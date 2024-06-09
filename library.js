'use strict';

const passport = require.main.require('passport');
const passportTotp = require('passport-totp').Strategy;
const notp = require('notp');
const { Fido2Lib } = require('fido2-lib');
const base64url = require('base64url');

const db = require.main.require('./src/database');
const nconf = require.main.require('nconf');
const async = require.main.require('async');
const winston = require.main.require('winston');
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const groups = require.main.require('./src/groups');
const plugins = require.main.require('./src/plugins');
const notifications = require.main.require('./src/notifications');
const utils = require.main.require('./src/utils');
const translator = require.main.require('./src/translator');
const routeHelpers = require.main.require('./src/routes/helpers');
const controllerHelpers = require.main.require('./src/controllers/helpers');
const SocketPlugins = require.main.require('./src/socket.io/plugins');

const atob = base64str => Buffer.from(base64str, 'base64').toString('binary');

const plugin = {
	_f2l: undefined,
};

plugin.init = async (params) => {
	const { router } = params;
	const hostMiddleware = params.middleware;
	const accountMiddlewares = [
		hostMiddleware.exposeUid,
		hostMiddleware.ensureLoggedIn,
		hostMiddleware.canViewUsers,
		hostMiddleware.checkAccountPermissions,
		hostMiddleware.buildAccountData,
	];
	const hostHelpers = require.main.require('./src/routes/helpers');
	const controllers = require('./lib/controllers');
	const middlewares = require('./lib/middlewares');

	// Public-facing pages
	hostHelpers.setupPageRoute(router, '/2factor/access-notification', controllers.renderAccessNotificationHelp);

	// ACP
	hostHelpers.setupAdminPageRoute(router, '/admin/plugins/2factor', [hostMiddleware.pluginHooks], controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', accountMiddlewares, controllers.renderSettings);

	// 2fa Login
	hostHelpers.setupPageRoute(router, '/login/2fa', [hostMiddleware.ensureLoggedIn], controllers.renderChoices);
	hostHelpers.setupPageRoute(router, '/login/2fa/totp', [hostMiddleware.ensureLoggedIn], controllers.renderTotpChallenge);
	router.post('/login/2fa/totp', hostMiddleware.ensureLoggedIn, controllers.processTotpLogin, (req, res) => {
		req.session.tfa = true;
		delete req.session.tfaForce;
		req.session.meta.datetime = Date.now();
		user.auth.addSession(req.uid, req.sessionID, req.session.meta.uuid);
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});
	hostHelpers.setupPageRoute(router, '/login/2fa/authn', [hostMiddleware.ensureLoggedIn], controllers.renderAuthnChallenge);

	// 2fa backups codes
	hostHelpers.setupPageRoute(router, '/login/2fa/backup', [hostMiddleware.ensureLoggedIn], controllers.renderBackup);
	router.post('/login/2fa/backup', hostMiddleware.ensureLoggedIn, controllers.processBackup, (req, res) => {
		req.session.tfa = true;
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});
	router.put('/login/2fa/backup', hostMiddleware.requireUser, middlewares.requireSecondFactor, hostMiddleware.applyCSRF, controllers.generateBackupCodes);

	// Websockets
	SocketPlugins['2factor'] = require('./websockets');

	// Login Strategy
	passport.use(new passportTotp(
		async (user, done) => {
			try {
				const key = await plugin.get(user.uid);
				return done(null, key, 30);
			} catch (e) {
				return done(e);
			}
		}
	));

	// Fido2Lib instantiation
	plugin._f2l = new Fido2Lib({
		timeout: 60 * 1000, // 60 seconds
		rpId: nconf.get('url_parsed').hostname,
		rpName: meta.config.title || 'NodeBB',
	});

	// Configure 2FA path exemptions
	let prefixes = ['/reset', '/confirm'];
	let pages = ['/login/2fa', '/login/2fa/authn', '/login/2fa/totp', '/login/2fa/backup', '/2factor/authn/verify', '/register/complete'];
	let paths = ['/api/v3/plugins/2factor/authn/verify'];
	({ prefixes, pages, paths } = await plugins.hooks.fire('filter:2factor.exemptions', { prefixes, pages, paths }));
	pages = pages.reduce((memo, cur) => {
		memo.push(nconf.get('relative_path') + cur);
		memo.push(`${nconf.get('relative_path')}/api${cur}`);
		return memo;
	}, []);
	plugin.exemptions = {
		prefixes,
		paths: new Set(pages.concat(paths)),
	};
};

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const middlewares = [
		middleware.ensureLoggedIn,
	];

	routeHelpers.setupApiRoute(router, 'get', '/2factor/authn/register', middlewares, async (req, res) => {
		const registrationRequest = await plugin._f2l.attestationOptions();
		const userData = await user.getUserFields(req.uid, ['username', 'displayname']);
		registrationRequest.user = {
			id: base64url(String(req.uid)),
			name: userData.username,
			displayName: userData.displayname,
		};
		registrationRequest.challenge = base64url(registrationRequest.challenge);
		req.session.registrationRequest = registrationRequest;
		helpers.formatApiResponse(200, res, registrationRequest);
	});

	routeHelpers.setupApiRoute(router, 'post', '/2factor/authn/register', middlewares, async (req, res) => {
		const attestationExpectations = {
			challenge: req.session.registrationRequest.challenge,
			origin: `${nconf.get('url_parsed').protocol}//${nconf.get('url_parsed').host}`,
			factor: 'second',
		};
		req.body.rawId = Uint8Array.from(atob(base64url.toBase64(req.body.rawId)), c => c.charCodeAt(0)).buffer;
		const regResult = await plugin._f2l.attestationResult(req.body, attestationExpectations);
		plugin.saveAuthn(req.uid, regResult.authnrData);
		delete req.session.registrationRequest;
		req.session.tfa = true; // eliminate re-challenge on registration

		helpers.formatApiResponse(200, res);
	});

	// Note: auth request generated in Controllers.renderLogin
	routeHelpers.setupApiRoute(router, 'post', '/2factor/authn/verify', middlewares, async (req, res) => {
		const prevCounter = await plugin.getAuthnCount(req.body.authResponse.id);
		const publicKey = await plugin.getAuthnPublicKey(req.uid, req.body.authResponse.id);
		const expectations = {
			challenge: req.session.authRequest,
			origin: `${nconf.get('url_parsed').protocol}//${nconf.get('url_parsed').host}`,
			factor: 'second',
			publicKey,
			prevCounter,
			userHandle: null,
		};

		req.body.authResponse.rawId =
			Uint8Array.from(atob(base64url.toBase64(req.body.authResponse.rawId)), c => c.charCodeAt(0)).buffer;
		req.body.authResponse.response.userHandle = undefined;

		const authnResult = await plugin._f2l.assertionResult(req.body.authResponse, expectations);
		const count = authnResult.authnrData.get('counter');
		await plugin.updateAuthnCount(req.body.authResponse.id, count);

		req.session.tfa = true;
		delete req.session.authRequest;
		delete req.session.tfaForce;
		req.session.meta.datetime = Date.now();

		helpers.formatApiResponse(200, res, {
			next: req.query.next || '/',
		});
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/authn', middlewares, async (req, res) => {
		const { uid } = req;
		const keyIds = await db.getObjectKeys(`2factor:webauthn:${uid}`);
		await db.sortedSetRemove('2factor:webauthn:counters', keyIds);
		await db.delete(`2factor:webauthn:${uid}`);

		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/totp', middlewares, async (req, res) => {
		await db.deleteObjectField('2factor:uid:key', req.uid);

		helpers.formatApiResponse(200, res);
	});
};

