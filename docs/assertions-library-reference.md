# Assertions Library

The assertions library (`lib/assertions/mod.js`) provides type-checking helper functions that return Booleans and assertion functions that throw an `AssertionError` on failure.

```javascript
import { isNonEmptyString, assertEqual } from 'kixx-assert';
```

There is no deep equality testing. Compare objects by reference or by their individual properties.

## Type Checkers

All type checkers accept a single value and return a Boolean.

### isString(value)
Returns `true` for string primitives and `String` objects (including `new String()`).

### isNonEmptyString(value)
Returns `true` for strings with length greater than zero.

### isNumber(value)
Returns `true` for number primitives, `Number` objects, `BigInt` values, and `NaN`.

### isNumberNotNaN(value)
Returns `true` for numbers and BigInt, but `false` for `NaN`.

### isBoolean(value)
Returns `true` for boolean primitives and `Boolean` objects (including `new Boolean()`).

### isUndefined(value)
Returns `true` only for `undefined`. Returns `false` for `null`.

### isPrimitive(value)
Returns `true` for String, Number, BigInt, Boolean, Symbol, `null`, and `undefined`.

### isFunction(value)
Returns `true` for function declarations, function expressions, arrow functions, async functions, and class methods.

### isObjectNotNull(value)
Returns `true` for any value where `typeof` is `'object'` and the value is not `null`. This includes plain objects, arrays, Date, RegExp, Map, Set, and class instances.

### isPlainObject(value)
Returns `true` for objects with no prototype or whose constructor is named `"Object"`. Returns `false` for class instances, arrays, Date, etc.

### isDate(value)
Returns `true` for `Date` instances (including invalid dates).

### isValidDate(value)
Returns `true` for `Date` instances whose timestamp is not `NaN`.

### isRegExp(value)
Returns `true` for `RegExp` instances.

### isMap(value)
Returns `true` for `Map` and `WeakMap` instances (including subclasses).

### isSet(value)
Returns `true` for `Set` and `WeakSet` instances (including subclasses).

## Comparison Functions

### isEqual(a, b)
Strict equality (`===`) with special handling for `Date` and `NaN`:
- Two valid dates are equal if they represent the same time.
- `NaN` is equal to `NaN`.

Supports currying when called with a single argument:
```javascript
const isOne = isEqual(1);
isOne(1); // true
```

### doesMatch(matcher, value)
Flexible string and pattern matching:
1. If `matcher` equals `value` via `isEqual()`, returns `true`.
2. If `value` is a valid Date, it is converted to an ISO string before comparison.
3. If `matcher` has a `.test()` method (RegExp), calls `matcher.test(value)`.
4. If `value` has an `.includes()` method (String), calls `value.includes(matcher)`.

Supports currying when called with a single argument:
```javascript
const isShortDate = doesMatch(/^\d{4}-\d{2}-\d{2}$/);
isShortDate('2020-09-14'); // true
```

## toFriendlyString(value)
Converts any value to a human-readable string for use in error messages.

```javascript
toFriendlyString('foo');           // "String(foo)"
toFriendlyString(42);             // "Number(42)"
toFriendlyString(false);          // "Boolean(false)"
toFriendlyString(null);           // "null"
toFriendlyString(undefined);      // "undefined"
toFriendlyString([1, 2, 3]);      // "Array([0..2])"
toFriendlyString({});             // "Object({})"
toFriendlyString(new Date('foo')); // "Date(Invalid)"
```

## AssertionError

All assertion functions throw an `AssertionError` on failure. It extends `Error` with these additional properties:

- **name** - The error name (defaults to `"AssertionError"`).
- **code** - Error code (defaults to `"ASSERTION_ERROR"`).
- **operator** - The name of the assertion function that failed.

```javascript
import { AssertionError } from 'kixx-assert';

try {
    assert(false);
} catch (error) {
    error instanceof AssertionError; // true
    error.code;     // "ASSERTION_ERROR"
    error.operator; // "assert"
}
```

## Assertion Functions

All assertion functions throw an `AssertionError` on failure and accept an optional message string as their last argument. The message is prepended to the generated assertion message.

```javascript
assertNonEmptyString(null, 'config.name');
// Throws: "config.name (Expected null to be a non-empty String)"
```

### Single-Value Assertions

These accept `(value, messagePrefix)`:

| Function | Passes when |
|---|---|
| `assert(value)` | `value` is truthy |
| `assertFalsy(value)` | `value` is falsy |
| `assertDefined(value)` | `value` is not `undefined` |
| `assertUndefined(value)` | `value` is `undefined` |
| `assertNonEmptyString(value)` | `value` is a non-empty string |
| `assertNumberNotNaN(value)` | `value` is a number and not `NaN` |
| `assertArray(value)` | `value` passes `Array.isArray()` |
| `assertBoolean(value)` | `value` is a boolean |
| `assertFunction(value)` | `value` is a function |
| `assertValidDate(value)` | `value` is a valid Date |
| `assertRegExp(value)` | `value` is a RegExp |

### Two-Value Assertions (Curryable)

These accept `(expected, actual, messagePrefix)` and can be curried by calling with a single argument:

| Function | Passes when |
|---|---|
| `assertEqual(expected, actual)` | `isEqual(expected, actual)` is `true` |
| `assertNotEqual(expected, actual)` | `isEqual(expected, actual)` is `false` |
| `assertMatches(matcher, actual)` | `doesMatch(matcher, actual)` is `true` |
| `assertNotMatches(matcher, actual)` | `doesMatch(matcher, actual)` is `false` |
| `assertGreaterThan(control, subject)` | `subject > control` |
| `assertLessThan(control, subject)` | `subject < control` |

Currying example:
```javascript
const assertFoo = assertEqual('foo');

assertFoo('foo'); // passes
assertFoo('bar', 'expected foo'); // throws AssertionError
```

## curryAssertion2(operator, guard)

Factory function for creating custom curryable assertion functions. The `guard` function receives `(expected, actual, messagePrefix)` and should return a message string on failure or `null` on success.

```javascript
import { curryAssertion2 } from 'kixx-assert';

const assertStartsWith = curryAssertion2('assertStartsWith', (prefix, actual, msg) => {
    if (!actual.startsWith(prefix)) {
        return `${msg || ''} Expected ${actual} to start with ${prefix}`;
    }
    return null;
});

const assertHttps = assertStartsWith('https://');
assertHttps('http://example.com'); // throws AssertionError
```
