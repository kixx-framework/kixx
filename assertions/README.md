Kixx Assert
===========
A JavaScript library for creating robust ES6 code.

Contains test functions like `isNumberNotNaN()` which return Booleans, and assertion functions like `assertEquals()` which throw an AssertionError if the condition(s) fail.

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2025.

## Environment Support

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__ or __Deno >= 1.0.0__. You could use it in a browser, but there are no plans to offer CommonJS or AMD modules. It targets at least [ES2022](https://node.green/#ES2022) and uses the optional chaining operator `?.`.

If you're curious: Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

Please don't bother running benchmarks on this library. Correctness and readability are design objectives. Conserving CPU cycles is not. It is very unlikely any utilities in this library would have a measureable performance impact on your application, and if they did you should probably be implementing something more optimized to your specific use case.

__Note:__ There is no TypeScript here. It would be waste of time for a library as small as this.

## Usage
```js
// In Node.js:
import { isNonEmptyString, assertEquals } from 'kixx-assert';

isNonEmptyString('hello world'); // true
isNonEmptyString(''); // false
isNonEmptyString({}); // false

assertEquals('hello world', 'hello world');
assertEquals({}, {}); // Throws an AssertionError
```

Also supports currying :tada:

```js
const assertFoo = assertEqual('Foo');

assertFoo('Foo', 'Expecting Foo'); // Passes
assertFoo('hello world', 'Expecting Foo'); // Throws an AssertionError
```

## Contents

- [Library](#library)
- [AssertionError](#assertionerror)
- [Assertions](#assertions)

## Library

### isString
See [isNonEmptyString()](#isnonemptystring) below for something which might be more useful for you.

```js
isString(1) // false
isString('1') // true
isString(String('1')) // true

// If you need to do this for some (dumb) reason, then isString() will still
// return true even though typeof new String() === 'object'.
isString(new String('1')) // true
````

### isNonEmptyString
```js
isNonEmptyString(1) // false
isNonEmptyString('') // false
isNonEmptyString('hello world') // true
```

### isNumber
Detects integers, floats, BigInt, and even NaN.

See [isNumberNotNaN()](#isnumbernotnan) below for something which might be more useful for you.

```js
isNumber('2') // false
isNumber(1) // true
isNumber(0.1) // true
isNumber(BigInt(7)) // true
isNumber(NaN) // true
```

### isNumberNotNaN
```js
isNumberNotNaN('2') // false
isNumberNotNaN(NaN) // false
isNumberNotNaN(1) // true
isNumberNotNaN(0.1) // true
isNumberNotNaN(BigInt(7)) // true
```

### isBoolean
```js
isBoolean(1) // false
isBoolean(false) // true
isBoolean(Boolean(1)) // true

// If you need to do `new Boolean()` for some (stupid) reason, then isBoolean() will still
// return true even though typeof new Boolean() === 'object'.
isBoolean(new Boolean(1)) // true
```

### isUndefined
```js
isUndefined(null) // false
isUndefined(undefined) // true
isUndefined() // true
```

### isPrimitive
Detects [JavaScript Primitives](https://developer.mozilla.org/en-US/docs/Glossary/Primitive).

```js
isPrimitive({}) // false
isPrimitive(null) // true
isPrimitive(false) // true
isPrimitive('hello world') // true
isPrimitive(undefined) // true
isPrimitive() // true
```

### isFunction
Detects function declaration, function expressions, arrow functions, and async functions.

```js
class Foo {
    yell() {
        return 'HELLO WORLD';
    }
}

async function helloWorld() {
    const res = await Promise.resolve('hello world');
    return res;
}

isFunction(new Foo().yell) // true
isFunction(helloWorld) // true
isFunction(() => {}) // true
isFunction('foo') // false
```

### isPlainObject
```js
isPlainObject(new Date()) // false
isPlainObject({ foo: 'bar' }) // true
```

### isDate
```js
isDate({}) // false
isDate(new Date()) // true
```

### isValidDate
```js
isValidDate({}) // false
isValidDate(new Date('1999')) // true
isValidDate(new Date('Invalid')) // false
```

### isRegExp
```js
isRegExp({}) // false
isRegExp(/^foo/i) // true
isRegExp(new RegExp('^foo', 'i')) // true
```

### isMap
```js
isMap(new Set()) // false
isMap(new Map()) // true
isMap(new WeakMap()) // true
```

### isSet
```js
isSet(new Map()) // false
isSet(new Set()) // true
isSet(new WeakSet()) // true
```

### isEqual
Provides a clever date comparison and some safety against stupid stuff with NaN.

Can be curried.

```js
isEqual(1, 2) // false
isEqual(1, '1') // false
isEqual(1, 1) // true

// If you do NaN === NaN you'll get false (dumb).
// The isEqual() helper corrects that.
isEqual(NaN, NaN) // true

// Compare dates :D
isEqual(new Date('1999'), new Date('1999')) // true
```

You can curry it! :tada:

```js
const isOne = isEqual(1);

isOne(1) // true
```

### doesMatch
A wiz at matching strings and RegExp, but can match just about anything.

If the matcher is a regular expression then doesMatch() will call RegExp:test() using the subject. If the subject is equal to the matcher (using isEqual()) then return true. If the subject is a String then check to see if the String contains the matcher with String:includes(). If the subject is a valid Date then convert it to a string using Date:toISOString() before making the comparison.

Can be curried.

```js
doesMatch(/^foo/i, 'BAR') // false
doesMatch(/^foo/i, 'FOOBAR') // true
doesMatch('oba', 'foobar') // true
doesMatch('fox', 'The quick brown fox jumped over the...') // true
```

You can curry it! :tada:

```js
const isShortDateString = doesMatch(/^[\d]{4}-[\d]{2}-[\d]{2}$/);

isShortDateString('14 September 2020') // false
isShortDateString('2020-09-14') // true
```

### toFriendlyString
Coerces the passed value into a String which more closely represents what the thing is.

```js
toFriendlyString('foo'); // "String(foo)"
toFriendlyString(false); // "Boolean(false)"
toFriendlyString(new Date('foo')); // "Date(Invalid)"
toFriendlyString([1,2,3]); // "Array([0..2])"
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
assert(0) // Throws AssertionError
assert('foo') // Passes
```

### assertFalsy
Throw an AssertionError if the passed value is not falsy.

```js
assertFalsy('foo') // Throws AssertionError
assertFalsy(null) // Passes
```

### assertEqual
Throw an AssertionError if the passed values are *not strictly* equal. Dates and NaN are special cases handled seperately.

See [isEqual](#isequal).

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

### assertMatches
See [doesMatch()](#doesmatch)

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
Uses [isUndefined()](#isundefined) internally.

```js
assertDefined(undefined) // Throws AssertionError
assertDefined(new Date().foo) // Throws AssertionError
assertDefined(new Map().size) // passes (even though .size is zero)
assertDefined(null) // passes
```

### assertUndefined
Inverse of [assertUndefined](#assertUndefined). Uses [isUndefined()](#isundefined) internally.

```js
assertUndefined(null) // Throws AssertionError
assertUndefined(({}).toString) // Throws AssertionError
assertUndefined(undefined) // passes
```
### assertNonEmptyString
See [isNonEmptyString()](#isnonemptystring).

### assertNumberNotNaN
See [isNumberNotNaN()](#isnumbernotnan).

### assertArray
Uses the native Array.isArray().

### assertBoolean
See [isBoolean()](#isboolean).

### assertFunction
See [isFunction()](#isfunction).

### assertValidDate
See [isValidDate()](#isvaliddate).

### assertRegExp
See [isRegExp()](#isregexp).

### assertGreaterThan
If the subject is less than or equal to the control the test will fail.

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

Copyright and License
---------------------
Copyright: (c) 2017 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
