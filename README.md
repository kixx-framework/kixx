Kixx
====

__A web development framework for you and your clankers to build anything from a home-cooked website to the next unicorn.__

Build web applications with AI agents without generating piles of shit code you’ll need to rewrite later. Kixx is optimized for solo developers and small teams with an emphasis on productivity, craftsmanship, portability, and durability.

- Server-side JavaScript to run on Cloudflare Workers, AWS Lambda, Node.js and Deno.
- Supports hypermedia-driven applications with server-side HTML template rendering.
- Of course you can also use it to build a JSON API or single-page client application.
- Component based design so you can choose only what you need and leave the rest behind.
- Provides well worn paths for most use cases, but also includes escape hatches so you can go your own way.
- Kixx applications are easy to hack on.
- Designed for token efficiency in the agentic coding world.

Deploy on:

- [x] Node.js
- [ ] Deno
- [x] Cloudflare
- [ ] AWS Lambda

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2026.

---

Repository Layout
-----------------

This mono-repo holds every part of the Kixx framework. The important directories and files (up to 2 levels deep):

```
kixx/
├── .github/workflows/ci.yml     # CI: lint and unit tests on Node.js and Deno
├── kixx/                        # Core, vendored into projects as kixx/
│   ├── config/, context/, http-router/, hyperview/, logger/, ...   # Framework modules
│   ├── content-compiler/        # Compiles content into objects and a Release manifest, and checks it
│   ├── adapters/                # Platform adapters: node/, cloudflare/
│   ├── plugin.json              # Core's manifest, in the plugin manifest schema
│   ├── tooling/                 # Manifest validation, the registry generator, and the entry a CLI loads
│   ├── vendor/                  # Third-party code, vendored unmodified: acorn, marked, path-to-regexp, templating
│   └── document-store/, jobs/, object-store/, permissions/
│                                # Leaving core in later sections (see test/kixx/import-hygiene.test.js)
├── plugins/                     # First-party plugins; today only README.md, the plugin guide
├── test/                        # Unit tests mirroring kixx/ (and later plugins/)
│   ├── fakes/                   # Shared fakes of platform services (KV, Durable Objects)
│   ├── fixtures/                # A small project that boots from generated registries
│   ├── test-app/                # Unit tests for the integration runner and the probe
│   └── tools/                   # Unit tests for tools/lib/
├── test-app/                    # Integration suite, run against a real target (see test-app/README.md)
│   ├── run-tests.js             # Integration test runner (`node test-app/run-tests.js --local`)
│   ├── probe/                   # Runs shared test suites inside a running server
│   └── test/                    # Integration tests
├── docs/                        # Maintainer guides; start with doc-index.md
├── devkit/                      # The `kixx` CLI, published as kixx-devkit; stand-alone
│   ├── kixx.js                  # CLI entry point
│   ├── commands/                # Thin command wrappers: admin, app, cloudflare, dev, local
│   ├── lib/                     # Command logic; vendored code in lib/vendor/
│   ├── templates/project/       # The project skeleton a new project is copied from
│   ├── docs/                    # Developer guides; start with doc-index.md
│   ├── test/                    # Unit tests (most still parked in test-v6/devkit/)
│   ├── run-tests.js             # Test runner (`node devkit/run-tests.js [path]`)
│   └── run-linter.js            # Linter (`node devkit/run-linter.js <path>`)
├── reference-app/               # What remains of the v6 starter app: source material, not runnable
├── test-v6/                     # v6 tests not yet brought back; never run or linted
├── tools/                       # Scripts for working on this repo
│   ├── build-project.js         # Builds a project with no plugins from the skeleton and core
│   ├── generate-registries.js   # Writes a project's registries from its manifests
│   └── lib/                     # The project assembly and the import walker
├── usage-docs/                  # Public docs (see usage-docs/README.md)
├── agents/plans/                # Structured implementation plans
├── run-tests.js                 # Unit test runner (`node run-tests.js [path]`)
├── run-linter.js                # Linter (`node run-linter.js [path]`)
├── eslint.config.js             # Lint config for kixx/, plugins/, test/, test-app/, and tools/
├── package.json                 # Private; dev dependencies only
├── vendored-code.json           # Version and digest of every vendored copy
└── deno.json                    # Deno lint settings
```

`reference-app/` is what remains of the v6 starter app. It is not maintained or runnable; it shrinks as code moves out of it, and is deleted at the end of the extraction. `test-v6/` holds the v6 tests (the v6 integration suites included) until each is brought back beside the code it covers.

**Continuous Integration.** GitHub Actions runs `.github/workflows/ci.yml` on every push and pull request. It runs `node run-linter.js` on Node.js 24, and the unit suite with `node run-tests.js` on Node.js 24 and `deno run -A run-tests.js` on Deno 2.8. The devkit suite isn't in CI yet; run it by hand with `node devkit/run-tests.js`. The integration suite in `test-app/` isn't in CI either: the operator runs it against a running or deployed test app.

Kixx Core
---------

Kixx core lives in `kixx/`. When we say "Kixx", we mean core (not `devkit/`). It is vendored into each project as `kixx/`, so it never imports anything outside itself.

- Modules - HTTP routing, server-rendered HTML pages and templates, data storage (key/value and published content), the content compiler and its pre-publish checks, the Publishing API and its deploy key, logging, and configuration.
- `adapters/` - Connectors that run the same app on Node.js (`node/`, which Deno also uses) or Cloudflare (`cloudflare/`). Your app code doesn't change between platforms.

A plugin is a directory in `plugins/` with a manifest, `plugin.json`. Core has one too (`kixx/plugin.json`). From the installed manifests a generator writes registries, which wire core and the plugins into each platform's entry point, so adding a plugin never edits an entry point. The registries are committed. See [plugins/README.md](plugins/README.md). No plugin ships yet.

Kixx Devkit
-----------

The Kixx Devkit lives in `devkit/`. It provides the `kixx` command line tool, which you install from npm or JSR and run against your project. You don't add it to your app's code.

With it you can:

- `kixx dev` - Run your app locally. It restarts when you change the code.
- `kixx local` - Run throwaway local instances with writable data, to test publishing and admin signup.
- `kixx admin` - Create the first admin account and run data migrations.
- `kixx app` - Publish your site's content to a running app.
- `kixx cloudflare` - Create, upload, and deploy your app as a Cloudflare Worker.

`devkit/templates/project/` is the project skeleton: every hand-written file of a new project with no plugins. It ships inside the devkit, and holds no core and no generated file.

See [devkit/README.md](devkit/README.md) to install it.

---

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
