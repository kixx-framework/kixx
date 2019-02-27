'use strict';

const { assert } = require('kixx-assert');
const sinon = require('sinon');
const R = require('ramda');

const Task = require('../../lib/atypes/task');
const U = require('../../lib/utils');

const {
	component,
	initializer,
	contextReducer,
	flattenAndSerializeComponents
} = require('../../lib/initialize-context');


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

	test.describe('flattenAndSerializeComponents()', (t) => {
		const CONFIGS = [
			[ 'jan', [ 'mar' ] ],
			[ 'feb', [] ],
			[ 'mar', [ 'may', 'apr', 'feb' ] ],
			[ 'apr', [ 'feb', 'may' ] ],
			[ 'may', [] ]
		];

		let components;
		let componentIndex;
		let result;

		t.before((done) => {
			components = CONFIGS.map(([ name, dependencies ]) => {
				const initialize = function () {};
				return [ name, dependencies, initialize ];
			});

			componentIndex = components.reduce((index, comp) => {
				const [ key ] = comp;
				return index.set(key, comp);
			}, new Map());

			result = flattenAndSerializeComponents('jan', components);

			done();
		});

		t.it('returns an Array of functions', () => {
			assert.isOk(Array.isArray(result));
			assert.isGreaterThan(0, result.length);
			result.forEach((fn) => {
				assert.isOk(typeof fn === 'function');
			});
		});

		t.it('returns items in expected load order', () => {
			const jan = componentIndex.get('jan');
			const feb = componentIndex.get('feb');
			const mar = componentIndex.get('mar');
			const apr = componentIndex.get('apr');
			const may = componentIndex.get('may');

			assert.isEqual(may[2], result[0]);
			assert.isEqual(feb[2], result[1]);
			assert.isEqual(apr[2], result[2]);
			assert.isEqual(mar[2], result[3]);
			assert.isEqual(jan[2], result[4]);
		});

		t.it('does not return duplicates', () => {
			assert.isEqual(R.uniq(result).length, result.length);
			assert.isEqual(CONFIGS.length, result.length);
		});
	});

	test.describe('happy path', (t) => {
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

			const flattenedComponents = flattenAndSerializeComponents('jan', components);

			const reducer = contextReducer((context, res) => {
				const [ name, deps ] = res;
				return context.update(name, deps);
			});

			const seed = Task.of(APIContext.create());

			R.reduce(reducer, seed, flattenedComponents).fork(done, (res) => {
				result = res;
				done();
			});
		});

		t.it('returns the final context state as the result', () => {
			assert.isOk(result instanceof APIContext);
		});

		t.it('loads components only once', () => {
			const names = result.extensions.map(R.prop('name'));
			assert.isGreaterThan(0, names.length);
			assert.isEqual(R.uniq(names).length, names.length);
		});

		t.it('loads dependencies before initializing a component', () => {
			const { extensions } = result;
			assert.isEqual(CONFIGS.length, extensions.length);

			extensions.forEach(({ name, dependencies, loadedNames }, index) => {
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
	});
};


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

	static create() {
		return new APIContext({
			loadedNames: [],
			extensions: []
		});
	}
}
APIContext.uid = uid();
