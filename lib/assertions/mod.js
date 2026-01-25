/*
A helper library for performing assertions which are not native to
JavaScript out of the box, or are implemented in unexpected ways.

There are generally two groups of functions available in this library:

1. Helper functions which allow you to perform various kinds of type checks
   which you wouldn't otherwise find in JavaScript.
2. Assertion functions which throw an AssertionError when the assertion is
   not true.

The MIT License

Copyright (c) 2017 - 2026 Kris Walker (www.kriswalker.me).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

const protoToString = Object.prototype.toString;

/**
 * Custom error class for assertion failures.
 * Extends the native Error class with additional properties for better error handling.
 */
export class AssertionError extends Error {

    /**
     * Creates a new AssertionError instance.
     * @param {string} message - The error message to display.
     * @param {object} [spec] - Optional specification object with additional error properties.
     * @param {Error} [spec.cause] - The cause of this error.
     * @param {string} [spec.name] - Custom name for the error.
     * @param {string} [spec.code] - Error code identifier.
     * @param {string} [spec.operator] - The assertion operator that failed.
     * @param {Function} [sourceFunction] - Function to exclude from stack trace.
     */
    constructor(message, spec, sourceFunction) {
        spec = spec || {};
        const cause = spec.cause || null;

        super(message, { cause });

        const name = spec.name || this.constructor.name;
        const causeCode = cause && cause.code;
        const code = spec.code || causeCode || this.constructor.CODE;

        // Use Object.defineProperty() so we can have public, enumerable
        // properties, but make them unwritable.
        // Secondly, only define properties if they exist.

        if (typeof name !== 'undefined') {
            Object.defineProperty(this, 'name', {
                enumerable: true,
                value: name,
            });
        }
        if (typeof code !== 'undefined') {
            Object.defineProperty(this, 'code', {
                enumerable: true,
                value: code,
            });
        }
        if (typeof spec.operator !== 'undefined') {
            Object.defineProperty(this, 'operator', {
                enumerable: true,
                value: spec.operator,
            });
        }

        if (typeof sourceFunction === 'function') {
            Error.captureStackTrace(this, sourceFunction);
        }
    }
}

Object.defineProperties(AssertionError, {
    CODE: {
        enumerable: true,
        value: 'ASSERTION_ERROR',
    },
});

/**
 * Determines if the given value is a String.
 * This function correctly identifies both string primitives and String objects.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a String, false otherwise.
 */
export function isString(value) {
    // The typeof expression will not catch strings created
    // with new String('foo'):
    //
    // ```js
    // return typeof new String('foo') === 'string'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    return protoToString.call(value) === '[object String]';
}

/**
 * Determines if the given value is a String with length greater than zero.
 * @see {@link isString}
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a non-empty String, false otherwise.
 */
export function isNonEmptyString(value) {
    return Boolean(value && isString(value));
}

/**
 * Determines if the given value is a Number or BigInt.
 * This function correctly identifies both number primitives and Number objects,
 * as well as BigInt values.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Number or BigInt, false otherwise.
 */
export function isNumber(value) {
    // The typeof expression will not catch numbers created with new Number(1):
    //
    // ```js
    // return typeof new Number(1) === 'number'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    const tag = protoToString.call(value);
    return tag === '[object Number]' || tag === '[object BigInt]';
}

/**
 * Determines if the given value is a Number but is not NaN.
 * @see {@link isNumber}
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Number and not NaN, false otherwise.
 */
export function isNumberNotNaN(value) {
    return isNumber(value) && !Number.isNaN(value);
}

/**
 * Determines if the given value is a Boolean.
 * This function correctly identifies both boolean primitives and Boolean objects.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Boolean, false otherwise.
 */
export function isBoolean(value) {
    // The typeof expression will not catch values created with new Boolean(1):
    //
    // ```js
    // return typeof new Boolean(1) === 'boolean'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    return protoToString.call(value) === '[object Boolean]';
}

/**
 * Determines if the given value is undefined.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is undefined, false otherwise.
 */
export function isUndefined(value) {
    return typeof value === 'undefined';
}

