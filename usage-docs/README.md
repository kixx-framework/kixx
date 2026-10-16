Kixx Usage Docs
===============

Documentation for developers and agents running a Kixx App and using the
`kixx` command line tool from the Kixx Devkit.

Kixx App
--------

- [Configuration](kixx-app/configuration.md) — where settings and secrets
  go, environments, dotenv files, job queue settings, and what a Cloudflare
  deployment expects.
- [Publishing API](kixx-app/publishing-api.md) — publish and roll back site
  content as immutable Releases assigned to builds.
- [Admin API](kixx-app/admin-api.md) — data migrations, background jobs,
  admin invites, and publishing tokens.
- [Administrative Data API](kixx-app/admin-data-api.md) — version-checked
  direct access to registered application records.

Kixx Devkit (`kixx` CLI)
------------------------

Install with `npm install -g kixx-devkit` (Node.js 24+) or from JSR as
`jsr:@kixx/devkit` (Deno 2.8+). Every command has `--help`.

- [Configuration](kixx-devkit/configuration.md) — `.kixx` settings and
  secrets, `--environment`, and the files Cloudflare commands read.
- [`kixx dev`](kixx-devkit/dev.md) — run the app locally with automatic
  restarts.
- [`kixx admin`](kixx-devkit/admin.md) — create the first admin, mint
  publishing tokens, and run migrations.
- [`kixx app`](kixx-devkit/app.md) — publish content and assign it to a build.
- [`kixx cloudflare`](kixx-devkit/cloudflare.md) — create, version, and
  deploy Cloudflare Workers, with end-to-end workflows.
