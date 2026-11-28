Kixx Devkit
===========

The `kixx-dev` command: local development, build, and deployment tools for Kixx
applications. In this version it regenerates a project's generated files, runs
the app locally with restarts after code changes, and manages throwaway local
instances.

Install
-------

With Node.js 24 or later:

```
npm install -g kixx-dev
```

Or with Deno 2.8 or later:

```
deno install -g -n kixx-dev -RWNE --allow-sys=homedir --allow-run jsr:@kixx/dev
```

The Deno permissions:

- `-R` read and `-W` write: project files, `.kixx` settings, Cloudflare state
  files, and the generated `cloudflare-config.generated.js`. Reading also
  covers loading your project's own Kixx tooling from its `kixx/` directory.
- `-N` net: the Cloudflare API and your application's Admin and Publishing
  APIs.
- `-E` env: the `KIXX_ADMIN_*` prompt variables.
- `--allow-sys=homedir`: find the `~/.kixx` settings layer.
- `--allow-run`: `kixx-dev dev` and `kixx-dev local start` run your app's
  `node-server.js` in a child Deno process with `-A`, so this grants it full
  access.

No FFI access is needed. `kixx-dev dev` and `kixx-dev local start` run
your app in a child process, and `kixx-dev generate` loads the Kixx tooling
from your project's `kixx/` directory. Everything else in a project is read as
data.

Upgrade:

```
npm install -g kixx-dev@latest
deno install -g -f -n kixx-dev -RWNE --allow-sys=homedir --allow-run jsr:@kixx/dev
```

Check the install with `kixx-dev --version`. Every command has `--help`, and
`kixx-dev --help` lists them all.

Every command also takes `--json`: stdout then holds exactly one JSON object,
`{ "ok": true, "command": "...", "data": {...} }` or
`{ "ok": false, "command": "...", "error": { "code", "exitCode", "message" } }`,
and everything written for a person goes to stderr.

Exit codes mean the same thing for every command: `0` success, `1` an
unexpected error, `2` a mistake you can fix (bad arguments or settings), `3`
not inside a Kixx project or an unsupported project version, and `4` a command
that is not available in this version. `kixx-dev --help --json` returns the
table.

Run a command anywhere inside your project. A Kixx project is the nearest
directory, at or above where you are, that holds `kixx/plugin.json`. You can
also pass a directory as the last argument: `kixx-dev dev ../my-app`.
Outside a project the command exits `3`.

`kixx-dev` loads the framework's own logic from your project's `kixx/`
directory, so one `kixx-dev` works with every Kixx 7 project. It refuses a
project of another major version, and tells you which `kixx-dev` to install.
If your project is newer than your `kixx-dev`, the command still runs and one
line on stderr suggests upgrading.

Commands
--------

- `kixx-dev generate` — rewrite the generated registries, routes, and
  `example.env.secrets` after you change a manifest (`kixx/plugin.json`, a
  plugin's `plugin.json`, or `app/app.json`). Commit what it writes.
- `kixx-dev dev` — run the app locally, restarting after code changes.
- `kixx-dev local create` — create a throwaway local instance.
- `kixx-dev local start` — run an instance under the devserver.
- `kixx-dev local list` — list instances.
- `kixx-dev local destroy` — delete a stopped instance.

`kixx-dev --help` also lists the commands that are not available in this
version, each marked so: `new`, `add`, `remove`, `upgrade`, `agents sync`,
`check`, `routes`, `render`, `publish`, `deploy`, `release list` and `assign`,
`media upload`, `env create` and `list`, `cloudflare provision`, `secrets set`
and `rotate`, `deploy-key generate` and `rotate`, `admin invite`, `reset`,
`migrations`, and `jobs`, and `local seed` and `publish`. Each has `--help`,
and running one exits `4`.

The v6 command names (`kixx dev start`, the `app` commands, the `cloudflare`
worker commands, and the old `admin` commands) are gone, with no alias.

Documentation:

- [configuration.md][configuration-doc]: `.kixx` settings,
  `cloudflare-config.jsonc`, `.env.<env>`, and `example.env.secrets`.
- [admin.md][admin-doc]: admin accounts, tokens, and migrations.
- [app.md][app-doc]: publishing content.
- [cloudflare.md][cloudflare-doc]: Workers, versions, deployment, and
  workflows.
- [dev.md][dev-doc]: the local devserver.
- [local.md][local-doc]: throwaway local instances.

`app` commands require an application serving content contract 2, addressing
format 4, and build assignment protocol 4; see [app.md][app-doc-server-requirement].

Not included: creating D1, KV, or R2 resources, and managing Worker secrets.
Use the Cloudflare dashboard or Wrangler for those.

<!-- Absolute links so they resolve on npmjs.com and jsr.io. -->
[configuration-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/configuration.md
[admin-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/admin.md
[app-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/app.md
[app-doc-server-requirement]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/app.md#server-requirement
[cloudflare-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/cloudflare.md
[dev-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/dev.md
[local-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-devkit/local.md

Development
-----------

Install dev dependencies once with `npm install` at the repo root; the devkit's
runners use them. From the repo root:

```
node devkit/run-tests.js                     # full suite on Node.js
deno run -A devkit/run-tests.js              # full suite on Deno
node devkit/run-tests.js devkit/test/lib     # a subtree
node devkit/run-linter.js devkit             # lint
node devkit/kixx-dev.js <command>            # run the CLI from source
```

The runners accept paths relative to the current directory. `run-tests.js`
also takes `--skip <path>` (repeatable). See
[commands/README.md][commands-readme] for adding a command and
[test/README.md][test-readme] for writing tests.

### The project skeleton

`templates/project/` holds every hand-written file of a new Kixx project
with no plugins: the app, its entry points and configs for each target,
placeholder pages, and its own test and lint setup. It ships in the package
as data. The scaffold command (`kixx-dev new`, not written yet) will copy it
into a new project, copy core in beside it as `kixx/`, and generate the
registries.

- Its files import core as `./kixx/...`, which exists only once a project is
  built. Nothing in the devkit imports, runs, or lints them.
- It holds no core and no generated file.
- `gitignore` is written into the project as `.gitignore`. It is the only
  file that is renamed.
- The repository's import hygiene test (`test/kixx/import-hygiene.test.js`)
  checks its imports.

[commands-readme]: https://github.com/kixx-framework/kixx/blob/main/devkit/commands/README.md
[test-readme]: https://github.com/kixx-framework/kixx/blob/main/devkit/test/README.md

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
