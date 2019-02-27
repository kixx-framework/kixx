'use strict';

const { EOL } = require('os');
const { inspect } = require('util');
const U = require('../utils');


class Either {
	static isEither(x) {
		if (!x) return false;
		if (x instanceof Either) return true;

		return Object.prototype.hasOwnProperty.call(x, 'value')
			&& (x.isRight || x.isLeft || false)
			&& typeof x.map === 'function'
			&& typeof x.bimap === 'function'
			&& typeof x.chain === 'function';
	}

	static isLeft(x) {
		return Either.isEither(x) && x.isLeft;
	}

	static isRight(x) {
		return Either.isEither(x) && x.isRight;
	}

	static of(x) {
		return new Either.Right(x);
	}
}


class Right extends Either {
	constructor(value) {
		super();

		Object.defineProperties(this, {
			value: { value },
			isRight: {
				enumerable: true,
				value: true
			},
			isLeft: {
				enumerable: true,
				value: false
			}
		});
	}

	inspect() {
		return `Right(${inspect(this.value)})`;
	}

	map(fn) {
		return new Right(fn(this.value));
	}

	bimap(sad, happy) {
		return new Right(happy(this.value));
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

	bimap(sad, happy) {
		return new Left(sad(this.value));
	}

	chain() {
		return this;
	}
}

Left.prototype.toString = Left.prototype.inspect;


const either = U.curry(function either(sad, happy, a) {
	if (Either.isLeft(a)) {
		return sad(a.value);
	}
	if (Either.isRight(a)) {
		return happy(a.value);
	}

	throw new TypeError(
		`Invalid type '${U.getName(a)}' given to either()`
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
