'use strict';

const translator = nodebb.require('./src/translator');
const user = nodebb.require('./src/user');
const helpers = nodebb.require('./src/controllers/helpers');

const Middlewares = module.exports;

Middlewares.requireSecondFactor = function (req, res, next) {
	if (req.session.hasOwnProperty('tfa') && req.session.tfa === true) {
		next();
	} else {
		translator.translate('[[2factor:second-factor-required]]', (translated) => {
			res.status(403).json({
				error: translated,
			});
		});
	}
};

// Require the account password before a destructive 2FA change.
// SSO-only users have no local password, so the challenge is skipped.
Middlewares.requirePassword = async (req, res, next) => {
	if (!(await user.hasPassword(req.uid))) {
		return next();
	}

	const password = req.body && req.body.password;
	if (typeof password !== 'string' || !password.length) {
		return helpers.formatApiResponse(401, res, new Error('[[error:invalid-password]]'));
	}

	const valid = await user.isPasswordCorrect(req.uid, password, req.ip);
	if (!valid) {
		return helpers.formatApiResponse(401, res, new Error('[[error:invalid-password]]'));
	}

	return next();
};
