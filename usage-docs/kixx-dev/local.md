# `kixx-dev local` — Throwaway Local Instances

A local instance is a writable copy of your app's data running on your
machine. Each instance has its own port, Build ID, secrets, and data stores,
apart from the `development` environment's. Create as many as you like and
delete them when you are done.

**In this version an instance can be created, started, listed, and
destroyed.** `kixx-dev local seed` and `kixx-dev local publish` are not
available yet, so an instance has no admin login and no way to take a publish
from `kixx-dev`. See [What is not available](#what-is-not-available).

## Quick start

```sh
kixx-dev local create alpha     # port, Build ID, and secrets
kixx-dev local start alpha      # run it; Ctrl-C to stop
kixx-dev local list             # every instance, and whether it is running
kixx-dev local destroy alpha    # once it is stopped
```

`create` prints the next command to run, including the project directory and
`--target` when you passed them.

## Directories

Every command takes a directory in your project as an optional last argument.
The project is found from it, or from the working directory when you pass
none; see [configuration.md](configuration.md#how-a-project-is-found).

Every command takes `-t`, `--target <dir>`, the directory holding
`instances/`. The default is `<project>/.kixx`, so instances live in
`<project>/.kixx/instances/`. A
relative `--target` resolves against the working directory.

`kixx-dev local` never writes a `.gitignore`. Add the instances directory to yours,
for example:

```
.kixx/instances/
```

Keep a custom `--target` in a directory whose name starts with `.`, or outside
the project, so `kixx-dev local start`'s file watcher ignores the instance's data files.

## Commands

```sh
kixx-dev local create [-t <dir>] [-p <port>] <name> [directory]
kixx-dev local start [-t <dir>] <name> [directory]
kixx-dev local list [-t <dir>] [directory]
kixx-dev local destroy [-t <dir>] <name> [directory]
```

An instance name is lowercase letters and digits, separated by single hyphens
(`alpha`, `pr-42`).

| Command | Option | Description |
| --- | --- | --- |
| `create` | `-p`, `--port` | Port for the instance; default a free port |
| all | `-t`, `--target` | Directory holding `instances/`; default `<project>/.kixx` |

Every command also takes `--help` and `--json`; see
[commands.md](commands.md). With `--json`, `create` returns
`{ "name", "port", "buildId", "directory" }`, `list` returns
`{ "instances": [ { "name", "port", "seeded", "running" } ] }`, `destroy`
returns `{ "name" }`, and `start` returns `{ "port", "environment" }` when it
stops.

### `create`

Makes `<target>/instances/<name>/` with a port, a fresh Build ID
(`local-<name>-<milliseconds>`), and generated secrets. It fails when the
instance exists, when the project has no `node-server.js`, or when it has no
`example.env.secrets`; in the last two cases it leaves nothing behind.

It reads `example.env.secrets` with the parser in your project's own `kixx/`
directory. It never prints a secret value.

### `start`

Runs the [devserver](dev.md) in the foreground on the instance port, with the
`local` environment and the instance's `.env`. The app server restarts after
code changes, as under `kixx-dev dev`. Ctrl-C stops it.

`start` refuses an instance whose port already accepts connections.

### `list`

Shows every instance in the target with its port, whether it is seeded
(`credentials.json` exists), and whether it is running (its port accepts
connections). No instance is seeded in this version.

### `destroy`

Deletes the instance directory and all of its data. It refuses while the
instance port accepts connections; stop the instance first.

## What is not available

`kixx-dev local seed` and `kixx-dev local publish` are listed by
`kixx-dev local --help`, and running either exits `4`.

- **`seed`** will create an admin login for the instance. It waits for the
  admin plugin.
- **`publish`** will publish your content to a running instance. It waits for
  the publish command.

Until then, an instance serves what your app serves with no published
Release. Its secrets include `ADMIN_BOOTSTRAP_TOKEN` and a random
`DEPLOY_KEY_HASH` whose key nobody holds, so the Publishing API on an
instance refuses every request.

## Instance layout

```
<target>/instances/<name>/
    instance.json        { "port": <port> }
    .env                 ENVIRONMENT=local, BUILD_ID, DATA_DIRECTORY=<this directory>
    .env.secrets         generated secrets (mode 0600)
    ...                  data stores the running app creates
```

`.env` starts from the active assignments in the project's `example.env`, without
`PORT`, then sets `ENVIRONMENT`, `BUILD_ID`, and `DATA_DIRECTORY`. The `local`
environment in `node-config.jsonc` puts every data store under
`DATA_DIRECTORY`.

The port lives in `instance.json`, not in `.env`, so a `PORT` exported in your
shell never collides with it. To run an instance's server by hand, pass both:

```sh
node node-server.js --environment local --dotenv <instance>/.env --port <port>
```

### Secrets

`.env.secrets` holds a random 64-character hex value for each required name in
the project's `example.env.secrets`, plus `ADMIN_BOOTSTRAP_TOKEN`. Instances
run as `local`, not `development`, so names marked
`# @required-outside-development`, such as core's `DEPLOY_KEY_HASH`, count as
required. Other names marked `# @optional` are left out, because a random value
for a third-party key would turn on a feature with a bogus credential. Add
those to the instance's `.env.secrets` by hand.

`.env.secrets` is plain text. Do not commit or share it.

## Shell environment collisions

The app server refuses to start when a name is set both in its dotenv files
and in the process environment. `create` and `start` warn when your
shell has a non-empty value for a name in the instance's `.env` or
`.env.secrets` (for example an exported `ENVIRONMENT`). Unset it before
running the instance.

## Runtimes

`start` runs the app server on the same runtime as `kixx-dev`, as
[`kixx-dev dev`](dev.md#runtimes) does. On Deno it needs `--allow-run`, which
the install command grants.
