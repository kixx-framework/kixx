End-to-End Testing
==================

## CSRF coverage

`010-csrf/` owns explicit CSRF coverage. Its files are independently runnable:

| File | Coverage |
| --- | --- |
| `010-form-lifecycle.test.js` | Cookie and token envelope policy, expiry window, multi-tab tokens, reuse, and validation-error refreshes. |
| `020-authentication-boundary.test.js` | Login/signup rejection before state changes and successful authentication cookie transitions. |
| `030-admin-mutations.test.js` | Invalid-token matrix plus protected invite and Publishing API token creates and revokes. |
| `040-api-boundary.test.js` | Browser session cookies cannot authenticate Admin or Publishing API mutations. |

The protected HTML routes are login, signup, invite create/revoke, and
Publishing API token create/revoke. The Publishing API token create route covers
missing, malformed, altered-signature, and SID-mismatched inputs; every other
protected form handler has a missing-token regression check. Other workflow
tests may extract and submit a valid token, but do not own CSRF policy or
rejection assertions.

Operators or CI can run each file, the focused suite, or the complete suite
against an already running target:

```bash
node run-tests.js --e2e --development test/end-to-end/010-csrf/010-form-lifecycle.test.js
node run-tests.js --e2e --development test/end-to-end/010-csrf/020-authentication-boundary.test.js
node run-tests.js --e2e --development test/end-to-end/010-csrf/030-admin-mutations.test.js
node run-tests.js --e2e --development test/end-to-end/010-csrf/040-api-boundary.test.js
node run-tests.js --e2e --development test/end-to-end/010-csrf
node run-tests.js --e2e --development
```

These fetch-based checks verify server responses and cookie attributes, not a
browser's `SameSite=Lax` enforcement. Normal runs also do not wait 30 minutes,
rotate the signing secret, or restart an app without that required secret.

## Publishing API coverage

`200-publishing-api/` owns the Publishing API v1 end-to-end coverage. It tests
the four publishing workflows described in `docs/publishing-api.md` — not one
file per endpoint group — because the old endpoint-per-file layout never
exercised a Release that named objects the store did not hold. Its files are
independently runnable:

| File | Coverage |
| --- | --- |
| `010-authentication.test.js` | Missing, malformed, unknown, and revoked bearer-token rejection, checked against discovery. |
| `020-objects.test.js` | Object upload, re-upload dedup, `POST /objects/status`, and an address/bytes mismatch. |
| `030-releases.test.js` | Release creation that verifies completely; failures on a missing object, a wrong size, and an unresolvable template partial; `POST /releases/validation` persisting nothing and rejecting inline content; content-idempotent creation; and Release history reads. |
| `040-protocol-errors.test.js` | Method, media-type, malformed-document, and JSON:API resource-type failures. |
| `050-build-pointers.test.js` | Build-pointer workflows against build ids generated for the run: a missing precondition, pre-staging a never-assigned build and reading it back, a stale `If-Match`, an `If-None-Match: *` conflict, code-only carry-forward to a second build id, forward-publish-then-rollback discovered from activation history, a no-op reassignment, and `GET /builds`. |
| `060-running-build.test.js` | The one workflow that must touch the target's actual running build: assigning a new Release to it with `If-Match`, reading it back, and its activation history. |

### Active-build mutation and restoration

`060-running-build.test.js` is the only file that publishes to the target's
actual running build, because assigning to a build id generated for the run
(`050-build-pointers.test.js` and the rest) proves the same pointer semantics
without touching anything real. It:

