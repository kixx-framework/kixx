'use strict';

const {compact, deepFreeze, isNonEmptyString} = require(`../../library`);

class Channel {
	addEventListener(pattern, listener) {
	}

	addCommandHandler(pattern, handler) {
	}

	emit(path, event) {
	}

	command(path, args) {
	}

	static findMatches(routes, path) {
		return compact(routes.map((route) => {
			const {handler, regex, keys} = route;
			const matches = regex.exec(path);

			if (!matches) return false;

			// If we matched a route, collect the parameters if there are any.
			const params = keys.reduce((params, key, i) => {
				const name = key.name;

				// Skip un-named parameters.
				if (!isNonEmptyString(key.name)) return params;

				params[name] = matches[i + 1];

				// If the parameter is a float, parse it as such.
				if (/^[\d]*.[\d]+$/.test(params[name])) {
					params[name] = parseFloat(params[name]);
				}

				// If the parameter is a number, parse it as such.
				if (/^[\d]+$/.test(params[name])) {
					params[name] = parseInt(params[name], 10);
				}

				return params;
			}, Object.create(null));

			return {handler, params: deepFreeze(params)};
		}));
	}
}

module.exports = Channel;
