# Fixture project

A small Kixx project the unit suite reads and boots: core, two tiny plugins, an app with one secret, thin entry points, virtual hosts, and the five generated files. Its tests are in `test/fixtures/project.test.js`.

| Path | What it shows |
|---|---|
| `app/app.js`, `app/app.json` | The app's lifecycle module and its one required secret. |
| `plugins/visits/` | Adapters per target, config defaults, an optional secret, mounted routes, a content root, `start()` and `stop()`, and routes contributed only when `panel` is installed. Its block for `reports`, which is not installed, must leave no trace. |
| `plugins/panel/` | A dependency, a required secret, and middleware on a mount. |
| `plugins/draft/` | A directory without a `plugin.json`. It is not a plugin. |
| `virtual-hosts.js` | The project's own routes, then `pluginRoutes`, then the catch-all. |
| `node-server.js`, `cloudflare-server.js` | The entry points. Each is a thin shell. |
| `node-config.jsonc`, `cloudflare-config.jsonc` | One environment, `test`. |
| `*.generated.js`, `example.env.secrets` | Generated from the manifests, and committed. |

## Rules

- **Never edit a generated file.** After changing a manifest (`plugin.json` or `app/app.json`), regenerate from the repository root and commit the result:

  ```
  node tools/generate-registries.js test/fixtures/project --core ../../../kixx
  ```

  A test fails while the committed files differ from what the generator writes.
- **No `*.test.js` file in here.** The test runner would collect it.
- **No directory named `data` or `tmp`.** Git ignores them.
- **Core is `../../../kixx` here.** A real project holds its own copy at `./kixx`.
- **Nothing loads `cloudflare-server.js`.** It imports `cloudflare:workers`, and `./cloudflare-config.generated.js`, which a deploy writes and which isn't committed, as in a real project. Unit tests never import either entry point.
- **Platform-neutral code stays platform-neutral.** `app/`, a plugin's files outside `adapters/`, and `virtual-hosts.js` import no `node:*` or `cloudflare:*` module and no adapter.
