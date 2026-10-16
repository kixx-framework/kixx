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

This mono-repo holds every part of the Kixx framework.

- `lib/` - The Kixx library (`lib/kixx/`) plus a default application built on it (`app/`, `routes/`, `pages/`, `templates/`, etc.). Not deployable on its own; it will run locally on a devserver (not built yet) under Node.js or Deno. Will later be published to NPM and JSR as a standalone library.
- `devkit/` - Source for the `kixx-devkit` package (NPM and JSR): the `kixx` command line tool for building and deploying Kixx applications.
- `test-app/` - A deployable copy of `lib/` used for end-to-end testing on each deployment target. Holds the e2e suite and its runner, run before a release. Copied code is ignored by git; only its config and test harness are tracked. See `test-app/README.md`.
- `tools/` - Scripts for working on this repo, such as the test app builder.
- `usage-docs/` - Public docs for app server users (`kixx-app/`) and the `kixx` CLI (`kixx-devkit/`).
- `agents/` - Working notes for AI agents: implementation plans and a daily activity journal.

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
- `kixx admin` - Create the first admin account, mint publishing tokens, and run data migrations.
- `kixx app` - Publish your site's content to a running app.
- `kixx cloudflare` - Create, upload, and deploy your app as a Cloudflare Worker.

See [devkit/README.md](devkit/README.md) to install it.

---

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
