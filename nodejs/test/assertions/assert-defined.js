import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertDefined } from '../../assertions/mod.js';


export default function testAssertDefined() {

    it('passes with success case', () => {
        assertDefined(1);
    });

    it('throws with failure case', () => {
        try {
            assertDefined(undefined, 'Passing in undefined');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in undefined (Expected undefined to be defined)');
            assert.equal(error.operator, 'assertDefined');
        }

        function test1(someParam) {
            try {
                // Without the failure message.
                assertDefined(someParam);
                throw new Error('This should have thrown');
            } catch (error) {
                assert.equal(error.name, 'AssertionError');
                assert.equal(error.message, 'Expected undefined to be defined');
                assert.equal(error.operator, 'assertDefined');
            }
        }

        test1();
    });
}
