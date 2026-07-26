Kixx
====

__A web development framework for you and your clankers to build anything from a home-cooked website to the next unicorn.__

Build web applications with AI agents without generating piles of shit code you’ll need to rewrite later. Kixx is optimized for solo developers and small teams and emphasizes productivity, craftsmanship, portability, and durability.

- JavaScript backend.
- Supports hypermedia-driven applications (HTML as the engine of application state).
- You can build a great JSON API with it too.
- Supports server-side rendering of markup (but you can build an SPA too).
- Component based design. You choose only what you like.
- Provide desired paths, but also include escape hatches.
- Keep you apps easy to hack on.
- Token efficiency for the coding agents.

Deploy on:

- [x] Node.js
- [ ] Deno
- [ ] Cloudflare
- [ ] AWS Lambda

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2026.

Development
-----------

Local development tools and processes.

### Development Server

Run the development server with:

```bash
node tools/devserver.js --port 2026
```

The dev server listens on the public `--port` and proxies requests to a child `src/node-server.js` process on a temporary port. It restarts the child after the app has been idle for a few seconds, so JavaScript source changes are picked up on the next request without manually restarting the command. Template, page data, and source stylesheet changes are read directly on reload.

The dev server also serves CSS files directly from `src/stylesheets/`, allowing you to skip a build process for CSS bundles.

The wrapper accepts the same `--environment` and `--dotenv` options as `src/node-server.js`. Change `--port` to avoid local port conflicts.

### Linting

Linting is configured in `./eslint.config.js`.

Run linting with:

```bash
# Run the linter on all JavaScript files in the current working directory which are not ignored in eslint.config.js
node run-linter.js

# Run the linter on specified files or directories.
node run-linter.js [pathname ...]

# Run the linter with Deno. Use the -P flag to pull permissions from deno.json
deno run -P run-linter.js
```
Pathname arguments are optional. If omitted, the CLI uses the current working directory.

The eslint.config.js file is always loaded from the current working directory.

When a target pathname is a directory, linting walks it recursively and only lints .js files. Other file extensions are ignored during directory traversal. Multiple targets are linted in argument order, and files selected through overlapping targets are linted only once.

The `files` and `ignores` matching in eslint.config.js is literal path-segment matching (no glob support).

Diagnostic output is written to stderr, grouped by file.

Exit behavior:

- Exits 1 when any lint error is present (or when CLI/config loading fails).
- Exits 0 when results are warnings-only or fully clean.

### Testing

Tests are split into two suites which never run in the same process:

- `test/unit-tests/` is the default suite.
- `test/end-to-end/` runs only when the `--e2e` flag is present.

Run tests with:

```bash
# Run all unit test files (*.test.js) in ./test/unit-tests/
node run-tests.js

# Run all end-to-end test files (*.test.js) in ./test/end-to-end/
node run-tests.js --e2e

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

# Run the tests with Deno. Use the -P flag to pull permissions from deno.json
deno run -P run-tests.js
```
Pathname arguments are optional. If omitted, the CLI walks the root directory of the selected suite.

Every pathname argument, positional or `--skip`, is resolved relative to the current working directory and must resolve inside the root directory of the selected suite. A pathname belonging to the other suite, or to neither suite, is a usage error. This is what stops a forgotten or misspelled `--e2e` from quietly running the wrong suite.

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

`./test/end-to-end/` is not tracked by git while it is empty, so `node run-tests.js --e2e` exits 1 until the first end-to-end test file is committed.

Usage and validation errors, such as an unknown flag, a pathname outside the selected suite, or a missing suite root directory, are written to stderr. Test results and the run summary are written to stdout.

Exit behavior:

- Exits 1 when any test error is present, when a pathname argument is invalid, or when the root directory of the selected suite does not exist.
- Exits 0 when every test passes, including when the selected suite contains no test files.

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
