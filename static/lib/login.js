'use strict';

/* globals webauthnJSON */

define('forum/login-2factor', ['api', 'alerts'], function (api, alerts) {
	var Plugin = {};

	Plugin.init = async () => {
		if (ajaxify.data.authnOptions) {
			try {
				const authResponse = await webauthnJSON.get({
					publicKey: ajaxify.data.authnOptions,
				});

				api.post(`/plugins/2factor/u2f/verify${document.location.search}`, { authResponse }).then(({ next }) => {
					document.location = next;
				}).catch((err) => {
					alerts.error(err);
					ajaxify.refresh();
				});
			} catch (e) {
				console.log(e);
			}
		} else {
			$('input#code').focus();
		}
	};

	return Plugin;
});
