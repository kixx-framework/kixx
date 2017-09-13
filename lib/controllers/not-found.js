'use strict';

module.exports = () => {
	return function notFoundController(req, res) {
		res.sendHTML(`<html><body><h1>not-found</h1></body></html>`);
	};
};
