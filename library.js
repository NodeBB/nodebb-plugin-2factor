'use strict';

const crypto = require('crypto');
const passport = nodebb.require('passport');
const passportTotp = require('passport-totp').Strategy;
const notp = require('notp');
const { Fido2Lib } = require('fido2-lib');
const base64url = require('base64url');
const cbor = require('cbor-x');
const base32 = require('thirty-two');
const qrcode = require('qrcode');

const db = nodebb.require('./src/database');
const nconf = nodebb.require('nconf');
const winston = nodebb.require('winston');
const user = nodebb.require('./src/user');
const meta = nodebb.require('./src/meta');
const groups = nodebb.require('./src/groups');
const plugins = nodebb.require('./src/plugins');
const notifications = nodebb.require('./src/notifications');
const utils = nodebb.require('./src/utils');
const controllerHelpers = nodebb.require('./src/controllers/helpers');
const SocketPlugins = nodebb.require('./src/socket.io/plugins');

const atob = base64str => Buffer.from(base64str, 'base64').toString('binary');
const guard = (path) => {
	let url = new URL(path, nconf.get('url'));
	url = url.hostname === nconf.get('url_parsed').hostname ? url : nconf.get('url');

	return url.toString();
};

const plugin = {
	_f2l: undefined,
};

plugin.init = async (params) => {
	const { router } = params;
	const hostMiddleware = params.middleware;
	const accountMiddlewares = [
		hostMiddleware.exposeUid,
		hostMiddleware.ensureLoggedIn,
		hostMiddleware.canViewUsers,
		hostMiddleware.checkAccountPermissions,
		hostMiddleware.buildAccountData,
	];
	const hostHelpers = nodebb.require('./src/routes/helpers');
	const controllers = require('./lib/controllers');
	const middlewares = require('./lib/middlewares');

	// Public-facing pages
	hostHelpers.setupPageRoute(router, '/2factor/access-notification', controllers.renderAccessNotificationHelp);

	// ACP
	hostHelpers.setupAdminPageRoute(router, '/admin/plugins/2factor', [hostMiddleware.pluginHooks], controllers.renderAdminPage);

	// UCP
	hostHelpers.setupPageRoute(router, '/user/:userslug/2factor', accountMiddlewares, controllers.renderSettings);

	// 2fa Login
	hostHelpers.setupPageRoute(router, '/login/2fa', [hostMiddleware.ensureLoggedIn], controllers.renderChoices);
	hostHelpers.setupPageRoute(router, '/login/2fa/totp', [hostMiddleware.ensureLoggedIn], controllers.renderTotpChallenge);
	router.post('/login/2fa/totp', hostMiddleware.ensureLoggedIn, controllers.processTotpLogin, async (req, res) => {
		req.session.tfa = true;
		const now = Date.now();
		req.session.meta.datetime = now;
		if (req.session.tfaForce) {
			delete req.session.tfaForce;
			req.session.meta.reAuthAt = now;
		}

		await plugin.grantTrust(req, res);

		user.auth.addSession(req.uid, req.sessionID, req.session.meta.uuid);
		res.redirect(guard(nconf.get('relative_path') + (req.query.next || '/')));
	});
	hostHelpers.setupPageRoute(router, '/login/2fa/authn', [hostMiddleware.ensureLoggedIn], controllers.renderAuthnChallenge);

	// 2fa backups codes
	hostHelpers.setupPageRoute(router, '/login/2fa/backup', [hostMiddleware.ensureLoggedIn], controllers.renderBackup);
	router.post('/login/2fa/backup', hostMiddleware.ensureLoggedIn, controllers.processBackup, async (req, res) => {
		req.session.tfa = true;
		await plugin.grantTrust(req, res);
		res.redirect(guard(nconf.get('relative_path') + (req.query.next || '/')));
	});
	router.put('/login/2fa/backup', hostMiddleware.requireUser, middlewares.requireSecondFactor, hostMiddleware.applyCSRF, controllers.generateBackupCodes);

	// Websockets
	SocketPlugins['2factor'] = require('./websockets');

	// Login Strategy
	passport.use(new passportTotp(
		async (user, done) => {
			try {
				const key = await plugin.get(user.uid);
				if (!key) {
					return done(new Error('[[2factor:login.failure]]'));
				}
				return done(null, key, 30);
			} catch (e) {
				return done(e);
			}
		}
	));

	// Fido2Lib instantiation
	plugin._f2l = new Fido2Lib({
		timeout: 60 * 1000, // 60 seconds
		rpId: nconf.get('url_parsed').hostname,
		rpName: meta.config.title || 'NodeBB',
	});

	// Configure 2FA path exemptions
	let prefixes = ['/reset', '/confirm'];
	let pages = ['/login/2fa', '/login/2fa/authn', '/login/2fa/totp', '/login/2fa/backup', '/2factor/authn/verify', '/register/complete'];
	let paths = ['/api/v3/plugins/2factor/authn/verify'];
	({ prefixes, pages, paths } = await plugins.hooks.fire('filter:2factor.exemptions', { prefixes, pages, paths }));
	pages = pages.reduce((memo, cur) => {
		memo.push(nconf.get('relative_path') + cur);
		memo.push(`${nconf.get('relative_path')}/api${cur}`);
		return memo;
	}, []);
	plugin.exemptions = {
		prefixes,
		paths: new Set(pages.concat(paths)),
	};
};

