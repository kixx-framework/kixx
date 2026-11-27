# Testing Guide

Kixx has two test suites: a unit suite and an integration suite. This guide says what belongs in each and how to write tests for both. Most of it is about the unit suite. How to run the integration suite is in `test-app/README.md`.

Both suites use two ES module libraries installed in the repository root's `node_modules/` and imported by bare module name:

- `kixx-test` provides the test runner API: `describe`, `it`, `before`, `after`, `xit`, `xdescribe`, and `MockTracker`.
- `kixx-assert` provides assertion helpers. Assertions throw `AssertionError` on failure.

Each runner imports test files first, which register top-level `describe` blocks, then executes the registered tests.

## The Two Suites

| | Unit suite | Integration suite |
|---|---|---|
| Checks | Kixx code only. Every platform service under it is replaced by a fake. | Kixx code working with the real systems under it: Cloudflare, and Node.js and Deno hosts. |
| Lives in | `test/` | `test-app/test/` |
| Runs with | `run-tests.js` | `test-app/run-tests.js`, pointed at a test app that is already running or deployed |
| Needs | Node.js or Deno, git, and the dev dependencies. No network, credentials, account, emulator (wrangler, miniflare, workerd), container, or database server. | A running or deployed test app, and credentials for a deployed one. |
| Takes | Seconds | Minutes |
| Runs | On every change, in CI, and by agents | Before each release and after a change to platform-facing code. Agents write its tests. The operator runs them. |

`run-tests.js` never collects `test-app/`, and CI doesn't run the integration suite.

**Where does a new test belong?** If it needs a real platform, a running or deployed app, credentials, or the network, it belongs in the integration suite. Everything else belongs in the unit suite, with each platform service replaced by a fake.

- A rule Kixx code enforces belongs in the unit suite, even in a platform adapter. That a Cloudflare adapter rejects a key that is too long is the adapter's own check, so its test runs against a fake and goes beside the adapter's other tests, under `test/kixx/adapters/cloudflare/`. When every adapter of a port must keep the same rule, the test goes in the port's conformance suite instead (see "Shared Conformance Suites").
- What only the platform can answer belongs in the integration suite: a limit Cloudflare enforces, data that must outlast a restart or a redeploy, a cache window, an entry point or a Durable Object class loading, or a difference between runtimes.

A unit test never tests the platform. It makes no request off the machine.

A test that runs git builds its repository in a temporary directory, isolates git from the user's and the system's configuration, and makes no commit or remote call. `test/kixx/code-fingerprint/git-tree.test.js` is the example.

## Running the Unit Suite

Install the dev dependencies once with `npm install` at the repository root. Then, from the repository root:

```
node run-tests.js                    # full suite on Node.js
deno run -A run-tests.js             # full suite on Deno
node run-tests.js test/kixx/logger   # a subtree or file
node run-tests.js --skip test/kixx   # skip a subtree
```

Pathnames resolve from your working directory and must be inside `test/`. The runner then changes directory to the repository root before importing tests, and exits 1 when the selection holds no test files.

## File Conventions

- Put unit tests under `test/`, mirroring the source tree: `kixx/logger/logger.js` is tested by `test/kixx/logger/logger.test.js`, adapters by `test/kixx/adapters/<platform>/<name>/…`, and plugins (once they exist) by `test/plugins/<name>/…`.
- Unit tests for code under `test-app/` (the integration runner and the probe) live in `test/test-app/`, mirroring that tree: `test-app/probe/probe-handler.js` is tested by `test/test-app/probe/probe-handler.test.js`. They are unit tests. They run with `run-tests.js` and never contact a target.
- Unit tests for the scripts' shared code in `tools/lib/` live in `test/tools/`: `tools/lib/assemble-project.js` is tested by `test/tools/assemble-project.test.js`. A test that assembles a project builds it in a temporary directory, removes it afterwards, and shares one assembly among the tests of a `describe`.
- Integration tests live in `test-app/test/`.
- Fakes of platform services live in `test/fakes/` (see "Fakes").
- Name test files with the project convention `*.test.js`.
- `test/fixtures/project/` is a small Kixx project: core, two tiny plugins, an app, entry points, and committed generated registries. `test/fixtures/project.test.js` checks that the committed files are what the generator writes, and boots the project from its registries on the Node.js adapters and on the Cloudflare adapters against fakes. `test/fixtures/project-pages.test.js` boots it to render pages: from a published Release, and from the working tree in development. Both boot it with `test/fixtures/fixture-project-boot.js`. Its rules are in `test/fixtures/project/README.md`:
  - A fixture directory holds no `*.test.js` file: the runner would collect it. Its tests sit beside it.
  - Its generated files are never edited. Regenerate them after changing a manifest.
  - A unit test imports its registries, `virtual-hosts.js`, and `app/app.js`. It never imports an entry point or the Durable Object registry.
