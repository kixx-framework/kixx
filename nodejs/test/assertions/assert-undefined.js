import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertUndefined } from '../../assertions/mod.js';


export default function testAssertUndefined() {

    it('passes with success case', () => {
        assertUndefined();
    });

    it('throws with failure case', () => {
        try {
            assertUndefined(1, 'Passing in 1');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in 1 (Expected Number(1) to be undefined)');
            assert.equal(error.operator, 'assertUndefined');
        }

        // Without the failure message.
        try {
            assertUndefined(1);
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected Number(1) to be undefined');
            assert.equal(error.operator, 'assertUndefined');
        }
    });
}
