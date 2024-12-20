import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertRegExp } from '../../assertions/mod.js';


export default function testAssertRegExp() {

    it('passes with success case', () => {
        assertRegExp(/foo/);
    });

    it('throws with failure case', () => {
        try {
            assertRegExp({}, 'Passing in an object');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Passing in an object (Expected Object({}) to be a RegExp)');
            assert.equal(error.operator, 'assertRegExp');
        }
        try {
            // Without the optional failure message prefix.
            assertRegExp('foo');
            throw new Error('This should have thrown');
        } catch (error) {
            assert.equal(error.name, 'AssertionError');
            assert.equal(error.message, 'Expected String(foo) to be a RegExp');
            assert.equal(error.operator, 'assertRegExp');
        }
    });
}
