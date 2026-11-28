Kixx Usage Docs
===============

Documentation for developers and agents running a Kixx App and using
`kixx-dev`, the command line tool from the Kixx Devkit.

Kixx App
--------

- [Configuration](kixx-app/configuration.md) — where settings and secrets
  go, environments, dotenv files, job queue settings, and what a Cloudflare
  deployment expects.
- [Content](kixx-app/content.md) — where content lives, the checks it must
  pass before it becomes a Release, declaring a template helper, and
  collisions with plugin content.
- [Publishing API](kixx-app/publishing-api.md) — publish and roll back site
  content as immutable Releases assigned to builds.
- [Admin API](kixx-app/admin-api.md) — data migrations, background jobs,
  and admin invites.
- [Administrative Data API](kixx-app/admin-data-api.md) — version-checked
  direct access to registered application records.

`kixx-dev` (the Kixx CLI)
-------------------------

Install with `npm install -g kixx-dev` (Node.js 24+), or with Deno 2.8+:

```
deno install -g -n kixx-dev -RWNE --allow-sys=homedir --allow-run jsr:@kixx/dev
```

Every command has `--help` and `--json`. See the
[devkit README](../devkit/README.md) for what each Deno permission is for.

- [Commands](kixx-dev/commands.md) — every command and whether it is
  available in this version, `kixx-dev generate`, `--help`, `--json` and its
  output, and the exit codes.
- [Configuration](kixx-dev/configuration.md) — how a project is found, the
  supported project versions, the `.kixx` settings layers, and the project
  files the CLI reads.
- [`kixx-dev dev`](kixx-dev/dev.md) — run the app locally with automatic
  restarts.
- [`kixx-dev local`](kixx-dev/local.md) — throwaway local instances with
  their own port, secrets, and data.
