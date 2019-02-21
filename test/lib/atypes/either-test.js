'use strict';

const { inspect } = require('util');
const { assert, helpers } = require('kixx-assert');
const sinon = require('sinon');

const Either = require('../../../lib/atypes/either');

// Create an assertion to check for an Either instance.
const isEither = helpers.assertion1(
	(x) => x instanceof Either,
	(actual) => `expected ${actual} to be an instance of Either`
);

// Create an assertion to confirm a function (sinon spy) has not been called.
const isNotCalled = helpers.assertion1(
	(x) => x.notCalled,
	(actual) => `expected not to be called, but called ${actual.callCount} times`
);

// Create an assertion to confirm a function (sinon spy) has only been called
// once, and was called with single argument a.
const isCalledOnceWith = helpers.assertion2(
	(a, x) => x.calledOnceWith(a),
	(expected, actual) => {
		const { callCount, firstCall } = actual;
		const expectedString = inspect(expected);
		const args = (firstCall || {}).args || [];
		return `expected to be called once with ${expectedString}, but called ${callCount} times with ${args}`;
	}
);

module.exports = (test) => {
	// Testing the map() instance method when Right.
	test.describe('Either as Functor on Right side', (t) => {
		// A value which has a Functor must provide a `map` method. The `map`
		// method takes one argument:
		//
		//     u.map(f)
		//
		// 1. `f` must be a function,
		//
		//     1. If `f` is not a function, the behaviour of `map` is
		//        unspecified.
		//     2. `f` can return any value.
		//     3. No parts of `f`'s return value should be checked.
		//
		// 2. `map` must return a value of the same Functor

		const VALUE = Object.freeze({ VALUE: true });

		const m = Either.right(VALUE);

		t.it('will take any value from f and return an Either', () => {
			const a = m.map((x) => x);
			isEither(a);
			assert.isEqual(VALUE, a.value);

			const b = m.map((x) => Object.isFrozen(x));
			isEither(b);
			assert.isEqual(true, b.value);

			const c = m.map(() => null);
			isEither(c);
			assert.isEqual(null, c.value);

			const fn = function () {};
			const d = m.map(() => fn);
			isEither(d);
			assert.isEqual(fn, d.value);

			const m1 = Either.of(1);
			const e = m.map(() => m1);
			isEither(e);
			assert.isEqual(m1, e.value);
		});

		t.it('follows the identity law', () => {
			const m1 = m.map((x) => x);

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);
			assert.isEqual(VALUE, m.value);
			assert.isEqual(m.value, m1.value);
		});

		t.it('follows the composition law', () => {
			function g(x) {
				return Object.keys(x).length;
			}

			function f(x) {
				return x * 10;
			}

			const m1 = m.map((x) => f(g(x)));
			const m2 = m.map(g).map(f);

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);

			assert.isDefined(m2);
			isEither(m2);
			assert.isEqual(m.constructor, m2.constructor);

			assert.isEqual(10, m1.value);
			assert.isEqual(m1.value, m2.value);
		});
	});

	// Testing the map() instance method when Left.
	test.describe('Either as Functor on Left side', (t) => {
		// A value which has a Functor must provide a `map` method. The `map`
		// method takes one argument:
		//
		//     u.map(f)
		//
		// 1. `f` must be a function,
		//
		//     1. If `f` is not a function, the behaviour of `map` is
		//        unspecified.
		//     2. `f` can return any value.
		//     3. No parts of `f`'s return value should be checked.
		//
		// 2. `map` must return a value of the same Functor

		const ERR = new Error('TEST');

		const m = Either.left(ERR);

		t.it('always returns an Either, but never calls f', () => {
			const fa = sinon.fake((x) => x);
			const a = m.map(fa);
			isEither(a);
			assert.isEqual(ERR, a.value);
			isNotCalled(fa);

			const fb = sinon.fake((x) => Object.isFrozen(x));
			const b = m.map(fb);
			isEither(b);
			assert.isEqual(ERR, b.value);
			isNotCalled(fb);

			const fc = sinon.fake.returns(null);
			const c = m.map(fc);
			isEither(c);
			assert.isEqual(ERR, c.value);
			isNotCalled(fc);

			const fn = function () {};
			const fd = sinon.fake.returns(fn);
			const d = m.map(fd);
			isEither(d);
			assert.isEqual(ERR, d.value);
			isNotCalled(fd);

			const m1 = Either.of(1);
			const fe = sinon.fake.returns(m1);
			const e = m.map(fe);
			isEither(e);
			assert.isEqual(ERR, e.value);
			isNotCalled(fe);
		});

		t.it('follows the identity law', () => {
			const m1 = m.map((x) => x);

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);
			assert.isEqual(ERR, m.value);
			assert.isEqual(m.value, m1.value);
		});

		t.it('follows the composition law', () => {
			const g = sinon.fake(function (x) {
				return x.message;
			});

			const f = sinon.fake(function (x) {
				x.length;
			});

			const m1 = m.map((x) => f(g(x)));
			const m2 = m.map(g).map(f);

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);

			assert.isDefined(m2);
			isEither(m2);
			assert.isEqual(m.constructor, m2.constructor);

			assert.isEqual(ERR, m1.value);
			assert.isEqual(m1.value, m2.value);

			// Mapping functions are never called on the Left path.
			isNotCalled(g);
			isNotCalled(f);
		});
	});

	// Testing the chain() instance method when Right.
	test.describe('Either as Chain on Right side', (t) => {
		// A value which has a Chain must provide a `chain` method. The `chain`
		// method takes one argument:
		//
		//     m.chain(f)
		//
		// 1. `f` must be a function which returns a value
		//
		//     1. If `f` is not a function, the behaviour of `chain` is
		//        unspecified.
		//     2. `f` must return a value of the same Chain
		//
		// 2. `chain` must return a value of the same Chain

		const VALUE = Object.freeze({ VALUE: true });

		const m = Either.right(VALUE);

		t.it('accepts an Either from f and returns an Either', () => {
			const m1 = Either.right(9);
			isEither(m1);

			const m2 = m.chain(() => m1);
			isEither(m2);

			assert.isEqual(9, m2.value);
		});

		t.it('follows the associativity law', () => {
			function f(x) {
				return Either.of(Object.keys(x).length);
			}

			function g(x) {
				return Either.of(x * 10);
			}

			const m1 = m.chain(f).chain(g);
			const m2 = m.chain((x) => f(x).chain(g));

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);

			assert.isDefined(m2);
			isEither(m2);
			assert.isEqual(m.constructor, m2.constructor);

			assert.isEqual(10, m1.value);
			assert.isEqual(m1.value, m2.value);
		});
	});

	// Testing the chain() instance method when Left.
	test.describe('Either as Chain on Left side', (t) => {
		// A value which has a Chain must provide a `chain` method. The `chain`
		// method takes one argument:
		//
		//     m.chain(f)
		//
		// 1. `f` must be a function which returns a value
		//
		//     1. If `f` is not a function, the behaviour of `chain` is
		//        unspecified.
		//     2. `f` must return a value of the same Chain
		//
		// 2. `chain` must return a value of the same Chain

		const ERR = new Error('TEST');

		const m = Either.left(ERR);

		t.it('accepts an Either from f and returns an Either', () => {
			const m1 = Either.right(9);
			isEither(m1);

			const fn = sinon.fake.returns(m1);

			const m2 = m.chain(fn);
			isEither(m2);

			assert.isEqual(ERR, m2.value);
		});

		t.it('follows the associativity law', () => {
			const f = sinon.fake.returns(null);
			const g = sinon.fake.returns(null);

			const m1 = m.chain(f).chain(g);
			const m2 = m.chain((x) => f(x).chain(g));

			assert.isDefined(m1);
			isEither(m1);
			assert.isEqual(m.constructor, m1.constructor);

			assert.isDefined(m2);
			isEither(m2);
			assert.isEqual(m.constructor, m2.constructor);

			assert.isEqual(ERR, m1.value);
			assert.isEqual(m1.value, m2.value);

			// Mapping functions are never called in the Left path.
			isNotCalled(f);
			isNotCalled(g);
		});
	});

	test.describe('either() helper', (t) => {
		const VALUE = Object.freeze({ VALUE: true });
		const ERR = new Error('TEST');

		t.describe('on Right path', (t1) => {
			const onleft = sinon.fake.returns(0);
			const onright = sinon.fake.returns(1);

			const map = Either.either(onleft, onright);

			t1.it('executes the right function', () => {
				const x = map(Either.right(VALUE));

				isNotCalled(onleft);
				isCalledOnceWith(VALUE, onright);

				assert.isEqual(1, x);
			});
		});

		t.describe('on Left path', (t1) => {
			const onleft = sinon.fake.returns(0);
			const onright = sinon.fake.returns(1);

			const map = Either.either(onleft, onright);

			t1.it('executes the left function', () => {
				const x = map(Either.left(ERR));

				isNotCalled(onright);
				isCalledOnceWith(ERR, onleft);

				assert.isEqual(0, x);
			});
		});

		t.describe('with invalid type', (t1) => {
			const onleft = sinon.fake.returns(0);
			const onright = sinon.fake.returns(1);

			const map = Either.either(onleft, onright);

			t1.it('throws', () => {
				let x;
				let success = false;

				try {
					x = map(new Date());
					success = true;
				} catch (err) {
					assert.isEqual("Invalid type 'Date' given to either()", err.message);
				}

				isNotCalled(onright);
				isNotCalled(onleft);

				assert.isEqual(false, success);
				assert.isUndefined(x);
			});
		});
	});
};
