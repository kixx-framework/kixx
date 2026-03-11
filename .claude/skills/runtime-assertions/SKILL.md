---
name: runtime-assertions
description: "Runtime invariant enforcement using the kixx-assert library (re-exported via `lib/assertions.js`). Covers assertion functions (assert, assertNonEmptyString, assertArray, assertEqual, assertDefined, assertMatches, assertGreaterThan, assertBoolean, assertFunction, and more), test/boolean functions (isNonEmptyString, isPlainObject, isUndefined, doesMatch, and more), argument order for curriable assertions, and message string conventions. These are guards for programmer errors at call boundaries — not user input validation or test assertions. Apply when writing or refactoring production JavaScript code."
---

## Overview
This project uses **kixx-assert** (vendored at `lib/vendor/kixx-assert/`, re-exported via `lib/assertions.js`) for runtime validation. The library has two groups of functions:

1. **Test functions** (e.g. `isNonEmptyString`, `isPlainObject`) — return a boolean. Use for conditional logic.
2. **Assertion functions** (e.g. `assertEqual`, `assertNonEmptyString`) — throw `AssertionError` on failure. Use to enforce invariants.

To view the kixx-assert documentation directly, review the README at `lib/vendor/kixx-assert/README.md`.

All the source code for the kixx-assert library is available in a single module at `lib/vendor/kixx-assert/mod.js`.

## Why Use Assertions?
Assertions are used to enforce invariants in the system.

- **Fail fast** — surface programmer errors at the call boundary instead of deep in execution.
- **Document assumptions** — assertions make preconditions and invariants explicit.
- **Validate API boundaries** — enforce that callers pass valid arguments (non-empty strings, defined values, correct types).

Assertions are for programmer errors (bugs), not user input validation. For expected invalid input, validate and return operational errors instead. See also: `error-handling` — for the distinction between programmer errors (assertion failures) and expected operational errors, and how to handle each.

## Import

```javascript
import { assert, assertNonEmptyString, assertArray, isPlainObject } from '../assertions.js';
```

## When to Use What

| Scenario | Use | Example |
|----------|-----|---------|
| Required string parameter | `assertNonEmptyString` | `assertNonEmptyString(options.directory, 'PageStore requires a base directory')` |
| Truthy requirement | `assert` | `assert(context, 'A Collection requires an ApplicationContext')` |
| Array parameter | `assertArray` | `assertArray(spec.routes, 'vhost.routes must be an Array')` |
| Specific value/equality | `assertEqual` | `assertEqual(item.id, modelInstance.id, 'item.id mismatch')` |
| Defined (not undefined) | `assertDefined` | `assertDefined(config, 'config is required')` |
| Conditional branching | Test function (`is*`) | `if (isPlainObject(val)) { ... }` |

## Function Reference

### Assertion Functions
All assertion functions throw `AssertionError` on failure. All accept an optional message string as the last argument.

| Function | Checks |
|----------|--------|
| `assert(actual)` | truthy value |
| `assertFalsy(actual)` | falsy value |
| `assertEqual(expected, actual)` | strict equality (handles NaN and Dates). Curriable. |
| `assertNotEqual(expected, actual)` | strict inequality. Curriable. |
| `assertMatches(matcher, actual)` | RegExp test, string substring, or strict equality. Curriable. |
| `assertNotMatches(matcher, actual)` | inverse of `assertMatches`. Curriable. |
| `assertDefined(value)` | not `undefined` |
| `assertUndefined(value)` | exactly `undefined` |
| `assertNonEmptyString(value)` | non-empty string |
| `assertNumberNotNaN(value)` | number and not NaN |
| `assertArray(value)` | `Array.isArray` |
| `assertBoolean(value)` | exactly `true` or `false` |
| `assertFunction(value)` | function, arrow function, or async function |
| `assertValidDate(value)` | valid `Date` instance |
| `assertRegExp(value)` | `RegExp` instance |
| `assertGreaterThan(control, subject)` | subject > control. Curriable. |
| `assertLessThan(control, subject)` | subject < control. Curriable. |

### Test Functions
Test functions return a boolean. Use for conditional branching. Reach for `assert*` when the invalid case should never occur; use `is*` when both branches are valid.

| Function | Returns `true` when |
|----------|---------------------|
| `isNonEmptyString(value)` | non-empty string |
| `isString(value)` | any string (including empty) |
| `isPlainObject(value)` | plain object — not `null`, not array, not class instance |
| `isObjectNotNull(value)` | any non-`null` object (includes arrays and class instances) |
| `isUndefined(value)` | exactly `undefined` |
| `isNumber(value)` / `isNumberNotNaN(value)` | number / number and not NaN |
| `isBoolean(value)` | exactly `true` or `false` |
| `isFunction(value)` | function, arrow, or async |
| `isPrimitive(value)` | string, number, boolean, symbol, `null`, or `undefined` |
| `isDate(value)` / `isValidDate(value)` | any `Date` instance / valid (non-NaN) `Date` |
| `isRegExp(value)` | `RegExp` instance |
| `isMap(value)` / `isSet(value)` | `Map` instance / `Set` instance |
| `isEqual(a, b)` | strict equality — non-throwing version of `assertEqual` |
| `doesMatch(matcher, value)` | non-throwing version of `assertMatches`; useful for message substring checks |

## Guidelines

### Message strings
Add a message as the last argument when the failure would be ambiguous. Describe the requirement and context (e.g. parameter name, method name).

```javascript
assertNonEmptyString(namespace, 'getNamespace() requires a non-empty string for the namespace key');
assertArray(spec.targets, `route.targets must be an Array (in route: ${ name })`);
```

### Argument order for control/subject assertions
Use `assertEqual(expected, actual)` — expected first, actual second. Same for `assertMatches(matcher, subject)`, `assertGreaterThan(control, subject)`.

### Currying
Control/subject assertions can be curried for repeated checks:
```javascript
const HTTP_METHODS = [ 'GET', 'HEAD' ];
const assertIsValidMethod = (method) => assert(HTTP_METHODS.includes(method), `Invalid HTTP method: ${ method }`);
```

### toFriendlyString
Use `toFriendlyString(value)` when building assertion messages that include a value. It produces readable output for any type, including `null`, `undefined`, objects, and arrays:

```javascript
assert(isPlainObject(options), `Expected options to be a plain object, got: ${ toFriendlyString(options) }`);
assertNonEmptyString(id, `getPage() requires a non-empty string ID, got: ${ toFriendlyString(id) }`);
```

## Common Patterns in This Codebase

**Constructor/options validation** — assert all required options at the top of the constructor, before any logic:

```javascript
constructor({ directory, fileSystem }) {
    assertNonEmptyString(directory, 'PageStore requires a non-empty directory path');
    assertDefined(fileSystem, 'PageStore requires a fileSystem');
}
```

**Method parameter validation** — assert at method entry before operating on the value:

```javascript
getPage(pathname) {
    assertNonEmptyString(pathname, 'getPage() requires a non-empty pathname');
    // ...
}
```

**Type checks before branching** — use `is*` functions when multiple branches are valid; use `assert*` when the invalid case should never occur:

```javascript
// Both branches valid — use is*
function processValue(value) {
    if (isPlainObject(value)) {
        return processObject(value);
    }
    return processScalar(value);
}

// Invalid case is a bug — use assert*
function requirePlainObject(value, label) {
    assert(isPlainObject(value), `${ label } must be a plain object, got: ${ toFriendlyString(value) }`);
}
```
