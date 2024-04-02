'use strict';

(async () => {
	const hooks = await app.require('hooks');
	hooks.on('filter:admin.reauth', (data) => {
		data.url = `/login/2fa?next=/${ajaxify.currentPage}`;
		return data;
	});
})();
