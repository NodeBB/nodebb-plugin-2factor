'use strict';

const base32 = require('thirty-two');
const notp = require('notp');
const qrcode = require('qrcode');

const user = require.main.require('./src/user');
const nconf = require.main.require('nconf');
const utils = require.main.require('./src/utils');
const meta = require.main.require('./src/meta');

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

Sockets.confirm = function (socket, data, callback) {
	const { key } = data;
	const { token } = data;
	const confirmed = notp.totp.verify(token, key);

	if (confirmed) {
		parent.save(socket.uid, key, (err) => {
			socket.request.session.tfa = true; // eliminate re-challenge on registration

			callback(err);
		});
	} else {
		callback(new Error('[[error:invalid-data]]'));
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
