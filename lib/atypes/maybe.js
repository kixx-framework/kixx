'use strict';

const { inspect } = require('util');


// TODO: Implement bimap()

class Maybe {
	static of(x) {
		return new Just(x);
	}
}


class Just extends Maybe {
	constructor(value) {
		super();

		Object.defineProperties(this, {
			value: { value }
		});
	}

	inspect() {
		return `Just(${inspect(this.value)})`;
	}

	map(fn) {
		return new Just(fn(this.value));
	}

	chain(fn) {
		return fn(this.value);
	}

	static of(x) {
		return new Just(x);
	}
}

Just.prototype.toString = Just.prototype.inspect;


class Nothing extends Maybe {
	inspect() {
		return 'Nothing';
	}

	map() {
		return this;
	}

	chain() {
		return this;
	}
}

Nothing.prototype.toString = Nothing.prototype.inspect;


Object.defineProperties(Maybe, {
	Just: {
		enumerable: true,
		value: Just
	},
	Nothing: {
		enumerable: true,
		value: Nothing
	},
	just: {
		enumerable: true,
		value(x) { return new Maybe.Just(x); }
	},
	nothing: {
		enumerable: true,
		value() { return new Maybe.Nothing(); }
	}
});

module.exports = Maybe;
