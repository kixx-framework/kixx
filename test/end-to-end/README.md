End-to-End Testing
==================

```bash
# Run end-to-end tests against a predefined deployment target
node run-tests.js --e2e --development
node run-tests.js --e2e --cloudflare
node run-tests.js --e2e --nodejs

# Override individual end-to-end configuration values
node run-tests.js --e2e --base-url https://example.test/ --username example-user --password 'example-password'

# Enable the tests which require the target deployment's current build id
node run-tests.js --e2e --nodejs --build-id 2026-07-27T14-31-09Z

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
- `--build-id <id>` sets `E2E_TESTS_BUILD_ID`.
- `--development` sets `E2E_TESTS_BASE_URL` to `http://localhost:2026/`.
- `--cloudflare` sets `E2E_TESTS_BASE_URL` to `https://cloudflare.kixx-testing.dev/`.
- `--nodejs` sets `E2E_TESTS_BASE_URL` to `https://nodejs.kixx-testing.dev/`.

These options are valid only with `--e2e`. Each option may appear only once, and only one of `--base-url`, `--development`, `--cloudflare`, or `--nodejs` may be used in a run. CLI overrides are independent: any required value not provided on the command line continues to come from the existing environment.

The final base URL must be a valid absolute HTTP or HTTPS URL with no leading or trailing whitespace. CLI values are otherwise preserved exactly.

## The current build id

`E2E_TESTS_BUILD_ID` is optional, unlike the three required values above. It names the Build ID the *target deployment is currently serving* — the value that deployment was started with in its own `BUILD_ID` environment variable — and it exists so tests can assert that the Publishing API refuses to write into the live build.

It has to be supplied out of band because no response exposes it, and it must match the running deployment exactly; a value that does not match makes those writes succeed, and the tests which use it fail. Set it only when you know the current Build ID of the target you are pointing at.

Tests which need this value disable themselves when it is absent, so an unconfigured run reports them as disabled blocks in the summary rather than skipping them silently or failing. A local dev server has no current build at all — nothing in this repository sets `BUILD_ID` — so those tests stay disabled against `--development` unless you start the server with one.

## Known obsolete suite: `020-publishing-api/`

This suite targets URL paths (e.g. `/publishing-api/v1/templates/**`) that
predate the current routes in `src/routes/publishing-api-v1.js`
(`/publishing-api/v1/resources/**` and `/publishing-api/v1/index/**`). It
predates and is unrelated to `agents/plans/hyperview-content-service.md`;
rewriting it against the current routes is out of scope for that work.
Passing or failing here is not a signal about that migration or about the
Publishing API's current behavior — see
`src/kixx/hyperview/README.md#publication-flow` and
`src/app/presentation/request-handlers/publishing-api/mod.js` for the
current, tested behavior instead.