/**
 * Determines if the given value is a primitive value.
 * Primitive values are defined as String, Number, BigInt, Boolean, Symbol, null, and undefined.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a primitive, false otherwise.
 */
export function isPrimitive(value) {
    return value === null
        || isString(value)
        || isNumber(value)
        || (typeof value === 'bigint')
        || isBoolean(value)
        || (typeof value === 'symbol')
        || isUndefined(value);
}

/**
 * Determines if the given value is a Function.
 * This will work as expected for function declarations, function expressions, async functions,
 * class static methods, class methods, and object methods.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Function, false otherwise.
 */
export function isFunction(value) {
    return typeof value === 'function';
}

/**
 * Determines if the given value is an object but not null.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is an object and not null, false otherwise.
 */
export function isObjectNotNull(value) {
    return typeof value === 'object' && value !== null;
}

/**
 * Determines if the given value is a plain object.
 * A plain object is defined as an object that either has no prototype or has a constructor named "Object".
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a plain object, false otherwise.
 */
export function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (!Object.getPrototypeOf(value)) {
        return true;
    }
    return value.constructor && value.constructor.name === 'Object';
}

/**
 * Determines if the given value is a native JavaScript Date instance.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Date, false otherwise.
 */
export function isDate(value) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    return protoToString.call(value) === '[object Date]';
}

/**
 * Determines if the given value is a valid JavaScript Date instance.
 * Validity is determined by checking if the date's timestamp is not NaN.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a valid Date, false otherwise.
 */
export function isValidDate(value) {
    if (isDate(value)) {
        return !Number.isNaN(value.getTime());
    }
    return false;
}

/**
 * Determines if the given value is a native JavaScript RegExp instance.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a RegExp, false otherwise.
 */
export function isRegExp(value) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    return protoToString.call(value) === '[object RegExp]';
}

/**
 * Determines if the given value is a native JavaScript Map or WeakMap.
 * This will work as expected, returning true when passing an instance of a class
 * which extends Map or WeakMap.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Map or WeakMap, false otherwise.
 */
export function isMap(value) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    const tag = protoToString.call(value);
    return tag === '[object Map]' || tag === '[object WeakMap]';
}

/**
 * Determines if the given value is a native JavaScript Set or WeakSet.
 * This will work as expected, returning true when passing an instance of a class
 * which extends Set or WeakSet.
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a Set or WeakSet, false otherwise.
 */
export function isSet(value) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    const tag = protoToString.call(value);
    return tag === '[object Set]' || tag === '[object WeakSet]';
}

/**
 * Compares two values for equality.
 * If `a === b` then returns `true`. Otherwise ensures date and NaN comparison is
 * done as expected.
 *
 * Will return a curried version of this function if only
 * a single argument is supplied.
 * @param {*} a - The first value to compare.
 * @param {*} b - The second value to compare.
 * @returns {boolean|Function} True if the values are equal, or a curried function if only one argument is provided.
 */
export function isEqual(a, b) {
    if (arguments.length < 2) {
        return function curriedIsEqual(_b) {
            return isEqual(a, _b);
        };
    }
    if (a === b) {
        return true;
    }
    if (isValidDate(a) && isValidDate(b)) {
        return a <= b && a >= b;
    }
    // Make sure NaN === NaN.
    return a !== a && b !== b;
}

/**
 * Performs string matching with various strategies.
 * If the matcher is a regular expression, it will call RegExp.test().
 * If the matcher equals the value using isEqual(), it returns true.
 * If the value is a String, it checks if the String contains the matcher using String.includes().
 * If the value is a valid Date, it converts it to a string using Date.toISOString() before comparison.
 *
 * Will return a curried version of this function if only
 * a single argument is supplied.
 *
 * @see {@link isEqual}
 * @see {@link isValidDate}
 * @param {string|RegExp} matcher - The pattern or value to match against.
 * @param {*} value - The value to test.
 * @returns {boolean|Function} True if the value matches, or a curried function if only one argument is provided.
 */
