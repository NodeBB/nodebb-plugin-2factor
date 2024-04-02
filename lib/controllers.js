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
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const translator = require.main.require('./src/translator');
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

Controllers.renderChoices = async (req, res) => {
	const uid = res.locals['2factor'] || req.uid;
	const [hasAuthn, hasTotp, hasBackupCodes] = await Promise.all([
		parent.hasAuthn(uid),
		parent.hasTotp(uid),
		parent.hasBackupCodes(uid),
	]);
	const count = [hasAuthn, hasTotp, hasBackupCodes].reduce((count, cur) => count + (cur ? 1 : 0), 0);

	if (count === 1) {
		switch (true) {
			case hasAuthn:
				helpers.redirect(res, `/login/2fa/authn?single=1&next=${req.query.next || '/'}`);
				break;

			case hasTotp:
				helpers.redirect(res, `/login/2fa/totp?single=1&next=${req.query.next || '/'}`);
				break;

			case hasBackupCodes:
				helpers.redirect(res, `/login/2fa/backup?single=1&next=${req.query.next || '/'}`);
				break;
		}

		return;
	}

	res.render('2fa-choices', {
		hasAuthn,
		hasTotp,
		hasBackupCodes,
		next: req.query.next,
		title: '[[2factor:title]]',
	});
};

Controllers.renderTotpChallenge = async (req, res, next) => {
	const uid = res.locals['2factor'] || req.uid;
	const single = parseInt(req.query.single, 10) === 1;

	if (req.session.tfa === true && !req.session.tfaForce) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	const error = req.flash('error');
	if (error.includes('[[2factor:login.failure]]')) {
		const main = require('..');
		main.handle2faFailure(uid);
	}

	if (!await parent.hasTotp(uid)) {
		return next();
	}

	setTimeout(() => {
		res.render('login-totp', {
			single,
			error: error[0],
			next: req.query.next,
		});
	}, error.length ? 2500 : undefined);
};

Controllers.renderAuthnChallenge = async (req, res, next) => {
	const uid = res.locals['2factor'] || req.uid;
	const single = parseInt(req.query.single, 10) === 1;

	if (req.session.tfa === true && ((req.query.next && !req.query.next.startsWith('/admin')) || !req.session.tfaForce)) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	if (!await parent.hasAuthn(uid)) {
		return next();
	}

	const keyIds = await parent.getAuthnKeyIds(uid);
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

	res.render('login-authn', {
		single,
		authnOptions,
		next: req.query.next,
	});
};

Controllers.processTotpLogin = function (req, res, next) {
	passport.authenticate('totp', {
		failureRedirect: `${nconf.get('relative_path')}/login/2fa/totp`,
		failureFlash: '[[2factor:login.failure]]',
		keepSessionInfo: true,
	})(req, res, next);
};

Controllers.renderBackup = async (req, res, next) => {
	const uid = res.locals['2factor'] || req.uid;
	const single = parseInt(req.query.single, 10) === 1;

	if (req.session.tfa === true && ((req.query.next && !req.query.next.startsWith('/admin')) || !req.session.tfaForce)) {
		return res.redirect(nconf.get('relative_path') + (req.query.next || '/'));
	}

	const error = req.flash('error');

	if (!await parent.hasKey(uid)) {
		return next();
	}

	setTimeout(() => {
		res.render('login-backup', {
			single,
			error: error[0],
			next: req.query.next,
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
		data.title = '[[2factor:title]]';
		res.render('admin/plugins/2factor', data);
	});
};

Controllers.renderSettings = async (req, res) => {
	const { username, userslug } = await user.getUserFields(res.locals.uid, ['username', 'userslug']);
	if (res.locals.uid !== req.user.uid) {
		return helpers.notAllowed(req, res);
	}

	const title = await translator.translate('[[2factor:title]]');
	const breadcrumbs = helpers.buildBreadcrumbs([
		{
			text: username,
			url: `/user/${userslug}`,
		},
		{
			text: '[[2factor:title]]',
		},
	]);

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	let forceTfa = false;

	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');
	if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.user.uid, tfaEnforcedGroups)).includes(true)) {
		forceTfa = true;
	}

	const hasTotp = await parent.hasTotp(req.user.uid);
	const hasAuthn = await parent.hasAuthn(req.user.uid);
	res.render('account/2factor', {
		title,
		breadcrumbs,
		forceTfa,
		hasTotp,
		hasAuthn,
		backupCodeCount: await parent.countBackupCodes(req.user.uid),
	});
};

Controllers.renderAccessNotificationHelp = (req, res, next) => {
	const { when } = req.query;
	if (!when) {
		return next();
	}

	const date = new Date(parseInt(when, 10));
	res.render('2fa-access-notification', {
		timeString: date.toLocaleTimeString(date),
		dateString: date.toLocaleDateString(date),
	});
};

module.exports = Controllers;
