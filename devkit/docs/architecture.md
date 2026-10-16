Devkit Architecture
===================

Paths are relative to `devkit/`.

Layers
------

```
kixx.js       parse argv, load settings, check required keys, run the command, print errors
commands/     wiring: parsed options + settings -> one library call -> output
lib/          all real logic, grouped by subsystem
```

`kixx.js` owns help rendering, the single directory positional, settings loading, and error printing. A command module stays thin; logic shared or worth testing on its own goes in `lib/`. See `commands/README.md`.

`lib/` Subsystems
-----------------

| Directory | Used by | Responsibility |
|---|---|---|
| `lib/` (root) | everything | Settings layers (`config-loader.js`), `cloudflare-config.jsonc` loading, JSONC, `.env.<env>` parsing, terminal prompts, text wrapping, the `fileSystem` seam, `UsageError`, hashing, and token generation |
| `lib/admin/` | `admin` | Admin API client, invite redemption, credential prompting, and environment resolution |
| `lib/publishing/` | `app` | Scanning content sources, stylesheet bundling, content addressing, capability negotiation, Release creation, and build assignment over the Publishing API |
| `lib/bundler/` | `cloudflare` | Crawls an app's static ES module graph and strips comments for upload, using vendored `acorn` |
| `lib/cloudflare/` | `cloudflare` | Cloudflare API client, config validation, bindings, secrets parity, resource checks, Durable Object exports, and the Worker version and deploy pipelines |
| `lib/devserver/` | `dev`, `local` | Proxy server, app child process, and restart decisions on file change |
| `lib/local/` | `local` | Local instance files: names, paths, generated dotenv pair, `instance.json`, credentials, listing, and removal |
| `lib/vendor/` | — | Unmodified third-party code; not linted |

Settings
--------

Commands read three inputs, all as data:

- `.kixx/config.json` and `.kixx/secrets.json`: home layer (`~/.kixx/`) merged under the project layer, deeply frozen. A `null` in the project layer cancels an inherited value. Commands declare required keys with `requiredConfig` / `requiredSecrets`.
- `cloudflare-config.jsonc`: loaded only for `cloudflare` commands. Most values are under `environments.<env>`, so commands validate what they use at run time.
- `.env.<env>` and `example.env.secrets`: read by the Cloudflare pipeline.

User-facing docs for these files are in `../usage-docs/kixx-devkit/configuration.md`.

Check, Then Act
---------------

Pipelines that change remote state check every precondition before writing anything locally or remotely. `lib/cloudflare/create-worker-version.js` validates config, the Worker, the secret source, secret parity, resources, and Durable Object policy before it uploads. Keep new pipelines in that order, so a failed run leaves nothing half done.

Compatibility With the Kixx Library
-----------------------------------

The devkit talks to a Kixx application over wire formats and reads files in the application's dialects. Because it cannot import the repository's `lib/`, some rules are ported:

| Devkit module | Ported from (repo `lib/`) | Conformance test |
|---|---|---|
| `lib/parse-jsonc.js` | `kixx/config/parse-jsonc.js` | `test/conformance/parse-jsonc.test.js` |
| `lib/cloudflare/secrets-manifest.js` | `kixx/config/secrets-manifest.js` | `test/conformance/secrets-manifest.test.js` |
| `lib/publishing/addressing.js` | `kixx/content-addressable-store/addressing.js` | `test/conformance/addressing.test.js` |
| `lib/publishing/content-layout.js` | `kixx/content-addressable-store/content-layout.js` | `test/conformance/content-layout.test.js` |

`test/conformance/bundle-lib.test.js` and `scan-lib-content.test.js` also run the bundler and content scanner against the real `lib/` app.

Rules:

- When you change one side, change the other in the same commit, and run `node devkit/run-tests.js devkit/test/conformance`.
- A new port gets a header comment naming its source and a conformance test that compares results with the original.
- `addressing.js` pins `FORMAT`. A format change upstream changes object ids, so treat it as a migration; see the module header.
- The `app` commands speak Publishing API build assignment protocol 2, content contract 1, and addressing format 4. `lib/publishing/negotiate-capabilities.js` pins these versions and refuses, before any write, a server that does not support them. Bump them there when the server protocol changes.
