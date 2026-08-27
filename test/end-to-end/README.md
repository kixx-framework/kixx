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

`200-publishing-api/` owns the Publishing API v1 end-to-end coverage. Its
files are independently runnable:

| File | Coverage |
| --- | --- |
| `010-authentication.test.js` | Missing, malformed, unknown, and revoked bearer-token rejection. |
| `020-resource-uploads.test.js` | Successful uploads for all eight resource kinds and resource-shape validation failures. |
| `030-index-reads.test.js` | Published-reference GET and HEAD reads for every index kind, plus an absent-reference rejection. |
| `040-protocol-errors.test.js` | Method, media-type, malformed-document, and JSON:API resource-type failures. |
| `050-closure.test.js` | Full content-tree publishing, idempotent re-publishing, and published-index reads. |

Operators or CI can run each file or the focused suite against an already
running target:

```bash
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/010-authentication.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/020-resource-uploads.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/030-index-reads.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/040-protocol-errors.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api/050-closure.test.js
node run-tests.js --e2e --development test/end-to-end/200-publishing-api
```

The successful resource-upload tests, published-reference tests, and content-tree
closure tests are disabled when the runner selects the `--development` target
because the developer content store is read-only. Resource-validation tests
still run. An explicit `--base-url` does not imply developer mode, even when it
uses a local URL.

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
