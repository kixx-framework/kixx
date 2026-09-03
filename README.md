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
- [x] Cloudflare
- [ ] AWS Lambda

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2026.

Development
-----------

Local development tools and processes.

### Development Server

Run the development server with:

```bash
# Directly
node tools/devserver.js --port 2026
# npm script
npm run dev
```

The dev server listens on the public `--port` (default=2026) and proxies requests to a child `src/node-server.js` process on a temporary port. It restarts the child after the app has been idle for a few seconds, so source code changes are picked up on the next request without manually restarting the command.

The wrapper accepts the same `--environment` and `--dotenv` options as `src/node-server.js`. Change `--port` to avoid local port conflicts.

### Local Target Instances

The dev server's content store is read-only: `DeveloperContentStore` serves `pages/`, `templates/`, `static-assets/`, and `emails/` straight from the working tree, and its write methods throw. To exercise the Publishing API, an admin signup, or anything else that writes, create a **local target instance**: a throwaway directory holding a complete, writable `local` environment deployment, seeded from the working tree and served by `src/node-server.js` directly.

```bash
node tools/local-target.js create alpha
node tools/local-target.js seed alpha
node tools/local-target.js serve alpha
node tools/local-target.js destroy alpha
```

| Verb | Effect |
| --- | --- |
| `create <name>` | Creates `data/local-targets/<name>/` and writes its `.env`/`.env.secrets` pair — a fresh port, Build ID, and random secrets. |
| `seed <name>` | Boots the app in-process, publishes the working tree as a Release assigned to the instance's Build ID, creates the root admin, mints a Publishing API token, and writes `credentials.json`. |
| `serve <name>` | Runs `node src/node-server.js --environment local --dotenv <instance>/.env` in the foreground. |
| `destroy <name>` | Deletes the instance directory (refuses while its server is still listening). |

`credentials.json` holds the root admin's email and password, a Publishing API token, the Build ID, and the base URL — everything needed to log in to the admin panel or call the Publishing API. It is plain text inside `data/local-targets/<name>/`, which `.gitignore` excludes; treat it like any other local secret.

Instances are disposable: destroy and re-create one rather than trying to carry it forward, and `seed` refuses to run a second time against the same instance (delete `credentials.json`, or `destroy` and `create` again).

### Environment Variables and Configuration

Settings are split across two kinds of file by a single question:

> Does the value change **per deploy**, or only **per environment**?

Per-environment values are configuration and belong in `src/node-config.js` or `src/cloudflare-config.js`, under the `environments` map. The application name and log level live here, as do every store, cache, and rate-limit setting.

Per-deploy values are environment variables and live in dotenv files, split again by secrecy:

| File | Committed | Cloudflare binding | Holds |
| --- | --- | --- | --- |
| `src/.env.<environment>` | yes | plain text | `ENVIRONMENT`, `TRUST_PROXY`, `BUILD_ID`, `PORT` |
| `src/.env.<environment>.secrets` | no | encrypted secret text | signing secrets and tokens |

Because the secrecy split follows the git boundary, a deployment can derive the binding type from the filename alone. There is no per-key annotation to keep in sync, and no way for a value to be classified two ways at once.

`src/example.env` and `src/example.env.secrets` are the templates for each half. Bootstrap a fresh clone with:

```bash
cp src/example.env.secrets src/.env.development.secrets
```

The Node.js server reads `.env.<environment>`, `.env.<environment>.secrets`, and `process.env`. Each file is optional, so deploying with dotenv files and deploying by setting `process.env` both work, and they can be combined.

A key defined by more than one of those three sources aborts startup with an
error naming the key and the sources. There is deliberately no precedence rule:
a key carrying two definitions means one of them is in the wrong place, and
resolving it silently is how a secret ends up bound as plain text.

Only keys the dotenv files declare participate, so unrelated process environment entries never collide.

`--dotenv <path>` names the plain file and derives the secrets file by appending `.secrets`, so one flag selects the pair.

`ENVIRONMENT` cannot move into configuration, because it selects which section of the config module is loaded.

`DATA_DIRECTORY` is an optional, Node.js-only per-deploy value. When set, it overrides the directory that config-relative store paths (`DOCUMENT_STORE`, `KEY_VALUE_STORE`, `OBJECT_STORE`, `CONTENT_STORE`) resolve against, in place of `src/`. It exists for local target instances (see "Local Target Instances" below), where every instance's stores must live inside that instance's own directory rather than the shared development data. Leave it unset for every other deployment.

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

See the [End-to-End testing README](test/end-to-end/README.md) for more information about running end-to-end tests.

Run unit tests with:

```bash
# Run all unit test files (*.test.js) in ./test/unit-tests/
node run-tests.js

# Run only the test files in the given files and directories
node run-tests.js [pathname ...]

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

Usage and validation errors, such as an unknown flag, a pathname outside the selected suite, or a missing suite root directory, are written to stderr. Test results and the run summary are written to stdout.

Exit behavior:

- Exits 1 when any test error is present, when a pathname argument is invalid, or when the root directory of the selected suite does not exist.
- Exits 0 when every test passes, including when the selected suite contains no test files.

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