export function doesMatch(matcher, value) {
    if (arguments.length < 2) {
        return function curriedDoesMatch(_value) {
            return doesMatch(matcher, _value);
        };
    }
    if (isEqual(matcher, value)) {
        return true;
    }

    if (isValidDate(value)) {
        value = value.toISOString();
    }

    if (typeof matcher?.test === 'function') {
        return matcher.test(value);
    }
    if (typeof value?.includes === 'function') {
        return value.includes(matcher);
    }

    return false;
}

/**
 * Converts any JavaScript value to a human-friendly string representation.
 * @param {*} value - The value to convert.
 * @returns {string} A human-readable string representation of the value.
 */
export function toFriendlyString(value) {
    if (isString(value)) {
        return `String(${ value })`;
    }
    if (typeof value === 'bigint') {
        return `BigInt(${ value })`;
    }
    // WARNING
    // Checking isNumber() will return true for BigInt instances as well as
    // Numbers, so the isBigInt() check needs to come before isNumber().
    if (isNumber(value)) {
        return `Number(${ value })`;
    }
    if (isBoolean(value)) {
        return `Boolean(${ value })`;
    }
    if (typeof value === 'symbol') {
        return value.toString();
    }
    if (isUndefined(value)) {
        return 'undefined';
    }
    if (isFunction(value)) {
        if (value.toString().startsWith('class ')) {
            return `class ${ value.name } {}`;
        }
        // This will get "Function" or "AsyncFunction":
        const prefix = protoToString.call(value).slice(8, -1);
        if (value.name) {
            return `${ prefix }(${ value.name })`;
        }
        return `${ prefix }(function)`;
    }
    if (value === null) {
        return 'null';
    }
    if (Object.getPrototypeOf(value) === null) {
        return 'Object(null)';
    }
    if (isPlainObject(value)) {
        return 'Object({})';
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return 'Array([])';
        }
        return `Array([0..${ (value.length - 1) }])`;
    }
    if (isValidDate(value)) {
        return `Date(${ value.toISOString() })`;
    }
    if (isDate(value)) {
        return 'Date(Invalid)';
    }
    if (isRegExp(value)) {
        return `RegExp(${ value })`;
    }
    if (isMap(value) || isSet(value)) {
        return `${ value.constructor.name }()`;
    }

    const name = value.constructor?.name || 'Object';

    return `${ name }(${ value })`;
}

/**
 * Creates a function which can create assertion functions that can be curried.
 * If the returned function is called with only a single argument, it will
 * return a curried version of the assertion function.
 *
 * @param {string} operator - The name of the assertion operator which will be
 * passed to new AssertionError({ operator }).
 * @param {Function} guard - The guard function should return a message string
 * in the case of failure and null in the case of success.
 * @returns {Function} A curried assertion function.
 *
 * @example
 * const assertEqual = curryAssertion2('assertEqual', (expected, actual, messagePrefix) => {
 *     if (actual !== expected) {
 *         return `${messagePrefix}. Values are not equal.`;
 *     }
 *     return null;
 * });
 *
 * const assertIsZero = assertEqual(0);
 *
 * // This will fail.
 * assertIsZero(1, 'What happens when we pass in 1?');
 */
export function curryAssertion2(operator, guard) {
    return function curriedAssertion2(expected, actual, messagePrefix) {
        if (arguments.length < 2) {
            return function curriedInnerAssert(_actual, _messagePrefix) {
                // eslint-disable-next-line no-shadow
                const message = guard(expected, _actual, _messagePrefix);
                if (message) {
                    throw new AssertionError(message, { operator }, curriedInnerAssert);
                }

                return true;
            };
        }

        const message = guard(expected, actual, messagePrefix);
        if (message) {
            throw new AssertionError(message, { operator }, curriedAssertion2);
        }

        return true;
    };
}

/**
 * Asserts that the given value is truthy.
 * If the value is falsy, assert() will throw an AssertionError.
 *
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is falsy.
 * @returns {true} When the assertion passes.
 */
export function assert(actual, messagePrefix) {
    const assertionMessage = `Expected ${ toFriendlyString(actual) } to be truthy`;

    const message = isNonEmptyString(messagePrefix)
        ? `${ messagePrefix } (${ assertionMessage })`
        : assertionMessage;

    if (!actual) {
        throw new AssertionError(message, { operator: 'assert' }, assert);
    }
}

