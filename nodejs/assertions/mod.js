/**
 * A helper library for performing assertions which are not native to
 * JavaScript out of the box, or are implemented in unexpected ways.
 *
 * There are generally two groups of functions available in this library:
 *
 * 1. Helper functions which allow you to perform various kinds of type checks
 *    which you wouldn't otherwise find in JavaScript.
 * 2. Assertion functions which throw an AssertionError when the assertion is
 *    not true.
 *
 * The library depends on the Node.js AssertionError from the "node:assert" module.
 */
import { AssertionError } from 'node:assert';


const protoToString = Object.prototype.toString;


/**
 * Determine if the given value is a String.
 * @param  {*} x
 * @return {Boolean}
 */
export function isString(x) {
    // The typeof expression will not catch strings created with new String('foo'):
    //
    // ```js
    // return typeof new String('foo') === 'string'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    return protoToString.call(x) === '[object String]';
}

/**
 * Determine if the given value is a String with length greater than zero. Uses `isString()`.
 * @see {@link isString}
 * @param  {*} x
 * @return {Boolean}
 */
export function isNonEmptyString(x) {
    return Boolean(x && isString(x));
}

/**
 * Determine if the given value is a Number. Also returns `true` for BigInt instances.
 * @param  {*} x
 * @return {Boolean}
 */
export function isNumber(x) {
    // The typeof expression will not catch numbers created with new Number(1):
    //
    // ```js
    // return typeof new Number(1) === 'number'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    const tag = protoToString.call(x);
    return tag === '[object Number]' || tag === '[object BigInt]';
}

/**
 * Determine if the given value is a Number but is not NaN. Uses `isNumber()`.
 * @see {@link isNumber}
 * @param  {*} x
 * @return {Boolean}
 */
export function isNumberNotNaN(x) {
    return isNumber(x) && !Number.isNaN(x);
}

/**
 * Determine if the given value is a Boolean.
 * @param  {*} x
 * @return {Boolean}
 */
export function isBoolean(x) {
    // The typeof expression will not catch values created with new Boolean(1):
    //
    // ```js
    // return typeof new Boolean(1) === 'boolean'; // false
    // ```
    //
    // So we use `Object.prototype.toString` instead.
    return protoToString.call(x) === '[object Boolean]';
}

/**
 * Determine if the given value is undefined by checking typeof x === 'undefined'.
 * @param  {*} x
 * @return {Boolean}
 */
export function isUndefined(x) {
    return typeof x === 'undefined';
}

/**
 * Determine if the given value is a primitive value. Primitive values are
 * defined as String, Number, BigInt, Boolean, Symbol, null, and undefined.
 * @param  {*} x
 * @return {Boolean}
 */
export function isPrimitive(x) {
    return x === null
        || isString(x)
        || isNumber(x)
        || (typeof x === 'bigint')
        || isBoolean(x)
        || (typeof x === 'symbol')
        || isUndefined(x);
}

/**
 * Determine if the given value is a Function. This will work as expected for
 * function declarations, function expressions, async functions,
 * class static methods, class methods, and object methods.
 * @param  {*} x
 * @return {Boolean}
 */
export function isFunction(x) {
    return typeof x === 'function';
}

/**
 * Determine if the given value is a plain object. First, check to see if the
 * value is an object at all. Then if the object does not have a prototype OR
 * it has a constructor named "Object", then consider it a "plain" object.
 * @param  {*} x
 * @return {Boolean}
 */
export function isPlainObject(x) {
    if (!x || typeof x !== 'object') {
        return false;
    }
    if (!Object.getPrototypeOf(x)) {
        return true;
    }
    return x.constructor && x.constructor.name === 'Object';
}

/**
 * Determine if the given value is a native JavaScript Date instance.
 * @param  {*} x
 * @return {Boolean}
 */
export function isDate(x) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    return protoToString.call(x) === '[object Date]';
}

/**
 * Determine if the given value is a *valid* JavaScript Date instance.
 * Validity is determined by checking isNaN() of .getTime(): `isNaN(x.getTime())`.
 * @param  {*} x
 * @return {Boolean}
 */
export function isValidDate(x) {
    if (isDate(x)) {
        return !Number.isNaN(x.getTime());
    }
    return false;
}

/**
 * Determine if the given value is a native JavaScript RegExp instance.
 * @param  {*} x
 * @return {Boolean}
 */
export function isRegExp(x) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    return protoToString.call(x) === '[object RegExp]';
}