- `test/skeleton/` tests the project skeleton (`devkit/templates/project/`) as a project. `test/skeleton/core-only-project.test.js` assembles the skeleton and core into a temporary directory, once for the file, and boots that project with no plugins: on the Node.js adapters in development and in production, and as a Worker against fakes. It publishes over HTTP with `test-app/test/test-helpers/publish.js`, the helper the integration suite uses. `test/skeleton/assembled-project-boot.js` assembles, loads, and boots:
  - It loads every module of a boot from the assembled project with a dynamic `import()`, the project's own copy of core included. Never mix in a core module imported from this repository: two copies of a class don't share identity.
  - It never loads an entry point or the Durable Object registry.
  - It captures the project's log lines, because the skeleton's config logs at `DEBUG` and `INFO`.
- Build any other fixture in a temporary directory (`fsp.mkdtemp`) and remove it afterwards, or resolve it from `import.meta.url`. Never read files through the working directory or from `reference-app/`.
- `test-v6/` holds v6 tests that are not run. When you change, move, or keep a module, bring its tests back from `test-v6/` with `git mv` (never copy), fix their imports, and make them pass.
- The integration runner lives in `test-app/`. The v6 integration suites wait in `test-v6/test-app/`, and are not run, until they are rewritten for v7.
- Use one top-level `describe` per test file, named after the module, class, or behavior under test.

## Imports

Import directly from the modules using their bare module names:

```javascript
import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
```

Import only the helpers used in that file.

A shared conformance suite is the exception. It imports its assertions by relative path, from `kixx/assertions/mod.js`, because it also runs inside a server (see "Shared Conformance Suites").

## Basic Structure

```javascript
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

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

The file-local rule has two exceptions, each with its own section below: fakes of platform services, and shared conformance suites.

## Dependency Injection

A module gets every platform service it uses from its caller: bindings, storage and database handles, `fetch`, clocks, and output sinks. It never reaches for one itself. Adapters take the platform's objects, and everything above the adapters takes adapters.

This is what lets a unit test hand the module a fake:

- A module that needs Workers KV takes the KV binding. An adapter reads it from the `context` it is passed (`context.env`). Its test passes `createFakeKVNamespace()` from `test/fakes/workers-kv.js`.
- A module that needs the current time takes a clock: a function that returns milliseconds, with `() => Date.now()` as its default. Its test passes a clock it controls.
- A module that writes output takes its sink. The logger writers do: `new LoggerWriter({ console })` on Cloudflare, and `new LoggerWriter({ stdout, stderr })` on Node.js. With no argument they write to the global console or the process streams, looked up on each write. Their tests pass a sink that records each line.
- A class that runs inside a Durable Object takes the object's `ctx`. Its test passes `createFakeDurableObjectState()` (see "Thin Shells").

A test that needs time to pass moves a clock. It never waits:

```javascript
let now = Date.now();
const kvStore = createFakeKVNamespace({ now: () => now });

// KV allows one write per second to a key. Move the clock on a second.
now += 1000;
```

Don't patch a global in a test when the module can take the service as an argument. The exception is a test that pins a default: one test per logger writer spies on the global to prove that a writer given no sink still writes there.

Some older modules still read `Date.now()` directly, and their tests mock it with `MockTracker`. New code takes a clock.

## Thin Shells

Some code loads only on its platform. A Durable Object class must import `cloudflare:workers`, which exists only on Cloudflare, so no unit test can import it. Keep that code too thin to need one:

- A Durable Object class is a shell. It imports `cloudflare:workers`, passes `ctx` and `env` to a plain class that holds all the behavior, and delegates each RPC method to it in one line. It does nothing else.
- An entry point is just as thin.
- Unit tests never import a shell, an entry point, or a `cloudflare:*` module. They test the plain class, against fakes. The integration suite covers the shells and the entry points.

The working example is `ContentAddressableIndexStore`, in `kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store.js`:

```javascript
import { DurableObject } from 'cloudflare:workers';
import ContentAddressableIndexStoreCore from './content-addressable-index-store-core.js';

