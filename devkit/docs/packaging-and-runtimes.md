Packaging and Runtimes
======================

`kixx-devkit` ships to two registries and runs on two runtimes from one source tree:

- npm as `kixx-devkit` (`package.json`), on Node.js 24+.
- JSR as `@kixx/devkit` (`deno.json`), on Deno 2.8+.

Both install the `kixx` executable from `kixx.js`.

Stand-alone Package
-------------------

- **No imports outside `devkit/`.** The published package contains only `devkit/`. `test/conformance/` is the one exception, and tests are never published.
- **No runtime dependencies.** Only `node:` built-ins and vendored code. `kixx-test` and `kixx-linting` are dev dependencies.
- **Vendored code** lives in `lib/vendor/` (`acorn`, `kixx-assert`), unmodified, with its license. Upgrade by replacing the files and updating the version note in its README. The linter skips `lib/vendor/`.
- **Static command imports.** `commands/index.js` imports every command so the module graph is complete when loaded from a JSR URL, where there is no directory to read. See `commands/README.md`.

The Two Manifests
-----------------

`package.json` and `deno.json` must agree. `test/manifests.test.js` checks that they:

- have the same `version`; `kixx --version` reads it from `deno.json`.
- map `kixx` to `./kixx.js`.
- declare no runtime dependencies (`dependencies` / `imports`).
- leave `test/` out of the published files.

When you add a top-level file or directory that must ship, add it to both `package.json` `files` and `deno.json` `publish.include`. Bump the version in both.

Node.js and Deno Differences
----------------------------

Write to the `node:` APIs; Deno supports them. Branch on the runtime only where behavior really differs, and detect it with `process.versions.deno`. Known differences:

- `lib/devserver/app-process.js` spawns the app with `deno run -A` under Deno.
- `lib/devserver/dev-server.js` deduplicates Deno's multiple watch events per save.

Run the suite on both runtimes before a release:

```
node devkit/run-tests.js
deno run -A devkit/run-tests.js
```

Deno Permissions
----------------

The JSR install grants `-RWNE --allow-sys=homedir --allow-run`. The README explains each flag. If a change needs a new permission (a new environment variable is fine under `-E`; FFI or broader `--allow-sys` is not), update the install and upgrade commands in `README.md`, the `kixx` task in `deno.json`, and the permission list in the README. Prefer designs that need no new permission.

Only `kixx dev start` runs project code. Every other command reads project files (such as `cloudflare-config.jsonc`) as data. Keep it that way.

Test Seams
----------

Code that touches the outside world takes the dependency as an injectable argument with a real default, so tests never patch globals:

- `output` (default `process.stdout`) for command output.
- `fileSystem` (default `lib/file-system.js`) for disk access.
- `fetch` (default `globalThis.fetch`) for API clients.
- `now`, `wait`, `random`, and API client factories where timing or remote calls matter.

Follow the same pattern for new collaborators. `test/helpers/` holds the matching stand-ins; see `test/README.md`.
