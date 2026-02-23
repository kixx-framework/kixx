---
name: assertions
description: Guidelines for using the kixx-assert library to validate assumptions and inputs in the codebase. Apply when writing new code or refactoring.
---

## Overview
This project uses **kixx-assert** (vendored at `lib/vendor/kixx-assert/`, re-exported via `lib/assertions.js`) for runtime validation. The library has two groups of functions:

1. **Test functions** (e.g. `isNonEmptyString`, `isPlainObject`) — return a boolean. Use for conditional logic.
2. **Assertion functions** (e.g. `assertEqual`, `assertNonEmptyString`) — throw `AssertionError` on failure. Use to enforce invariants.

## Why Use Assertions?
- **Fail fast** — surface programmer errors at the call boundary instead of deep in execution.
- **Document assumptions** — assertions make preconditions and invariants explicit.
- **Validate API boundaries** — enforce that callers pass valid arguments (non-empty strings, defined values, correct types).

Assertions are for programmer errors (bugs), not user input validation. For expected invalid input, validate and return operational errors instead.

## Import
```javascript
import { assert, assertNonEmptyString, assertArray, isPlainObject } from '../assertions/mod.js';
```

When building on kixx, assertions are also available as `kixx.assert`, `kixx.assertNonEmptyString`, etc.

## When to Use What

| Scenario | Use | Example |
|----------|-----|---------|
| Required string parameter | `assertNonEmptyString` | `assertNonEmptyString(options.directory, 'PageStore requires a base directory')` |
| Truthy requirement | `assert` | `assert(context, 'A Collection requires an ApplicationContext')` |
| Array parameter | `assertArray` | `assertArray(spec.routes, 'vhost.routes must be an Array')` |
| Specific value/equality | `assertEqual` | `assertEqual(item.id, modelInstance.id, 'item.id mismatch')` |
| Defined (not undefined) | `assertDefined` | `assertDefined(config, 'config is required')` |
| Conditional branching | Test function (`is*`) | `if (isPlainObject(val)) { ... }` |
| Error message formatting | `toFriendlyString` | `toFriendlyString(value)` for readable error output |

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
const assertIsValidMethod = (method) => assert(HTTP_METHODS.includes(method), `Invalid HTTP method: ${ method }`);
```

### No deep equality
kixx-assert does not compare objects by structure. Compare by reference where possible, or assert individual properties.

### AssertionError
Failed assertions throw `AssertionError` with `name`, `code` (`'ASSERTION_ERROR'`), and `operator` (e.g. `'assertNonEmptyString'`). Use `error.name === 'AssertionError'` or `error.code` when catching or testing.

## Common Patterns in This Codebase
- **Constructor/options validation** — assert required options at the top of constructors.
- **Method parameter validation** — assert IDs, names, and structured params at method entry.
- **Type checks before logic** — use `isPlainObject`, `isNonEmptyString`, `isUndefined` when branching; use assertions when the invalid case should never occur.
