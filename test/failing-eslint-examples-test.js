/* eslint-disable strict, eol-last */

const assert = require('assert');


module.exports = (t) => {
	// TODO: This is a test comment
	// FIXME: This is another test comment

	t.describe('examples', (t) => { // eslint-disable-line no-shadow
		const a = "A"; // eslint-disable-line quotes
		const b = `B`; // eslint-disable-line quotes
		const c = {a, b, foo: 'bar'}; // eslint-disable-line object-curly-spacing
		const d = [a, b, 'foo']; // eslint-disable-line array-bracket-spacing

		var d1 = d[1]; // eslint-disable-line no-var
		let d2 = d[2]; // eslint-disable-line prefer-const

		const dangle = {
			a,
			b,
			c,
			d,
		};

		const curly = 'foo-${a}'; // eslint-disable-line no-template-curly-in-string

		const n = parseInt('1'); // eslint-disable-line radix

		t.it('is not smoking', t1 => { // eslint-disable-line arrow-parens
			const a1 = `foo-${a}-${b}`; // eslint-disable-line no-unused-vars

			const three = 3;

			if (three >  4) { // eslint-disable-line no-multi-spaces
				throw new Error('3 is greater than 4');
			}

			if (three >4) { // eslint-disable-line space-infix-ops
				throw new Error('3 is greater than 4');
			/* eslint-disable no-trailing-spaces */
			} 
			/* eslint-enable */

			const {foo} = c; // eslint-disable-line object-curly-spacing

			/* eslint-disable block-spacing */
			if (foo === 'foo') {throw new Error('foo is foo');}
			/* eslint-enable */

			const [f] = d; // eslint-disable-line array-bracket-spacing

			if (f === 'bar') throw new Error('f is bar');

			assert.equal(d1, d[1]);
			assert.equal(d2, d[2]);

			/* We can't actually do this:
			assert.equal(one, 1); // eslint-disable-line no-use-before-define
			const one = 1;
			*/

			if (dangle.a === b) // eslint-disable-line curly
				assert(true);

			assert(curly);
			assert(n);
		});

		t.it('cannot use caller', () => {
			const caller = arguments.caller; // eslint-disable-line no-caller
			const callee = arguments.callee; // eslint-disable-line no-caller
			assert.equal(typeof caller, 'undefined');
			assert.equal(typeof callee, 'function');
		});

		t.it('cannot shadow restricted names', () => {
			const eval = 1; // eslint-disable-line no-shadow-restricted-names
			const arguments = 1; // eslint-disable-line no-shadow-restricted-names
			const Infinity = 1; // eslint-disable-line no-shadow-restricted-names
			const undefined = 1; // eslint-disable-line no-shadow-restricted-names
			const NaN = 1; // eslint-disable-line no-shadow-restricted-names

			assert(eval);
			assert(arguments);
			assert(Infinity);
			assert(undefined);
			assert(NaN);
		});
	});
};