1. Reads the running build's pointer, via discovery and `GET
   /publishing-api/v1/builds/:buildId`, before making any request that
   mutates it, and retains its `releaseId`.
2. Assigns a freshly created Release with `If-Match: "<observed-releaseId>"`,
   so the assignment itself fails with `412 BuildPointerConflict` rather than
   silently overwriting a pointer moved by a concurrent deploy or another test
   run.
3. Registers its restoration in an `after` hook before any mutating request is
   made, so the hook still runs if setup fails partway through (per the
   `kixx-test` guarantee that `after` runs even when `before` fails).
4. Restores the original pointer with a conditional `PUT
   /publishing-api/v1/builds/:buildId`, using its own newly assigned
   `releaseId` as the `If-Match` precondition. Restoration is skipped, not
   attempted, when the running build had no prior Release (a genuinely fresh
   deploy) or the assignment never confirmed — guessing ownership of the
   pointer in that state would be more destructive than leaving a clearly
   failed run for an operator to inspect.

A restore conflict (something else moved the pointer between publish and
restore) fails the `after` hook loudly and does not overwrite the newer
pointer — this is a compare-and-swap safety net, not a distributed lock.
Operators should still avoid running this file concurrently with itself
against the same target, or overlapping it with a real deploy, when a
deterministic result matters. Every created Release and uploaded object
remains in storage after a run either way (see "What a run leaves behind"
below); only the running build's pointer is conditionally restored.

Operators or CI can run each file or the focused suite against an already
running target:

```bash
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/010-authentication.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/020-objects.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/030-releases.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/040-protocol-errors.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/050-build-pointers.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/060-running-build.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api
```

Every file that uploads an object or creates a Release is disabled when the
runner selects the `--development` target, because the developer content
store is read-only: `020-objects.test.js`, `050-build-pointers.test.js`, and
`060-running-build.test.js` in full, and the Release-verification `describe`
block in `030-releases.test.js`. The one exception is `030-releases.test.js`'s
"reports every missing object" case, which references an address the store
was never asked to store and needs no write, so it runs unconditionally, as do
`010-authentication.test.js` and `040-protocol-errors.test.js` (both fail
before reaching any storage call). An explicit `--base-url` does not imply
developer mode, even when it uses a local URL.

### What a run leaves behind

A successful run against a deployed target does not delete anything it wrote:
uploaded objects and every created Release stay in storage (the port has no
delete operation by design; see `content-store-interface.js`), Release and
Activation metadata accumulate without limit (retention is an open decision;
see the refactor plan), build pointers created for a run under a
run-generated build id are never cleaned up, and minted Publishing API tokens
keep their normal expiry rather than being revoked by the test. Only the
running build's pointer is touched, and it is restored conditionally as
described above. Routine content cleanup between runs is unnecessary —
UUID-namespaced run prefixes keep each run's fixture pathnames and build ids
from colliding with real content or with each other.

```bash
# Run end-to-end tests against a predefined deployment target
node run-tests.js --e2e --development
node run-tests.js --e2e --cloudflare
node run-tests.js --e2e --nodejs

# Override individual end-to-end configuration values
node run-tests.js --e2e --base-url https://example.test/ --username example-user --password 'example-password'

# Run only the test files in the given files and directories
node run-tests.js [pathname ...]
node run-tests.js --e2e [pathname ...]

# Exclude a file or directory from the run
node run-tests.js --skip test/unit-tests/plugins
```

When a target pathname is a directory, the test script walks it recursively and only runs `*.test.js` files. Other file extensions are ignored during directory traversal.

Test files are loaded in ascending order of their absolute pathname, compared by UTF-16 code unit. The comparison is deliberately not locale aware, so the order does not shift with the environment locale, the host ICU build, or the choice of Node.js or Deno. Files selected through overlapping targets are loaded only once.

Load order depends only on which files the run selects, never on how they were selected. Unlike the linter, the test runner ignores the order of the positional arguments: `node run-tests.js test/unit-tests/kixx test/unit-tests/app` loads the same files in the same order as the reversed invocation. A narrowed re-run therefore loads its files in the same relative order as the full run.

End-to-end tests run with a 10 second timeout in place of the `kixx-test` default. The runner applies it as a ceiling, so an individual `describe` block cannot raise it.

End-to-end runs require `E2E_TESTS_BASE_URL`, `E2E_TESTS_ROOT_USERNAME`, and `E2E_TESTS_ROOT_PASSWORD` to have non-empty values. The following CLI options override those environment variables for the current test process:

- `--base-url <url>` sets `E2E_TESTS_BASE_URL`.
- `--username <username>` sets `E2E_TESTS_ROOT_USERNAME`.
- `--password <password>` sets `E2E_TESTS_ROOT_PASSWORD`.
- `--development` sets `E2E_TESTS_BASE_URL` to `http://localhost:2026/`.
- `--cloudflare` sets `E2E_TESTS_BASE_URL` to `https://cloudflare.kixx-testing.dev/`.
- `--nodejs` sets `E2E_TESTS_BASE_URL` to `https://nodejs.kixx-testing.dev/`.

These options are valid only with `--e2e`. Each option may appear only once, and only one of `--base-url`, `--development`, `--cloudflare`, or `--nodejs` may be used in a run. CLI overrides are independent: any required value not provided on the command line continues to come from the existing environment.

The final base URL must be a valid absolute HTTP or HTTPS URL with no leading or trailing whitespace. CLI values are otherwise preserved exactly.
