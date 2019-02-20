'use strict';

const { assert } = require('kixx-assert');
// const pureTest = require('../../../lib/pure-test');

const Task = require('../../../lib/atypes/task');


module.exports = (test) => {
	test.describe('happy path', (t) => {
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
};