plugin.addAdminNavigation = function (header, callback) {
	translator.translate('[[2factor:title]]', (title) => {
		header.plugins.push({
			route: '/plugins/2factor',
			icon: 'fa-lock',
			name: title,
		});

		callback(null, header);
	});
};

plugin.addProfileItem = function (data, callback) {
	translator.translate('[[2factor:title]]', (title) => {
		data.links.push({
			id: '2factor',
			route: '2factor',
			icon: 'fa-lock',
			name: title,
			visibility: {
				self: true,
				other: false,
				moderator: false,
				globalMod: false,
				admin: false,
			},
		});

		callback(null, data);
	});
};

plugin.get = async uid => db.getObjectField('2factor:uid:key', uid);

plugin.getAuthnKeyIds = async (uid) => {
	const keys = await db.getObject(`2factor:webauthn:${uid}`);
	return Object.keys(keys);
};

plugin.getAuthnPublicKey = async (uid, id) => db.getObjectField(`2factor:webauthn:${uid}`, id);

plugin.getAuthnCount = async id => db.sortedSetScore(`2factor:webauthn:counters`, id);

plugin.updateAuthnCount = async (id, count) => db.sortedSetAdd(`2factor:webauthn:counters`, count, id);

plugin.save = function (uid, key, callback) {
	db.setObjectField('2factor:uid:key', uid, key, callback);
};

