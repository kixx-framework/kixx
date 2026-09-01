End-to-End Testing
==================

End-to-end tests drive a running instance of the application over HTTP. They
do not start a server themselves — point them at one with a target flag or
`--base-url`.

## Quick start

```bash
# Against the local dev server (node tools/devserver.js --port 2026)
node run-tests.js --e2e --development

# Against a deployed target
node run-tests.js --e2e --cloudflare
node run-tests.js --e2e --nodejs

# Against an arbitrary target
node run-tests.js --e2e --base-url https://example.test/ --username example-user --password 'example-password'
```

## Required configuration

Every run needs a base URL, a root username, and a root password. Each comes
from an environment variable, and each has a CLI override that sets that
variable for the current process:

| Environment variable | CLI override |
| --- | --- |
| `E2E_TESTS_BASE_URL` | `--base-url <url>`, or one of the target flags below |
| `E2E_TESTS_ROOT_USERNAME` | `--username <username>` |
| `E2E_TESTS_ROOT_PASSWORD` | `--password <password>` |

The root username and password authenticate as the root admin — the account
the tests use to create invites, super admins, and Publishing API tokens.

Missing any of the three at run time is a startup error, not a per-test
failure. CLI overrides are independent: any value not given on the command
line continues to come from the existing environment.

These options are only valid with `--e2e`; using them without it is a usage
error. Each option may appear only once per run.

## Selecting a target

Exactly one of `--base-url`, `--development`, `--cloudflare`, or `--nodejs`
may be used in a run — combining two is a usage error.

| Flag | Sets `E2E_TESTS_BASE_URL` to | Implications |
| --- | --- | --- |
| `--development` | `http://localhost:2026/` | The developer content store is read-only. Every Publishing API test that would upload an object or create a Release is disabled instead of failing (see below). |
| `--cloudflare` | `https://cloudflare.kixx-testing.dev/` | A real deployed target: writes persist, and `060-running-build.test.js` touches its actual running build. |
| `--nodejs` | `https://nodejs.kixx-testing.dev/` | Same as `--cloudflare`. |
| `--base-url <url>` | The given URL | Treated as a live target, not developer mode, even when the URL points at localhost. Only `--development` enables the read-only skips. |

The final base URL must be an absolute `http:` or `https:` URL with no
leading or trailing whitespace, whether it came from a flag or from
`E2E_TESTS_BASE_URL` directly.

## Running a subset

```bash
# Run everything in the end-to-end suite
node run-tests.js --e2e --development

# Run specific files or directories
node run-tests.js --e2e --development test/end-to-end/010-csrf
node run-tests.js --e2e --development test/end-to-end/010-csrf/010-form-lifecycle.test.js

# Exclude a file or directory from the run
node run-tests.js --e2e --development --skip test/end-to-end/200-publishing-api/060-running-build.test.js
```

A directory argument is walked recursively; only `*.test.js` files run, other
extensions are ignored. Every positional and `--skip` pathname must resolve
inside `test/end-to-end/` — a pathname from the unit-test tree, or outside
either suite, is a usage error rather than a silent no-op. This is what stops
a forgotten or misspelled `--e2e` from quietly running the wrong suite.

Test files are loaded in ascending order of their absolute pathname, compared
by UTF-16 code unit rather than locale-aware collation, so load order does
not shift with the environment locale, the host ICU build, or the choice of
Node.js or Deno. Load order depends only on which files the run selects, not
on the order of the arguments or how a file was reached (named directly or
found by walking a directory) — a narrowed re-run loads its files in the same
relative order as the full run.

## Timeout

End-to-end tests run with a 10 second timeout in place of the `kixx-test`
default of 1000ms. The runner applies it as a ceiling: a `describe` block
cannot raise it.

## Test suites and their operational implications

Each directory below is independently runnable by pointing `run-tests.js` at
it. See each directory for what it covers.

| Directory | Notes |
| --- | --- |
| `001-sanity-checks/` | Baseline smoke checks. No target-specific caveats. |
| `010-csrf/` | Fetch-based checks of server responses and cookie attributes — not a browser's `SameSite=Lax` enforcement. Normal runs do not wait 30 minutes, rotate the signing secret, or restart the app without that secret. |
| `050-admin-panel/` | Admin-panel HTML workflows. No target-specific caveats. |
| `200-publishing-api/` | See below — this directory changes behavior with `--development` and has one file that mutates a real deployment. |

### Publishing API: `--development` disables writes

Because the developer content store is read-only, every `200-publishing-api/`
test that would upload an object or create a Release is disabled under
`--development`: `020-objects.test.js`, `050-build-pointers.test.js`, and
`060-running-build.test.js` in full, plus the Release-verification `describe`
block in `030-releases.test.js`. The exceptions, which run unconditionally
because they need no write: `030-releases.test.js`'s "reports every missing
object" case (references an address the store was never asked to store), and
`010-authentication.test.js` / `040-protocol-errors.test.js` (both fail
before reaching any storage call).

### Publishing API: `060-running-build.test.js` mutates a real build

This is the one file that touches the target's actual running build rather
than a build id generated for the run. Running it against `--cloudflare` or
`--nodejs` will:

1. Read the running build's pointer and retain its `releaseId` before making
   any mutating request.
2. Assign a freshly created Release with `If-Match: "<observed-releaseId>"`,
   so a pointer moved concurrently (another deploy, another test run) fails
   the assignment with `412 BuildPointerConflict` instead of being silently
   overwritten.
3. Restore the original pointer in an `after` hook, registered before any
   mutating request so it still runs if setup fails partway through.

Restoration is skipped, not attempted, when the running build had no prior
Release (a genuinely fresh deploy) or the assignment never confirmed —
guessing ownership of the pointer in that state would be more destructive
than leaving a failed run for an operator to inspect. A restore conflict
(something else moved the pointer between publish and restore) fails the
`after` hook loudly rather than overwriting the newer pointer; this is a
compare-and-swap safety net, not a distributed lock. Avoid running this file
concurrently with itself against the same target, or overlapping it with a
real deploy, when a deterministic result matters.

### What a run leaves behind

A successful run against a deployed target does not delete anything it
wrote: uploaded objects and every created Release stay in storage (the port
has no delete operation by design; see `content-store-interface.js`),
Release and Activation metadata accumulate without limit, build pointers
created under a run-generated build id are never cleaned up, and minted
Publishing API tokens keep their normal expiry rather than being revoked by
the test. Only the running build's pointer is touched, and only by
`060-running-build.test.js`, which restores it conditionally as described
above. Routine cleanup between runs is unnecessary — UUID-namespaced run
prefixes keep each run's fixture pathnames and build ids from colliding with
real content or with each other.
