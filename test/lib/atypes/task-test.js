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
		let chainCalled = false;
		let mapCalled = false;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				setTimeout(() => {
					resolve(DELAYED_RESULT);
				}, 10);
			});

			f
				.chain(function withChain(x) {
					chainCalled = true;
					return Task.of(x);
				})
				.map(function withMap(x) {
					mapCalled = true;
					return x;
				})
				.fork(done, (x) => {
					result = x;
					done();
				});
		});

		t.it('resolves with the result', () => {
			assert.isNotEmpty(result);
			assert.isEqual(DELAYED_RESULT, result);
		});

		t.it('calls the chained function', () => {
			assert.isEqual(true, chainCalled);
		});

		t.it('calls the map function', () => {
			assert.isEqual(true, mapCalled);
		});
	});

	test.describe('Task sad path', (t) => {
		const ERR = new Error('TEST');

		let result;
		// TODO: Use Sinon for these spies.
		let chainCalled = false;
		let mapCalled = false;

		t.before((done) => {
			const f = new Task((reject) => {
				setTimeout(() => {
					reject(ERR);
				}, 10);
			});

			f
				.chain(function withChain(x) {
					chainCalled = true;
					return Task.of(x);
				})
				.map(function withMap(x) {
					mapCalled = true;
					return x;
				})
				.fork((x) => {
					result = x;
					done();
				}, done);
		});

		t.it('rejects with the Error', () => {
			assert.isDefined(result);
			assert.isEqual(ERR, result);
		});

		t.it('never called the chained function', () => {
			assert.isEqual(false, chainCalled);
		});

		t.it('never called the map function', () => {
			assert.isEqual(false, mapCalled);
		});
	});

	test.describe('with an error in the fork fn', (t) => {
		const ERR = new Error('TEST');

		let result;

		t.before((done) => {
			const f = new Task(() => {
				throw ERR;
			});

			f.fork((x) => {
				result = x;
				done();
			}, done);
		});

		t.it('rejects with an error', () => {
			assert.isDefined(result);
			assert.isEqual(ERR, result);
		});
	});

	test.describe('when calling resolve() more than once', (t) => {
		const DELAYED_RESULT = Object.freeze({
			DELAYED_RESULT: true
		});

		let result;
		let count = 0;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				setTimeout(() => {
					resolve(DELAYED_RESULT);
					setTimeout(() => {
						resolve(DELAYED_RESULT);
					}, 10);
				}, 10);
			});

			// TODO: Use Sinon for the callback.
			f.fork(done, (x) => {
				count += 1;
				result = x;
				// Give enough time for this callback to be called twice.
				setTimeout(done, 100);
			});
		});

		t.it('resolves only once', () => {
			assert.isEqual(1, count);
			assert.isEqual(DELAYED_RESULT, result);
		});
	});

	test.describe('when calling reject() more than once', (t) => {
		const ERR = new Error('TEST');

		let result;
		let count = 0;

		t.before((done) => {
			const f = new Task((reject) => {
				setTimeout(() => {
					reject(ERR);
					setTimeout(() => {
						reject(ERR);
					}, 10);
				}, 10);
			});

			// TODO: Use Sinon for the callback.
			f.fork((x) => {
				count += 1;
				result = x;
				// Give enough time for this callback to be called twice.
				setTimeout(done, 100);
			}, done);
		});

		t.it('rejects only once', () => {
			assert.isEqual(1, count);
			assert.isEqual(ERR, result);
		});
	});

	test.describe('when calling resolve() then reject()', (t) => {
		const VALUE = Object.freeze({ VALUE: true });

		let result;
		let count = 0;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				setTimeout(() => {
					resolve(VALUE);
					setTimeout(() => {
						reject(new Error('TEST'));
					}, 10);
				}, 10);
			});

			// TODO: Use Sinon for the callback.
			f.fork(done, (x) => {
				count += 1;
				result = x;
				// Give enough time for this callback to be called twice.
				setTimeout(done, 100);
			});
		});

		t.it('resolves only once', () => {
			assert.isEqual(1, count);
			assert.isEqual(VALUE, result);
		});
	});

	test.describe('when calling reject() then resolve()', (t) => {
		const ERR = new Error('TEST');

		let result;
		let count = 0;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				setTimeout(() => {
					reject(ERR);
					setTimeout(() => {
						resolve(new Error('Should not be called'));
					}, 10);
				}, 10);
			});

			// TODO: Use Sinon for the callback.
			f.fork((x) => {
				count += 1;
				result = x;
				// Give enough time for this callback to be called twice.
				setTimeout(done, 100);
			}, done);
		});

		t.it('rejects only once', () => {
			assert.isEqual(1, count);
			assert.isEqual(ERR, result);
		});
	});

	test.describe('with an error in the happy path', (t) => {
		const VALUE = Object.freeze({ VALUE: true });
		const ERR = new Error('TEST');

		let result;

		t.before((done) => {
			const f = new Task((reject, resolve) => resolve(VALUE));

			function throwError() {
				throw ERR;
			}

			f.fork((err) => {
				result = err;
				done();
			}, throwError);
		});

		t.it('rejects with the Error', () => {
			assert.isDefined(result);
			assert.isEqual(ERR, result);
		});
	});

	test.describe('with an error in the sad path', (t) => {
		const ERR1 = new Error('TEST1');
		const ERR2 = new Error('TEST2');
		const ERR3 = new Error('TEST3');

		let count = 0;
		let result1;
		let result2;
		let result3;

		t.before((done) => {
			const f = new Task((reject) => reject(ERR1));

			// TODO: Use Sinon for spies.
			function throwError(err) {
				count += 1;
				if (!result1) {
					result1 = err;
					throw ERR2;
				}
				if (!result2) {
					result2 = err;
					throw ERR3;
				}
			}

			try {
				f.fork(throwError, (res) => {
					done(new Error('Did not expect the happy path to execute'))	;
				});
			} catch (err) {
				result3 = err;
				done();
			}
		});

		t.it('calls reject twice, at most', () => {
			assert.isEqual(2, count);
		});

		t.it('receives first error as rejection', () => {
			assert.isEqual(ERR1, result1);
		});

		t.it('receives thrown error as rejection', () => {
			assert.isEqual(ERR2, result2);
		});

		t.it('throws if it errors a second time', () => {
			assert.isEqual(ERR3, result3);
		});
	});

	test.describe('with error 2 levels deep in chain', (t) => {
		const DELAYED_RESULT = Object.freeze({
			DELAYED_RESULT: true
		});

		const ERR = new Error('TEST');

		let result;
		let called1 = false;
		let called2 = false;
		let called3 = false;
		let called4 = false;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				resolve(DELAYED_RESULT);
			});

			// TODO: Use Sinon for spies.
			f
				.chain((x) => {
					called1 = true;
					return Task.of(x);
				})
				.chain(() => {
					called2 = true;
					throw ERR;
				})
				.chain((x) => {
					called3 = true;
					return Task.of(x);
				})
				.map((x) => {
					called4 = true;
					return x;
				})
				.fork((err) => {
					result = err;
					done();
				}, done);
		});

		t.it('rejects with the error', () => {
			assert.isEqual(ERR, result);
		});

		t.it('calls expected chains and maps', () => {
			assert.isOk(called1);
			assert.isOk(called2);
			assert.isNotOk(called3);
			assert.isNotOk(called4);
		});
	});

	test.describe('with error 2 levels deep in map', (t) => {
		const DELAYED_RESULT = Object.freeze({
			DELAYED_RESULT: true
		});

		const ERR = new Error('TEST');

		let result;
		let called1 = false;
		let called2 = false;
		let called3 = false;
		let called4 = false;

		t.before((done) => {
			const f = new Task((reject, resolve) => {
				resolve(DELAYED_RESULT);
			});

			// TODO: Use Sinon for spies.
			f
				.map((x) => {
					called1 = true;
					return x;
				})
				.map(() => {
					called2 = true;
					throw ERR;
				})
				.map((x) => {
					called3 = true;
					return x;
				})
				.chain((x) => {
					called4 = true;
					return Task.of(x);
				})
				.fork((err) => {
					result = err;
					done();
				}, done);
		});

		t.it('rejects with the error', () => {
			assert.isEqual(ERR, result);
		});

		t.it('calls expected chains and maps', () => {
			assert.isOk(called1);
			assert.isOk(called2);
			assert.isNotOk(called3);
			assert.isNotOk(called4);
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

		// TODO: Move this inside the it() block.
		function throwError(err) {
			throw err;
		}

		t.it('will take any value from f and returns a Task', () => {
			// TODO: Use Sinon for spies.
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
			// TODO: Use Sinon for spies.
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
			// TODO: Use Sinon for spies.
			function g(x) {
				return Object.keys(x).length;
			}

			function f(x) {
				return x * 10;
			}

			const task2 = task.map((x) => f(g(x)));
			const task3 = task.map(g).map(f);

			assert.isDefined(task2);
			isTask(task2);
			assert.isEqual(task.constructor, task2.constructor);

			assert.isDefined(task3);
			isTask(task3);
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

	// Testing the chain() instance method.
	test.describe('Task as Chain', (t) => {
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

		const task = new Task((reject, resolve) => {
			resolve(VALUE);
		});

		// TODO: Move this inside the it() block.
		function throwError(err) {
			throw err;
		}

		t.it('accepts a Task from f and return a Task', () => {
			// TODO: Use Sinon for spies.
			const task2 = new Task(function (reject, resolve) { resolve(9); });

			const e = task.chain(() => task2);
			isTask(e);

			let count = 0;
			e.fork(throwError, (x) => {
				assert.isEqual(9, x);
				count += 1;
			});

			assert.isEqual(1, count);
		});

		t.it('follows the associativity law', () => {
			// TODO: Use Sinon for spies.
			function f(x) {
				return Task.of(Object.keys(x).length);
			}

			function g(x) {
				return Task.of(x * 10);
			}

			const task2 = task.chain(f).chain(g);
			const task3 = task.chain((x) => f(x).chain(g));

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
