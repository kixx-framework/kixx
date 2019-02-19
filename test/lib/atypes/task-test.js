'use strict';

const { assert } = require('kixx-assert');

const pureTest = require('../../../lib/pure-test');


module.exports = (test) => {
	pureTest(test, 'happy path', (t) => {
		t.before(() => {
			return 9;
		});

		t.it('is not smoking', (result) => {
			assert.isEqual(9, result);
		});
	});
};
