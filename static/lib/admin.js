define('admin/plugins/2factor', ['settings'], function(Settings) {
	'use strict';
	/* globals $, app, socket, require */

	var ACP = {};

	ACP.init = function() {
		Settings.load('2factor', $('.2factor-settings'));

		$('#save').on('click', function() {
			Settings.save('2factor', $('.2factor-settings'), function() {
				app.alert({
					type: 'success',
					alert_id: '2factor-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function() {
						socket.emit('admin.reload');
					}
				});
			});
		});
	};

	return ACP;
});