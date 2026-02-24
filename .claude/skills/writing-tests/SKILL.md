---
name: writing-tests
description: Guidelines, examples, and reference documentation for writing effective tests in this project. Apply this skill when writing, updating, and fixing tests.
---

## Test File Naming
- Test file suffix: `*.test.js`
- Mirror `lib/` structure in `test/lib/` (e.g, `lib/node-http-server/server-request.js` → `test/lib/node-http-server/server-request.test.js`)
- Mirror `examples/` structure in `test/examples/` (e.g, `examples/forms/todo-item.form.js` → `test/examples/forms/todo-item.form.test.js`)

## Testing Dependencies
In this project, use the Kixx Test Framework for organizing and orchestrating tests, the Kixx Assertion Library to make assertions, and use Sinon to mock objects, methods, and functions.

- [Kixx Test Framework](#kixx-test-framework) — describe, before, after, it
- [Kixx Assertion Library](#kixx-assertion-library) — assertEqual, assertMatches, etc.
- [Sinon](#sinon) — spies and stubs for mocking

## Getting Started

```javascript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import Paths from '../../lib/application/paths.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_APP_DIR = path.join(THIS_DIR, 'my-projects', 'fake-app');

describe('Paths#constructor with valid input', ({ it }) => {
    const paths = new Paths(FAKE_APP_DIR);
    it('sets app_directory', () => assertEqual(FAKE_APP_DIR, paths.app_directory));
    it('sets routes_directory', () => assertEqual(path.join(FAKE_APP_DIR, 'routes'), paths.routes_directory));
});
```

With mocks and async setup:

```javascript
describe('PageStore#doesPageExist() when stats isDirectory is true', ({ before, after, it }) => {
    const stats = { isDirectory: sinon.stub().returns(true) };
    const fileSystem = { getFileStats: sinon.stub().resolves(stats) };
    let result;

    before(async () => {
        const store = new PageStore({ directory: THIS_DIR, fileSystem });
        result = await store.doesPageExist('/blog/a-blog-post');
    });
    after(() => sinon.restore());

    it('passes full path to getFileStats()', () => {
        assertEqual(path.join(THIS_DIR, 'blog', 'a-blog-post'), fileSystem.getFileStats.getCall(0).firstArg);
    });
    it('returns true', () => assertEqual(true, result));
});
```

## Kixx Test Framework
Use `describe()`, `before()`, `after()`, and `it()`. Declare subjects and results with `let` at the top of the describe block (assigned in `before()`). before/after/it blocks can be async.

**Do not nest describe()** — create separate top-level describe blocks per behavior. One describe per logical code branch.

```javascript
describe('toBinary(): when value <= 0', ({ it }) => {
    it('returns false', () => { assertEqual(false, toBinary(0)); assertEqual(false, toBinary(-1)); });
});
describe('toBinary(): when value >= 1', ({ it }) => {
    it('returns true', () => { assertEqual(true, toBinary(1)); assertEqual(true, toBinary(2)); });
});
```

### Helpers and fixtures
Extract helpers like `createRequest()`, `createApplicationContext()` at module level. Use `const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))` for test-file-relative paths.

Use `assert(isPlainObject(result))` and `assertArray(result)` for type checks when asserting properties separately. Both `isPlainObject` and `assertArray` are imported from `kixx-assert`.

## Kixx Assertion Library
Assertion functions throw on failure. Add a message string as the last argument when the failure would be ambiguous: `assertEqual(true, regex.test(urn), 'exact match')`. Control/subject assertions (e.g. assertEqual) can be curried: `const assertFoo = assertEqual('foo'); assertFoo('bar');`

**No deep equality** — compare objects by reference or by their properties.

### assert / assertFalsy
`assert(value)` — fails if not truthy. `assertFalsy(value)` — fails if not falsy.

### assertEqual
Strict equality. Handles NaN and Dates. Curriable. `assertEqual(expected, actual)`.

### assertNotEqual
Inverse of assertEqual. Curriable.

### assertMatches / assertNotMatches
`assertMatches(matcher, subject)` — Matcher can be a RegExp (`RegExp.test(subject)`), a string (`subject.includes(matcher)`), or any value (strict equality). Curriable.

`doesMatch(matcher, subject)` — non-throwing version; returns a boolean. Import from `kixx-assert`. Useful for substring checks: `assert(doesMatch('substring', error.message))`.

### Type checks (throw on failure)
| Function | Purpose |
|----------|---------|
| assertDefined | not undefined |
| assertUndefined | exactly undefined |
| assertNonEmptyString | non-empty string |
| assertNumberNotNaN | number, not NaN |
| assertArray | Array.isArray |
| assertBoolean | true or false |
| assertFunction | function/arrow/async |
| assertValidDate | valid Date instance |
| assertRegExp | RegExp instance |

### assertGreaterThan / assertLessThan
`assertGreaterThan(control, subject)` — fails if subject ≤ control. Curriable. Same for assertLessThan.

## Sinon

**Spy** — capture calls without changing behavior. `sinon.spy()` for new functions; `sinon.spy(obj, 'method')` to wrap (calls pass through). Use `.callCount`, `.getCall(n).firstArg`, etc.

**Stub** — pre-programmed behavior. `sinon.stub().returns(99)`, `.resolves(val)`, `.throws(err)`, `.rejects(err)`. `sinon.stub(obj, 'method').returns(99)` to replace.

**Fake** — standalone mock functions: `sinon.fake.resolves([...])`, `sinon.fake.returns(val)`. Good for constructor-injected mocks; usually no restore needed.

**sinon.restore()** — Call in `after()` when using stubs or spies on existing methods. Prevents test pollution.

## Sinon Spy API
Records arguments, return value, `this`, and exceptions. `sinon.spy()` (new) or `sinon.spy(fn)` / `sinon.spy(obj, 'method')` (wrap). For getters/setters: `sinon.spy(obj, 'prop', ['get','set'])`.

## Sinon Stub API
Stubs are spies with pre-programmed behavior. Supports [Spy/Stub Common API](#spystub-common-api).

### Stub behavior methods
| Method | Effect |
|--------|--------|
| .returns(val) | Return value |
| .returnsThis() | Return `this` (method chaining) |
| .resolves(val) | Resolve Promise |
| .rejects(val) | Reject Promise |
| .throws(err) | Throw (err or factory fn) |
| .callsFake(fn) | Call custom function |
| .onCall(n) / .onFirstCall() / .onSecondCall() | Per-call behavior |

## Spy/Stub Common API
`.callCount` · `.getCall(n)` (negative n = from end) · `.firstCall`, `.secondCall`, `.lastCall` · `.calledBefore(spy)` / `.calledAfter(spy)` · `.calledImmediatelyBefore` / `.calledImmediatelyAfter`

## Spy Call API
Access via `.getCall(n)`, `.firstCall`, `.lastCall`. Properties: `.args`, `.firstArg`, `.lastArg`, `.thisValue`, `.returnValue`, `.exception`.

## Test Patterns

### Error assertions
Use try/catch in `it()` blocks. Assert `error.name` and `error.code` (not `instanceof`) to avoid module reference mismatches. Use `assertMatches('substring', error.message)` for message substring checks.

```javascript
describe('authenticate() with null input', ({ it, after }) => {
    const testSubject = sinon.spy(auth, 'authenticate');
    after(() => sinon.restore());

    it('throws AuthenticationError', () => {
        try { testSubject(null); } catch { }
        const error = testSubject.firstCall.exception;
        assertEqual('AuthenticationError', error.name);
    });
});
```

### Other patterns
- **Events:** `emitter.once('eventName', (ev) => { capturedEvent = ev })` in before(), assert on capturedEvent
- **Async order:** Push IDs from callbacks into array, assert on contents
- **Streams:** `Readable.from(['chunk'])` for readable; custom Writable + `sinon.spy(mockWriteStream, 'write')` for writable
- **File system mocks:** `{ name: 'file.json', isFile() { return true } }`; `isFile() { return false }` for dirs/symlinks
