Kixx
====

__A web development framework for you and your clankers to build anything from a home-cooked website to the next unicorn.__

Build web applications with AI agents without generating piles of shit code you’ll need to rewrite later. Kixx is optimized for solo developers and small teams with an emphasis on productivity, craftsmanship, portability, and durability.

- Server-side JavaScript to run on Cloudflare Workers, AWS Lambda, Node.js and Deno.
- Supports hypermedia-driven applications with server-side HTML template rendering.
- But, of course you can also use it to build a JSON API or single-page client application.
- Component based design so you can choose only what you like and leave the rest behind.
- Provides common paths for most use cases, but also includes escape hatches so you can go your own way.
- Kixx applications are fun and easy to hack on.
- Designed for token efficiency so you can keep your costs under control when using agents.

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
├── README.md                    # This file; project overview
├── CLAUDE.md                    # Instructions for AI agents working in this repo
├── LICENSE                      # MIT license
├── lib/                         # The Kixx library plus a starter app built on it
│   ├── kixx/                    # Framework modules; third-party code in kixx/vendor/
│   ├── plugins/                 # Node.js and Cloudflare adapters (see plugins/README.md)
│   ├── app/                     # Application code (platform-neutral): models, actions, handlers, jobs, migrations
│   ├── routes/                  # Route tables (admin panel, admin APIs, publishing API, files)
│   ├── pages/                   # Page content and page.json directives, by URL path
│   ├── templates/               # Base layouts and partials
│   ├── static-assets/           # Stylesheets and browser JavaScript
│   ├── public/                  # Files served at the site root (favicons, web manifest)
│   ├── emails/                  # Email templates
│   ├── node-server.js           # Node.js entry point; chooses the Node.js plugin set
│   ├── node-environment.js      # Node.js environment loading
│   ├── cloudflare-server.js     # Cloudflare Worker entry point
│   ├── virtual-hosts.js         # Virtual hosts: route tables with middleware and error handlers
│   ├── node-config.jsonc        # Node.js runtime configuration (from its .template)
│   ├── cloudflare-config.jsonc  # Cloudflare runtime configuration (from its .template)
│   ├── example.env              # Example environment variables
│   ├── example.env.secrets      # Example secret environment variables
│   ├── .kixx/                   # Example devkit settings and secrets
│   ├── docs/                    # Developer guides; start with doc-index.md
│   ├── test/                    # Unit tests mirroring the source tree, plus fixtures/
│   ├── run-tests.js             # Test runner (`node lib/run-tests.js [path]`)
│   └── run-linter.js            # Linter (`node lib/run-linter.js <path>`)
├── devkit/                      # The `kixx` CLI, published as kixx-devkit; stand-alone
│   ├── kixx.js                  # CLI entry point
│   ├── commands/                # Thin command wrappers: admin, app, cloudflare, dev, local
│   ├── lib/                     # Command logic, plus ports of some lib/ modules; vendored code in lib/vendor/
│   ├── docs/                    # Developer guides; start with doc-index.md
│   ├── test/                    # Unit tests, plus conformance/ tests against lib/
│   ├── package.json             # npm manifest; keep in sync with deno.json
│   ├── deno.json                # JSR manifest and Deno tasks
│   ├── run-tests.js             # Test runner (`node devkit/run-tests.js [path]`)
│   └── run-linter.js            # Linter (`node devkit/run-linter.js <path>`)
├── test-app/                    # Deployable copy of lib/ for end-to-end tests; copied code is git-ignored
│   ├── test/                    # E2E suite in numbered folders, run in order, plus test-helpers/
│   └── run-tests.js             # E2E test runner (see test-app/README.md)
├── tools/                       # Scripts for working on this repo
│   └── build-test-app.js        # Copies lib/ into test-app/
├── usage-docs/                  # Public docs (see usage-docs/README.md)
│   ├── kixx-app/                # Running a Kixx app: configuration and HTTP APIs
│   └── kixx-devkit/             # One page per `kixx` command, plus configuration
├── agents/                      # Working notes for AI agents
│   ├── plans/                   # Structured implementation plans written by the Plan agent
│   └── journal/                 # Daily activity journal, one file per day
└── .claude/                     # Claude Code agents, skills, output styles, and settings
```

`lib/` is not deployable on its own; run it locally with `kixx dev` or `kixx local` under Node.js or Deno. `test-app/` is the deployable copy (see `test-app/README.md`).

Kixx Library
------------

The Kixx Library lives in `lib/`. When we say "Kixx", we mean this library (not `devkit/` or `test-app/`).

`lib/` holds two things: the framework, and a working starter app built on it. Your project starts from the starter app. You build your features in the app's folders, and the framework handles the plumbing.

The framework:

- `kixx/` - HTTP routing, server-rendered HTML pages and templates, data storage (documents, key/value, files, and published content), background jobs, email, logging, permissions, and configuration.
- `plugins/` - Connectors that run the same app on Node.js or Cloudflare. Your app code doesn't change between platforms.

The starter app:

- `app/` - Your application logic: data models, one function per user action, request handlers, background jobs, and data migrations.
- `pages/`, `templates/`, `static-assets/`, `public/`, `emails/` - Your site's pages, HTML templates, CSS and JavaScript, and email templates. Includes an admin panel and a live style guide.
- `node-server.js`, `cloudflare-server.js` - The entry points for each platform.

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
