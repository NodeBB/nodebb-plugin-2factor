'use strict';

var passport = require.main.require('passport');
var passportTotp = require('passport-totp').Strategy;
var loggedIn = require.main.require('connect-ensure-login');
var LRU = require('lru-cache');

var db = require.main.require('./src/database');
var nconf = require.main.require('nconf');
var async = require.main.require('async');
var user = require.main.require('./src/user');
var notifications = require.main.require('./src/notifications');
var meta = require.main.require('./src/meta');
var utils = require.main.require('./src/utils');
var translator = require.main.require('./public/src/modules/translator');
var routeHelpers = require.main.require('./src/controllers/helpers');
var SocketPlugins = require.main.require('./src/socket.io/plugins');

var plugin = {
	_sessionLock: new LRU({
		maxAge: 1000 * 60 * 60 * 24 * (parseInt(meta.config.loginDays, 10) || 14),	// Match cookie expiration
	}),
};

plugin.init = function (params, callback) {
	var router = params.router;
	var hostMiddleware = params.middleware;
	var hostHelpers = require.main.require('./src/routes/helpers');
	var controllers = require('./lib/controllers');
	var middlewares = require('./lib/middlewares');

	// ACP
	router.get('/admin/plugins/2factor', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	router.get('/api/admin/plugins/2factor', controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', hostMiddleware, [hostMiddleware.requireUser, hostMiddleware.exposeUid], controllers.renderSettings);

	// 2fa Login
	router.get('/login/2fa', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.get('/api/login/2fa', loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.post('/login/2fa', loggedIn.ensureLoggedIn(), controllers.processLogin, function (req, res) {
		req.session.tfa = true;
		plugin._sessionLock.del(req.user.uid);

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
		function (user, done) {
			plugin.get(user.uid, function (err, key) {
				if (err) { return done(err); }
				return done(null, key, 30);
			});
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

plugin.get = function (uid, callback) {
	db.getObjectField('2factor:uid:key', uid, callback);
};

plugin.save = function (uid, key, callback) {
	db.setObjectField('2factor:uid:key', uid, key, callback);
};

plugin.hasKey = function (uid, callback) {
	db.isObjectField('2factor:uid:key', uid, callback);
};

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

				plugin._sessionLock.del(uid);

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

plugin.check = function (req, res, next) {
	if (!req.user || req.session.tfa === true) {
		return next();
	}

	plugin.hasKey(req.user.uid, function (err, hasKey) {
		if (err) {
			return next(err);
		}

		if (hasKey) {
			// Account has TFA, redirect to login
			routeHelpers.redirect(res, '/login/2fa?next=' + (req.url ? req.url.replace('/api', '') : '/'));
		} else {
			// No TFA setup
			return next();
		}
	});
};

plugin.clearSession = function (data, callback) {
	if (data.req.session) {
		delete data.req.session.tfa;
	}

	plugin._sessionLock.del(data.uid);
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

plugin.restrictMessages = function (data, callback) {
	var restricted = plugin._sessionLock.has(data.uid);

	if (restricted) {
		data.canGet = false;
	}

	callback(null, data);
};

plugin.restrictMessageSending = function (data, callback) {
	var restricted = plugin._sessionLock.has(data.uid);

	callback(restricted ? new Error('[[2factor:second-factor-required]]') : undefined);
};

module.exports = plugin;
