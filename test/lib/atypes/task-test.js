'use strict';

const { assert, helpers } = require('kixx-assert');
// const pureTest = require('../../../lib/pure-test');

const Task = require('../../../lib/atypes/task');

const isTask = helpers.assertion1(
	(x) => x instanceof Task,
	(actual) => `expected ${actual} to be an instance of Task`
);


module.exports = (test) => {
	test.describe('Task happy path', (t) => {
		const DELAYED_RESULT = Object.freeze({
			DELAYED_RESULT: true
		});

		let result;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				setTimeout(() => {
					resolve(DELAYED_RESULT);
				}, 10);
			});

			f.fork(done, (x) => {
				result = x;
				done();
			});
		});

		t.it('is not smoking', () => {
			assert.isNotEmpty(result);
			assert.isEqual(DELAYED_RESULT, result);
		});
	});

	// Testing the map() instance method.
	test.describe('Task as Functor', (t) => {
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

		const task = new Task((reject, resolve) => {
			resolve(VALUE);
		});

		function throwError(err) {
			throw err;
		}

		t.it('can take any value from f and returns a Task', () => {
			let count = 0;

			const a = task.map((x) => x);
			isTask(a);
			a.fork(throwError, (x) => {
				assert.isEqual(VALUE, x);
				count += 1;
			});

			const b = task.map(() => null);
			isTask(b);
			b.fork(throwError, (x) => {
				assert.isEqual(null, x);
				count += 1;
			});

			const c = task.map(() => 1);
			isTask(c);
			c.fork(throwError, (x) => {
				assert.isEqual(1, x);
				count += 1;
			});

			const fn = function () {};
			const d = task.map(() => fn);
			isTask(d);
			d.fork(throwError, (x) => {
				assert.isEqual(fn, x);
				count += 1;
			});

			const task2 = new Task(function () {});
			const e = task.map(() => task2);
			isTask(e);
			e.fork(throwError, (x) => {
				assert.isEqual(task2, x);
				count += 1;
			});

			assert.isEqual(5, count);
		});

		t.it('follows the identity law', () => {
			const task2 = task.map((x) => x);
			assert.isDefined(task2);
			isTask(task2);
			assert.isEqual(task.constructor, task2.constructor);

			let count = 0;
			task2.fork(throwError, (x) => {
				assert.isEqual(VALUE, x);
				count += 1;
			});
			assert.isEqual(1, count);
		});

		t.it('follows the composition law', () => {
			function g(x) {
				return Object.keys(x).length;
			}

			function f(x) {
				return x * 10;
			}

			const task2 = task.map((x) => f(g(x)));
			const task3 = task.map(g).map(f);

			assert.isDefined(task2);
			assert.isDefined(task3);
			isTask(task2);
			isTask(task3);
			assert.isEqual(task.constructor, task2.constructor);
			assert.isEqual(task.constructor, task3.constructor);

			let count = 0;

			task2.fork(throwError, (x) => {
				assert.isEqual(10, x);
				count += 1;
			});
			task3.fork(throwError, (x) => {
				assert.isEqual(10, x);
				count += 1;
			});

			assert.isEqual(2, count);
		});
	});
};