export default class ContentAddressableIndexStore extends DurableObject {

    #core;

    constructor(ctx, env) {
        super(ctx, env);
        this.#core = new ContentAddressableIndexStoreCore({ ctx, env });
    }

    getBuild(buildId) {
        return this.#core.getBuild(buildId);
    }

    // ...and one line for each other RPC method.
}
```

The plain class, `ContentAddressableIndexStoreCore`, is in `content-addressable-index-store-core.js` beside it. It keeps the promise from `ctx.blockConcurrencyWhile()` as `ready`, so a test can wait for the constructor's setup:

```javascript
const state = createFakeDurableObjectState();
const core = new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
await core.ready;
```

To test code that calls a Durable Object, give it a fake namespace over the plain class:

```javascript
const namespace = createFakeDurableObjectNamespace((state) => {
    return new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
});
```

Its stubs behave like RPC. Arguments and results are copied, and an error the object throws reaches the caller as a new `Error` with `remote: true`.

When you add a Durable Object class, list its file in `DURABLE_OBJECT_SHELLS` in `test/kixx/import-hygiene.test.js`. That test fails until you do (see "Import Hygiene Rules").

## Fakes

A fake stands in for a platform service in unit tests. Fakes live in `test/fakes/`, each with its own `*.test.js` beside it. They are shared on purpose: every test of code that uses a service must meet the same platform rules.

| Module | Factory | Stands in for |
|---|---|---|
| `test/fakes/workers-kv.js` | `createFakeKVNamespace({ initial, now })` | A Workers KV namespace binding. It keeps a log of calls in `calls`. |
| `test/fakes/durable-object-storage.js` | `createFakeDurableObjectStorage({ path })` | SQLite-backed Durable Object storage (`ctx.storage`), built on `node:sqlite`. |
| `test/fakes/durable-object.js` | `createFakeDurableObjectState({ storage })` and `createFakeDurableObjectNamespace(createObject)` | A Durable Object's `ctx`, and a namespace binding whose stubs behave like RPC. |

Read a fake's header before you use it. It says what the fake models and what it doesn't. Fakes for D1 and R2 arrive with their first users.

A fake doesn't script failures. To test how a client handles a retryable error, an overloaded object, or a call that never settles, write a small stub in the test file.

### Writing a Fake

Add a fake for a new platform service as `test/fakes/<service>.js`, with `test/fakes/<service>.test.js` beside it.

- **Model the documented behavior and limits.** Work from the platform's documentation. A fake may be built on what the runtime provides, as the storage fake is built on `node:sqlite`. It must pass on Node.js and Deno.
- **Be at least as strict as the platform.** Where the documentation is silent or disagrees with itself, take the stricter reading. A fake never quietly accepts what the platform rejects.
- **Leave out what you don't model.** A method that is missing already throws a `TypeError` when called. Don't write stubs that throw.
- **Take a clock when time matters**, as an option such as `now`, so that no test waits.
- **Export factory functions**, named `createFake…`.
- **Test both sides of every limit** in the fake's own test file.
- **Only test code imports a fake.** Nothing under `kixx/` or `test-app/probe/` does.

The header comment of a fake must:

- name the platform service it stands in for, and say why the module is shared;
- list what it models, with the number for each limit;
- list where it is stricter than the platform, and why;
- list what it doesn't model;
- give the URLs of the platform documentation it was written from, and the date they were checked;
- say that when a run on the platform shows the fake differs from it, the fake is fixed and the difference pinned with a unit test.

`test/fakes/workers-kv.js` is the header to copy.

### When a Fake Is Wrong

A fake can drift from its platform, and only the integration suite can show it. When a run shows a difference, fix the fake and add a unit test that pins the difference. Never loosen a fake, or edit a suite's assertions, to make a failing test pass.

One difference is known. The storage fake limits a row, string, or BLOB to 2 MB. Cloudflare's limits page says 8 MB, while its architecture guidance, and D1's limits, say 2 MB. The fake keeps the stricter number until the real limit is measured on Cloudflare. Code that passes at 2 MB also passes at 8 MB.

## Shared Conformance Suites

When a single interface has several implementations that must behave identically, the contract tests belong in one shared suite that every implementation runs, rather than being copied per implementation.

Every port has one, and both of its adapters run it:

| Port | Suite |
|---|---|
| Content source | `test/kixx/content-compiler/content-source-conformance.js` |
| Content store | `test/kixx/content-addressable-store/content-store-conformance.js` |
| Key/value store | `test/kixx/key-value-store/key-value-store-conformance.js` |
| Logger writer | `test/kixx/logger/logger-writer-conformance.js` |
| Server request | `test/kixx/http-router/server-request-conformance.js` |

The content source is the one port whose implementations aren't a Node.js and a Cloudflare adapter: they are the in-memory source in core (`kixx/content-compiler/memory-content-source.js`) and the Node.js adapter.

Two golden suites have the same form. Neither is a port:

- `test/kixx/hyperview/helpers/format-date-goldens.js` holds the `formatDate` strings that depend on the runtime's locale and time zone data.
- `test/kixx/content-compiler/content-compiler-goldens.js` holds the object ids, sizes, and Release manifest the content compiler must produce for one fixed project. The ids are persisted in every published Release, so they must be the same on every runtime.

Write a shared suite this way:

- Name the file so the runner does not collect it. The runner only executes `*.test.js`, so a suite named `<subject>-conformance.js` runs only when a test file imports it. Mirror the source tree with the interface it covers.
- Export, as the default, a function taking the enclosing `describe` handle and a factory: `serverRequestConformance(describe, makeServerRequest)`. Call it from inside the implementation's top-level `describe` callback. kixx-test reports the full block path, so the enclosing block name identifies which implementation failed.
- Define a factory options shape and let each implementation's factory absorb its own construction differences, so the suite never encodes one platform's shape.
- Cover only shared behavior. Anything one implementation derives for itself stays in that implementation's own test file: what an adapter hands to its backing store, where a log line goes, and the wording of an error message.

This exception applies to one contract with several implementations. It is not a licence for shared fixtures generally: two test files that merely happen to build a similar object still prefer their own local helpers.

### Suites That Also Run on a Real Platform

These suites run twice. The unit suite runs them against each adapter over fakes. The integration suite runs them inside a running server, against that server's real bindings, through the probe in `test-app/probe/`. The probe lists a suite's tests, then runs one test per request.

So a suite must also work where storage outlives the test and every call is a network request:

- Export `suite(describe, factory)`. Never call `describe` when the module is imported.
- Import by relative path only, with assertions from `kixx/assertions/mod.js`. Never import `kixx-test`, `kixx-assert`, a `node:*` module, or a `cloudflare:*` module. The suite is bundled into the server.
- Register tests with `describe(name, fn)` and `it(name, fn)` only. The probe has no hooks, `xit`, `xdescribe`, block options, or callback-style tests. A suite that uses one fails when the probe collects it.
- Call the factory inside each `it`, never while registering tests. Each test runs in its own request, so tests share no state. The probe also lists tests with a factory that throws.
- Build every key from a value unique to the test, such as `crypto.randomUUID()`, wherever storage persists.
- Never wait for an expiry to pass.
- Never write one key twice within a second, or read, delete, or rewrite a key just written, unless the factory's `afterWrite()` hook runs in between. Workers KV allows one write per second to a key. `afterWrite()` hides the difference between stores: over the KV fake it moves the clock on a second, over the Node.js adapter it does nothing, and over real KV it waits the second out. One exception: the content store suite uploads one hash twice on purpose, with no hook, because that adapter absorbs KV's write rate. The rule holds for every other suite.
- Keep each test to a few storage calls, under about 20. A Worker limits the calls one request can make.
- Never patch a global. Inside a live server that would change the server, for example by swallowing its logs.
- Never put a secret in an assertion message.

To let the integration suite run a suite, import it in `test-app/probe/probe-suites.js` and add it to `PROBE_SUITES`. The unit tests in `test/test-app/probe/probe-client.test.js` then list it through the probe, which fails if it breaks a registration rule above.

## Import Hygiene Rules

`test/kixx/import-hygiene.test.js` reads the static imports of the maintained code and enforces where each kind may appear. Its import walker (`extractSpecifiers()` and `readImportGraph()`) is in `tools/lib/import-graph.js`, shared with the project assembly:

- **Core's layers.** Every relative import in `kixx/` stays inside `kixx/` and resolves. `node:*` modules appear only under `kixx/adapters/`, and core imports no package by bare name. No core module outside `kixx/adapters/` imports an adapter: adapters are reached through generated registries and entry points. A module that is leaving core is imported from the rest of core only through the edges in `KNOWN_EDGES`.
- **Core's contents (CORE-1).** The top level of `kixx/` holds exactly the modules CORE-1 names, the operator-approved additions, and the modules leaving core. A new directory or file there fails until it is listed.
- **The content compiler and the tooling entry.** Nothing reachable from `kixx/content-compiler/mod.js` or `kixx/tooling/mod.js` imports a `node:*` or `cloudflare:*` module or a package, or is a file under `kixx/adapters/`. That is what lets the compiler run in a command line tool, a server, and a Worker. The rules above imply it. This one follows the imports and prints the chain of files that leads to a break. The entries are listed in `PLATFORM_NEUTRAL_ENTRIES`.
- **The Durable Object shells.** The core files that import a `cloudflare:*` module are exactly the files in `DURABLE_OBJECT_SHELLS`. Each of them imports only `cloudflare:workers` and relative modules. Core's manifest (`kixx/plugin.json`) declares exactly the same files under `cloudflare.durableObjects`.
- **What a unit test may reach.** Nothing that a file under `test/` imports, directly or through other modules, is a shell, imports a `cloudflare:*` module, or is one of the `CLOUDFLARE_ONLY_MODULES`. A failure prints the chain of files that leads there. No `*.test.js` file reaches an entry point in `ENTRY_POINTS`.
- **The fixture project.** Each of its entry points imports exactly the modules a thin shell may (`FIXTURE_ENTRY_POINT_IMPORTS`). Nothing its Cloudflare registry reaches imports a `node:*` module, and nothing its `routes.generated.js` or `virtual-hosts.js` reaches imports a `node:*` or `cloudflare:*` module.
- **The project skeleton** (`devkit/templates/project/`). Each of its entry points imports exactly the modules a thin shell may (`SKELETON_ENTRY_POINT_IMPORTS`). Every import of `./kixx/` names a module core has. It holds no generated file and no `kixx/` directory.
- **App and plugin code (CORE-5).** Nothing that the skeleton's `app/` files, its `virtual-hosts.js`, or a first-party plugin's files outside its `adapters/` import, directly or through other modules, is a `node:*` or `cloudflare:*` module or a core adapter. A plugin is covered as soon as its directory under `plugins/` has a `plugin.json`. Nothing enforces the rule inside a project.
- **What the probe may reach.** Everything reachable from `test-app/probe/` imports by relative path only: the probe, the suites it registers, and the core modules under them. Nothing under `test-app/` imports a `cloudflare:*` module.

Its lists are constants at the top of the file:

- `DURABLE_OBJECT_SHELLS`: add the file of a new Durable Object class, and remove a deleted one. An entry that no longer imports a `cloudflare:*` module fails too. Declare the class in core's manifest in the same change.
- `CLOUDFLARE_ONLY_MODULES`: the files that only Cloudflare can load: a project's Cloudflare entry point and its Durable Object registry, for the fixture and the skeleton. The walk from unit tests starts at none of them and doesn't read past one. Add both files of a new fixture or test project. An entry that imports no `cloudflare:*` module and no shell is stale and fails.
- `ENTRY_POINTS`: the entry points of the fixture and the skeleton. Add both of a new project's, and give each its allowed import list in `FIXTURE_ENTRY_POINT_IMPORTS` or `SKELETON_ENTRY_POINT_IMPORTS`.
- `PLATFORM_NEUTRAL_ENTRIES`: add the entry module of core code that must load on every runtime.
- `CORE_1_MODULES` and `APPROVED_CORE_ADDITIONS`: with `LEAVING_CORE`, exactly what the top level of `kixx/` holds (CORE-1). A new top-level module needs the operator's approval and an entry in `APPROVED_CORE_ADDITIONS` with its reason.
- `LEAVING_CORE` and `KNOWN_EDGES`: delete an entry when its module or edge is gone. The rule "lists no module or edge that is already gone" fails until you do.

The rules follow static `import` and `export … from` statements. A dynamic `import()` isn't followed.

To watch a rule fail, run the file alone: `node run-tests.js test/kixx/import-hygiene.test.js`. A test file that imports a shell can't load, so a full run stops at that import before the rule can report it.

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

Use `MockTracker` to create standalone mock functions or replace object methods/getters/setters. Don't use it to replace a global that the module could take as an argument instead (see "Dependency Injection").

```javascript
import { describe, MockTracker } from 'kixx-test';
import { assertEqual, assertUndefined } from 'kixx-assert';

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
