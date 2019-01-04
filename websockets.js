'use strict';

const base32 = require('thirty-two');

const user = require.main.require('./src/user');
const nconf = require.main.require('nconf');
const utils = require.main.require('./public/src/utils');
const notp = require('notp');
const meta = require.main.require('./src/meta');

const parent = module.parent.exports;
const Sockets = {
	admin: {},
};

Sockets.regenerate = function (socket, data, callback) {
	const key = utils.generateUUID();
	const encodedKey = base32.encode(key).toString().replace(/=/g, '');

	user.getUserField(socket.uid, 'userslug', function (err, userslug) {
		if (err) {
			return callback(err);
		}

		const baseUrl = nconf.get('url').replace(/.*?:\/\//g, '');
		const issuer = encodeURIComponent(meta.config.title.replace(/\s/, '%20')).replace('+', '%20');
		const account = encodeURIComponent(userslug + '@' + baseUrl).replace('+', '%20');
		const otpUrl = 'otpauth://totp/' + issuer + ':' + account + '?issuer=' + issuer + '&secret=' + encodedKey.replace('+', '%20') + '&period=30';
		const qrImage = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(otpUrl);

		callback(null, {
			qr: qrImage,
			key: key,
		});
	});
};

Sockets.confirm = function (socket, data, callback) {
	const key = data.key;
	const token = data.token;
	const confirmed = notp.totp.verify(token, key);

	if (confirmed) {
		parent.save(socket.uid, key, function (err) {
			callback(err);
		});
	} else {
		callback(new Error('[[error:invalid-data]]'));
	}
};

Sockets.disassociate = function (socket, data, callback) {
	parent.disassociate(socket.uid, callback);
};

Sockets.admin.disassociate = function (socket, data, callback) {
	user.isAdministrator(socket.uid, function (err, isAdmin) {
		if (err) {
			return callback(err);
		} else if (isAdmin) {
			parent.disassociate(data.uid, callback);
		}
	});
};

module.exports = Sockets;
