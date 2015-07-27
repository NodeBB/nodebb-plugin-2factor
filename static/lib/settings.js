define('forum/account/2factor', function() {
	var Settings = {};

	Settings.init = function() {
		if (ajaxify.data.showSetup) {
			$('button[data-action="regenerate"]').on('click', Settings.beginSetup);
		} else {
			$('button[data-action="disassociate"]').on('click', Settings.disassociate);
		}
	};

	Settings.beginSetup = function() {
		socket.emit('plugins.2factor.regenerate', function(err, data) {
			templates.parse('partials/2factor/generate', data, function(html) {
				var modal = bootbox.dialog({
						title: 'Generate Token &amp; Set up Device',
						message: html
					}),
					confirmEl = modal.find('button[data-action="confirm"]'),
					codeEl = modal.find('.2fa-confirm');

				confirmEl.on('click', function() {
					Settings.completeSetup(data.key, codeEl.val(), modal);
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
				app.alertSuccess('Successfully enabled Two-Factor Authentication!');
			} else {
				app.alertError(err.message);
			}
		});
	};

	Settings.disassociate = function() {
		bootbox.confirm('Are you sure you wish to disable Two-Factor Authentication?', function(confirm) {
			if (confirm) {
				socket.emit('plugins.2factor.disassociate', function(err) {
					if (err) {
						return app.alertError(err.message);
					}

					ajaxify.refresh();
				});
			}
		});
	};

	return Settings;
});