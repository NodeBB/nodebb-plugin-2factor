/**
 * You can run these tests by executing `npx mocha test/plugins-installed.js`
 * from the NodeBB root folder. The regular test runner will also run these
 * tests.
 *
 * Keep in mind tests do not activate all plugins, so if you are testing
 * hook listeners, socket.io, or mounted routes, you will need to add your
 * plugin to `config.json`, e.g.
 *
 * {
 *     "test_plugins": [
 *         "nodebb-plugin-2factor"
 *     ]
 * }
 */

'use strict';

/* globals describe, it, before */

const assert = require('assert');

const nconf = nodebb.require('nconf');
const db = nodebb.require('./test/mocks/databasemock');
const request = nodebb.require('./src/request');
const user = nodebb.require('./src/user');
const categories = nodebb.require('./src/categories');
const groups = nodebb.require('./src/groups');
const meta = nodebb.require('./src/meta');
const helpers = nodebb.require('./test/helpers');
const notp = require('notp');

const plugin = require('../library');

describe('nodebb-plugin-2factor', () => {
	describe('no-script composer (POST /compose)', () => {
		const totpKey = 'JBSWY3DPEHPK3PXP';
		let cid;
		let uid;
		let jar;
		let csrf_token;

		before(async function () {
			this.timeout(30000);
			({ cid } = await categories.create({ name: '2factor compose', description: '2factor compose' }));
			uid = await user.create({ username: 'tfauser', password: 'tfaPass123', gdpr_consent: true });
			await plugin.save(uid, totpKey);
			assert(await plugin.hasKey(uid));

			// password-only login: the second factor is intentionally not completed
			const login = await helpers.loginUser('tfauser', 'tfaPass123');
			jar = login.jar;
			csrf_token = login.csrf_token;
		});

		it('should reject a password-only session before writing', async function () {
			this.timeout(30000);
			const result = await request.post(`${nconf.get('url')}/compose`, {
				body: { cid, title: '2fa topic', content: '2fa content' },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 307);
			assert.ok(result.response.headers.location.includes('/login/2fa'));

			// nothing was written: no topic, no queue entry
			assert.equal(await user.getUserField(uid, 'topiccount'), 0);
			assert.equal(await db.sortedSetCard('post:queue'), 0);
		});

		it('should accept the same request once the second factor is completed', async function () {
			this.timeout(30000);
			// complete the second factor through the plugin's TOTP challenge
			const totp = notp.totp.gen(totpKey);
			const login2fa = await request.post(`${nconf.get('url')}/login/2fa/totp`, {
				body: { code: totp },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
			});
			assert.ok([302, 307].includes(login2fa.response.statusCode));

			const result = await request.post(`${nconf.get('url')}/compose`, {
				body: { cid, title: '2fa topic', content: '2fa content' },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 302);
			assert.ok(result.response.headers.location.includes('/topic/'));
			assert.equal(await user.getUserField(uid, 'topiccount'), 1);
		});
	});

	describe('TOTP enrolment via REST (enforced group)', () => {
		const groupName = '2fa-enforced-group';
		let uid;
		let jar;
		let csrf_token;
		let registration;

		before(async function () {
			this.timeout(30000);
			await groups.create({ name: groupName });
			uid = await user.create({ username: 'tfaenforceduser', password: 'tfaPass123', gdpr_consent: true });
			await groups.join(groupName, uid);
			await meta.settings.set('2factor', { tfaEnforcedGroups: JSON.stringify([groupName]) });

			const login = await helpers.loginUser('tfaenforceduser', 'tfaPass123');
			jar = login.jar;
			csrf_token = login.csrf_token;
		});

		after(async function () {
			this.timeout(30000);
			await meta.settings.set('2factor', { tfaEnforcedGroups: '[]' });
		});

		it('should redirect API requests to the 2factor page for an enforced user without a key', async function () {
			this.timeout(30000);
			const result = await request.get(`${nconf.get('url')}/api/categories`, { jar });
			assert.equal(result.response.statusCode, 200);
			assert.ok(result.response.headers['x-redirect']);
			const redirect = decodeURIComponent(result.response.headers['x-redirect']);
			assert.ok(redirect.includes('/user/tfaenforceduser/2factor'), `expected redirect to /user/tfaenforceduser/2factor, got: ${redirect}`);
		});

		it('should return a registration payload (QR + key) via GET', async function () {
			this.timeout(30000);
			const result = await request.get(`${nconf.get('url')}/api/v3/plugins/2factor/totp/register`, { jar });
			assert.equal(result.response.statusCode, 200);
			assert.ok(result.body.response.qr.startsWith('data:image/png;base64,'));
			assert.ok(typeof result.body.response.key === 'string' && result.body.response.key.length > 0);
			assert.ok(typeof result.body.response.encodedKey === 'string' && result.body.response.encodedKey.length > 0);
			registration = result.body.response;
		});

		it('should reject an invalid token via POST', async function () {
			this.timeout(30000);
			// Non-numeric token: TOTP codes are always 6 digits, so this can never
			// verify within notp's ±6 period window (avoids a flaky numeric guess).
			const result = await request.post(`${nconf.get('url')}/api/v3/plugins/2factor/totp/register`, {
				body: { key: registration.key, token: 'abcdef' },
				jar,
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 400);
			assert.ok(!(await plugin.hasTotp(uid)));
		});

		it('should save the key and clear the session challenge via POST', async function () {
			this.timeout(30000);
			const token = notp.totp.gen(registration.key);
			const result = await request.post(`${nconf.get('url')}/api/v3/plugins/2factor/totp/register`, {
				body: { key: registration.key, token },
				jar,
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 200);
			assert.ok(await plugin.hasTotp(uid));
		});

		it('should no longer challenge the session after enrolment', async function () {
			this.timeout(30000);
			const result = await request.get(`${nconf.get('url')}/api/categories`, { jar });
			assert.equal(result.response.statusCode, 200);
			assert.ok(!result.response.headers['x-redirect']);
		});
	});
});
