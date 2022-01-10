'use strict';

/* globals webauthnJSON */

define('forum/account/2factor', ['translator', 'benchpress', 'api', 'alerts'], function (translator, bch, api, alerts) {
	var Settings = {};

	Settings.init = function () {
		if (ajaxify.data.showSetup) {
			$('button[data-action="regenerateTOTP"]').on('click', Settings.setupTotp);
			$('button[data-action="regenerateU2F"]').on('click', Settings.setupAuthn);
		} else {
			$('button[data-action="disassociate"]').on('click', Settings.disassociate);
			$('button[data-action="generateBackupCodes"]').on('click', Settings.generateBackupCodes);
		}
	};

	Settings.setupTotp = function () {
		socket.emit('plugins.2factor.regenerate', function (err, data) {
			if (err) {
				return app.alertError(err);
			}

			bch.parse('partials/2factor/generate', data, function (html) {
				translator.translate(html, function (translatedHTML) {
					translator.translate('[[2factor:generate.title]]', function (title) {
						var modal = bootbox.dialog({
							title: title,
							message: translatedHTML,
						});
						var formEl = modal.find('form');
						var confirmEl = modal.find('button[data-action="confirm"]');
						var codeEl = modal.find('.2fa-confirm');

						confirmEl.on('click', function () {
							Settings.verifyTotp(data.key, codeEl.val(), modal);
						});

						formEl.on('submit', function (e) {
							e.preventDefault();
							Settings.verifyTotp(data.key, codeEl.val(), modal);
						});

						modal.on('shown.bs.modal', function () {
							codeEl.focus();
						});
					});
				});
			});
		});
	};

	Settings.setupAuthn = function () {
		this.classList.add('disabled');
		const modal = bootbox.dialog({
			message: '[[2factor:authn.modal.content]]',
			closeButton: false,
			className: 'text-center',
		});
		api.get('/plugins/2factor/authn/register', {}).then(async (request) => {
			try {
				const response = await webauthnJSON.create({
					publicKey: request,
				});
				modal.modal('hide');

				api.post('/plugins/2factor/authn/register', response).then(() => {
					alerts.success('[[2factor:authn.success]]');
					setTimeout(document.location.reload, 1000);
				}).catch(alerts.error);
			} catch (e) {
				modal.modal('hide');
				this.classList.remove('disabled');
				alerts.alert({
					message: '[[2factor:authn.error]]',
					timeout: 2500,
				});
			}
		});
	};

	Settings.verifyTotp = function (key, token, modal) {
		socket.emit('plugins.2factor.confirm', {
			key: key,
			token: token,
		}, function (err) {
			if (!err) {
				modal.modal('hide');
				ajaxify.refresh();
				translator.translate('[[2factor:generate.success]]', function (successText) {
					app.alertSuccess(successText);
				});
			} else {
				// Probably a bad validation code
				var inputEl = modal.find('.2fa-confirm');
				inputEl.parent().addClass('has-error');
			}
		});
	};

	Settings.disassociate = function () {
		translator.translate('[[2factor:disable.confirm]]', function (disableText) {
			bootbox.confirm(disableText, function (confirm) {
				if (confirm) {
					socket.emit('plugins.2factor.disassociate', function (err) {
						if (err) {
							return app.alertError(err.message);
						}

						ajaxify.refresh();
					});
				}
			});
		});
	};

	Settings.generateBackupCodes = function () {
		$.ajax(config.relative_path + '/login/2fa/backup', {
			method: 'put',
			headers: {
				'x-csrf-token': config.csrf_token,
			},
		}).done(function (data) {
			bch.parse('partials/2factor/generateBackupCodes', data, function (html) {
				translator.translate(html, function (translatedHTML) {
					translator.translate('[[2factor:backup.generate.title]]', function (title) {
						bootbox.dialog({
							title: title,
							message: translatedHTML,
							onEscape: true,
						});
					});
				});
			});
		});
	};

	return Settings;
});
