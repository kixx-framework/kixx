'use strict';

const {assert, mergeDeep} = require('../../library');

module.exports = function (t) {
	t.describe('when undefined is last', () => {
		t.it('returns undefined', function (t, _, u) {
			const x = mergeDeep(_, u);

			assert.isEqual('undefined', typeof x);
			assert.isEqual(x, u);
		});
	});
	t.describe('when null is last', () => {
		t.it('returns null', function (t, _) {
			const y = null;
			const x = mergeDeep(_, y);

			assert.isEqual(x, null);
			assert.isEqual(x, y);
		});
	});
	t.describe('when NaN is last', () => {
		t.it('returns NaN', function (t, _) {
			const y = NaN;
			const x = mergeDeep(_, y);

			assert.isEqual(x, NaN);
			assert.isEqual(x, y);
		});
	});
	t.describe('when number is last', () => {
		t.it('returns number', function (t, _) {
			const y = 0;
			const x = mergeDeep(_, y);

			assert.isEqual(x, 0);
			assert.isEqual(x, y);
		});
	});
	t.describe('when string is last', () => {
		t.it('returns string', function (t, _) {
			const y = '';
			const x = mergeDeep(_, y);

			assert.isEqual(x, '');
			assert.isEqual(x, y);
		});
	});
	t.describe('when boolean is last', () => {
		t.it('returns boolean', function (t, _) {
			const y = false;
			const x = mergeDeep(_, y);

			assert.isEqual(x, false);
			assert.isEqual(x, y);
		});
	});
	t.describe('when function is last', () => {
		t.it('returns boolean', function (t, _) {
			const y = function () {};
			const x = mergeDeep(_, y);

			assert.isEqual(x, y);
		});
	});
	t.describe('when date is last', () => {
		t.it('returns a copy of the date', function (t, _) {
			const y = new Date();
			const x = mergeDeep(_, y);

			assert.isNotEqual(x, y);
			assert.isEqual(y.toString(), x.toString());
		});
	});
	t.describe('when array is last', () => {
		t.it('returns a deep copy of the array', function (t, _) {
			const A = {A: 1};
			const y = [A];
			const x = mergeDeep(_, y);

			assert.isNotEqual(y, x);
			assert.isNotEqual(y[0], x[0]);
			assert.isEqual(1, x[0].A);
		});
	});

	t.describe('merge oject when undefined is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, _);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when null is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, null);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when NaN is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, NaN);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when number is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, 1);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when string is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, 'z');

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when boolean is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, true);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when function is last', () => {
		const A = {A: 1};
		const fn = function () {};
		fn.B = 2;

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, fn);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when date is last', () => {
		const A = {A: 1};
		const d = new Date();
		d.B = 2;

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, d);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge oject when array is last', () => {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, A, []);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});


	t.describe('merge an object into undefined', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, _, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into null', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, null, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into NaN', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, NaN, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into a number', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, 1, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into a string', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, 'z', A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into a boolean', function (t) {
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, true, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into a function', function (t) {
		const fn = function () {};
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, fn, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into a date', function (t) {
		const d = new Date();
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, d, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});
	t.describe('merge an object into an Array', function (t) {
		const arr = [0];
		const A = {A: 1};

		t.it('returns a copy of the object', function (t, _) {
			const x = mergeDeep(_, arr, A);

			assert.isNotEqual(A, x);
			assert.isNotEqual(_, x);
			assert.isNotEqual(arr, x);
			assert.isEqual(1, Object.keys(x).length);
			assert.isEqual(1, x.A);
			assert.isEqual('[object Object]', x.toString());
		});
	});

	t.describe('mergeDeep() a single Object', (t) => {
		t.it('returns a deep copy of all primitives', () => {
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
		t.it('returns a deep copy of all primitives', () => {
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
		t.it('returns a deep copy of all primitives', (t, _) => {
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

			const x1 = mergeDeep(null, {a: {n: 1}, b: {bt: 0}, c: 1, z: 99}, 0, 1.1, 'x', true, false, NaN, _, arr, fn, date, x);

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

			assert.isEqual(99, x1.z);
		});
	});

	//
	// Null into all types
	//
	t.describe('merging x.null into x.null', (t) => {
		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual(null, x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.NaN', (t) => {
		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.number', (t) => {
		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: 0, c: 0, d: {a: 0, b: 0, e: {a: 0, b: 0}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual(0, x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual(0, x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual(0, x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.string', (t) => {
		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: '', c: '', d: {a: '', b: '', e: {a: '', b: ''}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual('', x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual('', x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual('', x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.boolean', (t) => {
		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: false, c: false, d: {a: false, b: false, e: {a: false, b: false}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual(false, x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual(false, x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual(false, x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.function', (t) => {
		const fn = function () {};

		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: fn, c: fn, d: {a: fn, b: fn, e: {a: fn, b: fn}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isEqual(fn, x.c);
			assert.isEqual(null, x.d.a);
			assert.isEqual(fn, x.d.b);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isEqual(fn, x.d.e.b);
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.date', (t) => {
		const d = new Date();

		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(null, x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.object', (t) => {
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(null, x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(null, x.d.e.c);
		});
	});
	t.describe('merging x.null into x.array', (t) => {
		const a = [1];

		t.it('keeps null', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: null, b: null},
				{d: {a: null, c: null, e: {a: null, c: null}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(null, x.a);
			assert.isEqual(null, x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(null, x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(null, x.d.c);
			assert.isEqual(null, x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(null, x.d.e.c);
		});
	});

	//
	// Undefined into all types
	//
	t.describe('merging x.undefined into x.null', (t, _) => {
		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual(null, x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.NaN', (t, _) => {
		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.number', (t, _) => {
		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: 0, c: 0, d: {a: 0, b: 0, e: {a: 0, b: 0}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual(0, x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual(0, x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual(0, x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.string', (t, _) => {
		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: '', c: '', d: {a: '', b: '', e: {a: '', b: ''}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual('', x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual('', x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual('', x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.boolean', (t, _) => {
		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: false, c: false, d: {a: false, b: false, e: {a: false, b: false}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual(false, x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual(false, x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual(false, x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.function', (t, _) => {
		const fn = function () {};

		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: fn, c: fn, d: {a: fn, b: fn, e: {a: fn, b: fn}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isEqual(fn, x.c);
			assert.isEqual(_, x.d.a);
			assert.isEqual(fn, x.d.b);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isEqual(fn, x.d.e.b);
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.date', (t, _) => {
		const d = new Date();

		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(_, x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.object', (t, _) => {
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(_, x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(_, x.d.e.c);
		});
	});
	t.describe('merging x.undefined into x.array', (t, _) => {
		const a = [1];

		t.it('keeps undefined', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: _, b: _},
				{d: {a: _, c: _, e: {a: _, c: _}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(_, x.a);
			assert.isEqual(_, x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(_, x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(_, x.d.c);
			assert.isEqual(_, x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(_, x.d.e.c);
		});
	});

	//
	// Number into all types
	//
	t.describe('merging x.number into x.null', (t) => {
		t.it('keeps number', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual(null, x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.NaN', (t) => {
		t.it('keeps number', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.number', (t) => {
		t.it('keeps number', () => {
			const x = mergeDeep(
				{a: 0, c: 0, d: {a: 0, b: 0, e: {a: 0, b: 0}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual(0, x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual(0, x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual(0, x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.string', (t) => {
		t.it('keeps number', () => {
			const x = mergeDeep(
				{a: '', c: '', d: {a: '', b: '', e: {a: '', b: ''}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual('', x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual('', x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual('', x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.boolean', (t) => {
		t.it('keeps 0', () => {
			const x = mergeDeep(
				{a: false, c: false, d: {a: false, b: false, e: {a: false, b: false}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual(false, x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual(false, x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual(false, x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.function', (t) => {
		const fn = function () {};

		t.it('keeps 0', () => {
			const x = mergeDeep(
				{a: fn, c: fn, d: {a: fn, b: fn, e: {a: fn, b: fn}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isEqual(fn, x.c);
			assert.isEqual(0, x.d.a);
			assert.isEqual(fn, x.d.b);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isEqual(fn, x.d.e.b);
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.date', (t) => {
		const d = new Date();

		t.it('keeps 0', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(0, x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.object', (t) => {
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps 0', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(0, x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(0, x.d.e.c);
		});
	});
	t.describe('merging x.number into x.array', (t) => {
		const a = [1];

		t.it('keeps 0', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: 0, b: 0},
				{d: {a: 0, c: 0, e: {a: 0, c: 0}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(0, x.a);
			assert.isEqual(0, x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(0, x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(0, x.d.c);
			assert.isEqual(0, x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(0, x.d.e.c);
		});
	});

	//
	// String into all types
	//
	t.describe('merging x.string into x.string', (t) => {
		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: '', c: '', d: {a: '', b: '', e: {a: '', b: ''}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual('', x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual('', x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual('', x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.null', (t) => {
		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual(null, x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.NaN', (t) => {
		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.number', (t) => {
		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual(1, x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual(1, x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual(1, x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.boolean', (t) => {
		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: false, c: false, d: {a: false, b: false, e: {a: false, b: false}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual(false, x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual(false, x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual(false, x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.function', (t) => {
		const fn = function () {};

		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: fn, c: fn, d: {a: fn, b: fn, e: {a: fn, b: fn}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isEqual(fn, x.c);
			assert.isEqual('', x.d.a);
			assert.isEqual(fn, x.d.b);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isEqual(fn, x.d.e.b);
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.date', (t) => {
		const d = new Date();

		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual('', x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.object', (t) => {
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual('', x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual('', x.d.e.c);
		});
	});
	t.describe('merging x.string into x.array', (t) => {
		const a = [1];

		t.it('keeps string', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: '', b: ''},
				{d: {a: '', c: '', e: {a: '', c: ''}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual('', x.a);
			assert.isEqual('', x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual('', x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual('', x.d.c);
			assert.isEqual('', x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual('', x.d.e.c);
		});
	});

	//
	// Boolean into all types
	//
	t.describe('merging x.boolean into x.string', (t) => {
		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: 'x', c: 'x', d: {a: 'x', b: 'x', e: {a: 'x', b: 'x'}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual('x', x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual('x', x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual('x', x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.null', (t) => {
		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual(null, x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.NaN', (t) => {
		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.number', (t) => {
		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual(1, x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual(1, x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual(1, x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.boolean', (t) => {
		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: true, c: true, d: {a: true, b: true, e: {a: true, b: true}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual(true, x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual(true, x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual(true, x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.function', (t) => {
		const fn = function () {};

		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: fn, c: fn, d: {a: fn, b: fn, e: {a: fn, b: fn}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isEqual(fn, x.c);
			assert.isEqual(false, x.d.a);
			assert.isEqual(fn, x.d.b);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isEqual(fn, x.d.e.b);
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.date', (t) => {
		const d = new Date();

		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(false, x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.object', (t) => {
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(false, x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(false, x.d.e.c);
		});
	});
	t.describe('merging x.boolean into x.array', (t) => {
		const a = [1];

		t.it('keeps boolean', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: false, b: false},
				{d: {a: false, c: false, e: {a: false, c: false}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(false, x.a);
			assert.isEqual(false, x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(false, x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(false, x.d.c);
			assert.isEqual(false, x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(false, x.d.e.c);
		});
	});

	//
	// Function into all types
	//
	t.describe('merging x.function into y.string', (t) => {
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: 'x', c: 'x', d: {a: 'x', b: 'x', e: {a: 'x', b: 'x'}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual('x', x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual('x', x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual('x', x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.null', (t) => {
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual(null, x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual(null, x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.NaN', (t) => {
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual(NaN, x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.number', (t) => {
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual(1, x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual(1, x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual(1, x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.boolean', (t) => {
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: true, c: true, d: {a: true, b: true, e: {a: true, b: true}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual(true, x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual(true, x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual(true, x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.function', (t) => {
		const y = function () {};
		const fn = function () {};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: y, c: y, d: {a: y, b: y, e: {a: y, b: y}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isEqual(y, x.c);
			assert.isEqual(fn, x.d.a);
			assert.isEqual(y, x.d.b);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isEqual(y, x.d.e.b);
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.date', (t) => {
		const fn = function () {};
		const d = new Date();

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(fn, x.d.a);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.object', (t) => {
		const fn = function () {};
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(fn, x.d.a);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(fn, x.d.e.c);
		});
	});
	t.describe('merging x.function into y.array', (t) => {
		const fn = function () {};
		const a = [1];

		t.it('keeps function', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: fn, b: fn},
				{d: {a: fn, c: fn, e: {a: fn, c: fn}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(fn, x.a);
			assert.isEqual(fn, x.b);
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(fn, x.d.a);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(fn, x.d.c);
			assert.isEqual(fn, x.d.e.a);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(fn, x.d.e.c);
		});
	});

	//
	// Date into all types
	//
	t.describe('merging x.date into y.string', (t) => {
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: 'x', c: 'x', d: {a: 'x', b: 'x', e: {a: 'x', b: 'x'}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual('x', x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual('x', x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual('x', x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.null', (t) => {
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(null, x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(null, x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.NaN', (t) => {
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(NaN, x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.number', (t) => {
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(1, x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(1, x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(1, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.boolean', (t) => {
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: true, c: true, d: {a: true, b: true, e: {a: true, b: true}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(true, x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(true, x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(true, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.function', (t) => {
		const y = function () {};
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: y, c: y, d: {a: y, b: y, e: {a: y, b: y}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(y, x.c);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(y, x.d.b);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(y, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.date', (t) => {
		const y = new Date([2000]);
		const d = new Date();

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: y, c: y, d: {a: y, b: y, e: {a: y, b: y}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isEqual(y.toString(), x.c.toString());
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isEqual(y.toString(), x.d.b.toString());
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isEqual(y.toString(), x.d.e.b.toString());
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.object', (t) => {
		const d = new Date();
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});
	t.describe('merging x.date into y.array', (t) => {
		const d = new Date();
		const a = [1];

		t.it('keeps date', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: d, b: d},
				{d: {a: d, c: d, e: {a: d, c: d}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(d.toString(), x.a.toString());
			assert.isEqual(d.toString(), x.b.toString());
			assert.isNotEqual(a, x.c);
			assert.isEqual(1, x.c[0]);
			assert.isEqual(d.toString(), x.d.a.toString());
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(1, x.d.b[0]);
			assert.isEqual(d.toString(), x.d.c.toString());
			assert.isEqual(d.toString(), x.d.e.a.toString());
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(1, x.d.e.b[0]);
			assert.isEqual(d.toString(), x.d.e.c.toString());
		});
	});

	//
	// Array into all types
	//
	t.describe('merging x.array into y.string', (t) => {
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: 'x', c: 'x', d: {a: 'x', b: 'x', e: {a: 'x', b: 'x'}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual('x', x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual('x', x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual('x', x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.null', (t) => {
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual(null, x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual(null, x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.NaN', (t) => {
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual(NaN, x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.number', (t) => {
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual(1, x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual(1, x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual(1, x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.boolean', (t) => {
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: true, c: true, d: {a: true, b: true, e: {a: true, b: true}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual(true, x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual(true, x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual(true, x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.function', (t) => {
		const y = function () {};
		const arr = [1];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: y, c: y, d: {a: y, b: y, e: {a: y, b: y}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isEqual(y, x.c);
			assert.isEqual(1, x.d.a[0]);
			assert.isEqual(y, x.d.b);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isEqual(y, x.d.e.b);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.date', (t) => {
		const arr = [1];
		const d = new Date();

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(1, x.d.a[0]);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.object', (t) => {
		const arr = [1];
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(1, x.d.a[0]);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(1, x.d.e.c[0]);
		});
	});
	t.describe('merging x.array into y.array', (t) => {
		const arr = [1];
		const a = [2];

		t.it('keeps array', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: arr, b: arr},
				{d: {a: arr, c: arr, e: {a: arr, c: arr}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a[0]);
			assert.isEqual(1, x.b[0]);
			assert.isNotEqual(a, x.c);
			assert.isEqual(2, x.c[0]);
			assert.isEqual(1, x.d.a[0]);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(2, x.d.b[0]);
			assert.isEqual(1, x.d.c[0]);
			assert.isEqual(1, x.d.e.a[0]);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(2, x.d.e.b[0]);
			assert.isEqual(1, x.d.e.c[0]);
		});
	});

	//
	// Object into all types
	//
	t.describe('merging x.object into y.string', (t) => {
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: 'x', c: 'x', d: {a: 'x', b: 'x', e: {a: 'x', b: 'x'}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual('x', x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual('x', x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual('x', x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.null', (t) => {
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: null, c: null, d: {a: null, b: null, e: {a: null, b: null}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual(null, x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual(null, x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual(null, x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.NaN', (t) => {
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: NaN, c: NaN, d: {a: NaN, b: NaN, e: {a: NaN, b: NaN}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual(NaN, x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual(NaN, x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual(NaN, x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.number', (t) => {
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: 1, c: 1, d: {a: 1, b: 1, e: {a: 1, b: 1}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual(1, x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual(1, x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual(1, x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.boolean', (t) => {
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: true, c: true, d: {a: true, b: true, e: {a: true, b: true}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual(true, x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual(true, x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual(true, x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.function', (t) => {
		const y = function () {};
		const obj = {A: 1};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: y, c: y, d: {a: y, b: y, e: {a: y, b: y}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isEqual(y, x.c);
			assert.isEqual(1, x.d.a.A);
			assert.isEqual(y, x.d.b);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isEqual(y, x.d.e.b);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.date', (t) => {
		const obj = {A: 1};
		const d = new Date();

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: d, c: d, d: {a: d, b: d, e: {a: d, b: d}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isNotEqual(d, x.c);
			assert.isEqual(d.toString(), x.c.toString());
			assert.isEqual(1, x.d.a.A);
			assert.isNotEqual(d, x.d.b);
			assert.isEqual(d.toString(), x.d.b.toString());
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isNotEqual(d, x.d.e.b);
			assert.isEqual(d.toString(), x.d.e.b.toString());
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.object', (t) => {
		const obj = {A: 1};
		const p = {
			toString() { return 'p'; }
		};

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: p, c: p, d: {a: p, b: p, e: {a: p, b: p}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isNotEqual(p, x.c);
			assert.isEqual(p.toString(), x.c.toString());
			assert.isEqual(1, x.d.a.A);
			assert.isNotEqual(p, x.d.b);
			assert.isEqual(p.toString(), x.d.b.toString());
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isNotEqual(p, x.d.e.b);
			assert.isEqual(p.toString(), x.d.e.b.toString());
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('merging x.object into y.array', (t) => {
		const obj = {A: 1};
		const a = [2];

		t.it('keeps object', () => {
			const x = mergeDeep(
				{a: a, c: a, d: {a: a, b: a, e: {a: a, b: a}}},
				{a: obj, b: obj},
				{d: {a: obj, c: obj, e: {a: obj, c: obj}}}
			);

			assert.isEqual(4, Object.keys(x).length);
			assert.isEqual(4, Object.keys(x.d).length);
			assert.isEqual(3, Object.keys(x.d.e).length);

			assert.isEqual(1, x.a.A);
			assert.isEqual(1, x.b.A);
			assert.isNotEqual(a, x.c);
			assert.isEqual(2, x.c[0]);
			assert.isEqual(1, x.d.a.A);
			assert.isNotEqual(a, x.d.b);
			assert.isEqual(2, x.d.b[0]);
			assert.isEqual(1, x.d.c.A);
			assert.isEqual(1, x.d.e.a.A);
			assert.isNotEqual(a, x.d.e.b);
			assert.isEqual(2, x.d.e.b[0]);
			assert.isEqual(1, x.d.e.c.A);
		});
	});
	t.describe('when all arguments are Arrays, larger to smaller', (t) => {
		const A = [1, 2, 3, 4];
		const B = [4, 5, 6];
		const C = [6, 7];

		t.it('returns a copy of the last Array', () => {
			const x = mergeDeep(A, B, C);

			assert.isNotEqual(A, x);
			assert.isNotEqual(B, x);
			assert.isNotEqual(C, x);

			assert.isEqual(2, x.length);
			assert.isEqual(6, x[0]);
			assert.isEqual(7, x[1]);
		});

		t.it('does *not* mutate any of the arguments', () => {
			mergeDeep(A, B, C);

			assert.isEqual(4, A.length);
			assert.isEqual(3, B.length);
			assert.isEqual(2, C.length);

			assert.isEqual(1, A[0]);
			assert.isEqual(2, A[1]);
			assert.isEqual(3, A[2]);
			assert.isEqual(4, A[3]);

			assert.isEqual(4, B[0]);
			assert.isEqual(5, B[1]);
			assert.isEqual(6, B[2]);

			assert.isEqual(6, C[0]);
			assert.isEqual(7, C[1]);
		});
	});


	// TODO:
	// - all arguments are arrays, larger to smaller and smaller to larger
	// - Object.keys() vs Object.getOwnPropertyNames()

	t.xdescribe('deeply nested objects fewer keys into more keys', (t) => {
	});

	t.xdescribe('deeply nested objects more keys into fewer keys', (t) => {
	});
};
