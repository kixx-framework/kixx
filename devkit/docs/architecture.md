Devkit Architecture
===================

Paths are relative to `devkit/`.

Layers
------

```
kixx-dev.js   hand argv, the process streams, the registry, and the tooling loader to runCli(); set the exit code
lib/run-cli.js  dispatch, help, parse, find the project, load settings and tooling, run the command, map errors to exit codes
commands/     wiring: parsed options + settings -> one library call -> output and returned data
lib/          all real logic, grouped by subsystem
```

`kixx-dev.js` is the only module that touches `process.stdout`, `process.stderr`, and `process.exitCode`. The runner, `lib/run-cli.js`, takes them as arguments, so tests run it in process. It owns dispatch, the single directory positional, finding the project, settings loading, the `--json` envelope, and error printing, with these modules:

| Module | Responsibility |
|---|---|
| `commands/index.js` | The registry: one flat map from command name (`dev`, `local create`) to class, placeholders included, and the `groups` descriptions |
| `lib/command-registry.js` | Resolves the leading words of a command line to a command, lists commands, and checks a registry's and a command's shape |
| `lib/command-positionals.js` | Required positionals and the trailing directory |
| `lib/render-help.js` | Help as data (`--help --json`) and as text rendered from that data |
| `lib/exit-codes.js` | The exit-code table and the mapping from a thrown error to a row |
| `lib/placeholder-command.js` | The factory for a command that is registered but not available, and `CommandNotAvailableError` |
| `lib/project/find-project.js` | Finds the project: the nearest directory at or above the start directory that holds `kixx/plugin.json`; `ProjectNotFoundError` |
| `lib/project/project-version.js` | The version gate: `OLDEST_SUPPORTED_PROJECT_VERSION`, reading the project's version as data, and `UnsupportedProjectVersionError` |
| `lib/project/load-project-tooling.js` | Imports the project's own tooling at run time; the only module with a dynamic `import()` |
| `lib/config-loader.js` | Merges the home and project settings layers for a project directory it is given |

A command module stays thin; logic shared or worth testing on its own goes in `lib/`. See `commands/README.md` for the contract.

Framework Logic Comes From the Project
--------------------------------------

The devkit holds no copy of the registry generator, the manifest rules, or the content compiler. A command that needs them declares `requiresTooling`, and the runner loads them from the project's own `kixx/` (`lib/project/load-project-tooling.js`):

- `kixx/tooling/mod.js`, passed as `tooling`;
- `kixx/adapters/node/tooling/lib/project-file-system.js`, for `createProjectFileSystem()`;
- `kixx/adapters/node/content-compiler/lib/file-system-content-source.js`, for `createFileSystemContentSource()`.

So one `kixx-dev` works with every project version the gate allows, and what it generates or compiles is what that project's Kixx would. `kixx-dev generate` is the first command built this way: it calls the project's `writeProjectFiles()`.

- A project is supported when its `kixx/plugin.json` version has the major version of `OLDEST_SUPPORTED_PROJECT_VERSION` and is at least that version. The gate reads the manifest as data and runs before anything is imported.
- The loader is the only module with a dynamic `import()`, and it never imports a project's `app/`, `plugins/`, or entry points. `test/import-hygiene.test.js` enforces it.
- Classes loaded from a project are not devkit classes. Match an error project code throws by `error.name`, never with `instanceof`.
- `test/conformance/project-tooling.test.js` builds a real project from the skeleton and this repository's core and runs `generate` against it.

`lib/` Subsystems
-----------------

