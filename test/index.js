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

	describe('WebAuthn registration (POST /2factor/authn/register)', () => {
		const totpKey = 'JBSWY3DPEHPK3PXP';
		let uid;
		let jar;
		let csrf_token;

		const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

		before(async function () {
			this.timeout(30000);
			uid = await user.create({ username: 'tfareguser', password: 'tfaPass123', gdpr_consent: true });
			await plugin.save(uid, totpKey);
			const login = await helpers.loginUser('tfareguser', 'tfaPass123');
			jar = login.jar;
			csrf_token = login.csrf_token;
			// complete the second factor so the session is fully authenticated
			await request.post(`${nconf.get('url')}/login/2fa/totp`, {
				body: { code: notp.totp.gen(totpKey) },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
			});
		});

		it('should accept a browser-style registration (integer-keyed COSE)', async function () {
			this.timeout(30000);
			const cbor = require('cbor-x');
			const crypto = require('crypto');

			const getRes = await request.get(`${nconf.get('url')}/api/v3/plugins/2factor/authn/register`, {
				jar,
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(getRes.response.statusCode, 200);
			const opts = getRes.body.response;

			// a real authenticator emits COSE with integer keys (cbor maps decode as Map);
			// the plugin must normalize them so fido2-lib can parse the public key
			const { publicKey } = crypto.generateKeyPairSync('ec', {
				namedCurve: 'prime256v1',
				publicKeyEncoding: { format: 'jwk' },
			});
			const x = new Uint8Array(Buffer.from(publicKey.x, 'base64url'));
			const y = new Uint8Array(Buffer.from(publicKey.y, 'base64url'));
			const coseKey = new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]); // kty=EC, alg=ES256, crv=P-256
			const credId = crypto.randomBytes(16);
			const credIdLen = Buffer.alloc(2);
			credIdLen.writeUInt16BE(credId.length);
			const authData = Buffer.concat([
				crypto.createHash('sha256').update(opts.rp.id).digest(),
				Buffer.from([0x41]), // UP | AT
				Buffer.from([0, 0, 0, 0]),
				Buffer.alloc(16),
				credIdLen,
				credId,
				cbor.encode(coseKey),
			]);
			const attestationObject = cbor.encode({ fmt: 'none', attStmt: {}, authData });
			const clientDataJSON = Buffer.from(JSON.stringify({
				type: 'webauthn.create',
				challenge: opts.challenge,
				origin: new URL(nconf.get('url')).origin,
				crossOrigin: false,
			}));

			const postRes = await request.post(`${nconf.get('url')}/api/v3/plugins/2factor/authn/register`, {
				jar,
				body: {
					id: b64url(credId),
					rawId: b64url(credId),
					response: {
						attestationObject: b64url(attestationObject),
						clientDataJSON: b64url(clientDataJSON),
					},
					clientExtensionResults: {},
					deviceName: 'Test key',
				},
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(postRes.response.statusCode, 200);

			const id = b64url(credId);
			const devices = await plugin.getAuthnDevices(uid);
			assert.ok(devices.some(d => d.id === id));
			const pem = await plugin.getAuthnPublicKey(uid, id);
			assert.ok(pem.startsWith('-----BEGIN PUBLIC KEY'));
		});
	});

	describe('WebAuthn bulk disable (DELETE /2factor/authn)', () => {
		const totpKey = 'JBSWY3DPEHPK3PXP';
		let uid;
		let jar;
		let csrf_token;

		const addFakeDevice = async (id, name) => {
			await db.setObjectField(`2factor:webauthn:${uid}`, id, 'fake-public-key-pem');
			await db.sortedSetAdd('2factor:webauthn:counters', 1, id);
			if (name) {
				await db.setObjectField(`2factor:webauthn:${uid}:names`, id, name);
			}
		};

		before(async function () {
			this.timeout(30000);
			uid = await user.create({ username: 'tfawebauthnuser', password: 'tfaPass123', gdpr_consent: true });
			// TOTP is used to complete the second factor (easy to generate in a test);
			// WebAuthn devices are added afterwards, as a user disabling a hardware key
			// has already passed the second-factor challenge to reach the settings page.
			await plugin.save(uid, totpKey);
			const login = await helpers.loginUser('tfawebauthnuser', 'tfaPass123');
			jar = login.jar;
			csrf_token = login.csrf_token;

			// Complete the second factor so the session is fully authenticated
			const totp = notp.totp.gen(totpKey);
			const login2fa = await request.post(`${nconf.get('url')}/login/2fa/totp`, {
				body: { code: totp },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
			});
			assert.ok([302, 307].includes(login2fa.response.statusCode));

			await addFakeDevice('device-1', 'Yubikey');
			await addFakeDevice('device-2', 'Titan');
		});

		it('should remove all WebAuthn devices via DELETE /2factor/authn', async function () {
			this.timeout(30000);
			assert.ok(await plugin.hasAuthn(uid));
			assert.equal((await plugin.getAuthnDevices(uid)).length, 2);

			// Disabling 2FA requires the account password (user has one set)
			const result = await request.delete(`${nconf.get('url')}/api/v3/plugins/2factor/authn`, {
				jar,
				body: { password: 'tfaPass123' },
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 200);
			assert.ok(!(await plugin.hasAuthn(uid)));
			assert.equal((await plugin.getAuthnDevices(uid)).length, 0);
		});

		it('should reject DELETE /2factor/authn without a valid password', async function () {
			this.timeout(30000);
			await addFakeDevice('device-3', 'Rekeyed');
			assert.ok(await plugin.hasAuthn(uid));

			const result = await request.delete(`${nconf.get('url')}/api/v3/plugins/2factor/authn`, {
				jar,
				body: { password: 'wrong-password' },
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 401);
			// Device must remain in place
			assert.ok(await plugin.hasAuthn(uid));
			assert.equal((await plugin.getAuthnDevices(uid)).length, 1);
		});
	});

	describe('Device trust ("don\'t ask again for x days")', () => {
		const totpKey = 'JBSWY3DPEHPK3PXP';
		const reauthPage = '/user/tfatrustuser/edit/password';
		let uid;
		let jar;
		let csrf_token;

		// the newest session of the user, read straight from the session store
		const currentSession = async () => {
			const sids = await db.getSortedSetRange(`uid:${uid}:sessions`, 0, -1);
			const sid = sids[sids.length - 1];
			return await db.sessionStoreGet(sid);
		};

		const setSession = async (session) => {
			const sids = await db.getSortedSetRange(`uid:${uid}:sessions`, 0, -1);
			const sid = sids[sids.length - 1];
			await db.sessionStore.set(sid, session);
		};

		// a brand new jar => a brand new device (no device cookie)
		const login = async () => {
			const result = await helpers.loginUser('tfatrustuser', 'tfaPass123');
			jar = result.jar;
			csrf_token = result.csrf_token;
			return result;
		};

		// password-only sign-in, reusing the existing jar (i.e. the same device)
		const relogin = async () => {
			const token = await helpers.getCsrfToken(jar);
			const result = await request.post(`${nconf.get('url')}/login`, {
				body: { username: 'tfatrustuser', password: 'tfaPass123', noscript: 'true' },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
				headers: { 'x-csrf-token': token },
			});
			return { result, csrf_token: token };
		};

		const completeTotp = async (body = {}) => {
			const code = notp.totp.gen(totpKey);
			const result = await request.post(`${nconf.get('url')}/login/2fa/totp`, {
				body: { code, ...body },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
			});
			return result;
		};

		// express signs the cookie value, the name is unchanged
		const deviceCookie = () => jar.getCookiesSync(nconf.get('url'))
			.find(c => c.key === '2fa_device');

		before(async function () {
			this.timeout(30000);
			uid = await user.create({ username: 'tfatrustuser', password: 'tfaPass123', gdpr_consent: true });
			await plugin.save(uid, totpKey);
			await meta.settings.set('2factor', { tfaDeviceTrustDays: '30' });
		});

		after(async function () {
			this.timeout(30000);
			await meta.settings.set('2factor', { tfaDeviceTrustDays: '0' });
		});

		it('should offer the checkbox when a trust window is configured', async function () {
			this.timeout(30000);
			await login();
			const page = await request.get(`${nconf.get('url')}/login/2fa/totp`, { jar });
			assert.equal(page.response.statusCode, 200);
			assert.ok(page.body.includes('name="trust"'), 'trust checkbox should be rendered');
			assert.ok(page.body.includes('30'), 'trust window should be shown to the user');
		});

		it('should record the trusted device when the box is checked', async function () {
			this.timeout(30000);
			const result = await completeTotp({ trust: '1' });
			assert.ok([302, 307].includes(result.response.statusCode));

			const devices = await plugin.getTrustedDevices(uid);
			assert.equal(devices.length, 1, 'exactly one device should be trusted');
			// admin configured 30 days; allow for test-clock slack
			assert.ok(devices[0].expires > Date.now() + (29 * 24 * 60 * 60 * 1000), `expected ~30 days, got ${devices[0].expires}`); // 1 day
			assert.ok(devices[0].expires <= Date.now() + (30 * 24 * 60 * 60 * 1000), `expected no more than 30 days, got ${devices[0].expires}`); // 1 day

			const record = await db.getObject(`2factor:device:${devices[0].token}`);
			assert.equal(String(record.uid), String(uid), 'the device token must be bound to the uid that granted it');

			assert.ok(deviceCookie(), 'a long-lived cookie should be handed to the browser');
		});

		it('should skip the second factor on a trusted device after logout and re-login', async function () {
			this.timeout(30000);
			await helpers.logoutUser(jar);
			const re = await relogin();
			assert.ok([302, 307].includes(re.result.response.statusCode));
			assert.ok(
				!re.result.response.headers.location.includes('/login/2fa'),
				`no second factor expected, redirected to ${re.result.response.headers.location}`
			);

			// the first page request on the new session must be served without a 2FA challenge
			const page = await request.get(`${nconf.get('url')}/notifications`, {
				jar, maxRedirect: 0, redirect: 'manual',
			});
			assert.equal(page.response.statusCode, 200, `trusted device should not be challenged, redirected to ${page.response.headers.location}`);

			const session = await currentSession();
			assert.equal(session.tfa, true, 'the new session should be authorised by the device cookie');
		});

		it('should still demand the password from a trusted device', async function () {
			this.timeout(30000);
			// simulate an expired re-auth window (sensitive routes require a fresh password)
			const session = await currentSession();
			session.meta.reAuthAt = 0;
			await setSession(session);

			const challenge = await request.get(`${nconf.get('url')}${reauthPage}`, {
				jar, maxRedirect: 0, redirect: 'manual',
			});
			assert.ok([302, 307].includes(challenge.response.statusCode));
			assert.ok(challenge.response.headers.location.includes('/login'), 'a password challenge must still be issued');
			assert.ok(!challenge.response.headers.location.includes('/login/2fa'), 'second factor should be skipped on a trusted device');

			const re = await relogin();
			assert.ok([302, 307].includes(re.result.response.statusCode));
			assert.ok(
				!re.result.response.headers.location.includes('/login/2fa'),
				`second factor should be skipped, redirected to ${re.result.response.headers.location}`
			);
		});

		it('should still require the second factor from a new device', async function () {
			this.timeout(30000);
			const fresh = await login(); // fresh jar => no device cookie
			const challenge = await request.get(`${nconf.get('url')}${reauthPage}`, {
				jar: fresh.jar, maxRedirect: 0, redirect: 'manual',
			});
			assert.ok([302, 307].includes(challenge.response.statusCode));
			assert.ok(
				challenge.response.headers.location.includes('/login/2fa'),
				`a new device should be challenged, got ${challenge.response.headers.location}`
			);
		});

		it('should not trust a device when the box is not checked', async function () {
			this.timeout(30000);
			await plugin.revokeDevices(uid);
			await login();
			const result = await completeTotp();
			assert.ok([302, 307].includes(result.response.statusCode));
			assert.equal((await plugin.getTrustedDevices(uid)).length, 0, 'no device should be trusted');
			assert.ok(!deviceCookie(), 'no device cookie should be set');
		});

		it('should honour trust granted via a backup code too', async function () {
			this.timeout(30000);
			const codes = await plugin.generateBackupCodes(uid);
			await login();
			const result = await request.post(`${nconf.get('url')}/login/2fa/backup`, {
				body: { code: codes[0], trust: '1' },
				jar,
				maxRedirect: 0,
				redirect: 'manual',
			});
			assert.ok([302, 307].includes(result.response.statusCode));

			const devices = await plugin.getTrustedDevices(uid);
			assert.equal(devices.length, 1);
			assert.ok(devices[0].expires > Date.now() + (29 * 24 * 60 * 60 * 1000)); // 1 day

			const re = await relogin();
			assert.ok(!re.result.response.headers.location.includes('/login/2fa'), 'the device should be trusted after re-login');
		});

		it('should hide the checkbox and grant nothing when the admin disables the feature', async function () {
			this.timeout(30000);
			await meta.settings.set('2factor', { tfaDeviceTrustDays: '0' });
			await plugin.revokeDevices(uid);
			await login();
			const page = await request.get(`${nconf.get('url')}/login/2fa/totp`, { jar });
			assert.equal(page.response.statusCode, 200);
			assert.ok(!page.body.includes('name="trust"'), 'checkbox should be hidden when the window is 0');

			const result = await completeTotp({ trust: '1' });
			assert.ok([302, 307].includes(result.response.statusCode));
			assert.equal((await plugin.getTrustedDevices(uid)).length, 0, 'no trust window should be granted when the feature is disabled');
			assert.ok(!deviceCookie(), 'no device cookie should be set when the feature is disabled');
		});

		it('should revoke trusted devices when the second factor is disabled', async function () {
			this.timeout(30000);
			await meta.settings.set('2factor', { tfaDeviceTrustDays: '30' });
			await login();
			await completeTotp({ trust: '1' });
			assert.ok((await plugin.getTrustedDevices(uid)).length, 'a device should have been trusted');

			const result = await request.delete(`${nconf.get('url')}/api/v3/plugins/2factor/totp`, {
				jar,
				body: { password: 'tfaPass123' },
				headers: { 'x-csrf-token': csrf_token },
			});
			assert.equal(result.response.statusCode, 200);
			assert.equal((await plugin.getTrustedDevices(uid)).length, 0, 'trusted devices must be revoked when the second factor is removed');
		});

		it('should offer the checkbox on the hardware key challenge too', async function () {
			this.timeout(30000);
			const webauthnUid = await user.create({ username: 'tfatrustwebauthn', password: 'tfaPass123', gdpr_consent: true });
			await db.setObjectField(`2factor:webauthn:${webauthnUid}`, 'key-1', 'fake-public-key-pem');
			await db.sortedSetAdd('2factor:webauthn:counters', 1, 'key-1');
			await meta.settings.set('2factor', { tfaDeviceTrustDays: '30' });

			const fresh = await helpers.loginUser('tfatrustwebauthn', 'tfaPass123');
			const page = await request.get(`${nconf.get('url')}/login/2fa/authn`, { jar: fresh.jar });
			assert.equal(page.response.statusCode, 200);
			assert.ok(page.body.includes('name="trust"'), 'the hardware key challenge should offer the trust checkbox as well');
		});

		it('should render the trust window setting in the admin panel', async function () {
			this.timeout(30000);
			const admin = await user.create({ username: 'tfatrustadmin', password: 'tfaPass123', gdpr_consent: true });
			await groups.join('administrators', admin);
			const adminLogin = await helpers.loginUser('tfatrustadmin', 'tfaPass123');

			const page = await request.get(`${nconf.get('url')}/admin/plugins/2factor`, { jar: adminLogin.jar });
			assert.equal(page.response.statusCode, 200);
			assert.ok(page.body.includes('name="tfaDeviceTrustDays"'), 'the admin form should expose the trust window setting');
			assert.ok(page.body.includes('value="30"'), 'the default trust window should be offered in the form');
		});
	});
});
