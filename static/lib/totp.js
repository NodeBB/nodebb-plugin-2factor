'use strict';

define('forum/login-totp', [], function () {
	var Plugin = {};

	Plugin.init = async () => {
		const codeEl = document.getElementById('code');
		const formEl = document.querySelector('#content form');
		const submitBtn = formEl.querySelector('button');
		if (codeEl) {
			codeEl.focus();

			codeEl.addEventListener('keyup', (e) => {
				const length = e.target.value.length;
				if (length === 6) {
					submitBtn.disabled = true;
					formEl.submit();
				}
			});
		}
	};

	return Plugin;
});
