# Integration Suite

The integration suite checks Kixx code against the real systems under it: Cloudflare Workers with real KV and Durable Objects, and Node.js and Deno hosts. It covers what the unit suite's fakes stand in for: every adapter on its real platform, entry points and Durable Object classes, platform limits, data that must outlast a restart or a deploy, and differences between runtimes.

It is apart from the unit suite. `run-tests.js` at the repository root never collects this directory. CI runs it in a job of its own, against a test app started on the runner. What belongs in each suite is in the Testing Guide, `test/README.md`.

> **Status:** The first integration tests exist: the test app is up with production settings (`test/all-targets/boot.test.js`), and all six probe suites run inside it (`test/probe/`). They run against the local target, on Node.js and on Deno, in CI and with `run-local.js`. No test app is deployed yet, so the `cloudflare` and `nodejs` targets have never been run. The unit suite boots the built test app on the Node.js adapters and as a Worker against fakes (`test/skeleton/test-app.test.js`), and the unit tests of the runner, `run-local.js`'s logic, the helpers, the probe, and the plugin are in `test/test-app/`.

```
test-app/
├── run-tests.js                  # The runner
├── run-local.js                  # Builds and starts the test app here, runs the suite, stops it
├── lib/
│   ├── local-target.js           # run-local.js's logic
│   └── server-process.js         # Starts, watches, and stops a server process
├── integration-probe/            # The test app's one plugin: mounts the probe (test only)
├── cloudflare-config.jsonc       # The test app's Cloudflare config
├── build/                        # The built test app (git-ignored)
├── probe/                        # Runs shared suites inside a target
│   ├── probe-handler.js          # In the target: lists and runs a suite's tests
│   ├── probe-client.js           # On the laptop: createProbeClient(), describeProbeSuite()
│   └── probe-suites.js           # The suites the probe can run
└── test/                         # Integration tests (*.test.js)
    ├── all-targets/              # Tests that run on every target
    ├── probe/                    # One file per probe suite; they run on every target
    └── test-helpers/
        ├── target.js             # getBaseUrl(), getDeployKey(), getTarget(), describeOnTarget(), fetchWithDeployKey()
        └── publish.js            # publishContent(): a publish over HTTP
```

## The Test App

The test app is a real Kixx project: the project skeleton (`devkit/templates/project/`), core, and one test-only plugin, `integration-probe`. Build it from the repository root:

```
node tools/build-test-app.js
```

It writes `test-app/build/`, replacing what it built before. The directory is git-ignored, never linted, and never read by the unit suite. Building runs nothing and contacts nothing.

- **Every skeleton file is the skeleton's, byte for byte**, except `cloudflare-config.jsonc`, which is replaced by `test-app/cloudflare-config.jsonc`: the test app's Cloudflare resources are its own. Its namespace ids are placeholders until the test app is provisioned.
- **The plugin is installed the way any plugin is.** `test-app/integration-probe/` is copied to `plugins/integration-probe/`, and the generator wires its routes and lifecycle modules through the registries. The source sits two levels below the repository root, as a plugin sits two levels below a project root, so its imports (`../../kixx/…`, `../../test-app/probe/…`) are the same in both places.
- **What the plugin imports comes along.** The probe and the conformance suites it runs are copied to the same paths they have here (`test-app/probe/`, `test/kixx/…`), so the project root holds everything a Worker bundle needs.

The plugin mounts two routes at `/integration-probe`, both behind the deploy key:

| Route | Answers |
|---|---|
| `GET` or `POST /integration-probe/probe` | The probe (see "The Probe"), with all six suites. |
| `GET /integration-probe/environment` | `{ target, environment, buildId }`. `target` is `node` (Node.js and Deno) or `cloudflare`. |

Its `routes.js` is platform-neutral. Each target's lifecycle module (`adapters/node/plugin.js`, `adapters/cloudflare/plugin.js`) registers the `IntegrationProbe` service, which holds the target's name and a factory for each port suite, built over that target's own adapters and bindings:

| Suite | On Node.js and Deno | On Cloudflare |
|---|---|---|
| `key-value-store` | The app's own store. No wait after a write. | The app's own store and namespace. Waits 1,100 ms after a write: Workers KV takes one write a second to a key. |
| `content-store` | A new store for each test, in its own directory under `<data directory>/integration-probe/content-store/`. | A new store for each test over the app's own bindings, with a wire format of its own (`probe-<random id>`). |
| `logger-writer` | The adapter over a sink the test reads back, never a process stream. | The adapter over a sink the test reads back, never the console. |
| `server-request` | The adapter over a stand-in for `http.IncomingMessage`. | The adapter over a `Request`. |

**What a Cloudflare probe run leaves behind.** The content store has no delete. Each content store test's wire format names one Durable Object instance and a few KV keys that nothing else shares, and they stay after the test. Nothing here cleans them up. The operator clears them by deleting and re-creating the test app's namespaces when it matters. On Node.js and Deno each test leaves one directory under the data directory.

