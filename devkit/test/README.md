# Unit Testing Guide

This project uses two ES module libraries:

- `kixx-test` provides the test runner API: `describe`, `it`, `before`, `after`, `xit`, `xdescribe`, and `MockTracker`. It is installed in `node_modules/` and imported by bare module name.
- `kixx-assert` provides assertion helpers. Assertions throw `AssertionError` on failure. It is vendored in `devkit/lib/vendor/kixx-assert/` and imported by relative path, so tests and source share one `AssertionError`.

The project test runner imports test files first, which register top-level `describe` blocks, then executes the registered tests.

Run the suite from the repository root:

```
node devkit/run-tests.js                                  # full suite on Node.js
node devkit/run-tests.js devkit/test/lib                  # one subtree
node devkit/run-tests.js --skip devkit/test/conformance   # skip a subtree
deno run -A devkit/run-tests.js                           # full suite on Deno
node devkit/run-linter.js devkit                          # lint
```

Pathnames resolve from your working directory and must be inside `devkit/test/`. The runner then changes directory to `devkit/` before importing tests. Install the dev dependencies first with `cd devkit && npm install`.

## File Conventions

- Name test files `*.test.js`, for example `devkit/test/lib/config-loader.test.js`. The runner collects nothing else.
- Mirror the source tree: `devkit/lib/config-loader.js` is tested by `devkit/test/lib/config-loader.test.js`, and `devkit/commands/admin/gen-secure-token.js` by `devkit/test/commands/admin/gen-secure-token.test.js`.
- Shared helpers go in `devkit/test/helpers/` and fixture files in `devkit/test/fixtures/` (not linted).
- Use one top-level `describe` per test file, named after the module, class, or behavior under test.

## Imports

Import `kixx-test` by bare name and `kixx-assert` by relative path to the vendored copy, at the correct depth for the test file:

```javascript
import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
```

Import only the helpers used in that file.

## Basic Structure

```javascript
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';

describe('ModuleName', ({ before, after, it, describe, xit, xdescribe }) => {
    let subject;

    before(() => {
        subject = createSubject();
    });

    after(() => {
        subject.close();
    });

    it('returns the configured value', () => {
        assertEqual('expected', subject.getValue());
    });

    xit('temporarily skipped behavior', () => {
        assertEqual('expected', subject.getOtherValue());
    });

    describe('nested behavior group', ({ before, it }) => {
        let nestedSubject;

        before(() => {
            nestedSubject = createSubject({ enabled: true });
        });

        it('handles the enabled state', () => {
            assert(nestedSubject.isEnabled());
        });
    });

    xdescribe('disabled behavior group', ({ it }) => {
        it('does not run tests in this group', () => {
            assert(false);
        });
    });
});
```

Destructure only the helpers you use. Nested `describe` blocks are useful for grouping related behavior and setup.

## Setup Patterns

Prefer small file-local helpers over shared global fixtures:

- `makeSubject()` for the class or function under test.
- `makeContext()`, `makeRequest()`, `makeResponse()`, or `makeLogger()` for plain test doubles.
- `catchError()` and `catchAsyncError()` helpers when many tests assert thrown errors.

Use `before` when a group intentionally exercises one setup/action/result across several focused `it` blocks. Otherwise, keep setup inside the `it` so the test can be read in isolation.

## Conformance Tests Against Repo `lib/`

Nothing under `devkit/` may import from outside `devkit/`, because the package is published stand-alone. Tests in `devkit/test/conformance/` are the one exception: they may import the repository's `lib/` modules, read-only, to prove devkit agrees with the application on wire formats and file dialects (for example `conformance/parse-jsonc.test.js` parses `lib/cloudflare-config.jsonc` with both parsers).

- Never write into `lib/`. Use an overlay or in-memory `fileSystem` when a test needs a generated file.
- Compare devkit's result with lib's result rather than restating lib's rules in the test.
- `test/` is excluded from both published packages, so these imports never ship.

## Hook Semantics

