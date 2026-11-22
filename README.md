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
├── kixx/                        # Core, vendored into projects as kixx/
│   ├── config/, context/, http-router/, hyperview/, logger/, ...   # Framework modules
│   ├── adapters/                # Platform adapters: node/, cloudflare/, general/
│   ├── vendor/                  # Third-party code, vendored unmodified
│   └── document-store/, email-sender/, jobs/, object-store/, permissions/
│                                # Leaving core in later sections (see test/kixx/import-hygiene.test.js)
├── test/                        # Unit tests mirroring kixx/ (and later plugins/)
├── docs/                        # Maintainer guides; start with doc-index.md
├── devkit/                      # The `kixx` CLI, published as kixx-devkit; stand-alone
│   ├── kixx.js                  # CLI entry point
│   ├── commands/                # Thin command wrappers: admin, app, cloudflare, dev, local
│   ├── lib/                     # Command logic; vendored code in lib/vendor/
│   ├── docs/                    # Developer guides; start with doc-index.md
│   ├── test/                    # Unit tests (parked in test-v6/devkit/ for now)
│   ├── run-tests.js             # Test runner (`node devkit/run-tests.js [path]`)
│   └── run-linter.js            # Linter (`node devkit/run-linter.js <path>`)
├── reference-app/               # What remains of the v6 starter app: source material, not runnable
├── test-v6/                     # v6 tests not yet brought back; never run or linted
├── tools/                       # Scripts for working on this repo
├── usage-docs/                  # Public docs (see usage-docs/README.md)
├── agents/plans/                # Structured implementation plans
├── run-tests.js                 # Unit test runner (`node run-tests.js [path]`)
├── run-linter.js                # Linter (`node run-linter.js [path]`)
├── eslint.config.js             # Lint config for kixx/, plugins/, and test/
├── package.json                 # Private; dev dependencies only
└── deno.json                    # Deno lint settings
```

`reference-app/` is what remains of the v6 starter app. It is not maintained or runnable; it shrinks as code moves out of it, and is deleted at the end of the extraction. `test-v6/` holds the v6 tests (end-to-end suite included) until each is brought back beside the code it covers.

Kixx Core
---------

Kixx core lives in `kixx/`. When we say "Kixx", we mean core (not `devkit/`). It is vendored into each project as `kixx/`, so it never imports anything outside itself.

- Modules - HTTP routing, server-rendered HTML pages and templates, data storage (key/value and published content), logging, and configuration.
- `adapters/` - Connectors that run the same app on Node.js (`node/`, which Deno also uses) or Cloudflare (`cloudflare/`), plus platform-neutral plugins (`general/`). Your app code doesn't change between platforms.

Plugins arrive later in `plugins/`.

Kixx Devkit
-----------

The Kixx Devkit lives in `devkit/`. It provides the `kixx` command line tool, which you install from npm or JSR and run against your project. You don't add it to your app's code.

With it you can:

- `kixx dev` - Run your app locally. It restarts when you change the code.
- `kixx local` - Run throwaway local instances with writable data, to test publishing and admin signup.
- `kixx admin` - Create the first admin account, mint publishing tokens, and run data migrations.
- `kixx app` - Publish your site's content to a running app.
- `kixx cloudflare` - Create, upload, and deploy your app as a Cloudflare Worker.

See [devkit/README.md](devkit/README.md) to install it.

---

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
