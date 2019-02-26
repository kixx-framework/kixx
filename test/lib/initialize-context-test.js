'use strict';

const { assert } = require('kixx-assert');
const R = require('ramda');

const { component, initializer, initializeContext } = require('../../lib/initialize-context');

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


module.exports = (test) => {
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
					console.log(`>> initializing: ${name} ${context.uid} [${context.loadedNames.join()}]`);
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
			console.log(' --- result ---');
			console.log(result);
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

	test.xdescribe('when component intializer returns non Task', (t) => {
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
