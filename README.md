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
- `test-app/` - A deployable copy of `lib/` used for end-to-end testing on each deployment target. Copied code is ignored by git; only its config is tracked. See `test-app/README.md`.
- `tools/` - Scripts for working on this repo, such as the test app builder.
- `docs/` - API reference docs (Admin API, Publishing API).
- `agents/` - Working notes for AI agents: implementation plans and a daily activity journal.

---

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
