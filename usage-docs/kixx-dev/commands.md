# Commands

Every `kixx-dev` command, what works in this version, and the parts every
command shares: `--help`, `--json`, and the exit codes.

```sh
kixx-dev <command> [options] [...args]
```

Put the command name first. A name is one word (`dev`) or two (`local list`),
and both words of a two-word name go together, before the command's options:
`kixx-dev local list --target ../instances`, not
`kixx-dev local --target ../instances list`.

## Commands that work

| Command | What it does |
| --- | --- |
| `generate` | Rewrites your project's generated files from its manifests. See [below](#generate). |
| `dev` | Runs your app locally and restarts it after code changes. See [dev.md](dev.md). |
| `local create` | Creates a throwaway local instance. See [local.md](local.md). |
| `local start` | Runs a local instance. |
| `local list` | Lists local instances. |
| `local destroy` | Deletes a stopped local instance. |

## Commands that are not available in this version

These commands are registered, so `kixx-dev --help` lists them and each one
has `--help`. They are not built yet. Running one prints a message and exits
`4`.

| Command | What it will do |
| --- | --- |
| `new` | Scaffold a project |
| `add` | Install a plugin |
| `remove` | Remove a plugin |
| `upgrade` | Upgrade vendored code |
| `agents sync` | Regenerate harness files |
| `local seed` | Create the root admin of a local instance |
| `local publish` | Publish content to a local instance |
| `check` | Validate content |
| `routes` | List routes |
| `render` | Render a page |
| `publish` | Content-only publish, or pre-stage a build |
| `deploy` | Cloudflare: bundle, pre-stage, deploy |
| `release list` | Show the release history |
| `release assign` | Assign a release; emergency rollback |
| `media upload` | Upload media to the site media bucket |
| `env create` | Create an environment and its branch |
| `env list` | List environments and their branches |
| `cloudflare provision` | Provision resources, secrets, and custom domains |
| `secrets set` | Set a Worker secret |
| `secrets rotate` | Rotate a Worker secret |
| `deploy-key generate` | Generate the deploy key |
| `deploy-key rotate` | Rotate the deploy key |
| `admin invite` | Invite an admin, with the deploy key |
| `admin reset` | Reset an admin, with the deploy key |
| `admin migrations` | List and run migrations, with the deploy key |
| `admin jobs` | Inspect background jobs, with the deploy key |

The commands of Kixx 6 (`kixx dev start`, `kixx app publish`, the
`kixx cloudflare` Worker commands, and the old `kixx admin` commands) are
gone. They have no alias.

## `generate`

```sh
kixx-dev generate [directory]
```

Rewrites the five generated files at the top of your project:

- `node-registry.generated.js`
- `cloudflare-registry.generated.js`
- `cloudflare-durable-objects.generated.js`
- `routes.generated.js`
- `example.env.secrets`

Run it after you change a manifest: `kixx/plugin.json`, a plugin's
`plugin.json`, or `app/app.json`. Commit what it writes. Never edit a
generated file by hand; the next run replaces it.

`generate` uses the generator in your project's own `kixx/` directory, so
the files are what your project's version of Kixx expects. It writes nothing
when a manifest is invalid: it prints each problem and exits `2`.

```
$ kixx-dev generate
wrote /home/you/my-site/node-registry.generated.js
wrote /home/you/my-site/cloudflare-registry.generated.js
wrote /home/you/my-site/cloudflare-durable-objects.generated.js
wrote /home/you/my-site/routes.generated.js
wrote /home/you/my-site/example.env.secrets
```

## Where a command runs

`generate`, `dev`, and the `local` commands need a Kixx project. Run them
anywhere inside your project, or pass a directory in the project as the last
argument:

```sh
kixx-dev dev ../my-site
```

See [configuration.md](configuration.md#how-a-project-is-found) for how the
project is found and which project versions are supported.

## `--help`

`kixx-dev --help` lists every command. `kixx-dev local --help` lists the
`local` commands. `kixx-dev <command> --help` shows one command's arguments
and options. Help works anywhere, inside a project or not.

```
$ kixx-dev generate --help
Usage: kixx-dev generate [options] [directory]

  Rewrite the project's generated files from its manifests: the registries, the
  routes, and example.env.secrets. Run it after you change kixx/plugin.json, a
  plugin's plugin.json, or app/app.json, and commit what it writes.

Arguments:
  directory  A directory in the project; defaults to the current directory

Options:
  -h, --help     Show this help
  -v, --version  Print the kixx-dev version
      --json     Write the result to stdout as one JSON object
```

`kixx-dev --version` prints the version.

## `--json`

Every command takes `--json`, for scripts and agents. With it:

- stdout holds exactly one line: one JSON object, then a newline.
- Everything written for a person goes to stderr.
- The exit code is the same as without `--json`.

The object has one of two shapes.

**Success.** `data` holds the command's result. It is `{}` when the command
has nothing to report.

```json
{ "ok": true, "command": "<name>", "data": { } }
```

**Failure.** `error.code` is a stable name, `error.exitCode` is the process
exit code, and `error.message` is the text a person would have read.

```json
{ "ok": false, "command": "<name>", "error": { "code": "<name>", "exitCode": 2, "message": "..." } }
```

`command` is the command's name, or `null` when no command was found (for
example `kixx-dev --version --json`, or a name that does not exist). An error
may carry more fields beside the three above. When a manifest is invalid,
`error.problems` lists each problem as `{ "message", "source" }`.