/**
 * Determine if the given value is a native JavaScript Map or WeakMap. This
 * will work as expected, returning true when passing an instance of a class
 * which extends Map or WeakMap.
 * @param  {*} x
 * @return {Boolean}
 */
export function isMap(x) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    const tag = protoToString.call(x);
    return tag === '[object Map]' || tag === '[object WeakMap]';
}

/**
 * Determine if the given value is a native JavaScript Set or WeakSet. This
 * will work as expected, returning true when passing an instance of a class
 * which extends Map or WeakMap.
 * @param  {*} x
 * @return {Boolean}
 */
export function isSet(x) {
    // Using the protoToString tag is more reliable than using `instanceof`.
    const tag = protoToString.call(x);
    return tag === '[object Set]' || tag === '[object WeakSet]';
}

/**
 * Compare two values for equality. If `a === b` then
 * returns `true`. Otherwise ensure date and NaN comparison is
 * done as expected. Will return a curried version of this
 * function if only a single argument is supplied.
 *
 * @param {*} a
 * @param {*} b
 * @return {Boolean}
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
 * Performs string matching, with some caveats. If the matcher is a
 * regular expression then doesMatch() will call RegExp:test(). If the
 * matcher === x, then return true. If x is a String, then check to see if
 * the String contains the matcher with String:includes(). Will return a
 * curried version of this function if only a single argument is supplied.
 *
 * @param {*} matcher
 * @param {*} x
 * @return {Boolean}
 */
export function doesMatch(matcher, x) {
    if (arguments.length < 2) {
        return function curriedDoesMatch(_x) {
            return doesMatch(matcher, _x);
        };
    }
    if (isEqual(matcher, x)) {
        return true;
    }
    if (typeof matcher?.test === 'function') {
        return matcher.test(x);
    }
    if (typeof x?.includes === 'function') {
        return x.includes(matcher);
    }

    return false;
}

/**
 * Convert any JavaScript value to a human friendly string.
 * @param  {*} x
 * @return {String}
 */
export function toFriendlyString(x) {
    if (isString(x)) {
        return `String(${ x })`;
    }
    if (typeof x === 'bigint') {
        return `BigInt(${ x })`;
    }
    // WARNING
    // Checking isNumber() will return true for BigInt instances as well as
    // Numbers, so the isBigInt() check needs to come before isNumber().
    if (isNumber(x)) {
        return `Number(${ x })`;
    }
    if (isBoolean(x)) {
        return `Boolean(${ x })`;
    }
    if (typeof x === 'symbol') {
        return x.toString();
    }
    if (isUndefined(x)) {
        return 'undefined';
    }
    if (isFunction(x)) {
        if (x.toString().startsWith('class ')) {
            return `class ${ x.name } {}`;
        }
        // This will get "Function" or "AsyncFunction":
        const prefix = protoToString.call(x).slice(8, -1);
        if (x.name) {
            return `${ prefix }(${ x.name })`;
        }
        return `${ prefix }(function)`;
    }
    if (x === null) {
        return 'null';
    }
    if (Object.getPrototypeOf(x) === null) {
        return 'Object(null)';
    }
    if (isPlainObject(x)) {
        return 'Object({})';
    }
    if (Array.isArray(x)) {
        if (x.length === 0) {
            return 'Array([])';
        }
        return `Array([0..${ (x.length - 1) }])`;
    }
    if (isValidDate(x)) {
        return `Date(${ x.toISOString() })`;
    }
    if (isDate(x)) {
        return 'Date(Invalid)';
    }
    if (isRegExp(x)) {
        return `RegExp(${ x })`;
    }
    if (isMap(x) || isSet(x)) {
        return `${ x.constructor.name }()`;
    }

    const name = x.constructor?.name || 'Object';

    return `${ name }(${ x })`;
}

export function curryAssertion2(operator, guard) {
    return function curriedAssertion2(expected, actual, message) {
        if (arguments.length < 2) {
            return function curriedInnerAssert(_actual, _message) {
                _message = _message ? `. ${ _message }` : '.';
                const _msg = guard(expected, _actual, _message);
                if (_msg) {
                    throw new AssertionError({
                        message: _msg,
                        expected,
                        actual: _actual,
                        operator,
                        stackStartFn: curriedInnerAssert,
                    });
                }
            };
        }

        message = message ? `. ${ message }` : '.';
        const msg = guard(expected, actual, message);
        if (msg) {
            throw new AssertionError({
                message: msg,
                expected,
                actual,
                operator,
                stackStartFn: curriedAssertion2,
            });
        }

        return null;
    };
}