| Directory | Used by | Responsibility |
|---|---|---|
| `lib/` (root) | everything | The runner and its modules (above), `cloudflare-config.jsonc` loading, JSONC, `.env.<env>` parsing, terminal prompts, text wrapping, the `fileSystem` seam, `UsageError`, hashing, token generation, and JavaScript parsing over vendored `acorn` (`parse-javascript.js`) |
| `lib/admin/` | no command in this version | Admin API client, invite redemption, credential prompting, and environment resolution |
| `lib/publishing/` | no command in this version | Content addressing, capability negotiation, Release creation, and build assignment over the Publishing API |
| `lib/bundler/` | no command in this version | Crawls an app's static ES module graph and strips comments for upload, using `parse-javascript.js` |
| `lib/cloudflare/` | no command in this version | Cloudflare API client, config validation, bindings, secrets parity, resource checks, Durable Object exports, and the Worker version and deploy pipelines |
| `lib/devserver/` | `dev`, `local` | Proxy server, app child process, and restart decisions on file change |
| `lib/local/` | `local` | Local instance files: names, paths, generated dotenv pair, `instance.json`, credentials, listing, removal, and seeding an instance over HTTP |
| `lib/project/` | the runner | Project discovery, the version gate, and the tooling loader (above) |
| `lib/vendor/` | — | Unmodified third-party code; not linted |

Settings
--------

Commands read three inputs, all as data:

- `.kixx/config.json` and `.kixx/secrets.json`: home layer (`~/.kixx/`) merged under the project layer (`<project>/.kixx/`), deeply frozen. A `null` in the project layer cancels an inherited value. Commands declare required keys with `requiredConfig` / `requiredSecrets`. They are loaded only for a command that declares `requiresProject`, after the project is found by its `kixx/plugin.json`; a project needs no `.kixx/` directory.
- `cloudflare-config.jsonc`: read by `lib/cloudflare-config-loader.js`. The runner does not load it, because no registered command reads it in this version. Most values are under `environments.<env>`, so the code that uses it validates what it uses at run time.
- `.env.<env>` and `example.env.secrets`: read by the Cloudflare pipeline.

The registry holds the CLI-5 command tree plus `generate`. The commands that are not built yet are placeholders, registered from the factory with no module. The v6 `admin`, `app`, and `cloudflare` command modules, and `local seed` and `local publish`, are removed; their logic stays in `lib/` for the commands that replace them.

User-facing docs for these files are in `../usage-docs/kixx-devkit/configuration.md`.

Check, Then Act
---------------

Pipelines that change remote state check every precondition before writing anything locally or remotely. `lib/cloudflare/create-worker-version.js` validates config, the Worker, the secret source, secret parity, resources, and Durable Object policy before it uploads. Keep new pipelines in that order, so a failed run leaves nothing half done.

Compatibility With the Kixx Library
-----------------------------------

The devkit talks to a Kixx application over wire formats and reads files in the application's dialects. New code takes framework logic from the project (above). The v6 modules below still port their rules, and are deleted or rewired later in this section's work:

| Devkit module | Ported from (repo `lib/`) | Conformance test |
|---|---|---|
| `lib/parse-jsonc.js` | `kixx/config/parse-jsonc.js` | `test/conformance/parse-jsonc.test.js` |
| `lib/cloudflare/secrets-manifest.js` | `kixx/config/secrets-manifest.js` | `test/conformance/secrets-manifest.test.js` |
| `lib/publishing/addressing.js` | `kixx/content-addressable-store/addressing.js` | `test/conformance/addressing.test.js` |
| `lib/publishing/content-layout.js` | `kixx/content-addressable-store/content-layout.js` | `test/conformance/content-layout.test.js` |

`test/conformance/bundle-lib.test.js` also runs the bundler against the real `lib/` app, and `local-instance-env.test.js` checks generated instance files against `lib/`'s config reader and secrets manifest.

The content scanner, the stylesheet bundler, and the asset comment stripper moved into Kixx core as the content compiler (`kixx/content-compiler/`). The devkit can't import core, so `publishRelease()` has no default scanner, and no command calls it in this version. A caller can still inject `scan`.

Rules:

- When you change one side, change the other in the same commit, and run `node devkit/run-tests.js devkit/test/conformance`.
- A new port gets a header comment naming its source and a conformance test that compares results with the original.
- `addressing.js` pins `FORMAT`. A format change upstream changes object ids, so treat it as a migration; see the module header.
- The publishing code speaks Publishing API build assignment protocol 4, content contract 2, and addressing format 4. `lib/publishing/negotiate-capabilities.js` pins these versions and refuses, before any write, a server that does not support them. Bump them there when the server protocol changes. `test/conformance/content-contract.test.js` checks that the pinned contract matches core's and that `makeReleaseManifest()` output passes core's validator.
