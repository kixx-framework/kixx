'use strict';

module.exports = function pureTest(test, description, configure) {
	test.describe(description, (t) => {
		let context;

		configure({
			before(fn) {
				t.before((done) => {
					function resolve(res) {
						context = res;
						done();
					}

					let m;
					try {
						m = fn();
					} catch (err) {
						return done(err);
					}

					if (m && typeof m.fork === 'function') {
						return m.fork(done, resolve);
					}

					resolve(m);
				});
			},

			it(name, fn) {
				t.it(name, () => {
					return fn(context);
				});
			},

			describe(name, fn) {
				pureTest(t, name, fn);
			}
		});
	});
};