New fields may be added to these objects. Fields are not removed or renamed.

A command that runs until you stop it (`dev`, `local start`) writes its one
object when it ends: `data` is `{ "port", "environment" }`. Until then stdout
is silent, and your app's output goes to stderr.

### An example of each outcome

The examples below are real output, with the project's directory shown as
`/home/you/my-site`.

A command that finished (exit `0`):

```
$ kixx-dev generate --json 2>/dev/null
{"ok":true,"command":"generate","data":{"projectDirectory":"/home/you/my-site","files":["node-registry.generated.js","cloudflare-registry.generated.js","cloudflare-durable-objects.generated.js","routes.generated.js","example.env.secrets"]}}
```

A mistake you can fix (exit `2`):

```
$ kixx-dev dev --port abc --json
{"ok":false,"command":"dev","error":{"code":"UsageError","exitCode":2,"message":"The --port value must be an integer from 0 to 65535 (got \"abc\")"}}
```

A command name that does not exist (exit `2`):

```
$ kixx-dev frobnicate --json
{"ok":false,"command":null,"error":{"code":"UsageError","exitCode":2,"message":"The command \"frobnicate\" does not exist. Run \"kixx-dev --help\" for the list."}}
```

Not inside a Kixx project (exit `3`), run here from `/home/you`:

```
$ kixx-dev generate --json
{"ok":false,"command":"generate","error":{"code":"ProjectNotFound","exitCode":3,"message":"/home/you is not inside a Kixx project: no directory at or above it holds kixx/plugin.json. Run this command inside a project, or pass the project's directory."}}
```

A command that is not available in this version (exit `4`):

```
$ kixx-dev publish --json
{"ok":false,"command":"publish","error":{"code":"CommandNotAvailable","exitCode":4,"message":"The \"publish\" command is not available in this version of kixx-dev."}}
```

The version:

```
$ kixx-dev --version --json
{"ok":true,"command":null,"data":{"version":"7.0.0-alpha.0"}}
```

### Help as data

`--help --json` returns help as data instead of text.

- `kixx-dev --help --json`: `data` is `{ "version", "commands", "exitCodes" }`.
  Each command is `{ "name", "description", "available" }`, and each exit code
  is `{ "code", "name", "meaning" }`.
- `kixx-dev local --help --json`: `data` is
  `{ "group", "description", "commands" }`.
- `kixx-dev <command> --help --json`: `data` describes the command.

```
$ kixx-dev generate --help --json
{"ok":true,"command":"generate","data":{"name":"generate","available":true,"description":"Rewrite the project's generated files from its manifests: the registries, the routes, and example.env.secrets. Run it after you change kixx/plugin.json, a plugin's plugin.json, or app/app.json, and commit what it writes.","usage":"kixx-dev generate [options] [directory]","positionals":[{"name":"directory","description":"A directory in the project; defaults to the current directory","required":false}],"options":[],"requiredConfig":[],"requiredSecrets":[],"requiresProject":true}}
```

Each entry of `options` is
`{ "name", "short", "type", "multiple", "default", "description" }`. `short`
and `default` are `null` when the option has none. `available` is `false` for
a command that is not built yet.

## Exit codes

Each number means the same thing for every command.

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | `Success` | The command finished. |
| `1` | `UnexpectedError` | An unexpected error: a defect, printed with its stack. |
| `2` | `UsageError` | A mistake the user can fix. The message is printed with no stack. |
| `3` | `ProjectNotFound` | The command needs a Kixx project and was not run inside one. |
| `3` | `UnsupportedProjectVersion` | This kixx-dev does not support the project's Kixx version. |
| `4` | `CommandNotAvailable` | The command is not available in this version of kixx-dev. |

The name is the `error.code` of the `--json` object, with one exception: an
exit `2` may carry a more specific code, such as `ValidationError` for an
invalid manifest. Check `error.exitCode` to tell the kind of failure, and
`error.code` to tell which one.

Later versions add codes from `10` up, each for one named refusal. No code is
`126` or higher, because shells use those.
