import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertFunction } from '../../assertions/mod.js';


function noop() {}

export default function testAssertBoolean() {

    it('passes with success case', () => {
        assertFunction(noop);
    });

    it('throws with failure case', () => {
        try {
            assertFunction({}, 'Passing in an object');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in an object (Expected Object({}) to be a Function)');
            assert.equal(error.operator, 'assertFunction');
        }
        try {
            // Without the optional failure message prefix.
            assertFunction(1);
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected Number(1) to be a Function');
            assert.equal(error.operator, 'assertFunction');
        }
    });
}
