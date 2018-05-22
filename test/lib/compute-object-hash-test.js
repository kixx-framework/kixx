'use strict';

const {assert, remove, values} = require('../../library');

const {computeObjectHash} = require('../../');

module.exports = function (t) {
	const undef = ((u) => u)();

	const mixedArray = [
		1,
		{v: 2, k: 1},
		[1, {}, true, 'foo']
	];

	const mixedObject = {
		z: 0,
		A: [10,9,8],
		a: false,
		c: {k: 1, i: 2}
	};

	const orderedObjectA = {
		z: [{k: 1, v: 1}, {k: 2, v: 2}],
		a: {a: 1, b: 2, c: 3},
		Z: 2,
		A: 3,
		'1': 4,
		'0': 5,
		'-1': 6
	};

	const orderedObjectB = {
		'-1': 6,
		a: {c: 3, b: 2, a: 1},
		A: 3,
		Z: 2,
		'0': 5,
		'1': 4,
		z: [{v: 1, k: 1}, {v: 2, k: 2}]
	};

	const arrayA = [
		[{k: 1, v: 1}, {k: 2, v: 2}],
		{a: 1, b: 2, c: 3}
	];

	const arrayB = [
		[{v: 1, k: 1}, {v: 2, k: 2}],
		{c: 3, b: 2, a: 1}
	];

	const arrayOrderA = [{a: 1, b: 2}, {c: 3, d: 4}];
	const arrayOrderB = [{d: 4, c: 3}, {b: 2, a: 1}];

	const HASHES = Object.freeze({
		UNDEFINED: '1dTNB2FqVCiRt+wtAlezoktphW4=',
		NULL: 'K+iMpCQsduglOsYkdIUQZQMtaDM=',
		NAN: '9/2caPgErNpmXSqwgiF7sVgzGPI=',
		FALSE: 'fLbvuYullyqbUJDcLlF/4U0SywQ=',
		TRUE: 'X/5TO4MPCKAyY0ipFgr6/IraRNs=',
		ZERO: 'tlifxqsNyCzxIJnRwtQKuZToQQw=',
		ONE: 'NWoZK3kTsExUV00Ywo1G5jlUKKs=',
		NEGONE: 'eYSwoOE5yrrbWvx3VtRz+zTSOBk=',
		FLOAT: 'qo8onr5tTbG0oQOLiTHsjCtTmfs=',
		STRING: 'C+7Hteo/D9vJXQ3UfzxbwnXaijM=',
		SYMBOL: '8iE16SSYcKcGX7lTfhYX8nddXlw=',
		NEGFLOAT: 'pUqg9xSFJDEUUrNV19xvM5ND+UI=',
		NAMED_FUNC: '0XZAsJoiLLVSsgNh6xhUDX0wKfA=',
		FUNC: 'tXGaSIgMZiYcJUXGW0LcD2KAbWw=',
		DATE: '0ScLc9gnbMf6QdMxhS2/yIlO14c=',
		EMPTY_OBJECT: 'vyGp6PvFo4RvsFtPoIWeCReyIC8=',
		OBJECT: 'uAdVu1BicUUPbg9E4M1r3T5ZLwk=',
		FULL_OBJECT: 'GDOdFhaFWnmfNWMqvD0QqVJfcto=',
		EMPTY_ARRAY: 'l9Fw4VUO7kr8CvBlt4zaMCqXZ0w=',
		MIXED_ARRAY: 'OO/nlpAq/BmjRiWIWfO0uNB+Ams=',
		MIXED_OBJECT: 'ukWEBullTFTjgLgendgcc0LtMOs='
	});

	const {
		UNDEFINED,
		NULL,
		NAN,
		FALSE,
		TRUE,
		ZERO,
		ONE,
		NEGONE,
		FLOAT,
		STRING,
		SYMBOL,
		NEGFLOAT,
		NAMED_FUNC,
		FUNC,
		DATE,
		EMPTY_OBJECT,
		OBJECT,
		FULL_OBJECT,
		EMPTY_ARRAY,
		MIXED_ARRAY,
		MIXED_OBJECT
	} = HASHES;

	t.describe('HASHES', (t) => {
		const keys = Object.keys(HASHES);
		const hashes = values(HASHES);

		t.it('has no equal hashes; all hashes are unique', () => {
			hashes.forEach((hash, i) => {
				const key = keys[i];
				const checkKeys = remove(i, 1, hashes);
				assert.isEqual(-1, checkKeys.indexOf(hash), `hash for ${key}`);
			});
		});
	});

	t.it('hashes undefined', () => {
		assert.isEqual(UNDEFINED, computeObjectHash(undef));
	});
	t.it('hashes null', () => {
		assert.isEqual(NULL, computeObjectHash(null));
	});
	t.it('hashes NaN', () => {
		assert.isEqual(NAN, computeObjectHash(NaN));
	});
	t.it('hashes true', () => {
		assert.isEqual(TRUE, computeObjectHash(true));
	});
	t.it('hashes false', () => {
		assert.isEqual(FALSE, computeObjectHash(false));
	});
	t.it('hashes zero', () => {
		assert.isEqual(ZERO, computeObjectHash(0));
	});
	t.it('hashes an integer', () => {
		assert.isEqual(ONE, computeObjectHash(1));
	});
	t.it('hashes a neg integer', () => {
		assert.isEqual(NEGONE, computeObjectHash(-1));
	});
	t.it('hashes a float', () => {
		assert.isEqual(FLOAT, computeObjectHash(1.50));
	});
	t.it('hashes a neg float', () => {
		assert.isEqual(NEGFLOAT, computeObjectHash(-1.50));
	});
	t.it('hashes a string', () => {
		assert.isEqual(STRING, computeObjectHash('foo'));
	});
	t.it('hashes a symbol', () => {
		assert.isEqual(SYMBOL, computeObjectHash(Symbol('bar')));
	});
	t.it('hashes an anonymous function', () => {
		assert.isEqual(FUNC, computeObjectHash(() => 1));
	});
	t.it('hashes a named function', () => {
		assert.isEqual(NAMED_FUNC, computeObjectHash(function foo() {}));
	});
	t.it('hashes a date', () => {
		assert.isEqual(DATE, computeObjectHash(new Date('2018-01-01T17:00:00.000Z')));
	});
	t.it('hashes an Object', () => {
		assert.isEqual(OBJECT, computeObjectHash({foo: 'bar'}));
	});
	t.it('hashes an empty Object', () => {
		assert.isEqual(EMPTY_OBJECT, computeObjectHash({}));
	});
	t.it('hashes an Object with many props', () => {
		assert.isEqual(FULL_OBJECT, computeObjectHash({foo: 1, bar: 2}));
	});
	t.it('hashes an empty Array', () => {
		assert.isEqual(EMPTY_ARRAY, computeObjectHash([]));
	});
	t.it('hashes a mixed Array', () => {
		assert.isEqual(MIXED_ARRAY, computeObjectHash(mixedArray));
	});
	t.it('hashes a mixed Object', () => {
		assert.isEqual(MIXED_OBJECT, computeObjectHash(mixedObject));
	});
	t.it('treats objects with different ordered keys as the same object', () => {
		assert.isEqual(
			computeObjectHash(orderedObjectA),
			computeObjectHash(orderedObjectB)
		);
	});
	t.it('treats Arrays with different ordered keys as the same object in nested Array', () => {
		assert.isEqual(
			computeObjectHash(arrayA),
			computeObjectHash(arrayB)
		);
	});
	t.it('treats Arrays with same objects in a different order as different', () => {
		assert.isNotEqual(
			computeObjectHash(arrayOrderA),
			computeObjectHash(arrayOrderB)
		);
	});
};
