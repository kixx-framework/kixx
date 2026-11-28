# Fixture project

A small Kixx project the unit suite reads and boots: core, two tiny plugins, an app with one secret, a little content, thin entry points, virtual hosts, and the five generated files. Its tests are in `test/fixtures/project.test.js`, `test/fixtures/project-content.test.js`, and `test/fixtures/project-pages.test.js`. They boot it with `test/fixtures/fixture-project-boot.js`.

| Path | What it shows |
|---|---|
| `app/app.js`, `app/app.json` | The app's lifecycle module, its one required secret, and a template helper it declares and registers. |
| `plugins/visits/` | Adapters per target, config defaults, an optional secret, mounted routes, a content root, a declared template helper, `start()` and `stop()`, and routes contributed only when `panel` is installed. Its block for `reports`, which is not installed, must leave no trace. |
| `plugins/visits/pages/` | The plugin's two pages. `/visits` uses the helper the plugin declares, and a global partial the project supplies; the plugin's own route answers that URL first, so it is compiled and never rendered. `/visits/about` has no route, so the catch-all renders it. |
| `plugins/panel/` | A dependency, a required secret, and middleware on a mount. |
| `plugins/draft/` | A directory without a `plugin.json`. It is not a plugin. |
| `pages/`, `templates/`, `static-assets/`, `public/` | The project's content: two pages, one base template, one global partial, one stylesheet, and one public file. The home page's template uses the helper the app declares; the project's own route answers `/` first, so it is compiled and never rendered. `/about` has no route, so the catch-all renders it. The base template links the stylesheet with `assetUrl`. |
| `virtual-hosts.js` | The project's own routes (the home route and the fingerprinted asset route), then `pluginRoutes`, then the catch-all, which serves content the way a real project does: a static asset by its pathname, else a page. |
| `node-server.js`, `cloudflare-server.js` | The entry points. Each is a thin shell. |
| `node-config.jsonc` | Two environments, each holding only what has no default: a log level and one override of a plugin default. Neither names a store path, so the stores are at core's defaults under `data/`. `test` serves the Release assigned to its build. `development` leaves out `CONTENT_STORE.workingTree`, so it renders the working tree. |
| `cloudflare-config.jsonc` | One environment, `test`. |
| `*.generated.js`, `example.env.secrets` | Generated from the manifests, and committed. |

## Rules

- **Never edit a generated file.** After changing a manifest (`plugin.json` or `app/app.json`), regenerate from the repository root and commit the result:

  ```
  node tools/generate-registries.js test/fixtures/project --core ../../../kixx
  ```

  A test fails while the committed files differ from what the generator writes.
- **No `*.test.js` file in here.** The test runner would collect it.
- **No directory named `data` or `tmp`.** Git ignores them.
- **No test writes in here.** A test that edits content copies the config and content to a temporary directory and boots the copy. Every boot sets a temporary `DATA_DIRECTORY`, so the default store paths land in `<DATA_DIRECTORY>/data/` and never in this directory.
- **Content compiles with no problem and no unmatched file.** A test compiles it through the tooling entry and the Node.js adapters. Keep each content file a few lines, with a lowercase name. A development boot renders it from this directory, so a problem here breaks that boot's tests too.
- **Core is `../../../kixx` here.** A real project holds its own copy at `./kixx`.
- **Nothing loads `cloudflare-server.js`.** It imports `cloudflare:workers`, and `./cloudflare-config.generated.js`, which a deploy writes and which isn't committed, as in a real project. Unit tests never import either entry point.
- **Platform-neutral code stays platform-neutral.** `app/`, a plugin's files outside `adapters/`, and `virtual-hosts.js` import no `node:*` or `cloudflare:*` module and no adapter.
