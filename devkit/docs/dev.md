# `kixx dev` — Local Development

## `start`

Runs the app's `node-server.js` behind a local proxy. The devserver listens on
its own port and forwards every request to the app server, which runs as a
child process on a free port. The app server restarts on the next request
after a server-side file changes.

```sh
kixx dev start [-p <port>] [-e <env>] [--dotenv <file>]
```

| Option | Description |
| --- | --- |
| `-p`, `--port` | Port for the devserver to listen on. An integer from 0 to 65535; default `2026`. `0` picks a free port. |
| `-e`, `--environment` | Application environment passed to `node-server.js`; default `development` |
| `--dotenv` | Dotenv file passed to `node-server.js`. Relative paths resolve against the current directory. |

The app server is `node-server.js` in the project directory: the nearest
ancestor with a `.kixx/` directory, or the working directory when there is
none. It runs with the project directory as its working directory. A missing
`node-server.js` is a usage error. So is a devserver port that is already in
use; choose another with `--port`.

Requests are forwarded with their original `Host` header, so hostname-based
routing in `virtual-hosts.js` works as it does in production.

## Restarts

A file watcher on the project directory marks the app changed. Nothing
restarts until the next request arrives. That request stops the running app
server (SIGTERM, then SIGKILL after 11 s), starts a new one, waits until it
accepts connections, and then is forwarded. Requests that arrive meanwhile
wait for the same restart.

These files trigger a restart:

- `.js` and `.mjs` files
- `node-config.jsonc`
- `example.env.secrets`
- `.env` and any `.env.*` file, including `.secrets` files

Changes are ignored in:

- `pages/`, `templates/`, `static-assets/`, `public/`, `emails/`, and `test/`
  at the top level of the project. Directories with these names deeper in the
  tree are still watched.
- `node_modules/` and any directory whose name starts with `.` (such as
  `.git/` and `.kixx/`), at any depth.

`package.json` and `deno.json` do not trigger a restart. After changing
dependencies, stop and start the devserver.

Template, page, and static asset edits need no restart in the `development`
environment: the default `node-config.jsonc` turns off the template and page
caches there and reads content from disk.

## Error page

When the app server is unavailable, every request gets a `502` HTML page with
`cache-control: no-store`. The page shows the reason and the app server's
recent output, such as a stack trace.

- **Failed start.** The app server exited before accepting connections, or did
  not accept connections within 10 s. The devserver does not retry on every
  request. Fix the error and save a watched file; the next request retries.
- **Crash.** A running app server exited on its own. The next request starts a
  new one.

## Runtimes

The app server runs on the same runtime as `kixx`:

- Node.js: `node <project>/node-server.js ...`
- Deno: `deno run -A <project>/node-server.js ...`

On Deno, `kixx` needs `--allow-run` to start the child, and the child gets
full access (`-A`). Whether the app's own dependencies, such as `node:sqlite`,
work under Deno is up to the app.

## Stopping

Ctrl-C stops the devserver and the app server together. The app server is in
the same process group, so it receives the terminal's SIGINT directly.

## Limitations

- No browser live reload. Reload the page yourself.
- No WebSocket (`upgrade`) proxying.
- A `--dotenv` file outside the project directory is not watched; restart the
  devserver after changing it.
- Template and page edits show without a restart only in `development`.
- Windows is untested.
