'use strict';

const {assert, mergeDeep} = require('../../library');

module.exports = function (t) {
	t.describe('attempting to merge non Objects, Arrays, and Dates', function (t) {
		t.it('returns a plain empty Object', function (t) {
			const fn = function () {};
			const a = [];
			const d = new Date();
			const x = {};

			/* eslint-disable no-undefined */
			const newObject = mergeDeep(null, 0, 1.1, 'x', true, false, NaN, undefined, a, fn, d, x);
			/* eslint-enable */

			assert.isEqual('[object Object]', Object.prototype.toString.call(newObject));
			assert.isEqual(0, Object.getOwnPropertyNames(newObject).length);

			assert.isNotEqual(fn, newObject);
			assert.isNotEqual(a, newObject);
			assert.isNotEqual(d, newObject);
			assert.isNotEqual(x, newObject);
		});
	});
	t.describe('mergeDeep() a single Object', (t) => {
		t.it('returns a deep copy of all values', () => {
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

			const x1 = mergeDeep(x);

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
	t.describe('mergeDeep() a blank object and full object', (t) => {
		t.it('returns a deep copy of all values', () => {
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

			const blank = Object.create(null);

			const x1 = mergeDeep(blank, x);

			assert.isNotEqual(blank, x1);
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
	t.describe('mergeDeep() objects mixed with primitives', (t) => {
		t.it('returns a deep copy of all values', () => {
			const fn = function () {};
			const arr = [];
			const date = new Date();

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

			/* eslint-disable no-undefined */
			const x1 = mergeDeep(null, 0, 1.1, 'x', true, false, NaN, undefined, arr, fn, date, x);
			/* eslint-enable */

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
	t.describe('when merging', (t) => {
		const innerA = {A: 1};
		const innerB = {B: 1};

		const a = {
			a: 1,
			b: []
		};
		const b = {
			b: null,
			c: {first: innerA, second: innerB}
		};
		const c = {
			c: true,
			d: {first: innerA, second: innerB}
		};
		const d = {
			d: {second: null, third: false},
			e: {foo: 1}
		};
		const e = {
			e: [1, 2],
			f: [innerA, innerB, innerA, innerB]
		};
		/* eslint-disable no-undefined */
		const f = {
			f: [innerB, innerA, innerB, innerA],
			g: 0,
			h: null,
			i: false,
			j: undefined
		};
		/* eslint-enable */

		const x = mergeDeep(a, b, c, d, e, f);

		t.it('the result is not equal to any input', () => {
			assert.isNotEqual(a, x);
			assert.isNotEqual(b, x);
			assert.isNotEqual(c, x);
			assert.isNotEqual(d, x);
			assert.isNotEqual(e, x);
			assert.isNotEqual(f, x);
		});

		t.it('has all the merged keys, but none others', () => {
			assert.isEqual(10, Object.keys(x).length);

			Object.keys(x).forEach((k) => {
				assert.includes(k, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
			});
			console.log(x.d);

			assert.isEqual(3, Object.keys(x.d).length);

			Object.keys(x.d).forEach((k) => {
				assert.includes(k, ['first', 'second', 'third']);
			});
		});
	});
};
