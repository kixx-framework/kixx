import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBoolean } from '../../assertions/mod.js';


export default function testAssertBoolean() {

    it('passes with success case', () => {
        assertBoolean(false);
    });

    it('throws with failure case', () => {
        try {
            // eslint-disable-next-line no-undefined
            assertBoolean(undefined, 'Passing in undefined');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in undefined (Expected undefined to be a Boolean)');
            assert.equal(error.operator, 'assertBoolean');
        }
        try {
            // Without the optional failure message prefix.
            assertBoolean(1);
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected Number(1) to be a Boolean');
            assert.equal(error.operator, 'assertBoolean');
        }
    });
}
