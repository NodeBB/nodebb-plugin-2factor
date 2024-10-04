'use strict';

(async () => {
	const hooks = await app.require('hooks');
	hooks.on('filter:admin.reauth', (data) => {
		if (config['2factor'].hasKey) {
			data.url = `/login/2fa?next=/${ajaxify.currentPage}`;
		}

		return data;
	});
})();