plugin.saveAuthn = (uid, authnrData) => {
	const counter = authnrData.get('counter');
	const publicKey = authnrData.get('credentialPublicKeyPem');
	const id = base64url(authnrData.get('credId'));
	db.setObjectField(`2factor:webauthn:${uid}`, id, publicKey);
	db.sortedSetAdd(`2factor:webauthn:counters`, counter, id);
};

plugin.hasAuthn = async (uid) => {
	if (!(parseInt(uid, 10) > 0)) {
		return false;
	}
	return await db.exists(`2factor:webauthn:${uid}`);
};

plugin.hasTotp = async (uid) => {
	if (!(parseInt(uid, 10) > 0)) {
		return false;
	}
	return await db.isObjectField('2factor:uid:key', uid);
};

// hmm... remove?
plugin.hasKey = async (uid) => {
	const [hasTotp, hasAuthn] = await Promise.all([
		plugin.hasTotp(uid),
		plugin.hasAuthn(uid),
	]);

	return hasTotp || hasAuthn;
};

plugin.hasBackupCodes = async uid => db.exists(`2factor:uid:${uid}:backupCodes`);

plugin.countBackupCodes = async uid => db.setCount(`2factor:uid:${uid}:backupCodes`);

plugin.generateBackupCodes = function (uid, callback) {
	const set = `2factor:uid:${uid}:backupCodes`;
	const codes = [];
	let code;

	for (let x = 0; x < 5; x++) {
		code = utils.generateUUID().replace('-', '').slice(0, 10);
		codes.push(code);
	}

	async.series([
		async.apply(db.delete, set), // Invalidate all old codes
		async.apply(db.setAdd, set, codes), // Save new codes
		function (next) {
			notifications.create({
				bodyShort: '[[2factor:notification.backupCode.generated]]',
				bodyLong: '',
				nid: `2factor.backupCode.generated-${uid}-${Date.now()}`,
				from: uid,
				path: '/',
			}, (err, notification) => {
				if (!err && notification) {
					notifications.push(notification, [uid], next);
				}
			});
		},
	], (err) => {
		callback(err, codes);
	});
};

plugin.useBackupCode = function (code, uid, callback) {
	const set = `2factor:uid:${uid}:backupCodes`;

	async.waterfall([
		async.apply(db.isSetMember, set, code),
		function (valid, next) {
			if (valid) {
				// Invalidate this backup code
				db.setRemove(set, code, (err) => {
					next(err, valid);
				});

				notifications.create({
					bodyShort: '[[2factor:notification.backupCode.used]]',
					bodyLong: '',
					nid: `2factor.backupCode.used-${uid}-${Date.now()}`,
					from: uid,
					path: '/',
				}, (err, notification) => {
					if (!err && notification) {
						notifications.push(notification, [uid]);
					}
				});
			} else {
				next(null, valid);
			}
		},
	], callback);
};

plugin.disassociate = async (uid) => {
	await Promise.all([
		db.deleteObjectField('2factor:uid:key', uid),
		db.delete(`2factor:uid:${uid}:backupCodes`),
	]);

	// Clear U2F keys
	const keyIds = await db.getObjectKeys(`2factor:webauthn:${uid}`);
	await db.sortedSetRemove('2factor:webauthn:counters', keyIds);
	await db.delete(`2factor:webauthn:${uid}`);
};

