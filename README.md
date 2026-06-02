Kixx
====
__A web development framework for humans and their AI tools.__

Build web applications with AI agents like Claude Code and Codex without generating piles of shit code you’ll need to rewrite later. Kixx is designed to build server-rendered, hypermedia-driven applications (HTML as the engine of application state) with minimal client side scripting. It emphasizes productivity, craftsmanship, and durability.

Deploy on:

- [x] Node.js
- [ ] Deno
- [ ] Cloudflare
- [ ] Deno Deploy
- [ ] AWS Lambda

Started by [Kris Walker](https://www.kriswalker.me) 2017 - 2026.

Development
-----------

Local development tools and processes.

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

### Unit Testing

Run tests with:

```bash
# Run all non-integration test files (*.test.js) in the ./test/ directory
node run-tests.js

# Run all test files (*.test.js) in the files and directories passed into run-tests.js
node run-tests.js [pathname ...]

# Run the tests with Deno. Use the -P flag to pull permissions from deno.json
deno run -P run-tests.js
```
Pathname arguments are optional. If omitted, the CLI uses `./test/`.

When a target pathname is a directory, the test script walks it recursively and only runs `*.test.js` files. Other file extensions are ignored during directory traversal.

Diagnostic output is written to stderr, grouped by file.

Exit behavior:

- Exits 1 when any test error is present (or when CLI/config loading fails).
- Exits 0 when results are warnings-only or fully clean.

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
