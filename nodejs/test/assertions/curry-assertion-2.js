import { it } from 'node:test';
import assert from 'node:assert/strict';
import { curryAssertion2 } from '../../assertions/mod.js';


export default function testCurryAssertion2() {
    it('calls the guard', () => {
        let callCount = 0;
        let argumentsLength = 0;
        let expected;
        let actual;
        let messagePrefix;

        function guard(a, b, c) {
            argumentsLength = arguments.length;
            callCount += 1;
            expected = a;
            actual = b;
            messagePrefix = c;
            return null;
        }

        const testFunc = curryAssertion2('foo', guard);

        testFunc(1, 2, 'bar');

        assert.equal(callCount, 1);
        assert.equal(argumentsLength, 3);
        assert.equal(expected, 1);
        assert.equal(actual, 2);
        assert.equal(messagePrefix, 'bar');
    });

    it('throws an AssertionError', () => {
        function guard() {
            return 'Should FAIL!';
        }

        const testFunc = curryAssertion2('foo', guard);

        try {
            testFunc(1, 2);
        } catch (error) {
            assert.equal(error.message, 'Should FAIL!');
            assert.equal(error.actual, 2);
            assert.equal(error.expected, 1);
            assert.equal(error.operator, 'foo');
        }
    });

    it('calls the guard when curried', () => {
        let callCount = 0;
        let argumentsLength = 0;
        let expected;
        let actual;
        let messagePrefix;

        function guard(a, b, c) {
            argumentsLength = arguments.length;
            callCount += 1;
            expected = a;
            actual = b;
            messagePrefix = c;
            return null;
        }

        const testFunc = curryAssertion2('foo', guard);

        const curriedTestFunc = testFunc(1);

        curriedTestFunc(2, 'bar');

        assert.equal(callCount, 1);
        assert.equal(argumentsLength, 3);
        assert.equal(expected, 1);
        assert.equal(actual, 2);
        assert.equal(messagePrefix, 'bar');
    });

    it('throws an AssertionError when curried', () => {
        function guard() {
            return 'Should FAIL!';
        }

        const testFunc = curryAssertion2('foo', guard);

        const curriedTestFunc = testFunc(1);

        try {
            curriedTestFunc(2);
        } catch (error) {
            assert.equal(error.message, 'Should FAIL!');
            assert.equal(error.actual, 2);
            assert.equal(error.expected, 1);
            assert.equal(error.operator, 'foo');
        }
    });
}