- `before(fn, opts?)` runs once before tests and child suites in its enclosing `describe`.
- `after(fn, opts?)` runs once after tests and child suites in its enclosing `describe`.
- There is no `beforeEach` or `afterEach`.
- If a `before` hook fails, tests and child suites in that `describe` are skipped, but `after` hooks for that `describe` still run.
- Hooks in a disabled suite are registered, but their runnable blocks are disabled and do not execute.

Prefer local setup inside each `it` for mutable state. Use `before` for expensive setup or shared fixtures that will not be mutated in a way that makes tests order-dependent.

## Test Functions and Timeouts

Tests and hooks can be synchronous, promise-returning, `async`, or callback-style:

```javascript
it('computes a value', () => {
    assertEqual(42, computeValue());
});

it('fetches data', async () => {
    const result = await fetchData();
    assertEqual('ok', result.status);
});

it('calls back', (done) => {
    setTimeout(() => {
        try {
            assertEqual(true, isReady());
            done();
        } catch (error) {
            done(error);
        }
    }, 10);
}, { timeout: 100 });
```

The default timeout is 1000ms per runnable block. Pass `{ timeout: ms }` to `it`, `before`, `after`, `describe`, or `xdescribe` to override it for that block or suite. A timeout passed to `describe` becomes the default for runnable blocks registered inside it unless those blocks provide their own timeout.

Callback-style tests are detected by function arity. If the test function accepts one or more parameters, the runner treats it as callback-style and waits for `done()`.

## Skipping Tests

```javascript
xit('temporarily skipped test', () => {
    assert(false);
});

xdescribe('entire skipped suite', ({ it }) => {
    it('is also skipped', () => {
        assert(false);
    });
});

describe('disabled suite', ({ it }) => {
    it('is skipped because the suite is disabled', () => {
        assert(false);
    });
}, { disabled: true });

describe('placeholder suite');
```

A test or suite declared with only a name is disabled. Disabled tests are reported in the final disabled test count, not the executed test count.

## Assertions

All assertion helpers throw `AssertionError` on failure. A message string can be passed as the last argument.

| Assertion | Description |
|---|---|
| `assert(value)` | Truthy check |
| `assertFalsy(value)` | Falsy check |
| `assertEqual(expected, actual)` | Equality using `isEqual`; supports `NaN` and valid `Date` comparison |
| `assertNotEqual(expected, actual)` | Inverse of `assertEqual` |
| `assertMatches(matcher, actual)` | Match by RegExp, equality, string `includes`, or Date ISO string |
| `assertNotMatches(matcher, actual)` | Inverse of `assertMatches` |
| `assertDefined(value)` | Not `undefined` |
| `assertUndefined(value)` | Is `undefined` |
| `assertNonEmptyString(value)` | Non-empty string |
| `assertNumberNotNaN(value)` | Number or BigInt and not `NaN` |
| `assertArray(value)` | Is an array |
| `assertBoolean(value)` | Is a boolean |
| `assertFunction(value)` | Is a function |
| `assertValidDate(value)` | Is a valid `Date` instance |
| `assertRegExp(value)` | Is a `RegExp` instance |
| `assertGreaterThan(control, subject)` | `subject > control` |
| `assertLessThan(control, subject)` | `subject < control` |

Two-argument assertions are curried when called with only the expected/control value:

```javascript
const assertOk = assertEqual('ok');
assertOk(result.status);

const assertShortDate = assertMatches(/^\d{4}-\d{2}-\d{2}$/);
assertShortDate(dateString);
```

## Mocking With MockTracker

Use `MockTracker` to create standalone mock functions or replace object methods/getters/setters.

```javascript
import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertUndefined } from '../../lib/vendor/kixx-assert/mod.js';

describe('Service', ({ before, after, it }) => {
    const tracker = new MockTracker();
    const calculator = {
        multiply(a, b) {
            return a * b;
        },
    };
    let add;

    before(() => {
        add = tracker.fn((a, b) => a + b);
        tracker.method(calculator, 'multiply', (a, b) => a * b * 10);
    });

    after(() => {
        tracker.reset();
    });

    it('records function calls', () => {
        assertEqual(7, add(3, 4));
        assertEqual(1, add.mock.callCount());
        assertEqual(3, add.mock.getCall(0).arguments[0]);
        assertEqual(7, add.mock.getCall(0).result);
        assertUndefined(add.mock.getCall(0).error);
    });

    it('mocks object methods', () => {
        assertEqual(120, calculator.multiply(3, 4));
        assertEqual(1, calculator.multiply.mock.callCount());
        assertUndefined(calculator.multiply.mock.getCall(0).error);
    });
});
```

