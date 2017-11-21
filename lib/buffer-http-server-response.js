'use strict';

const {deepFreeze} = require(`../library`);

module.exports = function (resolve, reject) {
	return function bufferHttpServerResponse(res) {
		res.once(`error`, reject);

		const chunks = [];
		res.on(`data`, (chunk) => chunks.push(chunk));

		res.on(`end`, () => {
			resolve(Object.freeze({
				statusCode: res.statusCode,
				headers: deepFreeze(res.headers),
				body: Buffer.concat(chunks)
			}));
		});
	};
};
