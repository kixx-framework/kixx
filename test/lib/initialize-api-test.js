'use strict';

const { assert } = require('kixx-assert');
const R = require('ramda');
const Task = require('../../lib/atypes/task');

const { component, initializer, initializeApi } = require('../../lib/initialize-api');


module.exports = (test) => {
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
				return createComponent(name, dependencies, (api) => {
					const loadedNames = api.map(R.prop('name'));
					// api.push({ name, dependencies , loadedNames });
					// return Task.of(api);
					const newApi = api.slice();
					newApi.push({ name, dependencies , loadedNames });
					return new Task((reject, resolve) => {
						setTimeout(() => {
							resolve(newApi);
						}, 100);
					});
				});
			});

			initializeApi('jan', [], components).fork(done, (res) => {
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

			initializeApi('root', [], components).fork(done, (res) => {
				result = res;
				done();
			});
		});

		t.it('is not smoking', () => {
			assert.isOk(X, result);
		});
	});
};
