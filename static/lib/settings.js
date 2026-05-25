'use strict';

define('forum/account/2factor', ['api', 'alerts', 'bootbox'], function (api, alerts, bootbox) {
	var Settings = {};

	Settings.init = function () {
		document.querySelector('#content .list-group').addEventListener('click', (e) => {
			if (!e.target.closest('[data-action]') || Array.from(e.target.classList).includes('text-muted')) {
				return;
			}

			const action = e.target.getAttribute('data-action');
			Settings[action].call(e.target);
		});

		// Render device list if WebAuthn is enabled
		if (ajaxify.data.hasAuthn) {
			Settings.renderDevicesList();
		}
	};

	Settings.setupTotp = function () {
		socket.emit('plugins.2factor.regenerate', async (err, data) => {
			if (err) {
				return alerts.error(err);
			}

			const message = await app.parseAndTranslate('partials/2factor/generate', data);
			const size = 'lg';

			var modal = bootbox.dialog({ title: '[[2factor:generate.title]]', message, size });
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
	};

	Settings.disableTotp = () => {
		bootbox.confirm('[[2factor:user.manage.disableTotp]]', function (confirm) {
			if (confirm) {
				api.del('/plugins/2factor/totp').then(ajaxify.refresh).catch(alerts.error);
			}
		});
	};

	Settings.getAuthnDevices = async () => {
		try {
			const response = await api.get('/plugins/2factor/authn/devices');
			return response.devices || [];
		} catch (e) {
			alerts.error(e);
			return [];
		}
	};

	Settings.renderDevicesList = async () => {
		const devices = await Settings.getAuthnDevices();
		app.parseAndTranslate('partials/2factor/deviceList', { devices }, (html) => {
			const itemEl = document.querySelector('[data-action="setupAuthn"]').closest('.list-group-item');
			const container = itemEl.querySelector('.device-list-container');
			if (container) {
				$(container).html(html);
			}
			// Attach event listeners for rename/remove
			document.querySelectorAll('.device-rename').forEach(btn => {
				btn.addEventListener('click', (e) => {
					const deviceId = e.target.closest('.device-rename').getAttribute('data-device-id');
					Settings.renameDevice(deviceId);
				});
			});
			document.querySelectorAll('.device-remove').forEach(btn => {
				btn.addEventListener('click', (e) => {
					const deviceId = e.target.closest('.device-remove').getAttribute('data-device-id');
					Settings.removeDevice(deviceId);
				});
			});
		});
	};

	Settings.renameDevice = (deviceId) => {
		bootbox.prompt('[[2factor:authn.rename.prompt]]', function (result) {
			if (result && result.trim()) {
				api.patch('/plugins/2factor/authn/device', { id: deviceId, name: result.trim() })
					.then(() => {
						alerts.success('[[2factor:authn.renamed]]');
						Settings.renderDevicesList();
					})
					.catch(alerts.error);
			}
		});
	};

	Settings.removeDevice = (deviceId) => {
		bootbox.confirm('[[2factor:authn.remove.confirm]]', function (confirm) {
			if (confirm) {
				api.del(`/plugins/2factor/authn/device/${deviceId}`)
					.then(() => {
						alerts.success('[[2factor:authn.removed]]');
						Settings.renderDevicesList();
					})
					.catch(alerts.error);
			}
		});
	};

	Settings.disableAuthn = () => {
		bootbox.confirm('[[2factor:user.manage.disableAuthn]]', function (confirm) {
			if (confirm) {
				api.del('/plugins/2factor/authn').then(ajaxify.refresh).catch(alerts.error);
			}
		});
	};

	// Decode base64url strings to Uint8Array for WebAuthn API
	function base64urlToUint8Array(str) {
		const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
		const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
		const binary = atob(base64 + pad);
		return Uint8Array.from(binary, c => c.charCodeAt(0));
	}

	// Encode ArrayBuffer/Uint8Array to base64url for JSON transmission
	function arrayBufferToBase64url(buffer) {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		bytes.forEach(b => { binary += String.fromCharCode(b); });
		const base64 = btoa(binary);
		return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
	}

	Settings.setupAuthn = function () {
		const self = this;
		self.classList.add('text-muted');
		bootbox.prompt('[[2factor:authn.register.prompt]]', async function (deviceName) {
			const modal = bootbox.dialog({
				message: '[[2factor:authn.modal.content]]',
				closeButton: false,
				className: 'text-center',
			});
			let request;
			try {
				request = await api.get('/plugins/2factor/authn/register', {});
			} catch (e) {
				modal.modal('hide');
				self.classList.remove('disabled');
				alerts.error(e);
				return;
			}
			try {
				// WebAuthn requires user.id and challenge as BufferSource (Uint8Array)
				request.user.id = base64urlToUint8Array(request.user.id);
				request.challenge = base64urlToUint8Array(request.challenge);
				const response = await navigator.credentials.create({
					publicKey: request,
				});
				modal.modal('hide');

				// Encode binary fields for JSON transmission
				const payload = {
					id: response.id,
					rawId: arrayBufferToBase64url(response.rawId),
					response: {
						attestationObject: arrayBufferToBase64url(response.response.attestationObject),
						clientDataJSON: arrayBufferToBase64url(response.response.clientDataJSON),
					},
					clientExtensionResults: response.getClientExtensionResults(),
					deviceName: deviceName && deviceName.trim() ? deviceName.trim() : undefined,
				};

				api.post('/plugins/2factor/authn/register', payload).then(() => {
					alerts.success('[[2factor:authn.success]]');
					Settings.renderDevicesList();
					ajaxify.refresh();
				}).catch(alerts.error);
			} catch (e) {
				modal.modal('hide');
				self.classList.remove('disabled');
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
				alerts.success('[[2factor:generate.success]]');
			} else {
				// Probably a bad validation code
				var inputEl = modal.find('.2fa-confirm');
				inputEl.parent().addClass('has-error');
			}
		});
	};

	Settings.generateBackupCodes = function () {
		$.ajax(config.relative_path + '/login/2fa/backup', {
			method: 'put',
			headers: {
				'x-csrf-token': config.csrf_token,
			},
		}).done(function (data) {
			app.parseAndTranslate('partials/2factor/generateBackupCodes', data, function (html) {
				bootbox.dialog({
					title: '[[2factor:backup.generate.title]]',
					message: html,
					onEscape: true,
				});
			});
		});
	};

	return Settings;
});
