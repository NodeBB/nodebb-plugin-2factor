'use strict';

define('forum/login-2factor', ['api', 'alerts'], function (api, alerts) {
	var Plugin = {};

	Plugin.init = function () {
		if (ajaxify.data.challenge) {
			const authRequest = ajaxify.data.challenge;

			window.u2f.sign(authRequest.appId, authRequest.challenge, [authRequest], (authResponse) => {
				api.post(`/plugins/2factor/u2f/verify${document.location.search}`, { authResponse }).then(({ next }) => {
					document.location = next;
				}).catch((err) => {
					alerts.error(err);
					ajaxify.refresh();
				});
			});
		} else {
			$('input#code').focus();
		}
	};

	return Plugin;
});