/**
 * Asserts that the given value is falsy.
 * If the value is truthy, assertFalsy() will throw an AssertionError.
 *
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is truthy.
 * @returns {true} When the assertion passes.
 */
export function assertFalsy(actual, messagePrefix) {
    const assertionMessage = `Expected ${ toFriendlyString(actual) } to be falsy`;

    const message = isNonEmptyString(messagePrefix)
        ? `${ messagePrefix } (${ assertionMessage })`
        : assertionMessage;

    if (actual) {
        throw new AssertionError(message, { operator: 'assertFalsy' }, assertFalsy);
    }
}

/**
 * Asserts equality using isEqual().
 * If the actual value does not equal the expected value, an AssertionError will be thrown.
 *
 * @see {@link isEqual}
 * @param {*} expected - The value to test against.
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the values are not equal.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
export const assertEqual = curryAssertion2('assertEqual', (expected, actual, messagePrefix) => {
    if (!isEqual(expected, actual)) {
        const assertionMessage = `Expected ${ toFriendlyString(actual) } to equal (===) ${ toFriendlyString(expected) }`;
        return isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;
    }
    return null;
});

/**
 * Asserts non-equality using isEqual().
 * If the actual value equals the expected value, an AssertionError will be thrown.
 *
 * @see {@link isEqual}
 * @param {*} expected - The value to test against.
 * @param {*} actual - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the values are equal.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
export const assertNotEqual = curryAssertion2('assertNotEqual', (expected, actual, messagePrefix) => {
    if (isEqual(expected, actual)) {
        const assertionMessage = `Expected ${ toFriendlyString(actual) } to NOT equal (!==) ${ toFriendlyString(expected) }`;
        return isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;
    }
    return null;
});

/**
 * Asserts that the actual value matches the matcher value according to doesMatch().
 * If the actual does not match the matcher, an AssertionError will be thrown.
 *
 * @see {@link doesMatch}
 * @param {string|RegExp} matcher - The matcher to test against. See doesMatch() for more info.
 * @param {*} actual - The value to test. See doesMatch() for more info.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value does not match.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
export const assertMatches = curryAssertion2('assertMatches', (matcher, actual, messagePrefix) => {
    if (!doesMatch(matcher, actual)) {
        const assertionMessage = `Expected ${ toFriendlyString(actual) } to match ${ toFriendlyString(matcher) }`;
        return isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;
    }
    return null;
});

/**
 * Asserts that the actual value does NOT match the matcher value according to doesMatch().
 * If the actual value matches the matcher, an AssertionError will be thrown.
 *
 * @see {@link doesMatch}
 * @param {string|RegExp} matcher - The matcher to test against. See doesMatch() for more info.
 * @param {*} actual - The value to test. See doesMatch() for more info.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value matches.
 * @returns {true|Function} True when the assertion passes, or a curried function if only one argument is provided.
 */
export const assertNotMatches = curryAssertion2('assertNotMatches', (matcher, actual, messagePrefix) => {
    if (doesMatch(matcher, actual)) {
        const assertionMessage = `Expected ${ toFriendlyString(actual) } NOT to match ${ toFriendlyString(matcher) }`;
        return isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;
    }
    return null;
});

/**
 * Asserts that the given value is not undefined as determined by isUndefined().
 * If the value is undefined, an AssertionError will be thrown.
 *
 * @see {@link isUndefined}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is undefined.
 * @returns {true} When the assertion passes.
 */
