Packaging and Runtimes
======================

`kixx-dev` ships to two registries and runs on two runtimes from one source tree:

- npm as `kixx-dev` (`package.json`), on Node.js 24+.
- JSR as `@kixx/dev` (`deno.json`), on Deno 2.8+.

Both install the `kixx-dev` executable from `kixx-dev.js`.

Stand-alone Package
-------------------

- **No imports outside `devkit/`.** The published package contains only `devkit/`. `test/conformance/` is the one exception, and tests are never published. `test/import-hygiene.test.js` checks every static import of `kixx-dev.js`, `commands/`, and `lib/`: a relative one stays inside `devkit/`, and a bare one is a `node:` built-in.
- **Framework logic is loaded from the project at run time.** `lib/project/load-project-tooling.js` imports three modules of the project's own `kixx/` by file URL. It is the only module with a dynamic `import()`. See "Framework Logic Comes From the Project" in `docs/architecture.md`.
- **No runtime dependencies.** Only `node:` built-ins and vendored code. `kixx-test` and `kixx-linting` are dev dependencies.
- **Vendored code** lives in `lib/vendor/` (`acorn`, `kixx-assert`), unmodified, with its license. The version and digest of each copy are recorded in the repository's `vendored-code.json`, and upgrades follow `docs/vendored-code.md` at the repository root. The Kixx-written acorn wrapper is `lib/parse-javascript.js`. The linter skips `lib/vendor/`.
- **The project skeleton** lives in `templates/project/` and ships as data: nothing in the devkit imports it. Its files import core as `./kixx/...`, which only a built project has. The linter skips `templates/`. Its `.gitignore` is stored as `gitignore`, because npm leaves `.gitignore` files out of a package and a real one would act on this repository. See "The project skeleton" in `README.md`.
- **Static command imports.** `commands/index.js` imports every command so the module graph is complete when loaded from a JSR URL, where there is no directory to read. See `commands/README.md`.

The Two Manifests
-----------------

`package.json` and `deno.json` must agree. `test/manifests.test.js` checks that they:

- are named `kixx-dev` and `@kixx/dev`.
- have the same `version`; `kixx-dev --version` reads it from `deno.json`, so npm's `files` lists `deno.json`.
- map the executable to the entry point: `bin["kixx-dev"]` in `package.json` and `exports["."]` in `deno.json` are both `./kixx-dev.js`. The default export is what lets `deno run jsr:@kixx/dev` resolve.
- list `kixx-dev.js` in the published files.
- declare no runtime dependencies (`dependencies` / `imports`).
- leave `test/` out of the published files.

When you add a top-level file or directory that must ship, add it to both `package.json` `files` and `deno.json` `publish.include`.

Core, plugins, and the CLI share one version. `test/conformance/versions.test.js` checks that `package.json`, `deno.json`, and core's `kixx/plugin.json` hold the same one, so bump all three together. It also checks that each devkit `devDependencies` version equals the root `package.json`'s: the devkit has no `node_modules/` of its own, and its runners resolve `kixx-test` and `kixx-linting` from the root's.

Node.js and Deno Differences
----------------------------

Write to the `node:` APIs; Deno supports them. Branch on the runtime only where behavior really differs, and detect it with `process.versions.deno`. Known differences:

- `lib/devserver/app-process.js` spawns the app with `deno run -A` under Deno.
- `lib/devserver/dev-server.js` deduplicates Deno's multiple watch events per save.

CI runs the suite on both runtimes on every push (`devkit-test-node`, `devkit-test-deno`). To run it yourself:

```
node devkit/run-tests.js
deno run -A devkit/run-tests.js
```

Deno Permissions
----------------

The JSR install grants `-RWNE --allow-sys=homedir --allow-run`. The README explains each flag. If a change needs a new permission (a new environment variable is fine under `-E`; FFI or broader `--allow-sys` is not), update the install and upgrade commands in `README.md`, the `kixx-dev` task in `deno.json`, and the permission list in the README. Prefer designs that need no new permission.

`test/kixx-dev.test.js` runs the entry point on Deno with exactly these permissions, so it fails if the CLI needs more.

The CLI runs project code in two ways, and no other:

- `kixx-dev dev` and `kixx-dev local start` run the app's `node-server.js` in a child process.
- A command that declares `requiresTooling` (today `kixx-dev generate` and `kixx-dev local create`) imports the project's own Kixx tooling into the CLI's process: `kixx/tooling/mod.js` and two adapter modules under `kixx/adapters/node/`. It never imports the project's `app/`, `plugins/`, or entry points.

Everything else in a project is read as data: `kixx/plugin.json` for discovery and the version gate, the `.kixx/` settings, and files such as `cloudflare-config.jsonc`. Keep it that way.

The dynamic import of a local file needs only `-R`, which the install already grants. `test/kixx-dev.test.js` proves it: under Deno it runs `generate` against a real project in a child process with exactly the installed permissions.

`--allow-run` covers two things: the local `git` binary, which no code runs yet, and that app child process. `node:child_process` is imported only by `lib/devserver/app-process.js`, and `test/import-hygiene.test.js` pins the list. A new module that starts a process must be added there on purpose.

Test Seams
----------

Code that touches the outside world takes the dependency as an injectable argument with a real default, so tests never patch globals:

- `output` (default `process.stdout`) for command output.
- `fileSystem` (default `lib/file-system.js`) for disk access.
- `fetch` (default `globalThis.fetch`) for API clients.
- `now`, `wait`, `random`, and API client factories where timing or remote calls matter.

Follow the same pattern for new collaborators. `test/helpers/` holds the matching stand-ins; see `test/README.md`.
