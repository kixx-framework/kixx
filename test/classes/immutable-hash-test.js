'use strict';

const {assert} = require('../../library');

const {ImmutableHash} = require('../../index');

module.exports = function (t) {
	const subject1 = ImmutableHash.create({foo: 'bar'});

	t.it('is frozen', () => {
		assert.isOk(Object.isFrozen(subject1), 'Object.isFrozen');
	});

	t.it('cannot be mutated', () => {
		try {
			subject1.foo = 'baz';
			assert.isOk(false, 'should throw');
		} catch (err) {
			assert.isMatch(/^Cannot assign to read only property/, err.message);
		}

		try {
			subject1.bar = true;
			assert.isOk(false, 'should throw');
		} catch (err) {
			assert.isMatch(/^Cannot add property/, err.message);
		}
	});

	t.describe('ImmutableHash#set()', (t) => {
		const subject2 = subject1.set({
			bar: true,
			baz: false
		});

		t.it('creates a new instance', (t) => {
			assert.isNotEqual(subject1, subject2);
		});

		t.it('retains existing props', (t) => {
			assert.isEqual('bar', subject1.foo);
			assert.isEqual(subject1.foo, subject2.foo);
		});

		t.it('sets property values', () => {
			assert.isEqual(true, subject2.bar);
			assert.isEqual(false, subject2.baz);
		});

		t.it('refuses to update existing props', () => {
			try {
				subject1.set({foo: 'bar'});
				assert.isOk(false, 'should throw');
			} catch (err) {
				assert.isMatch(/The 'foo' property is already set/, err.message);
			}
		});
	});
};
