'use strict';

const Promise = require(`bluebird`);
const {ProgrammerError, StackedError} = require(`../../index`);
const {compact, last} = require(`../../library`);

class CommandBus {
	constructor() {
		Object.defineProperties(this, {
			_commandRoutes: {
				value: []
			}
		});
	}

	addCommandHandler(pattern, handler) {
		this._commandRoutes.push({pattern, handler});
		return this;
	}

	command(path, args) {
		const handler = last(Channel.findMatches(this._commandRoutes, path));

		if (!handler) {
			throw new ProgrammerError(`No command handler for path "${path}"`);
		}

		return new Promise((resolve, reject) => {
			function rejector(err) {
				return reject(new StackedError(
					`Error in command request for path "${path}"`,
					err
				));
			}

			try {
				handler(args, resolve, rejector);
			} catch (err) {
				return rejector(err);
			}
		});
	}

	static findMatches(routes, path) {
		return compact(routes.map((route) => {
			const {handler, pattern} = route;
			if (!path.startsWith(pattern)) return false;
			return handler;
		}));
	}
}

module.exports = CommandBus;
