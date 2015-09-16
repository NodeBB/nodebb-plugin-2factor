define('forum/backup-code-2factor', function() {
	var Plugin = {};

	Plugin.init = function() {
		$('input#code').focus();
	};

	return Plugin;
});