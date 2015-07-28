"use strict";

var passport = module.parent.require('passport'),
	passportTotp = require('passport-totp').Strategy,
	loggedIn = module.parent.require('connect-ensure-login'),

	db = module.parent.require('./database'),
	nconf = module.parent.require('nconf'),

	SocketPlugins = require.main.require('./src/socket.io/plugins'),
	plugin = {};

plugin.init = function(params, callback) {
	var router = params.router,
		hostMiddleware = params.middleware,
		hostControllers = params.controllers,
		controllers = require('./lib/controllers');
		
	// ACP
	router.get('/admin/plugins/2factor', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	router.get('/api/admin/plugins/2factor', controllers.renderAdminPage);

	// UCP
	router.get('/user/:userslug/2factor', hostMiddleware.buildHeader, hostMiddleware.requireUser, hostMiddleware.exposeUid, controllers.renderSettings);
	router.get('/api/user/:userslug/2factor', hostMiddleware.requireUser, hostMiddleware.exposeUid, controllers.renderSettings);

	// 2fa Login
	router.get('/login/2fa', hostMiddleware.buildHeader, loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.get('/api/login/2fa', loggedIn.ensureLoggedIn(), controllers.renderLogin);
	router.post('/login/2fa', loggedIn.ensureLoggedIn(), controllers.processLogin, function(req, res) {
		req.session.tfa = true;
		res.redirect(nconf.get('relative_path') + '/');
	});

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
	header.plugins.push({
		route: '/plugins/2factor',
		icon: 'fa-lock',
		name: 'Two-Factor Auth (TOTP)'
	});

	callback(null, header);
};

plugin.addProfileItem = function(links, callback) {
	links.push({
		id: '2factor',
		route: '2factor',
		icon: 'fa-lock',
		name: 'Two-Factor Authentication',
		public: false
	});

	callback(null, links);
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

plugin.disassociate = function(uid, callback) {
	db.deleteObjectField('2factor:uid:key', uid, callback);
};

plugin.check = function(req, res, next) {
	if (!req.user || req.session.tfa === true) {
		return next();
	}

	plugin.hasKey(req.user.uid, function(err, hasKey) {
		if (hasKey) {
			// Account has TFA, redirect to login
			if (!res.locals.isAPI) {
				res.redirect(nconf.get('relative_path') + '/login/2fa');
			} else {
				res.status(302).json('/login/2fa');
			}
		} else {
			// No TFA setup
			return next();
		}
	})
};

module.exports = plugin;