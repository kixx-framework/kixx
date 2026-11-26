# Integration Suite

The integration suite checks Kixx code against the real systems under it: Cloudflare Workers with real KV and Durable Objects, and Node.js and Deno hosts. It covers what the unit suite's fakes stand in for: every adapter on its real platform, entry points and Durable Object classes, platform limits, data that must outlast a restart or a deploy, and differences between runtimes.

It is apart from the unit suite. `run-tests.js` at the repository root never collects this directory, and CI doesn't run it. What belongs in each suite is in the Testing Guide, `test/README.md`.

> **Status:** There is no test app yet, and no integration test. Until the first test app arrives, every run ends with `No test files found under …`. The runner, the target helper, and the probe are here, and their unit tests are in `test/test-app/`.

```
test-app/
├── run-tests.js                  # The runner
├── probe/                        # Runs shared suites inside a target
│   ├── probe-handler.js          # In the target: lists and runs a suite's tests
│   ├── probe-client.js           # On the laptop: createProbeClient(), describeProbeSuite()
│   └── probe-suites.js           # The suites the probe can run
└── test/                         # Integration tests (*.test.js)
    └── test-helpers/target.js    # getBaseUrl(), getDeployKey()
```

## Who Runs It

Agents write integration tests. The operator runs them, before each release and after a change to platform-facing code. An agent never runs the suite against a target and never deploys one.

## Running the Suite

The runner starts nothing and deploys nothing. It points the tests at a target that is already up: a test app on this machine, run under Node.js or Deno with production settings, or a deployed one.

It uses the repository's dev dependencies, so run `npm install` once at the repository root. This directory has no `package.json` and no install step of its own.

From the repository root:

```
node test-app/run-tests.js --local             # http://localhost:2026/
node test-app/run-tests.js --cloudflare        # https://kixx-test-app.kixx.workers.dev/
node test-app/run-tests.js --nodejs            # https://nodejs.kixx-testing.dev/
node test-app/run-tests.js --base-url <url>    # any other target
deno run -A test-app/run-tests.js --local      # the same runner on Deno
```

Use one target option, or none and set `INTEGRATION_TESTS_BASE_URL` yourself. The URLs of the named targets are carried over from v6. Each is confirmed when a test app is first deployed to it.

The runner works from any directory, for example `node kixx/test-app/run-tests.js --local` from the directory above the repository. Pathname arguments resolve from where you are.

To run part of the suite, pass pathnames after the options. To leave part out, pass `--skip <path>`, as often as needed. Every pathname must be inside `test-app/test/`.

```
node test-app/run-tests.js --local test-app/test/some-directory
node test-app/run-tests.js --local --skip test-app/test/some-file.test.js
```

- **Each test gets 10 seconds.** That is a ceiling. A block's own `timeout` can't raise it.
- **A selection with no test files fails**, with exit code 1, so an empty suite never reads as a passing one.
- **A bad invocation fails before any test file is imported**, so before any request is made.

## Environment Variables

| Variable | Use |
|---|---|
| `INTEGRATION_TESTS_BASE_URL` | Required. The target's base URL, an absolute `http:` or `https:` URL. A target option sets it. |
| `INTEGRATION_TESTS_TARGET` | Set by the runner to `local`, `cloudflare`, or `nodejs` when a named target is used. Otherwise the runner clears it. |
| `INTEGRATION_TESTS_DEPLOY_KEY` | Optional. The target's deploy key, for tests that call a protected route such as the probe. |

The deploy key is a secret. Set it in the environment only. It has no command-line option, because a secret on the command line leaks into shell history and process listings, and it never goes in a tracked file. The runner never reads it.

Tests read these through `test/test-helpers/target.js`: `getBaseUrl()` returns the base URL without a trailing slash, and `getDeployKey()` returns the key, or `null` when none is set.

## Writing an Integration Test

- Put it in `test-app/test/`, named `*.test.js`. It uses `kixx-test` and `kixx-assert`, like a unit test.
- Drive the target over HTTP, from `getBaseUrl()`.
- Touch only the test app's own resources.
- Take credentials from the environment, never from a tracked file. Never print one, and never put one in an assertion message.