export function assertDefined(value, messagePrefix) {
    if (isUndefined(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be defined`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertDefined' }, assertDefined);
    }
}

/**
 * Asserts that the given value is undefined as determined by isUndefined().
 * If the value is NOT undefined, an AssertionError will be thrown.
 *
 * @see {@link isUndefined}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not undefined.
 * @returns {true} When the assertion passes.
 */
export function assertUndefined(value, messagePrefix) {
    if (!isUndefined(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be undefined`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertUndefined' }, assertUndefined);
    }
}

/**
 * Asserts that the given value is a non-empty String as determined by isNonEmptyString().
 * If the value is not a String or is an empty String, an AssertionError will be thrown.
 *
 * @see {@link isNonEmptyString}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a non-empty String.
 * @returns {true} When the assertion passes.
 */
export function assertNonEmptyString(value, messagePrefix) {
    if (!isNonEmptyString(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a non-empty String`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertNonEmptyString' }, assertNonEmptyString);
    }
}

/**
 * Asserts that the given value is a Number but not NaN as determined by isNumberNotNaN().
 * If the value is not a Number or is NaN, an AssertionError will be thrown.
 *
 * @see {@link isNumberNotNaN}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Number or is NaN.
 * @returns {true} When the assertion passes.
 */
export function assertNumberNotNaN(value, messagePrefix) {
    if (!isNumberNotNaN(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a Number and not NaN`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertNumberNotNaN' }, assertNumberNotNaN);
    }
}

/**
 * Asserts that the given value is an Array as determined by Array.isArray().
 * If the value is not an Array, an AssertionError will be thrown.
 *
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not an Array.
 * @returns {true} When the assertion passes.
 */
export function assertArray(value, messagePrefix) {
    if (!Array.isArray(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be an Array`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertArray' }, assertArray);
    }
}

/**
 * Asserts that the given value is a Boolean as determined by isBoolean().
 * If the value is not a Boolean, an AssertionError will be thrown.
 *
 * @see {@link isBoolean}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Boolean.
 * @returns {true} When the assertion passes.
 */
export function assertBoolean(value, messagePrefix) {
    if (!isBoolean(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a Boolean`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertBoolean' }, assertBoolean);
    }
}

/**
 * Asserts that the given value is a Function as determined by isFunction().
 * If the value is not a Function, an AssertionError will be thrown.
 *
 * @see {@link isFunction}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a Function.
 * @returns {true} When the assertion passes.
 */
export function assertFunction(value, messagePrefix) {
    if (!isFunction(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a Function`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertFunction' }, assertFunction);
    }
}

/**
 * Asserts that the given value is a valid Date as determined by isValidDate().
 * If the value is not a valid Date, an AssertionError will be thrown.
 *
 * @see {@link isValidDate}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a valid Date.
 * @returns {true} When the assertion passes.
 */
export function assertValidDate(value, messagePrefix) {
    if (!isValidDate(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a valid Date`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertValidDate' }, assertValidDate);
    }
}

/**
 * Asserts that the given value is a RegExp as determined by isRegExp().
 * If the value is not a RegExp, an AssertionError will be thrown.
 *
 * @see {@link isRegExp}
 * @param {*} value - The value to test.
 * @param {string} [messagePrefix] - An optional error message prefix string.
 * @throws {AssertionError} When the value is not a RegExp.
 * @returns {true} When the assertion passes.
 */
export function assertRegExp(value, messagePrefix) {
    if (!isRegExp(value)) {
        const assertionMessage = `Expected ${ toFriendlyString(value) } to be a RegExp`;

        const message = isNonEmptyString(messagePrefix)
            ? `${ messagePrefix } (${ assertionMessage })`
            : assertionMessage;

        throw new AssertionError(message, { operator: 'assertRegExp' }, assertRegExp);
    }
}

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
export const assertGreaterThan = curryAssertion2('assertGreaterThan', (control, subject, messageSuffix) => {
    if (subject <= control) {
        const assertionMessage = `Expected ${ toFriendlyString(subject) } to be greater than ${ toFriendlyString(control) }`;
        return isNonEmptyString(messageSuffix)
            ? `${ assertionMessage } (${ messageSuffix })`
            : assertionMessage;
    }
    return null;
});

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
export const assertLessThan = curryAssertion2('assertLessThan', (control, subject, messageSuffix) => {
    if (subject >= control) {
        const assertionMessage = `Expected ${ toFriendlyString(subject) } to be less than ${ toFriendlyString(control) }`;
        return isNonEmptyString(messageSuffix)
            ? `${ assertionMessage } (${ messageSuffix })`
            : assertionMessage;
    }
    return null;
});