To add a test route, add it to `test-app/integration-probe/routes.js`. A route that needs a platform service takes it from the `IntegrationProbe` service, never from an import.

## Who Runs It

- **Agents** write integration tests. An agent never runs `run-local.js` or `run-tests.js`, and never deploys a target. It pushes, then reads the CI job.
- **CI** runs the suite against the local target on every push: the `integration-local` job, once on Node.js and once on Deno.
- **The operator** runs it against the local target on a laptop, and against the deployed targets before each release and after a change to platform-facing code.

## Running the Suite Locally

One command builds the test app, starts it on this machine, runs the suite against it, and stops it. From the repository root, after `npm install`:

```
node test-app/run-local.js           # a Node.js server, tested from Node.js
deno run -A test-app/run-local.js    # a Deno server, tested from Deno
```

It does this, in order:

1. Stops at once if anything already answers at `http://localhost:2026/`.
2. Builds the test app into `test-app/build/`.
3. Makes a temporary data directory and a deploy key for this run.
4. Starts `test-app/build/node-server.js --environment production --port 2026` with the runtime it runs on, and waits up to 15 seconds for it to answer.
5. Runs `run-tests.js --local` with the same runtime. Arguments after the script's name go to the runner, so `--skip` and pathnames work (see "Running the Suite Against a Target").
6. Sends the server `SIGTERM` and waits for it to exit.

Its exit code is the runner's, or 1 when the server didn't start or didn't exit with code 0.

It sets these in the server's environment, and nothing else. Variables named `INTEGRATION_TESTS_*` in your shell are not passed to the server.

| Variable | Value |
|---|---|
| `DEPLOY_KEY_HASH` | The hash of the run's deploy key. |
| `BUILD_ID` | `integration-<time>`. |
| `TRUST_PROXY` | `true`, so a test can name its own client address in `X-Forwarded-For`. |
| `DATA_DIRECTORY` | The temporary data directory. The stores and the server's log (`server.log`) are in it. |

The runner gets the key as `INTEGRATION_TESTS_DEPLOY_KEY`. The key and the hash travel in the two children's environments only. They are never printed and never on a command line.

A passing run removes the data directory. A failing run keeps it, prints the path of the server's log, and prints the log's last 60 lines, leaving out the requests the server answered.

The logic is in `lib/local-target.js`. It starts the server through `lib/server-process.js`, which a test that needs a server of its own also uses: `startServerProcess()` starts a project's entry point on a port, `waitUntilReady()` waits for it to answer, `signal()` sends it a signal, `exited` resolves its exit code and output, and `stop()` ends it. A test that starts a server calls `stop()` in a `finally`. It sends a signal with `process.kill`, never the child's own `kill()`: under Deno that makes the exit report the signal sent in place of the server's exit code.

## Running the Suite Against a Target

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
| `INTEGRATION_TESTS_DEPLOY_KEY` | The target's deploy key, for tests that call a protected route such as the probe. `run-local.js` sets it. For any other target, set it yourself. |

The deploy key is a secret. Set it in the environment only. It has no command-line option, because a secret on the command line leaks into shell history and process listings, and it never goes in a tracked file. The runner never reads it.

Tests read these through `test/test-helpers/target.js`:

- `getBaseUrl()` returns the base URL without a trailing slash.
- `getDeployKey()` returns the key, or `null` when none is set.
- `getTarget()` returns `local`, `cloudflare`, or `nodejs`, or `null` for a target given by URL.
- `fetchWithDeployKey(pathname, init)` sends a request to the target with the key as a bearer token. It follows no redirect, and an error from it names only the method and the path.

`test/test-helpers/publish.js` publishes content to a target through its Publishing API: `publishContent({ baseUrl, deployKey, files, pluginContentRoots, templateHelpers })` compiles the files, uploads the objects the store lacks, creates the Release, and assigns it to the build the target runs. The first assignment pre-stages the build with a made-up commit and code fingerprint; later ones are content-only publishes. The unit suite uses the same helper against a project booted on `127.0.0.1` (`test/skeleton/`).

## Writing an Integration Test

- Put it in `test-app/test/`, named `*.test.js`. It uses `kixx-test` and `kixx-assert`, like a unit test.
- A test that is the same on every target goes in `test/all-targets/`. A test for one target goes in `test/local/` or `test/cloudflare/`, and registers its block with `describeOnTarget([ 'local' ], name, fn)`, which registers nothing on any other target or on one given by URL.
- Every test file is imported into one process, in path order. Don't depend on that order.
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

The test app's plugin mounts it this way, in `test-app/integration-probe/routes.js`:

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
- A factory builder runs on every run request, before the test is looked up. So it only returns a function, and touches storage inside it.
- The plugin authorizes with `verifyDeployKey()`, and also puts `requireDeployKey` on the mount. A request without the key is refused at the mount, with a 401 and the code `DeployKeyRequired`.

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
