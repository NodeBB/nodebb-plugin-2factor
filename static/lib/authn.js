'use strict';

define('forum/login-authn', ['api', 'alerts', 'hooks'], function (api, alerts, hooks) {
	// Encode ArrayBuffer/Uint8Array to base64url for JSON transmission
	function arrayBufferToBase64url(buffer) {
		if (!buffer) return '';
		const bytes = new Uint8Array(buffer);
		let binary = '';
		bytes.forEach(b => { binary += String.fromCharCode(b); });
		const base64 = btoa(binary);
		return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
	}

	// Decode base64url strings to Uint8Array for WebAuthn API
	function base64urlToUint8Array(str) {
		const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
		const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
		const binary = atob(base64 + pad);
		return Uint8Array.from(binary, c => c.charCodeAt(0));
	}

	var Plugin = {};

	Plugin.init = async () => {
		const deviceSelect = document.getElementById('deviceSelect');
		const authBtn = document.getElementById('authBtn');

		if (deviceSelect && authBtn) {
			// Multiple devices - show device selection
			authBtn.addEventListener('click', async () => {
				const selectedId = deviceSelect.value;
				authBtn.disabled = true;
				try {
					const abortController = new AbortController();
					hooks.on('action:ajaxify.start', () => {
						abortController.abort();
					});

					// Build assertion options for the selected device only
					const authnOptions = JSON.parse(JSON.stringify(ajaxify.data.authnOptions || {}));
					authnOptions.challenge = base64urlToUint8Array(authnOptions.challenge);
					authnOptions.allowCredentials = [{
						id: selectedId,
						type: 'public-key',
						transports: ['usb', 'ble', 'nfc'],
					}];

					const authResponse = await navigator.credentials.get({
						publicKey: authnOptions,
						signal: abortController.signal,
					});

					// Encode binary fields for JSON transmission
					const payload = {
						authResponse: {
							id: authResponse.id,
							rawId: arrayBufferToBase64url(authResponse.rawId),
							response: {
								authenticatorData: arrayBufferToBase64url(authResponse.response.authenticatorData),
								clientDataJSON: arrayBufferToBase64url(authResponse.response.clientDataJSON),
								signature: arrayBufferToBase64url(authResponse.response.signature),
								userHandle: arrayBufferToBase64url(authResponse.response.userHandle),
							},
							clientExtensionResults: authResponse.getClientExtensionResults(),
						},
					};
					api.post(`/plugins/2factor/authn/verify${document.location.search}`, payload).then(({ next }) => {
						ajaxify.go(next.replace(config.relative_path, ''));
					}).catch((err) => {
						alerts.error(err);
						ajaxify.refresh();
					});
				} catch (e) {
					if (e.code !== 20) { // 20 is user canceled
						alerts.alert({
							title: '[[2factor:title]]',
							message: e.message,
							timeout: 2500,
						});
					}
					authBtn.disabled = false;
				}
			});
		} else {
			// Single device or no device selection - proceed directly
			try {
				const abortController = new AbortController();
				hooks.on('action:ajaxify.start', () => {
					abortController.abort();
				});

				const authnOptions = JSON.parse(JSON.stringify(ajaxify.data.authnOptions || {}));
				authnOptions.challenge = base64urlToUint8Array(authnOptions.challenge);
				const authResponse = await navigator.credentials.get({
					publicKey: authnOptions,
					signal: abortController.signal,
				});

				// Encode binary fields for JSON transmission
				const payload = {
					authResponse: {
						id: authResponse.id,
						rawId: arrayBufferToBase64url(authResponse.rawId),
						response: {
							authenticatorData: arrayBufferToBase64url(authResponse.response.authenticatorData),
							clientDataJSON: arrayBufferToBase64url(authResponse.response.clientDataJSON),
							signature: arrayBufferToBase64url(authResponse.response.signature),
							userHandle: arrayBufferToBase64url(authResponse.response.userHandle),
						},
						clientExtensionResults: authResponse.getClientExtensionResults(),
					},
				};
				api.post(`/plugins/2factor/authn/verify${document.location.search}`, payload).then(({ next }) => {
					const iconEl = document.getElementById('statusIcon');
					iconEl.classList.remove('fa-spinner');
					iconEl.classList.remove('fa-spin');
					iconEl.classList.add('fa-check');
					iconEl.classList.add('text-success');
					document.location = next;
				}).catch((err) => {
					alerts.error(err);
					ajaxify.refresh();
				});
			} catch (e) {
				if (e.code !== 20) { // 20 is user canceled
					alerts.alert({
						title: '[[2factor:title]]',
						message: e.message,
						timeout: 2500,
					});
				}

				const iconEl = document.getElementById('statusIcon');
				iconEl.classList.remove('fa-spinner');
				iconEl.classList.remove('fa-spin');
				iconEl.classList.add('fa-times');
				iconEl.classList.add('text-danger');
			}
		}
	};

	return Plugin;
});
