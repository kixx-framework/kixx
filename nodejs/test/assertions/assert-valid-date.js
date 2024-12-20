import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidDate } from '../../assertions/mod.js';


export default function testAssertValidDate() {

    it('passes with success case', () => {
        assertValidDate(new Date());
    });

    it('throws with failure case', () => {
        try {
            assertValidDate({}, 'Passing in an object');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in an object (Expected Object({}) to be a valid Date)');
            assert.equal(error.operator, 'assertValidDate');
        }
        try {
            // Without the optional failure message prefix.
            assertValidDate(new Date('foobar'));
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected Date(Invalid) to be a valid Date');
            assert.equal(error.operator, 'assertValidDate');
        }
    });
}
