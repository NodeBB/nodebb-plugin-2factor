'use strict';

const passport = require.main.require('passport');
const passportTotp = require('passport-totp').Strategy;
const notp = require('notp');
const u2f = require('u2f');

const db = require.main.require('./src/database');
const nconf = require.main.require('nconf');
const async = require.main.require('async');
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const groups = require.main.require('./src/groups');
const notifications = require.main.require('./src/notifications');
const utils = require.main.require('./src/utils');
const translator = require.main.require('./src/translator');
const routeHelpers = require.main.require('./src/routes/helpers');
const controllerHelpers = require.main.require('./src/controllers/helpers');
const SocketPlugins = require.main.require('./src/socket.io/plugins');

const plugin = {};

plugin.init = function (params, callback) {
	const { router } = params;
	const hostMiddleware = params.middleware;
	const hostHelpers = require.main.require('./src/routes/helpers');
	const controllers = require('./lib/controllers');
	const middlewares = require('./lib/middlewares');

	// ACP
	hostHelpers.setupAdminPageRoute(router, '/admin/plugins/2factor', hostMiddleware, [hostMiddleware.pluginHooks], controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', hostMiddleware, [hostMiddleware.requireUser, hostMiddleware.exposeUid], controllers.renderSettings);

	// 2fa Login
	hostHelpers.setupPageRoute(router, '/login/2fa', hostMiddleware, [hostMiddleware.ensureLoggedIn], controllers.renderLogin);
	router.post('/login/2fa', hostMiddleware.ensureLoggedIn, controllers.processLogin, (req, res) => {
		req.session.tfa = true;
		delete req.session.tfaForce;
		req.session.meta.datetime = Date.now();
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});

	// 2fa backups codes
	hostHelpers.setupPageRoute(router, '/login/2fa/backup', hostMiddleware, [hostMiddleware.ensureLoggedIn], controllers.renderBackup);
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

	callback();
};

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const middlewares = [
		middleware.ensureLoggedIn,
	];

	routeHelpers.setupApiRoute(router, 'get', '/2factor/u2f/register', middlewares, (req, res) => {
		const registrationRequest = u2f.request(nconf.get('url'));
		req.session.registrationRequest = registrationRequest;
		helpers.formatApiResponse(200, res, registrationRequest);
	});

	routeHelpers.setupApiRoute(router, 'post', '/2factor/u2f/register', middlewares, (req, res) => {
		const result = u2f.checkRegistration(req.session.registrationRequest, req.body);
		if (result.successful) {
			plugin.saveU2F(req.uid, result);
			delete req.session.registrationRequest;
			helpers.formatApiResponse(200, res);
		} else {
			throw new Error(result.errorMessage);
		}
	});

	// Note: auth request generated in Controllers.renderLogin
	routeHelpers.setupApiRoute(router, 'post', '/2factor/u2f/verify', middlewares, async (req, res) => {
		const publicKey = await plugin.getU2fKey(req.uid);
		const result = u2f.checkSignature(req.session.authRequest, req.body.authResponse, publicKey);
		if (result.successful) {
			req.session.tfa = true;
			delete req.session.authRequest;
			delete req.session.tfaForce;
			req.session.meta.datetime = Date.now();

			helpers.formatApiResponse(200, res, {
				next: req.query.next || '/',
			});
		} else {
			throw new Error(result.errorMessage);
		}
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

plugin.getU2fKey = async (uid) => {
	const keys = await db.getSetMembers(`2factor:u2f:${uid}`);
	return keys.length ? keys.pop() : false; // Currently only supports one key
};

plugin.getU2fKeyHandle = async publicKey => db.getObjectField('2factor:u2f', publicKey);

plugin.save = function (uid, key, callback) {
	db.setObjectField('2factor:uid:key', uid, key, callback);
};

plugin.saveU2F = (uid, { publicKey, keyHandle }) => {
	db.setObjectField('2factor:u2f', publicKey, keyHandle);
	db.setAdd(`2factor:u2f:${uid}`, publicKey);
};

plugin.hasU2f = async uid => (await db.setCount(`2factor:u2f:${uid}`)) > 0;

plugin.hasTotp = async uid => db.isObjectField('2factor:uid:key', uid);

plugin.hasKey = async (uid) => {
	const [hasTotp, u2fCount] = await Promise.all([
		db.isObjectField('2factor:uid:key', uid),
		db.setCount(`2factor:u2f:${uid}`),
	]);

	return hasTotp || u2fCount > 0;
};

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
	const keys = await db.getSetMembers(`2factor:u2f:${uid}`);
	await db.deleteObjectFields(`2factor:u2f`, keys);
	await db.delete(`2factor:u2f:${uid}`);
};

plugin.check = async ({ req, res }) => {
	if (!req.user || req.session.tfa === true) {
		return;
	}

	const exemptPaths = ['/login/2fa', '/login/2fa/backup', '/2factor/u2f/verify'];
	if (exemptPaths.some(path => req.path === path || req.path === `/api${path}`)) {
		return;
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	const redirect = req.url ? req.url.replace('/api', '') : '/';

	if (await plugin.hasKey(req.user.uid)) {
		// Account has TFA, redirect to login
		controllerHelpers.redirect(res, `/login/2fa?next=${redirect}`);
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

plugin.updateTitle = function (data, callback) {
	translator.translate('[[2factor:title]]', (title) => {
		if (data.templateData.url.match(/user\/.+\/2factor/)) {
			data.templateData.title = title;
		}
		callback(null, data);
	});
};

plugin.adjustRelogin = async ({ req, res }) => {
	if (await plugin.hasKey(req.uid)) {
		req.session.forceLogin = 0;
		req.session.tfaForce = 1;
		controllerHelpers.redirect(res, `/login/2fa?next=${req.session.returnTo}`);
	}
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
