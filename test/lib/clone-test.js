'use strict';

const {assert, clone} = require('../../library');

module.exports = function (t) {
	t.describe('clone(null)', (t) => {
		t.it('returns null', () => {
			assert.isEqual(null, clone(null));
		});
	});
	t.describe('clone(1)', (t) => {
		t.it('returns 1', () => {
			assert.isEqual(1, clone(1));
		});
	});
	t.describe('clone("x")', (t) => {
		t.it('returns "x"', () => {
			assert.isEqual('x', clone('x'));
		});
	});
	t.describe('clone(true)', (t) => {
		t.it('returns true', () => {
			assert.isEqual(true, clone(true));
		});
	});
	t.describe('clone(NaN)', (t) => {
		t.it('returns NaN', () => {
			assert.isEqual(NaN, clone(NaN));
		});
	});
	t.describe('clone(function () {})', (t) => {
		t.it('returns the same function', () => {
			const fn = function () {};
			assert.isEqual(fn, clone(fn));
		});
	});
	t.describe('clone({})', (t) => {
		t.it('returns a new Object', () => {
			const x = {};
			assert.isNotEqual(x, clone(x));
			assert.isEqual(0, Object.getOwnPropertyNames(clone(x)).length);
		});
	});
	t.describe('clone([])', (t) => {
		t.it('returns a new Array', () => {
			const x = [];
			assert.isNotEqual(x, clone(x));
			assert.isEqual(0, clone(x).length);
		});
	});
	t.describe('clone() an Object of primitives', (t) => {
		t.it('returns a new copy of all values', () => {
			const fn = function () {};

			const x = {
				n: null,
				i: 0,
				f: 1.1,
				s: 'x',
				bt: true,
				bf: false,
				na: NaN,
				fn
			};

			const newX = clone(x);

			assert.isNotEqual(x, newX);

			assert.isEqual(null, newX.n);
			assert.isEqual(0, newX.i);
			assert.isEqual(1.1, newX.f);
			assert.isEqual('x', newX.s);
			assert.isEqual(true, newX.bt);
			assert.isEqual(false, newX.bf);
			assert.isEqual(NaN, newX.na);
			assert.isEqual(fn, newX.fn);
		});
	});
	t.describe('clone() an Array of primitives', (t) => {
		t.it('returns a new copy of all values', () => {
			const fn = function () {};

			const x = [
				null,
				0,
				1.1,
				'x',
				true,
				false,
				NaN,
				fn
			];

			const newX = clone(x);

			assert.isNotEqual(x, newX);

			assert.isEqual(null, newX[0]);
			assert.isEqual(0, newX[1]);
			assert.isEqual(1.1, newX[2]);
			assert.isEqual('x', newX[3]);
			assert.isEqual(true, newX[4]);
			assert.isEqual(false, newX[5]);
			assert.isEqual(NaN, newX[6]);
			assert.isEqual(fn, newX[7]);
		});
	});
	t.describe('clone() a mixed nested Object', (t) => {
		t.it('returns a new copy of all values', () => {
			const fn = function () {};

			const a = {
				n: null,
				i: 0,
				f: 1.1,
				s: 'x'
			};
			const b = {
				bt: true,
				bf: false,
				na: NaN,
				fn
			};
			const c = [a, b];

			const x = {a, b, c};

			const x1 = clone(x);

			assert.isNotEqual(x, x1);
			assert.isNotEqual(x.a, x1.a);
			assert.isNotEqual(x.b, x1.b);
			assert.isNotEqual(x.c, x1.c);

			assert.isEqual(null, x1.a.n);
			assert.isEqual(0, x1.a.i);
			assert.isEqual(1.1, x1.a.f);
			assert.isEqual('x', x1.a.s);
			assert.isEqual(true, x1.b.bt);
			assert.isEqual(false, x1.b.bf);
			assert.isEqual(NaN, x1.b.na);
			assert.isEqual(fn, x1.b.fn);

			assert.isNotEqual(x.c[0], x1.c[0]);
			assert.isNotEqual(x.c[1], x1.c[1]);
			assert.isEqual(2, x1.c.length);

			assert.isEqual(null, x1.c[0].n);
			assert.isEqual(0, x1.c[0].i);
			assert.isEqual(1.1, x1.c[0].f);
			assert.isEqual('x', x1.c[0].s);
			assert.isEqual(true, x1.c[1].bt);
			assert.isEqual(false, x1.c[1].bf);
			assert.isEqual(NaN, x1.c[1].na);
			assert.isEqual(fn, x1.c[1].fn);
		});
	});
};
