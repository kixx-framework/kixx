'use strict';

const { assert } = require('kixx-assert');
const R = require('ramda');
const Task = require('../../lib/atypes/task');

const { component, initializeApi } = require('../../lib/initialize-api');


module.exports = (test) => {
	test.describe('happy path', (t) => {
		const CONFIGS = [
			[ 'jan', [ 'mar' ] ],
			[ 'feb', [] ],
			[ 'mar', [ 'may', 'apr', 'feb' ] ],
			[ 'apr', [ 'feb', 'may' ] ],
			[ 'may', [] ]
		];

		let result;

		t.before((done) => {
			const components = CONFIGS.map(([ name, dependencies, ]) => {
				return component(name, dependencies, (api) => {
					const loadedNames = api.map(R.prop('name'));

					const newApi = api.slice();
					newApi.push({ name, dependencies , loadedNames });
					return Task.of(newApi);
				});
			});

			initializeApi('jan', [], components).fork(done, (res) => {
				result = res;
				done();
			});
		});

		t.it('loads dependencies before initializing a component', () => {
			assert.isOk(Array.isArray(result));
			assert.isGreaterThan(5, result.length);

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
	});
};
