'use strict';

const translator = require.main.require('./src/translator');

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
