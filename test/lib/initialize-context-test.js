'use strict';

const { assert } = require('kixx-assert');
const sinon = require('sinon');
const R = require('ramda');

const Task = require('../../lib/atypes/task');
const U = require('../../lib/utils');

const {
	component,
	initializer,
	initializeContext,
	// contextReducer,
	// flattenAndSerializeComponents
} = require('../../lib/initialize-context');


function uid() {
	let i = -1;
	return function genUID() {
		return i += 1;
	};
}

class APIContext {
	constructor(spec) {
		Object.defineProperties(this, {
			uid: {
				enumerable: true,
				value: APIContext.uid()
			},
			extensions: {
				enumerable: true,
				value: Object.freeze(spec.extensions)
			},
			loadedNames: {
				enumerable: true,
				value: Object.freeze(spec.loadedNames)
			}
		});
	}

	inspect() {
		const args = this.extensions.map((x) => {
			return JSON.stringify(x);
		});
		args.unshift(this.uid);
		return `Context(\n  ${args.join(',\n  ')}\n)`;
	}

	update(name, dependencies) {
		const { loadedNames, extensions } = this;

		const newExtensions = extensions.slice();
		newExtensions.push(Object.freeze({
			name,
			dependencies,
			loadedNames
		}));

		const newLoadedNames = loadedNames.slice();
		newLoadedNames.push(name);

		return new APIContext({
			extensions: newExtensions,
			loadedNames: newLoadedNames
		});
	}

	reduce(oldContext, value) {
		const [ name, deps ] = value;
		return oldContext.update(name, deps);
	}

	static create() {
		return new APIContext({
			loadedNames: [],
			extensions: []
		});
	}
}
APIContext.uid = uid();


module.exports = (test) => {
	test.describe('component()', (t) => {
		t.it('passes eq', () => {
			const a = 2;
			const b = 3;
			const c = 4;

			// Perform some random operation.
			const fn = (a, b, c) => a * b + c;

			const c1 = fn(a, b, c);

			assert.isNotEqual(c, c1);
			assert.isEqual(10, c1);

			// Take advantage of curried component() function.
			const createComponent = component(fn);

			const [ a1, b1, c2 ] = createComponent(a, b, c);

			assert.isEqual(a, a1);
			assert.isEqual(b, b1);
			assert.isNotEqual(c, c2);

			assert.isEqual(c1, c2);
		});

		t.it('calls the wrapper and uses the response', () => {
			const a = 2;
			const b = 3;
			const c = 4;

			const wrapper = sinon.fake((a, b, c) => a * b + c);

			// Take advantage of curried component() function.
			const createComponent = component(wrapper);

			const [ a1, b1, c1 ] = createComponent(a, b, c);

			assert.isEqual(a, a1);
			assert.isEqual(b, b1);
			assert.isNotEqual(c, c1);
			assert.isEqual(10, c1);

			assert.isEqual(1, wrapper.callCount);

			const { args } = wrapper.firstCall;
			assert.isEqual(a, args[0]);
			assert.isEqual(b, args[1]);
			assert.isEqual(c, args[2]);
		});
	});

	test.describe('initialize()', (t) => {
		t.it('invokes fn', () => {
			const a = 1;
			const b = 2;
			const c = 3;

			const fn = sinon.fake((x) => x * 2);

			const init = initializer(a, b, fn);

			const t = init(c);

			t.fork(
				(err) => assert.isOk(false, err.message),
				([ c1, y ]) => {
					assert.isEqual(c, c1);
					assert.isEqual(6, y);
				}
			);

			assert.isEqual(1, fn.callCount);
		});
	});

	test.describe('initializer() when fn returns Task', (t) => {
		t.it('returns an unnested Task', () => {
			const c = 1;

			const fn = () => Task.of(9);

			const init = initializer(U._, U._, fn);

			const t = init(c);

			t.fork(
				(err) => assert.isOk(false, err.message),
				([ c1, y ]) => {
					assert.isEqual(c, c1);
					assert.isEqual(9, y);
				}
			);
		});
	});

	test.describe('initializer() when fn throws', (t) => {
		t.it('returns rejected Task', () => {
			const ERR = new Error('TEST');

			const init = initializer(U._, U._, () => {
				throw ERR;
			});

			const t = init(null);
			assert.isOk(Task.isTask(t));

			t.fork(
				(err) => assert.isEqual(ERR, err),
				() => assert.isOk(false, 'unexpected path')
			);
		});
	});

	test.xdescribe('happy path', (t) => {
		const CONFIGS = [
			[ 'jan', [ 'mar' ] ],
			[ 'feb', [] ],
			[ 'mar', [ 'may', 'apr', 'feb' ] ],
			[ 'apr', [ 'feb', 'may' ] ],
			[ 'may', [] ]
		];

		const createComponent = component(initializer);

		let result;

		t.before((done) => {
			const components = CONFIGS.map(([ name, dependencies, ]) => {
				return createComponent(name, dependencies, (context) => {
					return [ name, dependencies ];
				});
			});

			function reducer(context, res) {
				const [ name, deps ] = res;
				return context.update(name, deps);
			}

			initializeContext(reducer, 'jan', APIContext.create(), components).fork(done, (res) => {
				result = res;
				done();
			});
		});

		t.it('loads dependencies before initializing a component', () => {
			assert.isOk(Array.isArray(result));
			assert.isEqual(CONFIGS.length, result.length);

			result.forEach(({ name, dependencies, loadedNames }, index) => {
				assert.isOk(
					Array.isArray(dependencies),
					`dependencies check for ${index} ${name}`
				);

				dependencies.forEach((key) => {
					assert.isOk(
						loadedNames.includes(key),
						`${index} ${name} missing loaded dependency ${key}`
					);
				});
			});
		});

		t.it('does not initialize a component more than once', () => {
			const initialized = result.map(R.prop('name'));

			const checks = [];
			for (let i = 0; i < initialized.length; i++) {
				const key = initialized[i];
				assert.isNotOk(checks.includes(key), `already includes '${key}'`);
				checks.push(key);
			}

			assert.isEqual(CONFIGS.length, initialized.length);
		});
	});

	test.xdescribe('when component initializer returns non Task', (t) => {
		const X = Object.create(null);

		const CONFIGS = [
			[ 'root', [ 'null', 'zero', 'false', 'undefined' ], X ],
			[ 'null', [], null ],
			[ 'zero', [], 0 ],
			[ 'false', [], false ],
			[ 'undefined', [], ],
		];

		const createComponent = component(initializer);

		let result;

		t.before((done) => {
			const components = CONFIGS.map(([ name, dependencies, rval ]) => {
				return createComponent(name, dependencies, () => {
					return rval;
				});
			});

			function reducer(context, res) {
				const [ name, deps ] = res;
				return context.update(name, deps);
			}

			initializeContext(reducer, 'root', [], components).fork(done, (res) => {
				result = res;
				done();
			});
		});

		t.it('is not smoking', () => {
			assert.isOk(X, result);
		});
	});
};
