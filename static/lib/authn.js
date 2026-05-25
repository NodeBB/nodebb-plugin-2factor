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

	// Decode a credential id: Uint8Array passes through, strings are base64url-decoded
	function decodeId(id) {
		return id instanceof Uint8Array ? id : base64urlToUint8Array(id);
	}

	// Build WebAuthn assertion options from ajaxify.data
	function buildAssertionOptions(allowCredentials) {
		const authnOptions = JSON.parse(JSON.stringify(ajaxify.data.authnOptions || {}));
		authnOptions.challenge = base64urlToUint8Array(authnOptions.challenge);
		const creds = allowCredentials || authnOptions.allowCredentials;
		if (creds) {
			authnOptions.allowCredentials = creds.map(cred => ({
				...cred,
				id: decodeId(cred.id),
			}));
		}
		return authnOptions;
	}

	// Encode authResponse into JSON-serializable payload
	function buildPayload(authResponse) {
		return {
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
	}

	// Submit verification payload and handle redirect/error
	function submitVerification(payload, onDone) {
		api.post(`/plugins/2factor/authn/verify${document.location.search}`, payload)
			.then(({ next }) => {
				if (onDone) { onDone(next); }
			})
			.catch((err) => {
				alerts.error(err);
				ajaxify.refresh();
			});
	}

	// Perform WebAuthn assertion and verify
	Plugin.verify = async (allowCredentials, onDone) => {
		const abortController = new AbortController();
		hooks.on('action:ajaxify.start', () => {
			abortController.abort();
		});

		const authnOptions = buildAssertionOptions(allowCredentials);
		const authResponse = await navigator.credentials.get({
			publicKey: authnOptions,
			signal: abortController.signal,
		});

		const payload = buildPayload(authResponse);
		submitVerification(payload, onDone);
	};

	Plugin.init = async () => {
		const deviceSelect = document.getElementById('deviceSelect');
		const authBtn = document.getElementById('authBtn');

		if (deviceSelect && authBtn) {
			// Multiple devices - show device selection
			authBtn.addEventListener('click', async () => {
				const selectedId = deviceSelect.value;
				authBtn.disabled = true;
				try {
					await Plugin.verify([{ id: selectedId, type: 'public-key', transports: ['usb', 'ble', 'nfc'] }], (next) => {
						document.location = next;
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
				await Plugin.verify(null, (next) => {
					document.location = next;
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
