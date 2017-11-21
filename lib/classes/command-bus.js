'use strict';

const Promise = require(`bluebird`);

const StackedError = require(`./stacked-error`);
const ProgrammerError = require(`./programmer-error`);

const {compact} = require(`../../library`);

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
		const match = CommandBus.findBestMatch(this._commandRoutes, path);

		if (!match) {
			throw new ProgrammerError(`No command handler for path "${path}"`);
		}

		const {handler} = match;

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

	static findBestMatch(routes, path) {
		// Find all matches, order them by the specificity of the pattern
		// (longest length/most specific first), then return the first one.
		return compact(routes.map((route) => {
			const {handler, pattern} = route;
			if (!path.startsWith(pattern)) return false;
			return {handler, pattern};
		})).sort((a, b) => {
			if (a.pattern.length === b.pattern.length) {
				return 0;
			}
			return b.pattern.length > a.pattern.length ? 1 : -1;
		})[0];
	}
}

module.exports = CommandBus;
