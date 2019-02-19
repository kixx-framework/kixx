'use strict';

module.exports = function (fn) {
	return function middleware(...args) {
		return args.length < 2 ? fn(args[0]) : fn(args[0])(args[1]);
	};
};
