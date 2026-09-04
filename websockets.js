'use strict';

const util = require('util');
const base32 = require('thirty-two');
const notp = require('notp');
const qrcode = require('qrcode');

const user = nodebb.require('./src/user');
const nconf = nodebb.require('nconf');
const utils = nodebb.require('./src/utils');
const meta = nodebb.require('./src/meta');
const db = nodebb.require('./src/database');
const winston = nodebb.require('winston');

const parent = module.parent.exports;
const Sockets = {
	admin: {},
};

Sockets.regenerate = function (socket, data, callback) {
	const key = utils.generateUUID();
	const encodedKey = base32.encode(key).toString().replace(/=/g, '');

	user.getUserField(socket.uid, 'userslug', (err, userslug) => {
		if (err) {
			return callback(err);
		}

		const baseUrl = nconf.get('url').replace(/.*?:\/\//g, '');
		const issuer = encodeURIComponent(meta.config.title).replace('+', '%20');
		const account = encodeURIComponent(`${userslug}@${baseUrl}`).replace('+', '%20');
		const otpUrl = `otpauth://totp/${issuer}:${account}?issuer=${issuer}&secret=${encodedKey.replace('+', '%20')}&period=30`;
		qrcode.toDataURL(otpUrl, (err, qr) => {
			callback(err, { qr, key, encodedKey });
		});
	});
};

Sockets.confirm = async function (socket, data) {
	const { key, token } = data;
	const confirmed = notp.totp.verify(token, key);

	if (confirmed) {
		await parent.save(socket.uid, key);
		// Write tfa flag to the session store (not the frozen socket.request.session snapshot)
		const sessionData = socket.request.session;
		sessionData.tfa = true;
		const sessionId = socket.request.signedCookies[nconf.get('sessionKey')];
		try {
			await util.promisify(db.sessionStore.set).bind(db.sessionStore)(sessionId, sessionData);
		} catch (err) {
			winston.warn(`[plugin/2factor] Failed to persist session: ${err.message}`);
		}
	} else {
		throw new Error('[[error:invalid-data]]');
	}
};

Sockets.disassociate = async (socket) => {
	await parent.disassociate(socket.uid);
};

Sockets.admin.disassociate = async (socket, data) => {
	const isAdmin = await user.isAdministrator(socket.uid);
	if (isAdmin) {
		await parent.disassociate(data.uid);
	} else {
		throw new Error('[[error:no-privileges]]');
	}
};

module.exports = Sockets;
