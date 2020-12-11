'use strict';

const parent = module.parent.exports;

const passport = require.main.require('passport');
const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const validator = require.main.require('validator');
const async = require('async');
const fs = require('fs');
const path = require('path');

const groups = require.main.require('./src/groups');
const meta = require.main.require('./src/meta');

const Controllers = {};


async function getGroups(set) {
	let groupNames = await groups.getGroups(set, 0, -1);
	groupNames = groupNames.filter(function (groupName) {
		return groupName && !groups.isPrivilegeGroup(groupName);
	});

	return groupNames.map(function (groupName) {
		return {
			name: validator.escape(String(groupName)),
			value: validator.escape(String(groupName)),
		};
	});
}

Controllers.renderLogin = async (req, res, next) => {
	if (req.session.tfa === true && (!req.query.next.startsWith('/admin') || !req.session.tfaForce)) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	var error = req.flash('error');

	if (!await parent.hasKey(req.user.uid)) {
		return next();
	}

	setTimeout(function () {
		res.render('login-2factor', {
			error: error[0],
		});
	}, error.length ? 2500 : undefined);
};

Controllers.processLogin = function (req, res, next) {
	passport.authenticate('totp', { failureRedirect: nconf.get('relative_path') + '/login/2fa', failureFlash: '[[2factor:login.failure]]' })(req, res, next);
};

Controllers.renderBackup = async (req, res, next) => {
	if (req.session.tfa === true) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	var error = req.flash('error');

	if (!await parent.hasKey(req.user.uid)) {
		return next();
	}

	setTimeout(function () {
		res.render('backup-code-2factor', {
			error: error[0],
		});
	}, error.length ? 2500 : undefined);
};

Controllers.generateBackupCodes = function (req, res) {
	parent.generateBackupCodes(req.user.uid, function (err, codes) {
		if (err) {
			winston.error('[plugin/2factor] Could not generate new backup codes for uid ' + req.user.uid + '! Error: ' + err.message);
			return res.sendStatus(500);
		}

		res.status(200).json({
			codes: codes,
		});
	});
};

Controllers.processBackup = function (req, res, next) {
	parent.useBackupCode(req.body.code, req.user.uid, function (err, success) {
		if (err || !success) {
			req.flash('error', !err ? '[[2factor:backup.failure]]' : err.message);
			res.redirect(nconf.get('relative_path') + '/login/2fa/backup');
		} else {
			// Success!
			next();
		}
	});
};

Controllers.renderAdminPage = async function (req, res, next) {
	const groups = await getGroups('groups:createtime');

	async.parallel({
		image: async.apply(fs.readFile, path.join(__dirname, '../screenshots/profile.png'), {
			encoding: 'base64',
		}),
		users: async.apply(parent.getUsers),
	}, function (err, data) {
		if (err) {
			return next(err);
		}

		data.groups = groups;

		res.render('admin/plugins/2factor', data);
	});
};

Controllers.renderSettings = async (req, res) => {
	if (res.locals.uid !== req.user.uid) {
		return res.render('403', {});
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	let forceTfa = false;

	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');
	if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.user.uid, tfaEnforcedGroups)).includes(true)) {
		forceTfa = true;
	}

	const hasKey = await parent.hasKey(req.user.uid);
	res.render('account/2factor', {
		showSetup: !hasKey,
		forceTfa: forceTfa,
	});
};

module.exports = Controllers;
