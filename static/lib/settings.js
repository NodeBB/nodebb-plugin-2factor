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
		const itemEl = document.querySelector('[data-action="setupAuthn"]').closest('.list-group-item');
		let devicesHtml = '';
		if (devices.length > 0) {
			devicesHtml = '<div class="mt-2">';
			devices.forEach((device, index) => {
				const name = device.name || `Device ${index + 1}`;
				devicesHtml += `
					<div class="d-flex justify-content-between align-items-center mb-1 device-item" data-device-id="${device.id}">
						<span><i class="fa fa-key text-muted"></i> ${name}</span>
						<div>
							<button type="button" class="btn btn-sm btn-link device-rename" data-device-id="${device.id}" title="[[2factor:authn.rename]]"><i class="fa fa-edit"></i></button>
							<button type="button" class="btn btn-sm btn-link device-remove text-danger" data-device-id="${device.id}" title="[[2factor:authn.remove]]"><i class="fa fa-trash"></i></button>
						</div>
					</div>
				`;
			});
			devicesHtml += '</div>';
		}
		const existing = itemEl.querySelector('.device-list-container');
		if (existing) {
			existing.outerHTML = devicesHtml;
		} else {
			const container = document.createElement('div');
			container.className = 'device-list-container mt-2';
			container.innerHTML = devicesHtml;
			itemEl.appendChild(container);
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
				const response = await navigator.credentials.create({
					publicKey: request,
				});
				modal.modal('hide');

				api.post('/plugins/2factor/authn/register', { ...response, deviceName: deviceName && deviceName.trim() ? deviceName.trim() : undefined }).then(() => {
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