The Testing Guide's rule decides whether a test belongs here: it does if it needs a real platform, a running or deployed app, credentials, or the network.

## The Probe

Some questions can't be asked through a target's public routes. Does the key/value adapter keep its port's contract on real Workers KV? Does `formatDate` give the same strings on this runtime's locale data?

The probe answers them by running a shared conformance suite inside the target, against the bindings and runtime the target really has. They are the same suites the unit suite runs against fakes, so a fake that differs from its platform shows up as a failing test.

The probe has three modules, and none of them imports a package or a platform module:

- `probe/probe-handler.js` is a request handler the test app mounts. Its header comment is the protocol reference.
- `probe/probe-client.js` is what an integration test uses.
- `probe/probe-suites.js` lists the suites: `content-compiler`, `content-store`, `format-date`, `key-value-store`, `logger-writer`, and `server-request`.

### The Protocol

The client asks for a suite's tests, then runs one test per request. One test per request keeps each request inside a Worker's limits.

```
GET <probe URL>?suite=<name>
    200 { suite, tests }

POST <probe URL> { suite, path }
    200 { suite, path, status: 'passed' }
    200 { suite, path, status: 'failed', error: { name, message, code? } }
```

`tests` is a list of paths. A path is the names from the suite's outermost `describe` down to the `it`, as an array of strings. A failed test is still a 200.

Any other answer is `{ error: { name, message } }`: a 400 for a malformed request, a 401 for an unauthorized one, and a 404 for an unknown suite, an unknown path, or a suite the target has no factory for.

A failed test's error carries only its `name`, its `message`, and its `code` when that is a string, each cut to a fixed length. No stack or other property leaves the target.

### Mounting It

No app mounts the probe yet. The first test app does it this way:

```javascript
import { createProbeHandler } from './probe/probe-handler.js';
import { BUILT_IN_FACTORIES, PROBE_SUITES } from './probe/probe-suites.js';

const probeHandler = createProbeHandler({
    suites: PROBE_SUITES,
    factories: { ...BUILT_IN_FACTORIES, ...portFactories },
    authorize,
});
```

- Mount the handler on a route that accepts `GET` and `POST`.
- `authorize(context, request)` must return exactly `true` to let a request through. Anything else, or a throw, is a 401. The handler can't be created without it.
- `factories` maps a suite's name to a function that takes the request's `context` and returns the suite's factory. `BUILT_IN_FACTORIES` covers `content-compiler` and `format-date`. The app supplies one for each port suite, built over its own bindings. A suite with no factory can be listed but not run.

### Using It in a Test

```javascript
import { describe } from 'kixx-test';
import { createProbeClient, describeProbeSuite } from '../probe/probe-client.js';
import { getBaseUrl, getDeployKey } from './test-helpers/target.js';

const client = createProbeClient({
    url: `${ getBaseUrl() }/path/the/probe/is/mounted/at`,
    deployKey: getDeployKey(),
});

// The tests must be known before they can be registered, so list them
// while the file is imported.
const tests = await client.listTests('key-value-store');

describeProbeSuite(describe, { client, suite: 'key-value-store', tests });
```

`describeProbeSuite()` registers one local test for each remote test, so the runner reports each on its own. A remote failure fails the local test with the remote error's name, message, and code.

The client sends the deploy key as a bearer token, to the probe's URL only. It follows no redirect, and no error it throws carries the key. An answer that isn't the probe's is an error named `ProbeRequestError`, never a passed test.

To add a suite, import it in `probe/probe-suites.js` and add it to `PROBE_SUITES`. The rules a suite must follow to run inside a target are in `test/README.md`, under "Shared Conformance Suites".

## Never Run `tools/build-test-app.js`

`tools/build-test-app.js` is a v6 tool and is knowingly broken. It was written to rebuild this directory, and when its checks pass it wipes `test-app/`. Don't run it.
