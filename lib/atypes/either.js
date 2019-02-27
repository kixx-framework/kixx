'use strict';

const { EOL } = require('os');
const { inspect } = require('util');


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
	}
});

module.exports = Either;
