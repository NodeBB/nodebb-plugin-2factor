'use strict';

/* global $, app, socket, define, bootbox, ajaxify */

define('admin/plugins/2factor', ['settings', 'autocomplete'], function (Settings, autocomplete) {
	var ACP = {};

	ACP.init = function () {
		Settings.load('2factor', $('.2factor-settings'));

		$('#save').on('click', function () {
			Settings.save('2factor', $('.2factor-settings'), function () {
				app.alert({
					type: 'success',
					alert_id: '2factor-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function () {
						socket.emit('admin.reload');
					},
				});
			});
		});

		autocomplete.user($('input[name="disassociate"]'), function (ev, ui) {
			var uid = ui.item.user.uid;
			var username = ui.item.user.name;

			bootbox.confirm('Are you sure you wish to deactivate 2FA for <strong>' + username + '</strong>?', function (confirm) {
				if (confirm) {
					socket.emit('plugins.2factor.admin.disassociate', {
						uid: uid,
					}, function (err) {
						if (!err) {
							app.alertSuccess('Deactivated 2FA for ' + username);
							ajaxify.refresh();
						}
					});
				}
			});
		});
	};

	return ACP;
});
