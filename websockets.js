'use strict';

const user = nodebb.require('./src/user');

const parent = module.parent.exports;
const Sockets = {
	admin: {},
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
