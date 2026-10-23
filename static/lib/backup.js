'use strict';

define('forum/login-backup', function () {
	const Plugin = {};

	Plugin.init = function () {
		document.getElementById('code').focus();
	};

	return Plugin;
});
