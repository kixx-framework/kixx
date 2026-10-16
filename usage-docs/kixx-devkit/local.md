# `kixx local` — Throwaway Local Instances

A local instance is a writable copy of your app's data running on your
machine. Use one to exercise write paths that the `development` environment
cannot: its content store reads pages and templates straight from disk and
is read-only, so the Publishing API, admin signup, and published Releases need
an instance.

Each instance has its own port, Build ID, secrets, and data stores. Create as
many as you like and delete them when you are done.

## Quick start

```sh
kixx local create alpha     # port, Build ID, and secrets
kixx local seed alpha       # admin login, publishing token, published content
kixx local start alpha      # run it; Ctrl-C to stop
kixx local publish alpha    # in another shell, after editing content
kixx local destroy alpha    # once it is stopped
```

`seed` and `create` print the next command to run, including the app
directory and `--target` when you passed them.

## Directories

Every verb takes the app directory as an optional last argument, found as for
every other command: the nearest ancestor of `directory` (default: the working
directory) with a `.kixx/` directory, or `directory` itself when there is none.

Every verb takes `-t`, `--target <dir>`, the directory holding `instances/`.
The default is `<app>/.kixx`, so instances live in `<app>/.kixx/instances/`. A
relative `--target` resolves against the working directory.

`kixx local` never writes a `.gitignore`. Add the instances directory to yours,
for example:

```
.kixx/instances/
```

Keep a custom `--target` in a directory whose name starts with `.`, or outside
the app, so `kixx local start`'s file watcher ignores the instance's data files.

## Commands

```sh
kixx local create [-t <dir>] [-p <port>] <name> [directory]
kixx local seed [-t <dir>] [--verbose] <name> [directory]
kixx local start [-t <dir>] <name> [directory]
kixx local publish [-t <dir>] [--dry-run] [--verbose] <name> [directory]
kixx local list [-t <dir>] [directory]
kixx local destroy [-t <dir>] <name> [directory]
```

An instance name is lowercase letters and digits, separated by single hyphens
(`alpha`, `pr-42`).

| Command | Option | Description |
| --- | --- | --- |
| `create` | `-p`, `--port` | Port for the instance; default a free port |
| `seed` | `--verbose` | Stream the app server output. Without it, the output shows only when the server fails to start. |
| `publish` | `--dry-run` | Preview the server-backed object diff without writes |
| `publish` | `--verbose` | List every resource and disposition |
| all | `-t`, `--target` | Directory holding `instances/`; default `<app>/.kixx` |

### `create`

Makes `<target>/instances/<name>/` with a port, a fresh Build ID
(`local-<name>-<milliseconds>`), and generated secrets. It fails when the
instance exists, when the app directory has no `node-server.js`, or when it has
no `example.env.secrets`; in the last two cases it leaves nothing behind.

### `seed`

Starts the app's `node-server.js` once in the `local` environment on the
instance port, then, over HTTP:

1. creates the admin `root@<name>.local` with a random password, using the
   instance's `ADMIN_BOOTSTRAP_TOKEN`;
2. mints a Publishing API token (role `editor`);
3. writes `credentials.json`;
4. publishes the app's content as a Release and assigns it to the instance's
   Build ID.

It stops the server afterwards, on success or failure. It prints the base URL,
username, Build ID, Release, and the `credentials.json` path, never the
password or token.

`seed` refuses an instance that is already seeded, and an instance whose port
already accepts connections.

If seeding fails:

- **Before the admin is created** (for example, the server fails to start):
  fix the problem and run `seed` again. The error includes the app server's
  output.
- **After the admin is created** but before `credentials.json` is written: the
  bootstrap token is spent, and a second `seed` fails with "The invite token is
  unknown, expired, revoked, or already used." Destroy and re-create the
  instance.
- **While publishing**: the credentials are saved. Run `kixx local start
  <name>`, then `kixx local publish <name>`.

### `start`

Runs the [devserver](dev.md) in the foreground on the instance port, with the
`local` environment and the instance's `.env`. The app server restarts after
code changes, as under `kixx dev start`. Ctrl-C stops it.

`start` refuses an instance whose port already accepts connections. Starting
an unseeded instance is allowed, for example to test admin signup with the
bootstrap token; it prints a reminder to seed.

### `publish`

Publishes the app's content to a running, seeded instance using its
`credentials.json`, and assigns the Release to the instance's Build ID. The
running server serves it on the next request; no restart is needed. Output
matches [`kixx app publish`](app.md).

Republishing is always manual. Under `start`, content changes do not restart
or republish anything; run `kixx local publish` after editing pages,
templates, or other published content.

`publish` refuses an instance that is not seeded or not running.

### `list`

Shows every instance in the target with its port, whether it is seeded
(`credentials.json` exists), and whether it is running (its port accepts
connections).

### `destroy`

Deletes the instance directory and all of its data. It refuses while the
instance port accepts connections; stop the instance first.

## Instance layout

```
<target>/instances/<name>/
    instance.json        { "port": <port> }
    .env                 ENVIRONMENT=local, BUILD_ID, DATA_DIRECTORY=<this directory>
    .env.secrets         generated secrets (mode 0600)
    credentials.json     written by seed (mode 0600)
    ...                  data stores the running app creates
```

`.env` starts from the active assignments in the app's `example.env`, without
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
the app's `example.env.secrets`, plus `ADMIN_BOOTSTRAP_TOKEN`, which `seed`
needs. Other names marked `# @optional` are left out, because a random value
for a third-party key would turn on a feature with a bogus credential. Add
those to the instance's `.env.secrets` by hand.

### `credentials.json`

```json
{
    "baseUrl": "http://localhost:<port>/",
    "username": "root@<name>.local",
    "password": "...",
    "publishingApiToken": "...",
    "buildId": "local-<name>-<milliseconds>",
    "port": <port>
}
```

Log in to the admin at `<baseUrl>admin` with `username` and `password`.

`credentials.json` is plain text. Do not commit or share it. Writing
credentials to a file is allowed only for these throwaway local instances;
never do it for a remote target (see [admin.md](admin.md#credentials)).

## Shell environment collisions

The app server refuses to start when a name is set both in its dotenv files
and in the process environment. `create`, `seed`, and `start` warn when your
shell has a non-empty value for a name in the instance's `.env` or
`.env.secrets` (for example an exported `ENVIRONMENT`). Unset it before
running the instance.

## Runtimes

`seed` and `start` run the app server on the same runtime as `kixx`, as
[`kixx dev start`](dev.md#runtimes) does. On Deno, they need `--allow-run`.