For simple interaction tests, create a `MockTracker` inside the `it` and call
`tracker.reset()` before the test returns. Prefer mocking methods on fresh local
objects. When a tracker or mocked object is shared by several tests, create it
in the `describe` and reset it in `after`.

Never mock a method on a global such as `process.stdout` or `globalThis.fetch`
when the code under test offers a seam to inject the dependency instead. A test
which fails throws before `tracker.reset()` runs, leaving the replacement
installed for every test that follows, and for the test runner itself. Inject a
stand-in and read what the subject wrote:

```javascript
import captureOutput from '../../helpers/capture-output.js';

const output = captureOutput();
const command = new SomeCommand({ output });

await command.run({ environment: 'production' });

assertMatches('Release: release-id', output.chunks[0]);
```

Helpers live in `devkit/test/helpers/`. The runner imports only `*.test.js`
files, so a helper module is never collected as a suite.

- `capture-output.js`: an `output` stream that records writes.
- `memory-file-system.js`: an in-memory text file system.
- `fake-cloudflare-client.js`: a recording Cloudflare client for
  `create-worker-version`; any endpoint outside its allowed set throws, and
  `forbiddenCalls()` reports it.

Fixtures: `lib-cloudflare-config.jsonc` (a copy of repo `lib/`'s config) and
`worker-project/` (a minimal project; copy it to a temp directory before
writing into it).

Useful mock APIs:

- `tracker.fn(original?, implementation?, options?)` creates a mock function.
- `tracker.method(object, propertyName, implementation?, options?)` replaces a method.
- `options.times` auto-restores after that many calls.
- `mockFn.mock.callCount()` returns the number of calls.
- `mockFn.mock.getCall(index)` returns frozen call data: `arguments`, `result`, `error`, `this`, and `target`.
- `mockFn.mock.mockImplementation(fn)` replaces future behavior.
- `mockFn.mock.mockImplementationOnce(fn, onCall?)` overrides one call.
- `mockFn.mock.resetCalls()` clears call history and one-time implementations.
- `tracker.restoreAll()` restores managed mocks but keeps them associated with the tracker.
- `tracker.reset()` restores all mocks and clears the tracker.

## Error and Rejection Tests

When testing thrown errors, catch and assert on stable fields. Prefer `error.name`, `error.code`, and `error.message` over `instanceof`, because vendored or duplicated modules can create different constructor identities.

For repeated error tests, define small file-local helpers:

```javascript
function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
```

Then keep each assertion focused on the stable contract:

```javascript
it('throws on invalid input', () => {
    const caught = catchError(() => subject.process(null));

    assert(caught, 'expected an error to be thrown');
    assertEqual('TypeError', caught.name);
    assertMatches('Expected non-null', caught.message);
});
```

For async rejection cases:

```javascript
it('rejects on failure', async () => {
    const caught = await catchAsyncError(() => subject.fetch('bad-id'));

    assert(caught, 'expected an error to be thrown');
    assertEqual('NotFoundError', caught.name);
});
```

## Writing Good Tests

- Name each `it` as a behavior statement, for example `'returns null when input is empty'`.
- Keep each `it` focused on one behavior.
- Avoid relying on test order. The runner executes tests sequentially in registration order, but tests should still be understandable in isolation. Test files are loaded in a deterministic order so that a failure reproduces identically on another machine and in CI. That guarantee exists for debugging, and is not permission to let one test file depend on another having run first.
- Prefer local setup in `it` blocks for mutable state.
- Use file-local factories to keep required context explicit without repeating large object literals.
- Assert observable behavior: return values, thrown errors, emitted output, state changes, or calls made through mocks.
- Use `MockTracker` for interaction tests, and reset shared trackers in `after`.
- Keep disabled tests temporary and intentional; disabled tests are visible in runner output.
