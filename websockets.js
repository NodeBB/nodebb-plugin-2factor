var base32 = require('thirty-two'),

	user = require.main.require('./src/user'),
	nconf = require.main.require('nconf'),
	utils = require.main.require('./public/src/utils'),
	notp = require('notp'),
	meta = require.main.require('./src/meta'),

	parent = module.parent.exports,
	Sockets = {
		admin: {}
	};

Sockets.regenerate = function(socket, data, callback) {
	var key = utils.generateUUID(),
		encodedKey = base32.encode(key).toString().replace(/=/g, '');

	user.getUserField(socket.uid, 'userslug', function(err, userslug) {
		var baseUrl = nconf.get('url').replace(/.*?:\/\//g, "");
		var issuer = encodeURIComponent(meta.config.title.replace(/\s/, '%20')).replace("+", "%20");
		var account = encodeURIComponent(userslug + "@" + baseUrl).replace("+", "%20");
		var otpUrl = "otpauth://totp/" + issuer + ":" + account + "?issuer=" + issuer + "&secret=" + encodedKey.replace("+", "%20") + '&period=30',
			qrImage = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(otpUrl);
	
		callback(null, {
			qr: qrImage,
			key: key
		});
	});
};

Sockets.confirm = function(socket, data, callback) {
	var key = data.key,
		token = data.token,
		confirmed = notp.totp.verify(token, key);

	if (confirmed) {
		parent.save(socket.uid, key, function(err) {
			callback(err);
		});
	} else {
		callback(new Error('[[error:invalid-data]]'));
	}
};

Sockets.disassociate = function(socket, data, callback) {
	parent.disassociate(socket.uid, callback);
};

Sockets.admin.disassociate = function(socket, data, callback) {
	user.isAdministrator(socket.uid, function(err, isAdmin) {
		if (isAdmin) {
			parent.disassociate(data.uid, callback);
		}
	});
};

module.exports = Sockets;