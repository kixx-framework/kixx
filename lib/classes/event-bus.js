'use strict';

const EventEmitter = require(`events`);
const {StackedError} = require(`../../index`);
const {compact} = require(`../../library`);

class EventBus {
	constructor() {
		Object.defineProperties(this, {
			_observerRoutes: {
				value: []
			},
			_emitter: {
				value: new EventEmitter()
			}
		});
	}

	observe(pattern, handler) {
		this._observerRoutes.push({pattern, handler});
		return this;
	}

	addErrorHandler(handler) {
		this._emitter.on(`error`, handler);
	}

	broadcast(path, event) {
		const matches = EventBus.findBestMatches(this._observerRoutes, path);

		for (let i = matches.length - 1; i >= 0; i--) {
			const handler = matches[i];
			try {
				handler(event);
			} catch (err) {
				return this._emitter.emit(`error`, new StackedError(
					`Error in event handler index [${i}] for path "${path}"`,
					err
				));
			}
		}

		return this;
	}

	static findBestMatches(routes, path) {
		// Find all matches, order them by the specificity of the pattern
		// (longest length/most specific first).
		const matches = compact(routes.map((route) => {
			const {handler, pattern} = route;
			if (!path.startsWith(pattern)) return false;
			return {handler, pattern};
		})).sort((a, b) => {
			if (a.pattern.length === b.pattern.length) {
				return 0;
			}
			return b.pattern.length > a.pattern.length ? 1 : -1;
		})[0];

		if (matches.length === 0) {
			return matches;
		}

		const firstMatchLength = matches[0].pattern.length;
		return matches.filter((match) => {
			return match.pattern.length === firstMatchLength;
		});
	}
}

module.exports = EventBus;
