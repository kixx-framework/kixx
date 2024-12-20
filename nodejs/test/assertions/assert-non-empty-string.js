import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNonEmptyString } from '../../assertions/mod.js';


export default function testAssertNonEmptyString() {

    it('passes with success case', () => {
        assertNonEmptyString('x');
    });

    it('throws with failure case', () => {
        try {
            // eslint-disable-next-line no-undefined
            assertNonEmptyString(undefined, 'Passing in undefined');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in undefined (Expected undefined to be a non-empty String)');
            assert.equal(error.operator, 'assertNonEmptyString');
        }
        try {
            // Without the optional failure message prefix.
            assertNonEmptyString(1);
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected Number(1) to be a non-empty String');
            assert.equal(error.operator, 'assertNonEmptyString');
        }
    });
}
