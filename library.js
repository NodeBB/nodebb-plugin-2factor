"use strict";

var passport = module.parent.require('passport'),
	passportTotp = require('passport-totp').Strategy,
	loggedIn = module.parent.require('connect-ensure-login'),

	db = module.parent.require('./database'),
	nconf = module.parent.require('nconf'),
	async = module.parent.require('async'),
	user = module.parent.require('./user'),
	notifications = module.parent.require('./notifications'),
	meta = module.parent.require('./meta'),
	utils = module.parent.require('../public/src/utils'),
	translator = module.parent.require('../public/src/modules/translator'),
	routeHelpers = module.parent.require('./controllers/helpers'),

	SocketPlugins = require.main.require('./src/socket.io/plugins'),
	plugin = {};

plugin.init = function(params, callback) {
	var router = params.router,
		hostMiddleware = params.middleware,
		hostControllers = params.controllers,
		hostHelpers = require.main.require('./src/routes/helpers'),
		controllers = require('./lib/controllers'),
		middlewares = require('./lib/middlewares');
		
	// ACP
	router.get('/admin/plugins/2factor', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	router.get('/api/admin/plugins/2factor', controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', hostMiddleware, [hostMiddleware.requireUser, hostMiddleware.exposeUid], controllers.renderSettings);

	// 2fa Login
	router.get('/login/2fa', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.get('/api/login/2fa', loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.post('/login/2fa', loggedIn.ensureLoggedIn(), controllers.processLogin, function(req, res) {
		req.session.tfa = true;
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});

	// 2fa backups codes
	router.get('/login/2fa/backup', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderBackup);
	router.get('/api/login/2fa/backup', loggedIn.ensureLoggedIn(), controllers.renderBackup);
	router.post('/login/2fa/backup', loggedIn.ensureLoggedIn(), controllers.processBackup, function(req, res) {
		req.session.tfa = true;
		res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	});
	router.put('/login/2fa/backup', hostMiddleware.requireUser, middlewares.requireSecondFactor, hostMiddleware.applyCSRF, controllers.generateBackupCodes);

	// Websockets
	SocketPlugins['2factor'] = require('./websockets');

	// Login Strategy
	passport.use(new passportTotp(
		function(user, done) {
			plugin.get(user.uid, function(err, key) {
				if (err) { return done(err); }
				return done(null, key, 30);
			});
		}
	));

	callback();
};

plugin.addAdminNavigation = function(header, callback) {
	translator.translate('[[2factor:title]]', function(title) {
		header.plugins.push({
			route: '/plugins/2factor',
			icon: 'fa-lock',
			name: title
		});

		callback(null, header);
	});
};

plugin.addProfileItem = function(links, callback) {
	translator.translate('[[2factor:title]]', function(title) {
		links.push({
			id: '2factor',
			route: '2factor',
			icon: 'fa-lock',
			name: title,
			public: false
		});

		callback(null, links);
	});
};

plugin.get = function(uid, callback) {
	db.getObjectField('2factor:uid:key', uid, callback);
};

plugin.save = function(uid, key, callback) {
	db.setObjectField('2factor:uid:key', uid, key, callback);
};

plugin.hasKey = function(uid, callback) {
	db.isObjectField('2factor:uid:key', uid, callback);
};

plugin.generateBackupCodes = function(uid, callback) {
	var set = '2factor:uid:' + uid + ':backupCodes',
		codes = [],
		code;

	for(var x=0;x<5;x++) {
		code = utils.generateUUID().replace('-', '').slice(0, 10);
		codes.push(code);
	}

	async.series([
		async.apply(db.delete, set),		// Invalidate all old codes
		async.apply(db.setAdd, set, codes),	// Save new codes
		function(next) {
			notifications.create({
				bodyShort: '[[2factor:notification.backupCode.generated]]',
				bodyLong: '',
				nid: '2factor.backupCode.generated-' + uid + '-' + Date.now(),
				from: uid,
				path: '/'
			}, function(err, notification) {
				if (!err && notification) {
					notifications.push(notification, [uid], next);
				}
			});
		}
	], function(err) {
		callback(err, codes);
	});
};

plugin.useBackupCode = function(code, uid, callback) {
	var set = '2factor:uid:' + uid + ':backupCodes';

	async.waterfall([
		async.apply(db.isSetMember, set, code),
		function(valid, next) {
			if (valid) {
				// Invalidate this backup code
				db.setRemove(set, code, function(err) {
					next(err, valid);
				});

				notifications.create({
					bodyShort: '[[2factor:notification.backupCode.used]]',
					bodyLong: '',
					nid: '2factor.backupCode.used-' + uid + '-' + Date.now(),
					from: uid,
					path: '/'
				}, function(err, notification) {
					if (!err && notification) {
						notifications.push(notification, [uid]);
					}
				});
			} else {
				next(null, valid);
			}
		}
	], callback);
};

plugin.disassociate = function(uid, callback) {
	async.parallel([
		async.apply(db.deleteObjectField, '2factor:uid:key', uid),
		async.apply(db.delete, '2factor:uid:' + uid + ':backupCodes')
	], callback);
};

plugin.check = function(req, res, next) {
	if (!req.user || req.session.tfa === true) {
		return next();
	}

	plugin.hasKey(req.user.uid, function(err, hasKey) {
		if (hasKey) {
			// Account has TFA, redirect to login
			routeHelpers.redirect(res, '/login/2fa' + (res.locals.isAPI ? '?next=' + req.url.replace('/api', '') : ''));
		} else {
			// No TFA setup
			return next();
		}
	})
};

plugin.clearSession = function(data, callback) {
	delete data.req.session.tfa;
	setImmediate(callback);
};

plugin.getUsers = function(callback) {
	async.waterfall([
		async.apply(db.getObjectKeys, '2factor:uid:key'),
		function(uids, next) {
			user.getUsersFields(uids, ['username', 'userslug', 'picture'], next);
		}
	], callback);
};

plugin.updateTitle = function(data, callback) {
	translator.translate('[[2factor:title]]', function(title) {
		if (data.fragment.match(/^user\/.+\/2factor/)) {
			data.parsed = title;
		}

		callback(null, data);
	});
};

module.exports = plugin;