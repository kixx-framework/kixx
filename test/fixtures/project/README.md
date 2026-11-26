# Fixture project

A small Kixx project the unit suite reads and boots: core, two tiny plugins, an app with one secret, a little content, thin entry points, virtual hosts, and the five generated files. Its tests are in `test/fixtures/project.test.js` and `test/fixtures/project-content.test.js`.

| Path | What it shows |
|---|---|
| `app/app.js`, `app/app.json` | The app's lifecycle module, its one required secret, and a template helper it declares and registers. |
| `plugins/visits/` | Adapters per target, config defaults, an optional secret, mounted routes, a content root, a declared template helper, `start()` and `stop()`, and routes contributed only when `panel` is installed. Its block for `reports`, which is not installed, must leave no trace. |
| `plugins/visits/pages/` | The plugin's one page, at `/visits`. Its template uses the helper the plugin declares, and a global partial the project supplies. |
| `plugins/panel/` | A dependency, a required secret, and middleware on a mount. |
| `plugins/draft/` | A directory without a `plugin.json`. It is not a plugin. |
| `pages/`, `templates/`, `static-assets/`, `public/` | The project's content: one page, one base template, one global partial, one stylesheet, and one public file. The page's template uses the helper the app declares. |
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
- **Content compiles with no problem and no unmatched file.** A test compiles it through the tooling entry and the Node.js adapters. Keep each content file a few lines, with a lowercase name. Nothing serves the content: the fixture's content store isn't in developer mode.
- **Core is `../../../kixx` here.** A real project holds its own copy at `./kixx`.
- **Nothing loads `cloudflare-server.js`.** It imports `cloudflare:workers`, and `./cloudflare-config.generated.js`, which a deploy writes and which isn't committed, as in a real project. Unit tests never import either entry point.
- **Platform-neutral code stays platform-neutral.** `app/`, a plugin's files outside `adapters/`, and `virtual-hosts.js` import no `node:*` or `cloudflare:*` module and no adapter.
