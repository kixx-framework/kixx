'use strict';

const EventEmitter = require(`events`);
const {StackedError, ProgrammerError} = require(`../../index`);
const {isObject, isNonEmptyString, compact, clone, deepFreeze} = require(`../../library`);

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

	observe(type, pattern, handler) {
		pattern = `${type}:${pattern}`;
		this._observerRoutes.push({pattern, handler});
		return this;
	}

	addErrorHandler(handler) {
		this._emitter.on(`error`, handler);
	}

	broadcast(spec) {
		if (!isObject(spec)) {
			throw new ProgrammerError(`EventBus#broadcast() requires an event Object.`);
		}
		if (!isNonEmptyString(spec.type)) {
			throw new ProgrammerError(`EventBus#broadcast() requires an event.type String`);
		}
		if (!isNonEmptyString(spec.pattern)) {
			throw new ProgrammerError(`EventBus#.broadcast() requires an event.pattern String`);
		}

		const event = EventBus.createEvent(spec);
		const matches = EventBus.findBestMatches(this._observerRoutes, event.pattern);

		for (let i = matches.length - 1; i >= 0; i--) {
			const handler = matches[i];
			try {
				handler(event);
			} catch (err) {
				return this._emitter.emit(`error`, new StackedError(
					`Error in event handler index [${i}] for pattern "${event.pattern}"`,
					err
				));
			}
		}

		return this;
	}

	static createEvent(spec) {
		if (!isObject(spec)) {
			throw new ProgrammerError(`EventBus.createEvent() requires a spec Object.`);
		}
		if (!isNonEmptyString(spec.type)) {
			throw new ProgrammerError(`EventBus.createEvent() requires a spec.type String`);
		}
		if (!isNonEmptyString(spec.pattern)) {
			throw new ProgrammerError(`EventBus.createEvent() requires a spec.pattern String`);
		}

		let payload;
		if (spec.error) {
			payload = spec.error;
		} else {
			payload = spec.payload ? clone(spec.payload) : null;
		}

		return deepFreeze({
			type: spec.type,
			pattern: `${spec.type}:${spec.pattern}`,
			error: Boolean(spec.error),
			payload
		});
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
		});

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
