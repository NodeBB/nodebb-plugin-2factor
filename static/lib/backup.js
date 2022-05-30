'use strict';

define('forum/login-backup', function () {
	var Plugin = {};

	Plugin.init = function () {
		document.getElementById('code').focus();
	};

	return Plugin;
});
