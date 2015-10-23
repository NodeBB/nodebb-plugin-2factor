define('forum/account/2factor', ['csrf'], function(csrf) {
	var Settings = {};

	Settings.init = function() {
		if (ajaxify.data.showSetup) {
			$('button[data-action="regenerate"]').on('click', Settings.beginSetup);
		} else {
			$('button[data-action="disassociate"]').on('click', Settings.disassociate);
			$('button[data-action="generateBackupCodes"').on('click', Settings.generateBackupCodes);
		}
	};

	Settings.beginSetup = function() {
		socket.emit('plugins.2factor.regenerate', function(err, data) {
			templates.parse('partials/2factor/generate', data, function(html) {
				translator.translate(html, function(translatedHTML) {
					translator.translate('[[2factor:generate.title]]', function(title) {
						var modal = bootbox.dialog({
								title: title,
								message: translatedHTML
							}),
							formEl = modal.find('form'),
							confirmEl = modal.find('button[data-action="confirm"]'),
							codeEl = modal.find('.2fa-confirm');

						confirmEl.on('click', function() {
							Settings.completeSetup(data.key, codeEl.val(), modal);
						});

						formEl.on('submit', function(e) {
							e.preventDefault()
							Settings.completeSetup(data.key, codeEl.val(), modal);
						});

						modal.on('shown.bs.modal', function() {
							codeEl.focus();
						});
					});
				});
			});
		});
	};

	Settings.completeSetup = function(key, token, modal) {
		socket.emit('plugins.2factor.confirm', {
			key: key,
			token: token
		}, function(err, data) {
			if (!err) {
				modal.modal('hide');
				ajaxify.refresh();
				translator.translate('[[2factor:generate.success]]', function(successText) {
					app.alertSuccess(successText);
				});
			} else {
				// Probably a bad validation code
				var inputEl = modal.find('.2fa-confirm');
				inputEl.parent().addClass('has-error');
			}
		});
	};

	Settings.disassociate = function() {
		translator.translate('[[2factor:disable.confirm]]', function(disableText) {
			bootbox.confirm(disableText, function(confirm) {
				if (confirm) {
					socket.emit('plugins.2factor.disassociate', function(err) {
						if (err) {
							return app.alertError(err.message);
						}

						ajaxify.refresh();
					});
				}
			});
		});
	};

	Settings.generateBackupCodes = function() {
		$.ajax(config.relative_path + '/login/2fa/backup', {
			method: 'put',
			headers: {
				'x-csrf-token': csrf.get()
			}
		}).success(function(data) {
			templates.parse('partials/2factor/generateBackupCodes', data, function(html) {
				translator.translate(html, function(translatedHTML) {
					translator.translate('[[2factor:backup.generate.title]]', function(title) {
						var modal = bootbox.dialog({
							title: title,
							message: translatedHTML,
							onEscape: true
						});
					});
				});
			});
		});
	};

	return Settings;
});