plugin.overrideUid = async ({ req, locals }) => {
	if (req.uid && await plugin.hasKey(req.uid) && req.session.tfa !== true) {
		locals['2factor'] = req.uid;
		req.uid = 0;
		delete req.user;
		delete req.loggedIn;
	}

	return { req, locals };
};

plugin.check = async ({ req, res }) => {
	if (!req.user || req.session.tfa === true) {
		return;
	}

	const requestPath = req.baseUrl + req.path;
	if (plugin.exemptions.paths.has(requestPath) || plugin.exemptions.prefixes.some(prefix => requestPath.startsWith(nconf.get('relative_path') + prefix))) {
		return;
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	const redirect = requestPath
		.replace('/api', '')
		.replace(nconf.get('relative_path'), '');

	if (await plugin.hasKey(req.user.uid)) {
		if (!res.locals.isAPI) {
			// Account has TFA, redirect to login
			controllerHelpers.redirect(res, `/login/2fa?next=${redirect}`);
		} else {
			await controllerHelpers.formatApiResponse(401, res, new Error('[[2factor:second-factor-required]]'));
		}
	} else if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.uid, tfaEnforcedGroups)).includes(true)) {
		if (req.url.startsWith('/admin') || (!req.url.startsWith('/admin') && !req.url.match('2factor'))) {
			controllerHelpers.redirect(res, `/me/2factor?next=${redirect}`);
		}
	}

	// No TFA setup
};

plugin.checkSocket = async (data) => {
	if (!data.socket.uid || data.req.session.tfa === true) {
		return;
	}

	if (await plugin.hasKey(data.socket.uid)) {
		winston.info(`[plugin/2factor] Denying socket access for uid ${data.socket.uid} pending second factor.`);
		throw new Error('[[2factor:second-factor-required]]');
	}
};

plugin.clearSession = function (data, callback) {
	if (data.req.session) {
		delete data.req.session.tfa;
	}

	setImmediate(callback);
};

plugin.getUsers = function (callback) {
	async.waterfall([
		async.apply(db.getObjectKeys, '2factor:uid:key'),
		function (uids, next) {
			user.getUsersFields(uids, ['username', 'userslug', 'picture'], next);
		},
	], callback);
};

plugin.adjustRelogin = async ({ req, res }) => {
	if (await plugin.hasKey(req.uid)) {
		req.session.forceLogin = 0;
		req.session.tfaForce = 1;

		if (!res.locals.isAPI) {
			controllerHelpers.redirect(res, `/login/2fa?next=${req.session.returnTo}`);
		}
	}
};

plugin.handle2faFailure = async (uid) => {
	const notification = await notifications.create({
		bodyShort: '[[2factor:notification.failure]]',
		bodyLong: '',
		nid: `2factor.failure.${uid}-${Date.now()}`,
		from: uid,
		path: `/2factor/access-notification?when=${Date.now()}`,
	});

	await notifications.push(notification, [uid]);
};

plugin.integrations = {};

plugin.integrations.writeApi = async (data) => {
	const routeTest = /^\/api\/v\d\/users\/\d+\/tokens\/?/;
	const uidMatch = data.route.match(/(\d+)\/tokens$/);
	const uid = uidMatch ? parseInt(uidMatch[1], 10) : 0;

	// Enforce 2FA on token generation route
	if (data.method === 'POST' && routeTest.test(data.route) && await plugin.hasTotp(uid)) {
		if (!data.req.headers.hasOwnProperty('x-two-factor-authentication')) {
			// No 2FA received
			return data.res.status(400).json(data.errorHandler.generate(
				400, '2fa-enabled', 'Two Factor Authentication is enabled for this route, please send in the appropriate additional header for authorization', ['x-two-factor-authentication']
			));
		}

		const skew = notp.totp.verify(data.req.headers['x-two-factor-authentication'], await plugin.get(uid));
		if (!skew || Math.abs(skew.delta) > 2) {
			return data.res.status(400).json(data.errorHandler.generate(
				401, '2fa-failed', 'The Two-Factor Authentication code provided is not correct or has expired'
			));
		}
	}
};

module.exports = plugin;
