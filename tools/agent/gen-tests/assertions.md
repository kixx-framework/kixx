# Kixx Assert
A JavaScript library for creating robust ES6 code.

## Usage
```js
// In Node.js:
import { isNonEmptyString, assertEqual } from 'kixx-assert';

isNonEmptyString('hello world'); // true
isNonEmptyString(''); // false
isNonEmptyString({}); // false

assertEqual('hello world', 'hello world');
assertEqual({}, {}); // Throws an AssertionError
```

Also supports currying :tada:

```js
const assertFoo = assertEqual('Foo');

assertFoo('Foo', 'Expecting Foo'); // Passes
assertFoo('hello world', 'Expecting Foo'); // Throws an AssertionError
```

## AssertionError
All the assertion functions in this library throw an AssertionError when they fail. You could also use the constructor to create special AssertionErrors elsewhere in your code if you'd like.

```js
// In Node.js:
import { AssertionError } from 'kixx-assert';

// Use for situations like this:

try {
    assert(false);
} catch (error) {
    if (error instanceof AssertionError === false) {
        console.log('Threw an unexpected error:', error.constructor.name);
    }
}
```

## Assertions
Assertion functions generally come in two flavors: Single subject or control and subject checks. A message string can be passed into either type of assertion as the last argument.

An example of a single subject check with a message string:

```js
assertNonEmptyString(null, 'This value should be a string');
// Throws an AssertionError("This value should be a string (Expected null to be a non-empty String)")
```

An example of a control and subject check with a message string:
```js
const control = 'foo';
const subject = 'bar';

assertEqual(control, subject, 'Subject is equal to control');
// Throws an AssertionError("Subject is equal to control (Expected String(bar) to equal (===) String(foo))")
```

The control/subject checks can be curried:
```js
const assertFoo = assertEqual('foo');

assertFoo(subject, 'Subject is foo');
// Throws an AssertionError("Subject is foo (Expected String(bar) to equal (===) String(foo))")
```

### assert
Throw an AssertionError if the passed value is not truthy.

```js
/**
 * Asserts that the given value is truthy.
 * If the value is falsy, assert() will throw an AssertionError.
 *
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is falsy.
 * @returns {true} When the assertion passes.
 */
function assert(actual, messagePrefix) {}
````

```js
assert(0) // Throws AssertionError
assert('foo') // Passes
```

### assertFalsy
Throw an AssertionError if the passed value is not falsy.

```js
/**
 * Asserts that the given value is falsy.
 * If the value is truthy, assertFalsy() will throw an AssertionError.
 *
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is truthy.
 * @returns {true} When the assertion passes.
 */
function assertFalsy(actual, messagePrefix) {}
```

```js
assertFalsy('foo') // Throws AssertionError
assertFalsy(null) // Passes
```

### assertEqual
Throw an AssertionError if the passed values are *not strictly* equal. Dates and NaN are special cases handled separately.

```js
/**
 * If the actual value does not equal the expected value, an AssertionError will be thrown.
 * Uses strict comparison: `a === b`.
 * Ensures date and NaN comparison is done as expected.
 *
 * @param {*} expected - The value to test against.
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the values are not equal.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
function assertEqual(expected, actual, messagePrefix) {}
```

```js
assertEqual(1, 2) // Throws AssertionError
assertEqual(1, '1') // Throws AssertionError
assertEqual(1, 1) // passes

// If you do NaN === NaN you'll get false (dumb).
// assertEqual() corrects that behavior.
assertEqual(NaN, NaN) // passes

// Compare dates :D
assertEqual(new Date('1999'), new Date('1999')) // passes
```

You can curry it! :tada:

```js
const assertIs1 = assertEqual(1);

assertIs1(1) // passes
```

### assertNotEqual
The inverse of [assertEqual()](#assertequal)

```js
/**
 * Asserts non-equality.
 * If the actual value equals the expected value, an AssertionError will be thrown.
 * Uses strict comparison: `a !== b`.
 * Ensures date and NaN comparison is done as expected.
 *
 * @param {*} expected - The value to test against.
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the values are equal.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
function assertNotEqual(expected, actual, messagePrefix) {}
```

### assertMatches
```js
/**
 * Asserts that the actual value matches the matcher value by using several different
 * stragegies depending on the arguments:
 *
 * - If the matcher is a regular expression, it will call RegExp.test().
 * - If the matcher equals the value using isEqual(), it returns true.
 * - If the value is a String, it checks if the String contains the matcher using String.includes().
 * - If the value is a valid Date, it converts it to a string using Date.toISOString() before comparison.
 * - If the actual does not match the matcher, an AssertionError will be thrown.
 *
 * @param {string|RegExp} matcher - The matcher to test against.
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value does not match.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
function assertMatches(matcher, actual, messagePrefix) {}
```

Can be curried.

```js
assertMatches(/^foo/i, 'BAR') // Throws AssertionError
assertMatches(/^foo/i, 'FOOBAR') // passes
assertMatches('oba', 'foobar') // passes
assertMatches('fox', 'The quick brown fox jumped over the...') // passes
```

You can curry it! :tada:

```js
const assertShortDateString = assertMatches(/^[\d]{4}-[\d]{2}-[\d]{2}$/);

assertShortDateString('14 September 2020') // Throws AssertionError
assertShortDateString('2020-09-14') // passes
```

### assertNotMatches
The inverse of [assertMatches()](#assertmatches)

### assertDefined
```js
/**
 * Asserts that the given value is not undefined as determined.
 * If the value is undefined, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is undefined.
 * @returns {true} When the assertion passes.
 */
