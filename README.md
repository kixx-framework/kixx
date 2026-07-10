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

The wrapper accepts the same `--environment` and `--secrets` options as `src/node-server.js`. Change `--port` to avoid local port conflicts.

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
