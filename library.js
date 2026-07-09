'use strict';

const passport = nodebb.require('passport');
const passportTotp = require('passport-totp').Strategy;
const notp = require('notp');
const { Fido2Lib } = require('fido2-lib');
const base64url = require('base64url');

const db = nodebb.require('./src/database');
const nconf = nodebb.require('nconf');
const winston = nodebb.require('winston');
const user = nodebb.require('./src/user');
const meta = nodebb.require('./src/meta');
const groups = nodebb.require('./src/groups');
const plugins = nodebb.require('./src/plugins');
const notifications = nodebb.require('./src/notifications');
const utils = nodebb.require('./src/utils');
const routeHelpers = nodebb.require('./src/routes/helpers');
const controllerHelpers = nodebb.require('./src/controllers/helpers');
const SocketPlugins = nodebb.require('./src/socket.io/plugins');

const atob = base64str => Buffer.from(base64str, 'base64').toString('binary');
const guard = (path) => {
	let url = new URL(path, nconf.get('url'));
	url = url.hostname === nconf.get('url_parsed').hostname ? url : nconf.get('url');

	return url.toString();
};

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
	const hostHelpers = nodebb.require('./src/routes/helpers');
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
		res.redirect(guard(nconf.get('relative_path') + (req.query.next || '/')));
	});
	hostHelpers.setupPageRoute(router, '/login/2fa/authn', [hostMiddleware.ensureLoggedIn], controllers.renderAuthnChallenge);

	// 2fa backups codes
	hostHelpers.setupPageRoute(router, '/login/2fa/backup', [hostMiddleware.ensureLoggedIn], controllers.renderBackup);
	router.post('/login/2fa/backup', hostMiddleware.ensureLoggedIn, controllers.processBackup, (req, res) => {
		req.session.tfa = true;
		res.redirect(guard(nconf.get('relative_path') + (req.query.next || '/')));
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

	routeHelpers.setupApiRoute(router, 'get', '/2factor/authn/devices', middlewares, async (req, res) => {
		const devices = await plugin.getAuthnDevices(req.uid);
		helpers.formatApiResponse(200, res, { devices });
	});

	routeHelpers.setupApiRoute(router, 'patch', '/2factor/authn/device', middlewares, async (req, res) => {
		const { id, name } = req.body;
		if (typeof name !== 'string' || !name.trim()) {
			return helpers.formatApiResponse(400, res);
		}
		await plugin.renameDevice(req.uid, id, name.trim());
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/authn/device/:id', middlewares, async (req, res) => {
		await plugin.removeDevice(req.uid, req.params.id);
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'post', '/2factor/authn/register', middlewares, async (req, res) => {
		const attestationExpectations = {
			challenge: req.session.registrationRequest.challenge,
			origin: `${nconf.get('url_parsed').protocol}//${nconf.get('url_parsed').host}`,
			factor: 'second',
		};
		// fido2-lib 3.x expects rawId/id as ArrayBuffer, attestationObject/clientDataJSON as base64url strings
		if (typeof req.body.rawId === 'string') {
			const base64 = req.body.rawId.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.rawId = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		if (typeof req.body.id === 'string') {
			const base64 = req.body.id.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.id = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		const regResult = await plugin._f2l.attestationResult(req.body, attestationExpectations);
		const deviceName = typeof req.body.deviceName === 'string' && req.body.deviceName.trim() ? req.body.deviceName.trim() : undefined;
		plugin.saveAuthn(req.uid, regResult.authnrData, deviceName);
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
			userHandle: base64url(String(req.uid)),
		};

		// fido2-lib 3.x expects rawId/id as ArrayBuffer, authenticatorData/clientDataJSON as base64url strings
		if (typeof req.body.authResponse.rawId === 'string') {
			const base64 = req.body.authResponse.rawId.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.authResponse.rawId = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		if (typeof req.body.authResponse.id === 'string') {
			const base64 = req.body.authResponse.id.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.authResponse.id = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}

		const authnResult = await plugin._f2l.assertionResult(req.body.authResponse, expectations);
		const count = authnResult.authnrData.get('counter');
		await plugin.updateAuthnCount(req.body.authResponse.id, count);

		req.session.tfa = true;
		delete req.session.authRequest;
		delete req.session.tfaForce;
		req.session.meta.datetime = Date.now();

		helpers.formatApiResponse(200, res, {
			next: guard(req.query.next || '/'),
		});
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/totp', middlewares, async (req, res) => {
		await db.deleteObjectField('2factor:uid:key', req.uid);

		helpers.formatApiResponse(200, res);
	});
};

plugin.appendConfig = async (config) => {
	const hasKey = await plugin.hasKey(config.uid);
	config['2factor'] = { hasKey };
	return config;
};

plugin.addAdminNavigation = function (header) {
	header.plugins.push({
		route: '/plugins/2factor',
		icon: 'fa-lock',
		name: '[[2factor:title]]',
	});

	return header;
};

plugin.addProfileItem = function (data) {
	data.links.push({
		id: '2factor',
		route: '2factor',
		icon: 'fa-lock',
		name: '[[2factor:title]]',
		visibility: {
			self: true,
			other: false,
			moderator: false,
			globalMod: false,
			admin: false,
			canViewInfo: false,
		},
	});

	return data;
};

plugin.get = async uid => db.getObjectField('2factor:uid:key', uid);

plugin.getAuthnKeyIds = async (uid) => {
	const keys = await db.getObject(`2factor:webauthn:${uid}`);
	return keys ? Object.keys(keys) : [];
};

plugin.getAuthnDevices = async (uid) => {
	const keyIds = await plugin.getAuthnKeyIds(uid);
	const names = await db.getObject(`2factor:webauthn:${uid}:names`) || {};
	return keyIds.map(id => ({
		id,
		name: names[id] || `Device ${keyIds.indexOf(id) + 1}`,
	}));
};

plugin.getAuthnPublicKey = async (uid, id) => db.getObjectField(`2factor:webauthn:${uid}`, id);

plugin.getAuthnCount = async id => db.sortedSetScore(`2factor:webauthn:counters`, id);

plugin.updateAuthnCount = async (id, count) => db.sortedSetAdd(`2factor:webauthn:counters`, count, id);

plugin.save = function (uid, key) {
	return db.setObjectField('2factor:uid:key', uid, key);
};

plugin.saveAuthn = async (uid, authnrData, deviceName) => {
	const counter = authnrData.get('counter');
	const publicKey = authnrData.get('credentialPublicKeyPem');
	const id = base64url(authnrData.get('credId'));
	await db.setObjectField(`2factor:webauthn:${uid}`, id, publicKey);
	await db.sortedSetAdd(`2factor:webauthn:counters`, counter, id);
	if (deviceName) {
		await db.setObjectField(`2factor:webauthn:${uid}:names`, id, deviceName);
	}
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

plugin.generateBackupCodes = async (uid) => {
	const set = `2factor:uid:${uid}:backupCodes`;
	const codes = [];
	let code;

	for (let x = 0; x < 5; x++) {
		code = utils.generateUUID().replace('-', '').slice(0, 10);
		codes.push(code);
	}

	await db.delete(set); // Invalidate all old codes
	await db.setAdd(set, codes); // Save new codes

	const notification = await notifications.create({
		bodyShort: '[[2factor:notification.backupCode.generated]]',
		bodyLong: '',
		nid: `2factor.backupCode.generated-${uid}-${Date.now()}`,
		from: uid,
		path: '/',
	});

	if (notification) {
		await notifications.push(notification, [uid]);
	}

	return codes;
};

plugin.useBackupCode = async (code, uid) => {
	const set = `2factor:uid:${uid}:backupCodes`;

	const valid = await db.isSetMember(set, code);
	if (valid) {
		// Invalidate this backup code
		await db.setRemove(set, code);

		const notification = await notifications.create({
			bodyShort: '[[2factor:notification.backupCode.used]]',
			bodyLong: '',
			nid: `2factor.backupCode.used-${uid}-${Date.now()}`,
			from: uid,
			path: '/',
		});

		if (notification) {
			await notifications.push(notification, [uid]);
		}
	}

	return valid;
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
	await db.delete(`2factor:webauthn:${uid}:names`);
};

plugin.removeDevice = async (uid, id) => {
	await db.sortedSetRemove('2factor:webauthn:counters', id);
	await db.deleteObjectField(`2factor:webauthn:${uid}`, id);
	await db.deleteObjectField(`2factor:webauthn:${uid}:names`, id);
};

plugin.renameDevice = async (uid, id, newName) => {
	await db.setObjectField(`2factor:webauthn:${uid}:names`, id, newName);
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

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	if (await plugin.hasKey(data.socket.uid)) {
		winston.info(`[plugin/2factor] Denying socket access for uid ${data.socket.uid} pending second factor.`);
		throw new Error('[[2factor:second-factor-required]]');
	} else if (tfaEnforcedGroups.length) {
		const inEnforcedGroup = (await groups.isMemberOfGroups(
			data.socket.uid, tfaEnforcedGroups,
		)).includes(true);
		if (inEnforcedGroup) {
			winston.info(`[plugin/2factor] Denying socket access for uid ${data.socket.uid} — TFA enforced by group policy.`);
			throw new Error('[[2factor:second-factor-required]]');
		}
	}
};

plugin.clearSession = function (data) {
	if (data.req.session) {
		delete data.req.session.tfa;
	}
};

plugin.getUsers = async () => {
	const uids = await db.getObjectKeys('2factor:uid:key');
	return user.getUsersFields(uids, ['username', 'userslug', 'picture']);
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