/**
 * Assert the given value is truthy. If not, assert() will throw a Node.js
 * AssertionError. The AssertionError message will be the concatenated string:
 * `${ messagePrefix } (Expected ${ toFriendlyString(actual) } to be truthy)`
 *
 * @param  {*} actual The value to test.
 * @param  {string} [messagePrefix] An optional error message prefix string.
 * @throws {AssertionError}
 */
export function assert(actual, messagePrefix) {
    const assertionMessage = `Expected ${ toFriendlyString(actual) } to be truthy`;

    const message = isNonEmptyString(messagePrefix)
        ? `${ messagePrefix } (${ assertionMessage })`
        : assertionMessage;

    if (!actual) {
        throw new AssertionError({
            message,
            expected: true,
            actual,
            operator: 'assert',
            stackStartFn: assert,
        });
    }
}

/**
 * Assert the given value is falsy. If not, assertFalsy() will throw a Node.js
 * AssertionError. The AssertionError message will be the concatenated string:
 * `${ message } Expected ${ toFriendlyString(actual) } to be falsy.`
 *
 * @param  {*} actual The value to test.
 * @param  {string} [messagePrefix] An optional error message prefix string.
 * @throws {AssertionError}
 */
export function assertFalsy(actual, messagePrefix) {
    const assertionMessage = `Expected ${ toFriendlyString(actual) } to be falsy`;

    const message = isNonEmptyString(messagePrefix)
        ? `${ messagePrefix } (${ assertionMessage })`
        : assertionMessage;

    if (actual) {
        throw new AssertionError({
            message,
            expected: false,
            actual,
            operator: 'assertFalsy',
            stackStartFn: assertFalsy,
        });
    }
}

export const assertEqual = curryAssertion2('assertEqual', (expected, actual, messageSuffix) => {
    if (!isEqual(expected, actual)) {
        let msg = `Expected ${ toFriendlyString(actual) }`;
        msg += ` to equal (===) ${ toFriendlyString(expected) }`;
        return msg + messageSuffix;
    }
    return null;
});

export const assertNotEqual = curryAssertion2('assertNotEqual', (expected, actual, messageSuffix) => {
    if (isEqual(expected, actual)) {
        let msg = `Expected ${ toFriendlyString(actual) }`;
        msg += ` to NOT equal (!==) ${ toFriendlyString(expected) }`;
        return msg + messageSuffix;
    }
    return null;
});

export const assertMatches = curryAssertion2('assertMatches', (matcher, actual, messageSuffix) => {
    if (!doesMatch(matcher, actual)) {
        const msg = `Expected ${ toFriendlyString(actual) } to match `;
        return msg + toFriendlyString(matcher) + messageSuffix;
    }
    return null;
});

export const assertNotMatches = curryAssertion2('assertNotMatches', (matcher, actual, messageSuffix) => {
    if (doesMatch(matcher, actual)) {
        const msg = `Expected ${ toFriendlyString(actual) } NOT to match `;
        return msg + toFriendlyString(matcher) + messageSuffix;
    }
    return null;
});

export function assertDefined(x, message) {
    if (isUndefined(x)) {
        const messageSuffix = message ? `. ${ message }` : '.';
        throw new AssertionError({
            message: `Expected ${ toFriendlyString(x) } to be defined${ messageSuffix }`,
            operator: 'assertDefined',
            stackStartFn: assertDefined,
        });
    }
}

export function assertUndefined(x, message) {
    if (!isUndefined(x)) {
        const messageSuffix = message ? `. ${ message }` : '.';
        throw new AssertionError({
            message: `Expected ${ toFriendlyString(x) } to be undefined${ messageSuffix }`,
            operator: 'assertUndefined',
            stackStartFn: assertUndefined,
        });
    }
}

export const assertGreaterThan = curryAssertion2('assertGreaterThan', (control, subject, messageSuffix) => {
    if (subject <= control) {
        const msg = `Expected ${ toFriendlyString(subject) } to be greater than `;
        return msg + toFriendlyString(control) + messageSuffix;
    }
    return null;
});

export const assertLessThan = curryAssertion2('assertLessThan', (control, subject, messageSuffix) => {
    if (subject >= control) {
        const msg = `Expected ${ toFriendlyString(subject) } to be less than `;
        return msg + toFriendlyString(control) + messageSuffix;
    }
    return null;
});
