'use strict';

const { inspect } = require('util');
const R = require('ramda');


class Maybe {
	static of(x) {
		return new Maybe.Just(x);
	}
}


class Just extends Maybe {
	constructor(value) {
		super();

		Object.defineProperties(this, {
			isJust: {
				enumerable: true,
				value: true
			},
			isNothing: {
				enumerable: true,
				value: false
			},
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
	constructor() {
		super();

		Object.defineProperties(this, {
			isJust: {
				enumerable: true,
				value: false
			},
			isNothing: {
				enumerable: true,
				value: true
			}
		});
	}

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


const maybe = R.curryN(3, (defaultValue, fn, f) => {
	return f.isNothing ? defaultValue : fn(f.value);
});


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
	},
	maybe: {
		enumerable: true,
		value: maybe
	}
});

module.exports = Maybe;
