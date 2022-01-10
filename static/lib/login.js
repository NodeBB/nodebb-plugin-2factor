'use strict';

/* globals webauthnJSON */

define('forum/login-2factor', ['api', 'alerts', 'hooks'], function (api, alerts, hooks) {
	var Plugin = {};

	Plugin.init = async () => {
		if (ajaxify.data.authnOptions) {
			try {
				const abortController = new AbortController();
				hooks.on('action:ajaxify.start', () => {
					abortController.abort();
				});

				const authResponse = await webauthnJSON.get({
					publicKey: ajaxify.data.authnOptions,
					signal: abortController.signal,
				});

				api.post(`/plugins/2factor/authn/verify${document.location.search}`, { authResponse }).then(({ next }) => {
					const iconEl = document.getElementById('statusIcon');
					iconEl.classList.remove('fa-spinner');
					iconEl.classList.remove('fa-spin');
					iconEl.classList.add('fa-check');
					iconEl.classList.add('text-success');
					document.location = config.relative_path + next;
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
		} else {
			$('input#code').focus();
		}
	};

	return Plugin;
});
