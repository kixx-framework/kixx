import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNumberNotNaN } from '../../assertions/mod.js';


export default function testAssertNumberNotNaN() {

    it('passes with success case', () => {
        assertNumberNotNaN(1);
    });

    it('throws with failure case', () => {
        try {
            assertNumberNotNaN(NaN, 'Passing in NaN');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in NaN (Expected Number(NaN) to be a Number and not NaN)');
            assert.equal(error.operator, 'assertNumberNotNaN');
        }
    });
}
