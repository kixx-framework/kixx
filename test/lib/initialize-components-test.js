'use strict';

const {assert} = require('../../library');
const initializeComponents = require('../../lib/initialize-components');

module.exports = function (t) {
	const A = {};
	const B = {};

	const compA = {
		key: 'comp_a',
		initialize(api, args, resolve, reject) {
			resolve(A);
		}
	};

	const compB = {
		key: 'comp_b',
		initialize(api, args, resolve, reject) {
			assert.isEqual(A, api.comp_a);
			return Promise.resolve(B).then(resolve);
		}
	};

	let api = null;

	t.before((done) => {
		return initializeComponents(null, [compA, compB])
			.then(function (res) {
				api = res;
				return null;
			})
			.then(function () {
				done();
				return null;
			})
			.catch(done);
	});

	t.it('sets api props', () => {
		assert.isEqual(A, api.comp_a);
		assert.isEqual(B, api.comp_b);
	});
};
