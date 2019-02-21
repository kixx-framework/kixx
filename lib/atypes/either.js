'use strict';

const { EOL } = require('os');
const { inspect } = require('util');
const R = require('ramda');
const { getName } = require('../utils');


class Either {
	static of(x) {
		return new Either.Right(x);
	}
}


class Right extends Either {
	constructor(value) {
		super();

		Object.defineProperties(this, {
			value: { value },
			// TODO: Remove these properties. We don't use them.
			isLeft: {
				enumerable: true,
				value: false
			},
			isRight: {
				enumerable: true,
				value: true
			}
		});
	}

	inspect() {
		return `Right(${inspect(this.value)})`;
	}

	map(fn) {
		return new Right(fn(this.value));
	}

	chain(fn) {
		return fn(this.value);
	}
}

Right.prototype.toString = Right.prototype.inspect;


class Left extends Either {
	constructor(value) {
		super();

		Object.defineProperties(this, {
			value: { value },
			// TODO: Remove these properties. We don't use them.
			isLeft: {
				enumerable: true,
				value: true
			},
			isRight: {
				enumerable: true,
				value: false
			}
		});
	}

	inspect() {
		return this.value && this.value.stack
			? `Left(${this.value.stack.split(EOL)[0]})`
			: `Left(${inspect(this.value)})`;
	}

	map() {
		return this;
	}

	chain() {
		return this;
	}
}

Left.prototype.toString = Left.prototype.inspect;


const either = R.curryN(3, function (leftFn, rightFn, a) {
	if (a.constructor === Either.Left) {
		return leftFn(a.value);
	}
	if (a.constructor === Either.Right) {
		return rightFn(a.value);
	}

	throw new TypeError(
		`Invalid type '${getName(a)}' given to either()`
	);
});


Object.defineProperties(Either, {
	Right: {
		enumerable: true,
		value: Right
	},
	Left: {
		enumerable: true,
		value: Left
	},
	right: {
		enumerable: true,
		value(x) { return new Either.Right(x); }
	},
	left: {
		enumerable: true,
		value(x) { return new Either.Left(x); }
	},
	either: {
		enumerable: true,
		value: either
	}
});

module.exports = Either;