// fido2-lib 3.5.x decodes COSE maps (integer keys) as JS Maps, then calls Object.entries() on
// the decoded object - which yields [] for a Map. That leaves the parsed public key empty and
// every registration fails with "Unrecognized algorithm name". Re-encode the COSE key with
// string keys so fido2-lib's parser can read it. Real authenticators emit integer-keyed COSE.
plugin.normalizeAttestationObject = function (attestationObject) {
	const b64 = attestationObject.replace(/-/g, '+').replace(/_/g, '/');
	const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
	const bytes = Uint8Array.from(atob(b64 + pad), c => c.charCodeAt(0));
	const ao = cbor.decode(bytes);
	const authData = new Uint8Array(ao.authData);
	let newAuthData = authData;

	if (authData.length > 53 && authData[32] & 0x40) { // AT flag: credential record present
		const credIdLen = (authData[53] << 8) | authData[54];
		const coseStart = 55 + credIdLen;
		const cose = cbor.decode(authData.slice(coseStart));

		if (cose instanceof Map) {
			const keyObj = {};
			for (const [k, v] of cose) {
				keyObj[String(k)] = v;
			}

			const coseBytes = new Uint8Array(cbor.encode(keyObj));
			newAuthData = new Uint8Array(coseStart + coseBytes.length);
			newAuthData.set(authData.slice(0, coseStart), 0);
			newAuthData.set(coseBytes, coseStart);
		}
	}

	return base64url(Buffer.from(new Uint8Array(cbor.encode({
		fmt: ao.fmt,
		attStmt: ao.attStmt,
		authData: newAuthData,
	}))));
};

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const routeHelpers = nodebb.require('./src/routes/helpers');
	const pluginMiddlewares = require('./lib/middlewares');
	const middlewares = [
		middleware.ensureLoggedIn,
	];

	routeHelpers.setupApiRoute(router, 'get', '/2factor/authn/register', middlewares, async (req, res) => {
		const registrationRequest = await plugin._f2l.attestationOptions();
		const userData = await user.getUserFields(req.uid, ['username', 'displayname']);
		registrationRequest.user = {
			id: base64url(String(req.uid)),
			name: userData.username,
			displayName: userData.displayname,
		};
		registrationRequest.challenge = base64url(registrationRequest.challenge);
		req.session.registrationRequest = registrationRequest;
		helpers.formatApiResponse(200, res, registrationRequest);
	});

	routeHelpers.setupApiRoute(router, 'get', '/2factor/authn/devices', middlewares, async (req, res) => {
		const devices = await plugin.getAuthnDevices(req.uid);
		helpers.formatApiResponse(200, res, { devices });
	});

	routeHelpers.setupApiRoute(router, 'patch', '/2factor/authn/device', middlewares, async (req, res) => {
		const { id, name } = req.body;
		if (typeof name !== 'string' || !name.trim()) {
			return helpers.formatApiResponse(400, res);
		}
		await plugin.renameDevice(req.uid, id, name.trim());
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/authn/device/:id', [...middlewares, pluginMiddlewares.requirePassword], async (req, res) => {
		await plugin.removeDevice(req.uid, req.params.id);
		await plugin.revokeIfNoFactor(req.uid);
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/authn', [...middlewares, pluginMiddlewares.requirePassword], async (req, res) => {
		await plugin.removeAllAuthn(req.uid);
		await plugin.revokeIfNoFactor(req.uid);
		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'post', '/2factor/authn/register', middlewares, async (req, res) => {
		const attestationExpectations = {
			challenge: req.session.registrationRequest.challenge,
			origin: `${nconf.get('url_parsed').protocol}//${nconf.get('url_parsed').host}`,
			factor: 'second',
		};
		// fido2-lib 3.x expects rawId/id as ArrayBuffer, attestationObject/clientDataJSON as base64url strings
		if (typeof req.body.rawId === 'string') {
			const base64 = req.body.rawId.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.rawId = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		if (typeof req.body.id === 'string') {
			const base64 = req.body.id.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.id = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		if (req.body.response && typeof req.body.response.attestationObject === 'string') {
			req.body.response.attestationObject = plugin.normalizeAttestationObject(req.body.response.attestationObject);
		}
		const regResult = await plugin._f2l.attestationResult(req.body, attestationExpectations);
		const deviceName = typeof req.body.deviceName === 'string' && req.body.deviceName.trim() ? req.body.deviceName.trim() : undefined;
		await plugin.saveAuthn(req.uid, regResult.authnrData, deviceName);
		delete req.session.registrationRequest;
		req.session.tfa = true; // eliminate re-challenge on registration

		helpers.formatApiResponse(200, res);
	});

	// Note: auth request generated in Controllers.renderLogin
	routeHelpers.setupApiRoute(router, 'post', '/2factor/authn/verify', middlewares, async (req, res) => {
		const prevCounter = await plugin.getAuthnCount(req.body.authResponse.id);
		const publicKey = await plugin.getAuthnPublicKey(req.uid, req.body.authResponse.id);
		const expectations = {
			challenge: req.session.authRequest,
			origin: `${nconf.get('url_parsed').protocol}//${nconf.get('url_parsed').host}`,
			factor: 'second',
			publicKey,
			prevCounter,
			userHandle: base64url(String(req.uid)),
		};

		// fido2-lib 3.x expects rawId/id as ArrayBuffer, authenticatorData/clientDataJSON as base64url strings
		if (typeof req.body.authResponse.rawId === 'string') {
			const base64 = req.body.authResponse.rawId.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.authResponse.rawId = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}
		if (typeof req.body.authResponse.id === 'string') {
			const base64 = req.body.authResponse.id.replace(/-/g, '+').replace(/_/g, '/');
			const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
			const binary = atob(base64 + pad);
			req.body.authResponse.id = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
		}

		const authnResult = await plugin._f2l.assertionResult(req.body.authResponse, expectations);
		const count = authnResult.authnrData.get('counter');
		await plugin.updateAuthnCount(req.body.authResponse.id, count);

		req.session.tfa = true;
		await plugin.grantTrust(req, res);
		const now = Date.now();
		req.session.meta.datetime = now;
		if (req.session.tfaForce) {
			delete req.session.tfaForce;
			req.session.meta.reAuthAt = now;
		}
		delete req.session.authRequest;

		helpers.formatApiResponse(200, res, {
			next: guard(req.query.next || '/'),
		});
	});

	routeHelpers.setupApiRoute(router, 'get', '/2factor/totp/register', middlewares, async (req, res) => {
		const key = utils.generateUUID();
		const encodedKey = base32.encode(key).toString().replace(/=/g, '');

		const { userslug } = await user.getUserFields(req.uid, ['userslug']);
		const baseUrl = nconf.get('url').replace(/.*?:\/\//g, '');
		const issuer = encodeURIComponent(meta.config.title).replace('+', '%20');
		const account = encodeURIComponent(`${userslug}@${baseUrl}`).replace('+', '%20');
		const otpUrl = `otpauth://totp/${issuer}:${account}?issuer=${issuer}&secret=${encodedKey.replace('+', '%20')}&period=30`;
		const qr = await qrcode.toDataURL(otpUrl);

		helpers.formatApiResponse(200, res, { qr, key, encodedKey });
	});

	routeHelpers.setupApiRoute(router, 'post', '/2factor/totp/register', middlewares, async (req, res) => {
		const { key, token } = req.body;
		const confirmed = typeof key === 'string' && typeof token === 'string' && notp.totp.verify(token, key);
		if (!confirmed) {
			return helpers.formatApiResponse(400, res, new Error('[[error:invalid-data]]'));
		}

		await plugin.save(req.uid, key);
		req.session.tfa = true; // eliminate re-challenge on registration

		helpers.formatApiResponse(200, res);
	});

	routeHelpers.setupApiRoute(router, 'delete', '/2factor/totp', [...middlewares, pluginMiddlewares.requirePassword], async (req, res) => {
		await db.deleteObjectField('2factor:uid:key', req.uid);
		await plugin.revokeIfNoFactor(req.uid);

		helpers.formatApiResponse(200, res);
	});
};

plugin.appendConfig = async (config) => {
	const [hasKey, hasPassword] = await Promise.all([
		plugin.hasKey(config.uid),
		config.uid ? user.hasPassword(config.uid) : false,
	]);
	config['2factor'] = { hasKey, hasPassword };
	return config;
};

plugin.addAdminNavigation = function (header) {
	header.plugins.push({
		route: '/plugins/2factor',
		icon: 'fa-lock',
		name: '[[2factor:title]]',
	});

	return header;
};

plugin.addProfileItem = function (data) {
	data.links.push({
		id: '2factor',
		route: '2factor',
		icon: 'fa-lock',
		name: '[[2factor:title]]',
		visibility: {
			self: true,
			other: false,
			moderator: false,
			globalMod: false,
			admin: false,
			canViewInfo: false,
		},
	});

	return data;
};

plugin.get = async uid => db.getObjectField('2factor:uid:key', uid);

/*
 * Device trust (“don’t ask again for x days”).
 *
 * A trusted device is an opaque, high-entropy token recorded server-side against
 * the uid, and presented to the browser as a long-lived signed cookie
 * (2fa_device). The cookie outlives the login session, so logging out and
 * logging in again on the same browser skips the second factor; any other
 * device (no cookie, or a cookie issued to a different browser) is challenged.
 * The window is enforced server-side — possession of the cookie alone is not
 * enough, the record must match the uid and must not have expired.
 * Revoking the account's second factor revokes every trusted device.
 */
const DEVICE_COOKIE = '2fa_device';

plugin.getTrustDays = async () => {
	const { tfaDeviceTrustDays } = await meta.settings.get('2factor');
	if (tfaDeviceTrustDays === undefined) {
		return 30; // default trust window, in days
	}

	return Math.max(0, parseInt(tfaDeviceTrustDays, 10) || 0);
};

plugin.isTrusted = async (req) => {
	const token = req.signedCookies && req.signedCookies[DEVICE_COOKIE];
	if (!token) {
		return false;
	}

	const record = await db.getObject(`2factor:device:${token}`);
	if (!record) {
		return false;
	}

	// the token is only honoured for the account that granted it
	return String(record.uid) === String(req.uid) && parseInt(record.expires, 10) > Date.now();
};

plugin.getTrustedDevices = async (uid) => {
	const entries = await db.getSortedSetRangeWithScores(`2factor:uid:${uid}:devices`, 0, -1);
	return entries
		.filter(entry => parseInt(entry.score, 10) > Date.now())
		.map(entry => ({ token: entry.value, expires: entry.score }));
};

plugin.revokeDevices = async (uid) => {
	const tokens = await db.getSortedSetRange(`2factor:uid:${uid}:devices`, 0, -1);
	await Promise.all(tokens.map(token => db.delete(`2factor:device:${token}`)));
	await db.delete(`2factor:uid:${uid}:devices`);
};

plugin.revokeIfNoFactor = async (uid) => {
	if (!await plugin.hasKey(uid)) {
		await plugin.revokeDevices(uid);
	}
};

plugin.grantTrust = async (req, res) => {
	if (!req.body || !req.body.trust) {
		return;
	}

	const days = await plugin.getTrustDays();
	if (days <= 0) {
		return;
	}

	const expires = Date.now() + (days * 24 * 60 * 60 * 1000); // 1 day
	const token = crypto.randomBytes(24).toString('hex');
	const key = `2factor:uid:${req.uid}:devices`;

	await db.setObject(`2factor:device:${token}`, { uid: req.uid, expires });
	await db.pexpire(`2factor:device:${token}`, expires - Date.now());
	// prune this user's expired devices, then record the new one
	await db.sortedSetsRemoveRangeByScore([key], '-inf', Date.now());
	await db.sortedSetAdd(key, expires, token);

	res.cookie(DEVICE_COOKIE, token, {
		signed: true,
		httpOnly: true,
		maxAge: expires - Date.now(),
		...meta.configs.cookie.get(),
	});

	const notification = await notifications.create({
		bodyShort: `[[2factor:notification.trust, ${days}]]`,
		bodyLong: '',
		nid: `2factor.trust-${req.uid}-${Date.now()}`,
		from: req.uid,
		path: '/',
	});

	if (notification) {
		await notifications.push(notification, [req.uid]);
	}
};

plugin.persistSession = async (req) => {
	const sessionId = req.sessionID || (req.session && req.session.id);
	if (!sessionId) {
		return;
	}

	try {
		// express-session stores are promise-based (connect-redis, connect-mongo)
		await db.sessionStore.set(sessionId, req.session);
	} catch (err) {
		winston.warn(`[plugin/2factor] Failed to persist session: ${err.message}`);
	}
};

plugin.getAuthnKeyIds = async (uid) => {
	const keys = await db.getObject(`2factor:webauthn:${uid}`);
	return keys ? Object.keys(keys) : [];
};

plugin.getAuthnDevices = async (uid) => {
	const keyIds = await plugin.getAuthnKeyIds(uid);
	const names = await db.getObject(`2factor:webauthn:${uid}:names`) || {};
	return keyIds.map(id => ({
		id,
		name: names[id] || `Device ${keyIds.indexOf(id) + 1}`,
	}));
};

plugin.getAuthnPublicKey = async (uid, id) => db.getObjectField(`2factor:webauthn:${uid}`, id);

plugin.getAuthnCount = async id => db.sortedSetScore(`2factor:webauthn:counters`, id);

plugin.updateAuthnCount = async (id, count) => db.sortedSetAdd(`2factor:webauthn:counters`, count, id);

plugin.save = async function (uid, key) {
	return await db.setObjectField('2factor:uid:key', uid, key);
};

plugin.saveAuthn = async (uid, authnrData, deviceName) => {
	const counter = authnrData.get('counter');
	const publicKey = authnrData.get('credentialPublicKeyPem');
	const id = base64url(authnrData.get('credId'));
	await db.setObjectField(`2factor:webauthn:${uid}`, id, publicKey);
	await db.sortedSetAdd(`2factor:webauthn:counters`, counter, id);
	if (deviceName) {
		await db.setObjectField(`2factor:webauthn:${uid}:names`, id, deviceName);
	}
};

plugin.hasAuthn = async (uid) => {
	if (!(parseInt(uid, 10) > 0)) {
		return false;
	}
	return await db.exists(`2factor:webauthn:${uid}`);
};

plugin.hasTotp = async (uid) => {
	if (!(parseInt(uid, 10) > 0)) {
		return false;
	}
	return await db.isObjectField('2factor:uid:key', uid);
};

// hmm... remove?
plugin.hasKey = async (uid) => {
	const [hasTotp, hasAuthn] = await Promise.all([
		plugin.hasTotp(uid),
		plugin.hasAuthn(uid),
	]);

	return hasTotp || hasAuthn;
};

plugin.hasBackupCodes = async uid => db.exists(`2factor:uid:${uid}:backupCodes`);

plugin.countBackupCodes = async uid => db.setCount(`2factor:uid:${uid}:backupCodes`);

plugin.generateBackupCodes = async (uid) => {
	const set = `2factor:uid:${uid}:backupCodes`;
	const codes = [];
	let code;

	for (let x = 0; x < 5; x++) {
		code = utils.generateUUID().replace('-', '').slice(0, 10);
		codes.push(code);
	}

	await db.delete(set); // Invalidate all old codes
	await db.setAdd(set, codes); // Save new codes

	const notification = await notifications.create({
		bodyShort: '[[2factor:notification.backupCode.generated]]',
		bodyLong: '',
		nid: `2factor.backupCode.generated-${uid}-${Date.now()}`,
		from: uid,
		path: '/',
	});

	if (notification) {
		await notifications.push(notification, [uid]);
	}

	return codes;
};

plugin.useBackupCode = async (code, uid) => {
	const set = `2factor:uid:${uid}:backupCodes`;

	const valid = await db.isSetMember(set, code);
	if (valid) {
		// Invalidate this backup code
		await db.setRemove(set, code);

		const notification = await notifications.create({
			bodyShort: '[[2factor:notification.backupCode.used]]',
			bodyLong: '',
			nid: `2factor.backupCode.used-${uid}-${Date.now()}`,
			from: uid,
			path: '/',
		});

		if (notification) {
			await notifications.push(notification, [uid]);
		}
	}

	return valid;
};

plugin.disassociate = async (uid) => {
	await Promise.all([
		db.deleteObjectField('2factor:uid:key', uid),
		db.delete(`2factor:uid:${uid}:backupCodes`),
		plugin.revokeDevices(uid),
	]);

	// Clear U2F keys
	const keyIds = await db.getObjectKeys(`2factor:webauthn:${uid}`);
	await db.sortedSetRemove('2factor:webauthn:counters', keyIds);
	await db.delete(`2factor:webauthn:${uid}`);
	await db.delete(`2factor:webauthn:${uid}:names`);
};

plugin.removeDevice = async (uid, id) => {
	if (await userOwnsWebauthId(uid, id)) {
		await db.sortedSetRemove('2factor:webauthn:counters', id);
		await db.deleteObjectField(`2factor:webauthn:${uid}`, id);
		await db.deleteObjectField(`2factor:webauthn:${uid}:names`, id);
	}
};

plugin.removeAllAuthn = async (uid) => {
	const keyIds = await db.getObjectKeys(`2factor:webauthn:${uid}`);
	if (keyIds.length) {
		await db.sortedSetRemove('2factor:webauthn:counters', keyIds);
		await db.delete(`2factor:webauthn:${uid}`);
		await db.delete(`2factor:webauthn:${uid}:names`);
	}
};

plugin.renameDevice = async (uid, id, newName) => {
	if (await userOwnsWebauthId(uid, id)) {
		await db.setObjectField(`2factor:webauthn:${uid}:names`, id, newName);
	}
};

async function userOwnsWebauthId(uid, id) {
	return await db.isObjectField(`2factor:webauthn:${uid}`, id);
}

plugin.overrideUid = async ({ req, locals }) => {
	if (req.uid && await plugin.hasKey(req.uid) && req.session.tfa !== true) {
		if (await plugin.isTrusted(req)) {
			// this device passed the second factor within the trust window
			req.session.tfa = true;
			return { req, locals };
		}

		locals['2factor'] = req.uid;
		req.uid = 0;
		delete req.user;
		delete req.loggedIn;
	}

	return { req, locals };
};

plugin.check = async ({ req, res }) => {
	if (!req.user || req.session.tfa === true) {
		return;
	}

	if (await plugin.isTrusted(req)) {
		// this device is within the trust window, re-authorise the session
		req.session.tfa = true;
		return;
	}

	const requestPath = req.baseUrl + req.path;
	if (plugin.exemptions.paths.has(requestPath) || plugin.exemptions.prefixes.some(prefix => requestPath.startsWith(nconf.get('relative_path') + prefix))) {
		return;
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	const redirect = req.session.returnTo || requestPath
		.replace(new RegExp(`^${nconf.get('relative_path')}`), '')
		.replace(/^\/api/, '');

	if (await plugin.hasKey(req.user.uid)) {
		if (!res.locals.isAPI) {
			// Account has TFA, redirect to login
			controllerHelpers.redirect(res, `/login/2fa?next=${redirect}`);
		} else {
			await controllerHelpers.formatApiResponse(401, res, new Error('[[2factor:second-factor-required]]'));
		}
	} else if (tfaEnforcedGroups.length && (await groups.isMemberOfGroups(req.uid, tfaEnforcedGroups)).includes(true)) {
		if (req.url.startsWith('/admin') || (!req.url.startsWith('/admin') && !req.url.match('2factor'))) {
			const userslug = await user.getUserField(req.uid, 'userslug');
			const target = userslug ? `/user/${userslug}/2factor?next=${redirect}` : `/me/2factor?next=${redirect}`;
			controllerHelpers.redirect(res, target);
		}
	}

	// No TFA setup
};

plugin.checkSocket = async (data) => {
	if (!data.socket.uid || data.session.tfa === true) {
		return;
	}

	if (await plugin.isTrusted(data.req)) {
		return;
	}

	let { tfaEnforcedGroups } = await meta.settings.get('2factor');
	tfaEnforcedGroups = JSON.parse(tfaEnforcedGroups || '[]');

	if (await plugin.hasKey(data.socket.uid)) {
		winston.info(`[plugin/2factor] Denying socket access for uid ${data.socket.uid} pending second factor.`);
		throw new Error('[[2factor:second-factor-required]]');
	} else if (tfaEnforcedGroups.length) {
		const inEnforcedGroup = (await groups.isMemberOfGroups(
			data.socket.uid, tfaEnforcedGroups,
		)).includes(true);
		if (inEnforcedGroup) {
			winston.info(`[plugin/2factor] Denying socket access for uid ${data.socket.uid} — TFA enforced by group policy.`);
			throw new Error('[[2factor:second-factor-required]]');
		}
	}
};

plugin.getUsers = async () => {
	const uids = await db.getObjectKeys('2factor:uid:key');
	// uid and the icon fields are required for buildAvatar to render the initial
	// fallback for users without a picture
	return user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture', 'icon:bgColor', 'icon:text']);
};

plugin.adjustRelogin = async ({ req, res }) => {
	if (await plugin.hasKey(req.uid)) {
		if (await plugin.isTrusted(req)) {
			// The device is within its trust window: the password challenge is still
			// issued by the caller (forceLogin is set), only the second-factor
			// challenge is skipped.
			req.session.tfa = true;
			await plugin.persistSession(req);
			return;
		}

		req.session.forceLogin = 0;
		req.session.tfaForce = 1;

		// this is set to true after successful 2FA login
		delete req.session.tfa; // clear it here to force a re-challenge

		// Persist the re-challenge state to the session store. This hook fires
		// after the response is sent, so the in-memory session change is not
		// auto-saved. Connected sockets read the store via validateSession
		// (checkSocket); without persisting, they keep full access and can
		// regenerate/confirm/disassociate the 2FA factor.
		await plugin.persistSession(req);

		if (!res.locals.isAPI) {
			controllerHelpers.redirect(res, `/login/2fa?next=${req.session.returnTo}`);
		}
	}
};

plugin.handle2faFailure = async (uid) => {
	const notification = await notifications.create({
		bodyShort: '[[2factor:notification.failure]]',
		bodyLong: '',
		nid: `2factor.failure.${uid}-${Date.now()}`,
		from: uid,
		path: `/2factor/access-notification?when=${Date.now()}`,
	});

	await notifications.push(notification, [uid]);
};

plugin.integrations = {};

plugin.integrations.writeApi = async (data) => {
	const routeTest = /^\/api\/v\d\/users\/\d+\/tokens\/?/;
	const uidMatch = data.route.match(/(\d+)\/tokens$/);
	const uid = uidMatch ? parseInt(uidMatch[1], 10) : 0;

	// Enforce 2FA on token generation route
	if (data.method === 'POST' && routeTest.test(data.route) && await plugin.hasTotp(uid)) {
		if (!data.req.headers.hasOwnProperty('x-two-factor-authentication')) {
			// No 2FA received
			return data.res.status(400).json(data.errorHandler.generate(
				400, '2fa-enabled', 'Two Factor Authentication is enabled for this route, please send in the appropriate additional header for authorization', ['x-two-factor-authentication']
			));
		}

		const skew = notp.totp.verify(data.req.headers['x-two-factor-authentication'], await plugin.get(uid));
		if (!skew || Math.abs(skew.delta) > 2) {
			return data.res.status(400).json(data.errorHandler.generate(
				401, '2fa-failed', 'The Two-Factor Authentication code provided is not correct or has expired'
			));
		}
	}
};

module.exports = plugin;
