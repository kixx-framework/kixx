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

You also need `git` installed. `kixx-dev` may run your local `git`; no
command in this version does yet.

The Deno permissions:

- `-R` read and `-W` write: your project's files and the `.kixx` settings and
  instance directories. Reading also covers loading your project's own Kixx
  tooling from its `kixx/` directory.
- `-N` net: the local devserver, and later your application's Admin and
  Publishing APIs and the Cloudflare API.
- `-E` env: checking your shell for names that collide with an instance's
  dotenv files, and the environment your app's process inherits.
- `--allow-sys=homedir`: find the `~/.kixx` settings layer.
- `--allow-run`: two things only. `kixx-dev dev` and `kixx-dev local start`
  run your app's `node-server.js` in a child Deno process with `-A`, so this
  grants it full access. And `kixx-dev` may run your local `git`.

No FFI access is needed.

`kixx-dev` runs your project's code in two ways, and no other:

- **In its own process:** `kixx-dev generate` and `kixx-dev local create`
  load the Kixx tooling from your project's `kixx/` directory. Your `app/`
  code, your plugins, and your entry points are never loaded this way.
- **As a child process:** `kixx-dev dev` and `kixx-dev local start` run your
  app's `node-server.js`.

Everything else in a project is read as data.

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
table, and [commands.md][commands-doc] documents it.

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
version, under their own heading. Each has `--help`, and running one exits
`4`:

- `new`, `add`, `remove`, `upgrade`
- `agents sync`
- `local seed`, `local publish`
- `check`, `routes`, `render`
- `publish`, `deploy`
- `release list`, `release assign`
- `media upload`
- `env create`, `env list`
- `cloudflare provision`
- `secrets set`, `secrets rotate`
- `deploy-key generate`, `deploy-key rotate`
- `admin invite`, `admin reset`, `admin migrations`, `admin jobs`

The Kixx 6 command names (`kixx dev start`, the `app` commands, the
`cloudflare` worker commands, and the old `admin` commands) are gone, with no
alias.

Documentation:

- [commands.md][commands-doc]: every command and whether it is available,
  `generate`, `--help`, `--json` and its output, and the exit codes.
- [configuration.md][configuration-doc]: how a project is found, supported
  project versions, the `.kixx` settings, and the project files the CLI reads.
- [dev.md][dev-doc]: the local devserver.
- [local.md][local-doc]: throwaway local instances.

<!-- Absolute links so they resolve on npmjs.com and jsr.io. -->
[commands-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-dev/commands.md
[configuration-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-dev/configuration.md
[dev-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-dev/dev.md
[local-doc]: https://github.com/kixx-framework/kixx/blob/main/usage-docs/kixx-dev/local.md

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
