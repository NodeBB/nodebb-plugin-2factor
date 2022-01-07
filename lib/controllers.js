'use strict';

const parent = module.parent.exports;

const passport = require.main.require('passport');
const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const validator = require.main.require('validator');
const async = require('async');
const fs = require('fs');
const path = require('path');
const base64url = require('base64url');

const groups = require.main.require('./src/groups');
const meta = require.main.require('./src/meta');
const accountHelpers = require.main.require('./src/controllers/accounts/helpers');
const helpers = require.main.require('./src/controllers/helpers');

const Controllers = {};


async function getGroups(set) {
	let groupNames = await groups.getGroups(set, 0, -1);
	groupNames = groupNames.filter(groupName => groupName && !groups.isPrivilegeGroup(groupName));

	return groupNames.map(groupName => ({
		name: validator.escape(String(groupName)),
		value: validator.escape(String(groupName)),
	}));
}

Controllers.renderLogin = async (req, res, next) => {
	if (req.session.tfa === true && ((req.query.next && !req.query.next.startsWith('/admin')) || !req.session.tfaForce)) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	const error = req.flash('error');

	if (!await parent.hasKey(req.uid)) {
		return next();
	}

	const keyIds = await parent.hasAuthn(req.uid) && await parent.getAuthnKeyIds(req.uid);
	let authnOptions;
	if (keyIds.length) {
		authnOptions = await parent._f2l.assertionOptions();
		authnOptions.allowCredentials = keyIds.map(keyId => ({
			id: keyId,
			type: 'public-key',
			transports: ['usb', 'ble', 'nfc'],
		}));
		authnOptions.challenge = base64url(authnOptions.challenge);
		req.session.authRequest = authnOptions.challenge;
	}

	setTimeout(() => {
		res.render('login-2factor', {
			error: error[0],
			authnOptions,
		});
	}, error.length ? 2500 : undefined);
};

Controllers.processLogin = function (req, res, next) {
	passport.authenticate('totp', { failureRedirect: `${nconf.get('relative_path')}/login/2fa`, failureFlash: '[[2factor:login.failure]]' })(req, res, next);
};

Controllers.renderBackup = async (req, res, next) => {
	if (req.session.tfa === true) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	const error = req.flash('error');

	if (!await parent.hasKey(req.user.uid)) {
		return next();
	}

	setTimeout(() => {
		res.render('backup-code-2factor', {
			error: error[0],
		});
	}, error.length ? 2500 : undefined);
};

Controllers.generateBackupCodes = function (req, res) {
	parent.generateBackupCodes(req.user.uid, (err, codes) => {
		if (err) {
			winston.error(`[plugin/2factor] Could not generate new backup codes for uid ${req.user.uid}! Error: ${err.message}`);
			return res.sendStatus(500);
		}

		res.status(200).json({
			codes: codes,
		});
	});
};

Controllers.processBackup = function (req, res, next) {
	parent.useBackupCode(req.body.code, req.user.uid, (err, success) => {
		if (err || !success) {
			req.flash('error', !err ? '[[2factor:backup.failure]]' : err.message);
			res.redirect(`${nconf.get('relative_path')}/login/2fa/backup`);
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
	}, (err, data) => {
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

	const [userData, settings] = await Promise.all([
		accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, req.query),
		meta.settings.get('2factor'),
	]);
	userData.breadcrumbs = helpers.buildBreadcrumbs([
		{
			text: userData.username,
			url: `/user/${userData.userslug}`,
		},
		{
			text: '[[2factor:title]]',
		},
	]);

	let { tfaEnforcedGroups } = settings;
	let forceTfa = false;

	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');
	if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.user.uid, tfaEnforcedGroups)).includes(true)) {
		forceTfa = true;
	}

	const hasKey = await parent.hasKey(req.user.uid);
	res.render('account/2factor', {
		...userData,
		showSetup: !hasKey,
		forceTfa: forceTfa,
	});
};

module.exports = Controllers;
