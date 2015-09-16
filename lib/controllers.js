'use strict';

var parent = module.parent.exports,
	passport = require.main.require('passport'),
	nconf = require.main.require('nconf'),
	async = require.main.require('async'),
	fs = require('fs'),
	path = require('path'),
	Controllers = {};

Controllers.renderLogin = function(req, res, next) {
	if (req.session.tfa === true) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	var error = req.flash('error');

	parent.hasKey(req.user.uid, function(err, hasKey) {
		if (err) {
			return next(err);
		}

		if (!hasKey) {
			return next();
		}

		setTimeout(function() {
			res.render('login-2factor', {
				error: error[0]
			});
		}, error.length ? 2500 : undefined);
	});
};

Controllers.processLogin = function(req, res, next) {
	passport.authenticate('totp', { failureRedirect: nconf.get('relative_path') + '/login/2fa', failureFlash: '[[2factor:login.failure]]' })(req, res, next);
};

Controllers.renderBackup = function(req, res, next) {
	if (req.session.tfa === true) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	var error = req.flash('error');

	parent.hasKey(req.user.uid, function(err, hasKey) {
		if (err) {
			return next(err);
		}

		if (!hasKey) {
			return next();
		}

		setTimeout(function() {
			res.render('backup-code-2factor', {
				error: error[0]
			});
		}, error.length ? 2500 : undefined);
	});
};

Controllers.generateBackupCodes = function(req, res, next) {
	parent.generateBackupCodes(req.user.uid, function(err, codes) {
		if (err) {
			winston.error('[plugin/2factor] Could not generate new backup codes for uid ' + req.user.uid + '! Error: ' + err.message);
			return res.sendStatus(500);
		}

		res.status(200).json({
			codes: codes
		});
	});
};

Controllers.processBackup = function(req, res, next) {
	parent.useBackupCode(req.body.code, req.user.uid, function(err, success) {
		if (err || !success) {
			req.flash('error', !err ? '[[2factor:backup.failure]]' : err.message);
			res.redirect(nconf.get('relative_path') + '/login/2fa/backup');
		} else {
			// Success!
			next();
		}
	});
};

Controllers.renderAdminPage = function(req, res, next) {
	async.parallel({
		image: async.apply(fs.readFile, path.join(__dirname, '../screenshots/profile.png'), {
			encoding: 'base64'
		}),
		users: async.apply(parent.getUsers)
	}, function(err, data) {
		res.render('admin/plugins/2factor', data);
	});
};

Controllers.renderSettings = function(req, res, next) {
	if (res.locals.uid !== req.user.uid) {
		return res.render('403', {});
	}

	parent.hasKey(req.user.uid, function(err, hasKey) {
		res.render('account/2factor', {
			showSetup: !hasKey
		});
	});
};

module.exports = Controllers;