'use strict';

const passport = require.main.require('passport');
const passportTotp = require('passport-totp').Strategy;
const loggedIn = require.main.require('connect-ensure-login');
const notp = require('notp');

const db = require.main.require('./src/database');
const nconf = require.main.require('nconf');
const async = require.main.require('async');
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const groups = require.main.require('./src/groups');
const notifications = require.main.require('./src/notifications');
const utils = require.main.require('./src/utils');
const translator = require.main.require('./src/translator');
const routeHelpers = require.main.require('./src/controllers/helpers');
const SocketPlugins = require.main.require('./src/socket.io/plugins');

const plugin = {};

plugin.init = function (params, callback) {
	var router = params.router;
	var hostMiddleware = params.middleware;
	var hostHelpers = require.main.require('./src/routes/helpers');
	var controllers = require('./lib/controllers');
	var middlewares = require('./lib/middlewares');

	// ACP
	hostHelpers.setupAdminPageRoute(router, '/admin/plugins/2factor', hostMiddleware, [hostMiddleware.pluginHooks], controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', hostMiddleware, [hostMiddleware.requireUser, hostMiddleware.exposeUid], controllers.renderSettings);

	// 2fa Login
	router.get('/login/2fa', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.get('/api/login/2fa', loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.post('/login/2fa', loggedIn.ensureLoggedIn(), controllers.processLogin, function (req, res) {
		req.session.tfa = true;
		delete req.session.tfaForce;
		req.session.meta.datetime = Date.now();
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});

	// 2fa backups codes
	router.get('/login/2fa/backup', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderBackup);
	router.get('/api/login/2fa/backup', loggedIn.ensureLoggedIn(), controllers.renderBackup);
	router.post('/login/2fa/backup', loggedIn.ensureLoggedIn(), controllers.processBackup, function (req, res) {
		req.session.tfa = true;
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});
	router.put('/login/2fa/backup', hostMiddleware.requireUser, middlewares.requireSecondFactor, hostMiddleware.applyCSRF, controllers.generateBackupCodes);

	// Websockets
	SocketPlugins['2factor'] = require('./websockets');

	// Login Strategy
	passport.use(new passportTotp(
		async function (user, done) {
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

plugin.addAdminNavigation = function (header, callback) {
	translator.translate('[[2factor:title]]', function (title) {
		header.plugins.push({
			route: '/plugins/2factor',
			icon: 'fa-lock',
			name: title,
		});

		callback(null, header);
	});
};

plugin.addProfileItem = function (data, callback) {
	translator.translate('[[2factor:title]]', function (title) {
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

plugin.save = function (uid, key, callback) {
	db.setObjectField('2factor:uid:key', uid, key, callback);
};

plugin.hasKey = async uid => db.isObjectField('2factor:uid:key', uid);

plugin.generateBackupCodes = function (uid, callback) {
	var set = '2factor:uid:' + uid + ':backupCodes';
	var codes = [];
	var code;

	for (var x = 0; x < 5; x++) {
		code = utils.generateUUID().replace('-', '').slice(0, 10);
		codes.push(code);
	}

	async.series([
		async.apply(db.delete, set),		// Invalidate all old codes
		async.apply(db.setAdd, set, codes),	// Save new codes
		function (next) {
			notifications.create({
				bodyShort: '[[2factor:notification.backupCode.generated]]',
				bodyLong: '',
				nid: '2factor.backupCode.generated-' + uid + '-' + Date.now(),
				from: uid,
				path: '/',
			}, function (err, notification) {
				if (!err && notification) {
					notifications.push(notification, [uid], next);
				}
			});
		},
	], function (err) {
		callback(err, codes);
	});
};

plugin.useBackupCode = function (code, uid, callback) {
	var set = '2factor:uid:' + uid + ':backupCodes';

	async.waterfall([
		async.apply(db.isSetMember, set, code),
		function (valid, next) {
			if (valid) {
				// Invalidate this backup code
				db.setRemove(set, code, function (err) {
					next(err, valid);
				});

				notifications.create({
					bodyShort: '[[2factor:notification.backupCode.used]]',
					bodyLong: '',
					nid: '2factor.backupCode.used-' + uid + '-' + Date.now(),
					from: uid,
					path: '/',
				}, function (err, notification) {
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

plugin.disassociate = function (uid, callback) {
	async.parallel([
		async.apply(db.deleteObjectField, '2factor:uid:key', uid),
		async.apply(db.delete, '2factor:uid:' + uid + ':backupCodes'),
	], callback);
};

plugin.check = async (req, res, next) => {
	if (!req.user || req.session.tfa === true) {
		return next();
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	const redirect = req.url ? req.url.replace('/api', '') : '/';

	if (await plugin.hasKey(req.user.uid)) {
		// Account has TFA, redirect to login
		return routeHelpers.redirect(res, '/login/2fa?next=' + redirect);
	} else if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.uid, tfaEnforcedGroups)).includes(true)) {
		if (req.url.startsWith('/admin') || (!req.url.startsWith('/admin') && !req.url.match('2factor'))) {
			return routeHelpers.redirect(res, '/me/2factor?next=' + redirect);
		}
	}

	// No TFA setup
	return next();
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
	translator.translate('[[2factor:title]]', function (title) {
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
		routeHelpers.redirect(res, '/login/2fa?next=' + req.session.returnTo);
	}
};

plugin.integrations = {};

plugin.integrations.writeApi = async (data) => {
	const routeTest = /^\/api\/v\d\/users\/\d+\/tokens\/?/;
	const uidMatch = data.route.match(/(\d+)\/tokens$/);
	const uid = uidMatch ? parseInt(uidMatch[1], 10) : 0;

	// Enforce 2FA on token generation route
	if (data.method === 'POST' && routeTest.test(data.route) && await plugin.hasKey(uid)) {
		if (!data.req.headers.hasOwnProperty('x-two-factor-authentication')) {
			// No 2FA received
			return data.res.status(400).json(data.errorHandler.generate(
				400, '2fa-enabled',
				'Two Factor Authentication is enabled for this route, please send in the appropriate additional header for authorization',
				['x-two-factor-authentication']
			));
		}

		const skew = notp.totp.verify(data.req.headers['x-two-factor-authentication'], await plugin.get(uid));
		if (!skew || Math.abs(skew.delta) > 2) {
			return data.res.status(400).json(data.errorHandler.generate(
				401, '2fa-failed',
				'The Two-Factor Authentication code provided is not correct or has expired'
			));
		}
	}
};

module.exports = plugin;