function assertDefined(value, messagePrefix) {}
```

```js
assertDefined(undefined) // Throws AssertionError
assertDefined(new Date().foo) // Throws AssertionError
assertDefined(new Map().size) // passes (even though .size is zero)
assertDefined(null) // passes
```

### assertUndefined
Inverse of [assertDefined()](#assertdefined). Uses [isUndefined()](#isundefined) internally.

```js
/**
 * Asserts that the given value is undefined.
 * If the value is NOT undefined, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not undefined.
 * @returns {true} When the assertion passes.
 */
function assertUndefined(value, messagePrefix) {}
```

```js
assertUndefined(null) // Throws AssertionError
assertUndefined(({}).toString) // Throws AssertionError
assertUndefined(undefined) // passes
```

### assertNonEmptyString
```js
/**
 * Asserts that the given value is a non-empty String.
 * If the value is not a String or is an empty String, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a non-empty String.
 * @returns {true} When the assertion passes.
 */
function assertNonEmptyString(value, messagePrefix) { }
```

### assertNumberNotNaN
```js
/**
 * Asserts that the given value is a Number but not NaN.
 * If the value is not a Number or is NaN, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Number or is NaN.
 * @returns {true} When the assertion passes.
 */
function assertNumberNotNaN(value, messagePrefix) { }
```

### assertArray
Uses the native Array.isArray().

```js
/**
 * Asserts that the given value is an Array as determined by Array.isArray().
 * If the value is not an Array, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not an Array.
 * @returns {true} When the assertion passes.
 */
function assertArray(value, messagePrefix) { }
```

```js
assertArray({}) // Throws AssertionError
assertArray([]) // passes
assertArray([1, 2, 3]) // passes
```

### assertBoolean
```js
/**
 * Asserts that the given value is a Boolean.
 * If the value is not a Boolean, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Boolean.
 * @returns {true} When the assertion passes.
 */
function assertBoolean(value, messagePrefix) { }
```

### assertFunction
```js
/**
 * Asserts that the given value is a Function.
 * If the value is not a Function, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Function.
 * @returns {true} When the assertion passes.
 */
function assertFunction(value, messagePrefix) { }
```

### assertValidDate
```js
/**
 * Asserts that the given value is a valid Date.
 * If the value is not a valid Date, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a valid Date.
 * @returns {true} When the assertion passes.
 */
function assertValidDate(value, messagePrefix) { }
```

### assertGreaterThan
If the subject is less than or equal to the control the test will fail.

```js
/**
 * Asserts that the subject value is greater than the control value.
 * If the subject is less than or equal to the control value, an AssertionError will be thrown.
 *
 * @param {number} control - The value to test against.
 * @param {number} subject - The value to test.
 * @param {string} [messageSuffix] - An optional error message suffix string.
 * @throws {AssertionError} When the subject is not greater than the control.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
function assertGreaterThan(control, subject, messagePrefix) { }
```

Can be curried.

```js
const control = new Date();

// This comparison of 1970 to today will throw an AssertionError
assertGreaterThan(control, new Date(0));
```

You can curry it! :tada:

```js
const assertGreaterThan100 = assertGreaterThan(100);

assertGreaterThan100(99); // Will throw an AssertionError
```

### assertLessThan
If the subject is greater than or equal to the control the test will fail.

```js
/**
 * Asserts that the subject value is less than the control value.
 * If the subject is greater than or equal to the control value, an AssertionError will be thrown.
 *
 * @param {number} control - The value to test against.
 * @param {number} subject - The value to test.
 * @param {string} [messageSuffix] - An optional error message suffix string.
 * @throws {AssertionError} When the subject is not less than the control.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
function assertLessThan(control, subject, messagePrefix) { }
```

Can be curried.

```js
const control = 'A';

assertLessThan(control, 'B'); // Will throw an AssertionError
```

You can curry it! :tada:

```js
const assertBeforeToday = assertLessThan(new Date());

assertBeforeToday(new Date()); // Will throw an AssertionError
```
