var translator = require.main.require('./public/src/modules/translator'),

	Middlewares = {};

Middlewares.requireSecondFactor = function(req, res, next) {
	if (req.session.hasOwnProperty('tfa') && req.session.tfa === true) {
		next();
	} else {
		translator.translate('[[2factor:second-factor-required]]', function(translated) {
			res.status(403).json({
				error: translated
			});
		});
	}
};

module.exports = Middlewares;