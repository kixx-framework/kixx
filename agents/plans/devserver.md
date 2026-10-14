Devserver (`kixx dev start`)
============================

Add `kixx dev start` to the devkit CLI: a local development server for a Kixx project's `node-server.js`. It listens on its own port (default 2026) and reverse-proxies every request to a child `node-server.js` running on a free port, preserving the `Host` header. A recursive file watcher marks the app stale when server-side code, `node-config.jsonc`, or `.env*` files change. The next request then stops the old child and starts a new one before it is proxied (stop-then-start, single-flight). If the child fails to start, every request gets an HTML error page with the reason and the child's recent output, and no retry happens until another watched file changes. If a running child crashes, the next request starts a new one. The child runs on the same runtime as the devkit (Node.js or Deno). This is a deliberate, documented exception to the devkit rule that the CLI never spawns subprocesses.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Command is `kixx dev start`**, a new `dev` family (`devkit/commands/dev/index.js` + `devkit/commands/dev/start.js`), registered in `devkit/commands/index.js`. Reason: devkit only supports two-level commands. A family avoids changing the dispatcher and leaves room for more dev tools.
2. **Restart trigger is a file watcher plus the next request.** A recursive `fs.watch` marks the app stale. The next incoming request triggers a restart before it is proxied. Concurrent requests share one in-flight restart (single-flight). Reason: code is always fresh, with no restart churn while editing.
3. **Restart-trigger files** are server-side `.js` and `.mjs` files, `node-config.jsonc`, and `.env*` files (including their `.secrets` siblings) anywhere in the project directory, excluding `pages/`, `templates/`, `static-assets/`, `public/`, `emails/`, `node_modules/`, `test/`, and dot-directories such as `.git/` and `.kixx/`. Reason: these files are only read at app startup. Templates and pages are not cached in development (`lib/node-config.jsonc` development `HYPERVIEW.useTemplateCache`/`usePageCache` are false, and `CONTENT_STORE.developerMode` is true, so content is read from disk), and `static-assets/site.js` is browser JS. See the "Restart-trigger filter" constraint for how the exclusions are applied.
4. **Restart is stop-then-start.** Send SIGTERM to the old child and wait for it to exit (up to 11 s, just over `node-server.js`'s 10 s `SHUTDOWN_TIMEOUT_MS`, then SIGKILL). Then spawn the new child. Requests wait meanwhile. Reason: with the error page (Decision 5) there is no stale-code fallback to preserve, and only one process ever touches the SQLite stores and the job queue.
5. **A failed start shows an HTML error page, not stale code.** If the child exits before it becomes reachable, or does not accept TCP connections within 10 s, requests get an HTML error page with `cache-control: no-store`. The page shows the exit code/signal or the timeout reason, plus the child's recent captured stdout/stderr (bounded buffer, HTML-escaped). After a failed start the devserver does not respawn on every request. It retries on the next request after another watched file change. Reason: the user wants a visible error instead of stale code, and a broken child should not be spawned per request.
6. **A crash after a successful start restarts on the next request.** `lib/node-server.js` deliberately exits 1 on unexpected errors ("let it crash"). If the running child exits on its own, it is marked stale so the next request starts a new child. There is no backoff loop. Requests in flight at crash time get the error page (or a destroyed connection if headers were already sent).
7. **No browser live reload.** Reason: keep it simple.
8. **The child runs on the same runtime as the devkit.** On Node.js: `process.execPath <projectDirectory>/node-server.js ...`. On Deno (`process.versions.deno` is set): `process.execPath run -A <projectDirectory>/node-server.js ...`. Reason: support Deno. The user chose `-A` because this is a local dev tool running the developer's own code. Cloudflare/miniflare is explicitly excluded; it is never needed locally.
9. **Flags.** `--port` is the devserver's own listen port (default `2026`, validated as an integer 0–65535). `-e`/`--environment` defaults to `development` and is forwarded to the child. `--dotenv` is forwarded to the child after being resolved to an absolute path against the devkit's working directory, because the child's working directory may differ. The child always gets `--port <free port>`. Its stdout/stderr pass through to the terminal and are also captured for the error page.
10. **App location.** The child is `<projectDirectory>/node-server.js`, where `projectDirectory` is the devkit's discovered project directory (nearest ancestor with `.kixx/`, falling back to the working directory; `devkit/lib/config-loader.js:93-112`). It is spawned with `cwd` = `projectDirectory`. A missing `node-server.js` is a `UsageError`.
11. **The proxy preserves the `Host` header**, because `virtual-hosts.js` routes by hostname. Ctrl-C/SIGTERM on the devserver stops the child and exits.
12. **Deliberate exception to the devkit rules.** `agents/plans/devkit.md` ("Never spawn subprocesses", `node:` built-in allowlist) and `devkit/README.md` ("No subprocess (`--allow-run`) ... never executes project code") do not apply to the `dev` family. It may use `node:child_process`, `node:http`, `node:net`, and `node:fs` `watch`. Update `devkit/README.md` (install and upgrade permissions, the no-subprocess claim, the Commands list), `devkit/docs/configuration.md:99` (same claim), and the `kixx` task in `devkit/deno.json` (add `--allow-run`). Everything else under `devkit/` stays stand-alone (no imports from outside `devkit/`). Reason: a devserver must run project code. The completed `agents/plans/devkit.md` is historical and is not edited; this plan records the exception.
13. **Exclusion depth (confirmed R-b).** `pages/`, `templates/`, `static-assets/`, `public/`, `emails/`, and `test/` are excluded only as top-level directories of the project. `node_modules/` and dot-directories are excluded at any depth. Reason: lib has server code in nested directories with those names (`lib/kixx/static-assets/static-asset-request-handler.js`, `lib/app/presentation/forms/pages/put-page-metadata-form.js`).
14. **`--port` has a `-p` short alias.** Reason: matches `node-server.js` and the legacy devserver.
15. **`package.json` and `deno.json` do not trigger a restart.** Reason: they rarely change while the server runs, and dependency installs need a manual restart anyway.
16. **Out of scope:** live reload, Cloudflare/miniflare, overlap (ready-before-swap) cutover, the idle-time restart heuristic, crash backoff loops, Windows-specific signal handling, WebSocket/`upgrade` proxying, and any change to `lib/`.
17. **No "second Ctrl-C forces shutdown" (R-g dropped).** Do not add a `forceKill()` path. Reason: the child is spawned in the devserver's process group, so the terminal's Ctrl-C SIGINT reaches it directly and `node-server.js` exits at once on SIGINT. The stop path already escalates to SIGKILL after 11 s.
18. **No startup notice for non-`development` environments (R-f dropped).** Reason: not requested. `devkit/docs/dev.md` documents that template and page edits are picked up live only in `development`.

### Planner recommendations (accepted)

These choices were made by the planner from project conventions and accepted by the orchestrator. Implement them as written.

- **R-a. Error page status is `502 Bad Gateway`** for every error page: failed start, crashed child, and proxy connection failure. The devserver is a gateway whose upstream failed; `500` would suggest that the app itself answered.
- **R-b.** Confirmed by the user; see Decision 13.
- **R-c. `example.env.secrets` is a trigger.** `node-server.js` reads it at boot as the secrets manifest, which fits Decision 3's reason.
- **R-d. Eager first start.** The devserver starts the child right after it begins listening, so startup errors show in the terminal without a request. A failed first start does not stop the devserver; it serves the error page.
- **R-e. Listen failure is a `UsageError`.** If the devserver's port is in use (`EADDRINUSE`) or not allowed (`EACCES`), `run()` throws a `UsageError` naming the port and `--port`. Nothing is spawned.
- **R-f, R-g.** Dropped by the user; see Decisions 17 and 18.
- **R-h. A `--dotenv` file outside the project directory is not watched.** Document this; do not add extra watchers.

### Cross-cutting constraints

- **Stand-alone package.** Nothing under `devkit/` except `devkit/test/conformance/` imports from outside `devkit/`. Never import or modify repo `lib/`. Integration tests use their own fixture app, not `lib/`.
- **Runtime portability.** Node.js >= 24 and Deno >= 2.8. The `dev` family may use `node:child_process` (`spawn`), `node:http`, `node:net`, and `node:fs` (`watch`, `realpath`, `stat`), in addition to the built-ins allowed by `agents/plans/devkit.md`. Use `fsp.stat`, not `fsp.access`. Recursive `fs.watch` was checked during planning on macOS with Node v24.13.1 and Deno 2.8.1: both report project-relative filenames. Deno may report one save as several events, so the design must tolerate duplicates.
- **Lint globals.** `devkit/eslint.config.js` declares `setTimeout`/`clearTimeout` but not `setInterval`, `Buffer`, or `process`. Import `process` from `node:process` and `Buffer` from `node:buffer` when needed. Poll with `setTimeout`-based delays, not `setInterval`. Do not edit the lint config to add globals unless unavoidable; if you do, record why. Loops that `await` may need `// eslint-disable-next-line no-await-in-loop`, as `devkit/test/commands/index.test.js` does.
- **Injectable collaborators, only where a fake is needed.** Inject only what a unit test cannot exercise for real: `spawn`, `getFreePort`, `canConnect`, `delay` (in `AppProcess`), `watch` (in `DevServer`), `createDevServer`, `fileSystem` and `signals` (in the command), and output streams. Use real loopback HTTP servers in tests rather than injecting `http.createServer` or `http.request`. Unit tests use fakes. Only Task D6 uses real processes and watchers.
- **Timing constants** are module constants in `devkit/lib/devserver/app-process.js`, not constructor options: readiness poll 50 ms, readiness timeout 10000 ms (counted as 200 polls with `delay`, so no clock is injected), and stop timeout 11000 ms before SIGKILL. After SIGKILL, await `exit` with no further timeout, because SIGKILL cannot be ignored. Tests use a fake `delay` that resolves at once, so they never need shorter timeouts.
- **Keep the module count small.** The devserver is three modules: `restart-trigger.js` (D1), `app-process.js` (D2), and `dev-server.js` (D3). Helpers with a single caller (free port, TCP probe, child arguments, output capture, proxy, error page, watcher wiring) live in the module that uses them. Do not split them into their own files.
- **No lingering handles after shutdown.** `kixx.js` never calls `process.exit()`; the process exits when the event loop empties. After `stop()`, the HTTP server, every socket, the watcher, child pipes, timers, and signal listeners must all be closed or removed. A leaked handle means a CLI that hangs after Ctrl-C.
- **Command contract.** Follow `devkit/commands/README.md`: a default-exported class with static `description` and `options`, a constructor taking `{ projectDirectory, ... }` plus injectable collaborators, and `run(options)` returning an exit code. Commands are thin wiring; logic lives in `devkit/lib/devserver/`. Throw `UsageError` for operator-fixable problems. No `-h`/`-v` short flags.
- **Output.** Devserver status lines go to the injected `output` stream (default `process.stdout`), prefixed `[kixx dev] `, through `wrapText()`. Child stdout/stderr are forwarded unmodified to the injected `stdout`/`stderr` (defaults `process.stdout`/`process.stderr`). Never print the contents of `.env*` files.
- **Code style.** Follow `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md`: 4-space indent, private `#` members, argument objects, `isX` checks from `devkit/lib/vendor/kixx-assert/mod.js`, JSDoc only on exported contracts, blank lines between logical blocks, and short comments that explain why.
- **Legacy reference.** `tmp/legacy-devserver/devserver.js` and `tmp/legacy-devserver/devserver/app-server-process.js` (untracked) are reference only. Reuse their ideas for free-port discovery, the TCP readiness poll, the single-flight restart, Host preservation, and `waitForExitAfterSignal` (now with SIGKILL escalation). Do not port the idle heuristic, the overlap cutover, or the backoff loop. If the reference is missing, continue from this plan.
- **Validation.** Every task leaves `node devkit/run-linter.js devkit` clean and `node devkit/run-tests.js` passing, run from the repo root. Task D6 (real processes) and D5 (entry-point permissions) also run their tests on Deno with `deno run -A devkit/run-tests.js <paths>`. If `deno` is not installed, record that in the handoff instead of failing the task.
- **Restart-trigger filter.** Paths are evaluated relative to the real (symlink-resolved) project directory, with `/` separators. A path is a trigger when all of these hold:
  1. No directory segment is `node_modules` or starts with `.` (any depth).
  2. The first segment is not `pages`, `templates`, `static-assets`, `public`, `emails`, or `test`, unless the path is a single segment (a file at the project root).
  3. The basename ends in `.js` or `.mjs`; or equals `node-config.jsonc` or `example.env.secrets`; or is `.env`, or starts with `.env.` (this includes `.env.development.secrets`).
  A missing filename from the watcher (null or empty) counts as a trigger, because missing a restart is worse than one extra restart. Recursive `fs.watch` with the default encoding reports project-relative string filenames on both runtimes (checked during planning), so do not handle `Buffer` or absolute filenames.

---

### Task D1: Restart-trigger filter

**Status:** Complete
**Depends on:** None
**Documentation:** This plan's "Restart-trigger filter" constraint; Decisions 3, 13, 15; R-c

**Objective**

A pure function decides whether a changed path should trigger a restart. This is the only code that knows which files matter, so it is tested on its own and the rest of the devserver only sees "something relevant changed".

**Scope**

- In: `isRestartTrigger(relativePath)` in `devkit/lib/devserver/`, with unit tests.
- Out: calling `fs.watch` and reacting to changes (D3), command wiring (D4), real file-system watching tests (D6).

**Design and invariants**

- `devkit/lib/devserver/restart-trigger.js` exports `isRestartTrigger(relativePath)`, which implements the filter rules exactly. Normalize `\` to `/` before evaluating, so the rules are defined in one form. Return `true` for `null`, `undefined`, or empty input (conservative).
- There is no watcher wrapper class. D3's `DevServer` calls `fs.watch` directly and passes each filename to this function.

**Expected touch points**

- `devkit/lib/devserver/restart-trigger.js` — the filter.
- `devkit/test/lib/devserver/restart-trigger.test.js` — unit tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Triggers: `node-server.js`, `virtual-hosts.js`, `node-environment.js`, `app/foo.js`, `routes/x.mjs`, `plugins/a/lib/b.js`, `kixx/static-assets/static-asset-request-handler.js`, `app/presentation/forms/pages/put-page-metadata-form.js`, `node-config.jsonc`, `.env`, `.env.development`, `.env.development.secrets`, `example.env.secrets`, `null`, `''`.
- [x] Not triggers: `pages/index.js`, `templates/base/x.js`, `static-assets/site.js`, `public/a.js`, `emails/x.js`, `test/unit.test.js`, `node_modules/x/index.js`, `plugins/a/node_modules/b.js`, `.git/hooks/x.js`, `.kixx/config.json`, `app/.cache/x.js`, `app/readme.md`, `templates/base/page.html`, `cloudflare-config.jsonc`, `example.env`, `package.json`, `deno.json`.
- [x] Windows-style separators (`app\\foo.js`, `pages\\x.js`) give the same answers as `/`.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/devserver/restart-trigger.test.js` — filter tests pass.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite still passes.

**Progress and handoff**

- Completed: `isRestartTrigger()` and its unit tests.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: `undefined` is also treated as a trigger (tested alongside `null` and `''`).
- Actual files changed: `devkit/lib/devserver/restart-trigger.js`, `devkit/test/lib/devserver/restart-trigger.test.js`.
- Validation run: filter tests 3/3 pass; `node devkit/run-linter.js devkit` clean; full suite 588 tests pass on Node.
- Blockers: None.

---

### Task D2: App server process manager

**Status:** Complete
**Depends on:** None
**Documentation:** Decisions 4, 5, 6, 8, 9; this plan's timing constants; `tmp/legacy-devserver/devserver/app-server-process.js`; `lib/node-server.js` (flags, SIGTERM drain, `SHUTDOWN_TIMEOUT_MS`)

**Objective**

One object owns the child `node-server.js` lifecycle. It spawns on a free port, waits for TCP readiness, captures recent output, stops with SIGTERM then SIGKILL, restarts single-flight after a change, records start failures and crashes, and answers one question per request: "here is a port to proxy to" or "here is why there isn't one". It knows nothing about HTTP or file watching, so the whole state machine can be tested with fakes.

**Scope**

- In: `AppProcess` in `devkit/lib/devserver/app-process.js`, including child arguments for Node and Deno, free-port discovery, the TCP readiness probe, captured output, stop with escalation, and unit tests with fakes.
- Out: HTTP proxying, the error page, and file watching (D3), command wiring (D4), real-process tests (D6).

**Design and invariants**

- `devkit/lib/devserver/app-process.js` exports `AppProcess` and also `getFreePort()` and `canConnect(port)`, which are its defaults:
  - `getFreePort()` listens on port 0 on `127.0.0.1`, reads the port, closes, and resolves.
  - `canConnect(port)` connects to `127.0.0.1:port` and resolves true/false. It never rejects and always destroys the socket.
  - The small race between probe close and child bind is accepted: a bind failure makes the child exit 1, which is a normal failed start.
- Constructor options: `{ projectDirectory, environment, dotenv, stdout, stderr, log, spawn, getFreePort, canConnect, delay, execPath = process.execPath, isDeno = Boolean(process.versions.deno) }`.
  - `log(message)` writes devserver status lines (D4 supplies it).
  - The server script is always `path.join(projectDirectory, 'node-server.js')`.
- Child command, built inline in the spawn method:
  - Node: `execPath` with args `[ serverScript, '--environment', environment, ...(dotenv ? ['--dotenv', dotenv] : []), '--port', String(port) ]`.
  - Deno: the same with `'run', '-A'` before `serverScript`.
  - `--environment` is always passed (the default `development` comes from D4). This overrides `NODE_ENV` in the child, which is intended.
  - Tests check the arguments through the fake `spawn`; no separate builder function is exported.
- Spawn options: `{ cwd: projectDirectory, stdio: [ 'ignore', 'pipe', 'pipe' ], env: process.env }`, not detached. Keeping the child in the devserver's process group means a terminal Ctrl-C reaches it directly (Decision 17).
  - Each chunk from the child's stdout/stderr is written to `stdout`/`stderr` and appended to a string holding that child's recent output. Keep only the last 64 KiB by slicing the string after each append.
  - The string is reset at each spawn, so the page shows only the latest attempt.
  - An `output` getter returns it.
- State lives in plain fields, not a named state enum:
  - `#child` and `#port`: the current child, or null.
  - `#failure`: `{ reason, output }` or null.
  - `#changeCount`: incremented by `markChanged()`.
  - `#startedAtChange`: the `#changeCount` captured when the current child or failed attempt began.
  - `#restartPromise` and `#stopped`.
  - `#child` is set to null when the child exits.
- `markChanged()` only increments `#changeCount`. It never spawns or kills; the next `ensureReady()` acts on it.
- `ensureReady()` resolves to `{ port }` or `{ failure }`, and never rejects for app failures:
  - `#stopped` → `{ failure }` with reason "the devserver is shutting down".
  - A restart in flight → await and return its result (single-flight; all concurrent callers share one attempt).
  - Unchanged since the last attempt (`#changeCount === #startedAtChange`) and a live `#child` → `{ port }`.
  - Unchanged since the last attempt and a recorded `#failure` → that `{ failure }` (no respawn; Decision 5).
  - Anything else (first request, crashed child, or a change since the last attempt) → restart:
    1. Stop the current child if any, and await its full exit.
    2. Clear `#failure`, capture `#startedAtChange`, spawn, and wait for readiness.
    3. A change that lands during a restart therefore makes the next request restart again.
- Readiness: poll `canConnect(port)` with `delay(50)` up to 200 times. Fail early when the child emits `exit` (reason: exited before accepting connections, with code/signal) or `error` (reason: could not be spawned, with the error message). On timeout, stop the child and record reason "did not accept connections on port N within 10 s". Every failure records `{ reason, output }`, with `output` captured at failure time.
- Crash: when the current child emits `exit` and the manager did not stop it, set `#child` to null and log one line ("app server exited (code C, signal S); it will restart on the next request"). Record no failure: the next `ensureReady()` restarts because there is no live child and no failure (Decision 6). No respawn happens here.
- An intentional stop (restart or shutdown) must never be logged as a crash. Mark the child as stopping before signalling it.
- Stop with escalation (`#stopChild(child)`):
  - If `child.exitCode !== null || child.signalCode !== null`, resolve at once.
  - Otherwise send SIGTERM and race the `exit` event against `delay(11000)`.
  - On timeout, send SIGKILL, log it, and await `exit`.
  - Remove listeners afterwards.
- `stop()` (shutdown): set `#stopped` first, so an in-flight restart that resumes kills its new child instead of keeping it. Then stop the current child. Idempotent.
- `log` lines: "starting app server", "app server ready on port N", "app server failed to start: <reason>", the crash line above, "stopping app server", "app server did not exit within 11 s; sending SIGKILL".

**Expected touch points**

- `devkit/lib/devserver/app-process.js`
- `devkit/test/lib/devserver/app-process.test.js` — with a fake child built inline in the test file: an `EventEmitter` with `PassThrough` `stdout`/`stderr`, `exitCode`, `signalCode`, and recorded `kill(signal)` calls. Move it to `devkit/test/helpers/` only if D3 or D4 tests also need it.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The fake `spawn` receives the exact Node and Deno argument lists, with and without `--dotenv`, and `cwd = projectDirectory`.
- [x] Captured output keeps only the most recent 64 KiB and is reset at each spawn.
- [x] `canConnect` resolves true against a listening loopback server and false against a closed port, and `getFreePort` returns a usable port. Loopback sockets are allowed in this test.
- [x] With fakes: the first `ensureReady()` spawns and resolves `{ port }` once `canConnect` returns true. A second call without a change does not spawn again.
- [x] Ten concurrent `ensureReady()` calls after `markChanged()` produce exactly one SIGTERM to the old child and one new spawn, and the new spawn happens only after the old child's `exit`.
- [x] Exit before ready gives `{ failure }` whose reason includes the exit code and whose output holds the captured output. Later calls return the same failure without spawning until `markChanged()`, after which the next call spawns again.
- [x] Readiness timeout (a fake `delay` and a `canConnect` that always returns false) gives a timeout failure, and the child receives SIGTERM.
- [x] A spawn `error` event gives a failure naming the error, with no uncaught `error` event.
- [x] A child that ignores SIGTERM gets SIGKILL, and the restart still completes.
- [x] A crash after a successful start logs one line. The next `ensureReady()` spawns a new child even though nothing changed.
- [x] A restart or shutdown stop is never logged as a crash.
- [x] `stop()` during an in-flight start kills the new child, resolves, and makes later `ensureReady()` calls return the shutdown failure. `stop()` is idempotent.
- [x] A `markChanged()` during an in-flight restart causes one more restart on the next `ensureReady()` after it completes.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/devserver/app-process.test.js` — process manager tests pass.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite still passes.

**Progress and handoff**

- Completed: `AppProcess`, `getFreePort()`, `canConnect()`, and unit tests (fake child inline in the test file).
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries:
  - The injected `delay(ms, signal)` takes an optional `AbortSignal`. The stop timeout aborts it once the child exits, so the 11 s timer never outlives a prompt shutdown (no lingering handles). Fakes may ignore the signal.
  - Intentional stops are marked in a `WeakSet` before signalling (a child can exit synchronously inside `kill()`), and stop promises are memoized per child in a `WeakMap` so `stop()` and a restart never double-signal.
  - After the stop race, SIGKILL is sent only if the child has not exited (`exitCode`/`signalCode` still null). This keeps a child that exits in the same tick as the timeout from being killed, and lets tests use a `delay` that resolves at once.
  - `#stopped` is checked again after each `canConnect()` resolves, so `stop()` during an in-flight probe still kills the new child.
  - `stop()` awaits any in-flight restart, then stops the current child.
  - Output from a child is captured only while it is the latest spawned child (`#outputChild`), so a crashed child's trailing stderr (pipes can drain after `exit`) is still captured, but an old child's output never leaks into a new attempt.
  - `getFreePort` and `spawn` throwing synchronously are recorded as a failure ("app server could not be spawned: ...") rather than rejecting.
  - Stdout/stderr use `setEncoding('utf8')`, so the 64 KiB limit counts characters, not bytes.
- Actual files changed: `devkit/lib/devserver/app-process.js`, `devkit/test/lib/devserver/app-process.test.js`.
- Validation run: process manager tests 12/12 pass; `node devkit/run-linter.js devkit` clean; full suite 603 tests pass on Node; `deno run -A devkit/run-tests.js devkit/test/lib/devserver` 18 pass.
- Blockers: None.

---

### Task D3: Reverse proxy, error page, and the `DevServer` composition

**Status:** Not started
**Depends on:** D1, D2
**Documentation:** Decisions 2, 5, 6, 11; R-a, R-d, R-e; `tmp/legacy-devserver/devserver.js` (`proxyRequest`)

**Objective**

A `DevServer` object listens on the devserver port, watches the project, connects trigger changes to `AppProcess.markChanged()`, and for each request either proxies to the current child (Host preserved) or answers with the HTML error page. It starts and stops cleanly. This is the complete devserver behind a small API (`start()`, `stop()`, `port`), so the command in D4 is pure wiring.

**Scope**

- In: `devkit/lib/devserver/dev-server.js` (the `DevServer` class plus its private proxy, error page, and watch wiring), and unit tests using a fake `appProcess`, a fake `watch`, and in-process loopback HTTP servers as the upstream.
- Out: flag parsing, the `node-server.js` existence check, signals, and registration (D4); real child processes and real watchers (D6).

**Design and invariants**

- `DevServer` constructor options: `{ projectDirectory, port, appProcess, log, watch = fs.watch }`.
  - `projectDirectory` is already the real path (D4 resolves it).
  - `appProcess` is always injected: D4 builds the real `AppProcess`, and tests pass a fake.
- Watching, in `start()`:
  - Call `watch(projectDirectory, { recursive: true }, (eventType, filename) => ...)` once.
  - The listener passes `filename` to `isRestartTrigger` (D1). On a trigger it calls `appProcess.markChanged()` and logs "change detected: <path>; restarting on next request".
  - Log only the first trigger after each restart, not every event (Deno reports one save as several events). A boolean that is set on trigger and cleared when `ensureReady()` next resolves is enough.
  - Attach an `error` listener to the returned watcher. On error, log a warning that file watching stopped and restarts now only happen after a crash, close the watcher, and keep serving.
- Request handling:
  - `await appProcess.ensureReady()`. On `{ port }`, proxy. On `{ failure }`, send the error page.
  - Any unexpected rejection in the handler is logged and answered with a page (never a hung client).
- Proxy (a private method):
  - Target `127.0.0.1:port` with the same method, `request.url`, and `headers: request.headers` unchanged. Forwarding the incoming headers keeps the original `Host`; `http.request` only adds a Host header when none is given.
  - Use `agent: false`, so no pooled keep-alive socket outlives a child restart.
  - Copy the upstream status and headers with `response.writeHead(statusCode, proxyRes.headers)` and pipe the body.
  - An upstream request `error` before headers are sent gives the error page with `{ reason: 'connection to the app server failed: <message>', output: appProcess.output }`. The output shows a crash's stack trace when the child died mid-request. After headers are sent, destroy the response.
  - A client `request` error or an early `response` close destroys the upstream request.
- Error page (a private function):
  - One small HTML document with inline CSS only and no external resources. Every failure uses the same template:
    - the heading "App server unavailable";
    - the escaped `reason`;
    - a fixed hint: "If the app failed to start, fix the error and save a file; the next request retries. Otherwise, reload.";
    - the escaped `output` in a `<pre>`, or "(no output captured)".
  - Escape `& < > " '`.
  - Respond with status `502`, `content-type: text/html; charset=utf-8`, and `cache-control: no-store`, with no body for `HEAD`. If headers were already sent, destroy the response instead.
  - Do not add per-kind headings or failure-kind fields; the reason string carries the specifics.
- `start()`:
  - Listen on `port` (all interfaces, matching `node-server.js`). Map `EADDRINUSE`/`EACCES` to `UsageError` (R-e) and spawn nothing.
  - Then start watching.
  - Then kick off `appProcess.ensureReady()` without awaiting it (R-d).
- `port` getter: the bound port (meaningful when `--port 0`).
- `stop()`: idempotent. Close the watcher, stop accepting connections (`server.close()` plus `closeAllConnections()`), and `await appProcess.stop()`. Resolves once everything is closed, leaving no handles.

**Expected touch points**

- `devkit/lib/devserver/dev-server.js`
- `devkit/test/lib/devserver/dev-server.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] With a fake `appProcess` returning `{ failure }` whose reason and output contain `<script>` and `&`: the response is 502, `text/html; charset=utf-8`, `no-store`, escaped, and has no body for `HEAD`. Empty output shows "(no output captured)".
- [ ] With a fake `appProcess` returning the port of an in-process upstream on `127.0.0.1:0`, the proxy preserves method, path and query, request body, a custom `Host` (`Host: blog.example.test`), response status, response headers (including multiple `set-cookie`), and response body.
- [ ] An upstream connection refusal gives the error page containing the connection error and `appProcess.output`.
- [ ] A fake `watch` emitting a trigger path calls `markChanged()` and logs once until `ensureReady()` next resolves. Emitting a non-trigger path (`pages/x.js`) calls nothing. A watcher `error` logs a warning and does not throw.
- [ ] `start()` with the port already taken rejects with a `UsageError` mentioning the port and `--port`, and `ensureReady()` was never called.
- [ ] `stop()` closes the server (a new connection is refused), closes the watcher, awaits `appProcess.stop()`, and is idempotent.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/devserver` — filter, process manager, and `DevServer` tests pass.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite still passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task D4: `kixx dev start` command and registration

**Status:** Not started
**Depends on:** D3
**Documentation:** `devkit/commands/README.md` (command contract); Decisions 1, 9, 10, 11, 14, 17

**Objective**

`kixx dev start` exists, shows correct help, validates its flags, builds a real `DevServer` for the discovered project, runs until SIGINT/SIGTERM, and then resolves with exit code 0 after a full shutdown. This task is the wiring between the CLI contract and D1–D3.

**Scope**

- In: `devkit/commands/dev/index.js`, `devkit/commands/dev/start.js`, registration in `devkit/commands/index.js`, command unit tests, and the `kixx.js` entry-point help test for the new family.
- Out: README, docs, and Deno permissions (D5); real-process tests (D6).

**Design and invariants**

- `devkit/commands/dev/index.js`: `description = 'Local development tools'`, `subcommands = { start: DevStartCommand }`. Add `dev` to `devkit/commands/index.js` (alphabetical listing is automatic).
- `DevStartCommand` statics:
  - `description`: one paragraph. Runs the project's `node-server.js` behind a local proxy that restarts it on the next request after a server-side file changes, and shows an error page when it fails to start.
  - `options`: `port` (`type: 'string'`, `short: 'p'`, description "Port for the devserver to listen on (default 2026)"), `environment` (`type: 'string'`, `short: 'e'`, default described as `development`), and `dotenv` (`type: 'string'`, "Dotenv file passed to node-server.js, relative to the current directory"). No positionals, no `requiredConfig`/`requiredSecrets`. Do not use parseArgs `default` for `port`, so the validation message can name the raw value; apply defaults in `run()`.
- Constructor: `{ projectDirectory, output = process.stdout, stdout = process.stdout, stderr = process.stderr, signals = process, fileSystem = defaultFileSystem, createDevServer }`.
  - `defaultFileSystem` is `devkit/lib/file-system.js`. Use its existing `isFile` and `realpath`, following `devkit/commands/app/publish.js:85`.
  - `createDevServer(options)` defaults to building the real `AppProcess` and `DevServer`, so unit tests can pass a fake.
- `run(options)`:
  1. Validate `--port` with `/^\d+$/` and 0–65535, else `UsageError` "The --port value must be an integer from 0 to 65535". Default `2026`.
  2. `environment = options.environment || 'development'`.
  3. `dotenv = options.dotenv ? path.resolve(options.dotenv) : undefined` (resolved against `process.cwd()`). Do not check that it exists; `node-server.js` treats dotenv files as optional.
  4. If `fileSystem.isFile(path.join(projectDirectory, 'node-server.js'))` is false, throw `UsageError` naming the path and saying to run `kixx dev start` inside a Kixx application directory. Then pass `await fileSystem.realpath(projectDirectory)` to `createDevServer`, so watcher paths are relative to the real path.
  5. Create the dev server and `await devServer.start()`. A `UsageError` propagates (R-e).
  6. Write `[kixx dev] listening on http://localhost:<port> (environment <env>, app <projectDirectory>); press Ctrl-C to stop`.
  7. Install `SIGINT` and `SIGTERM` listeners on `signals`. The first signal logs "stopping" and calls `devServer.stop()`; later signals are ignored (Decision 17). `run()` returns a promise that resolves to `0` after `stop()` completes and both listeners are removed.
- Startup-order invariant: no listener is installed and nothing is spawned before the port check and the `node-server.js` check pass.

**Expected touch points**

- `devkit/commands/index.js`, `devkit/commands/dev/index.js`, `devkit/commands/dev/start.js`
- `devkit/test/commands/dev/start.test.js` — fake `createDevServer`, a fake `signals` `EventEmitter`, `captureOutput()`, and a temp project directory (`fsp.mkdtemp`, removed in `finally`).
- `devkit/test/kixx.test.js` — the top-level help lists `dev`, and `dev --help` lists `start`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `node devkit/kixx.js --help` lists `dev`. `node devkit/kixx.js dev --help` lists `start`. `node devkit/kixx.js dev start --help` shows `-p, --port`, `-e, --environment`, and `--dotenv`.
- [ ] `devkit/test/commands/index.test.js` passes unchanged with the new family registered.
- [ ] `--port abc`, `--port 70000`, and `--port -1` throw `UsageError`. No `--port` gives 2026, and `--port 0` is accepted.
- [ ] A missing `node-server.js` throws a `UsageError` naming `<projectDirectory>/node-server.js`, and `createDevServer` is never called.
- [ ] `--dotenv ./x.env` reaches `createDevServer` as `path.resolve('./x.env')`. The environment defaults to `development`, and `-e local` is forwarded.
- [ ] After `start()`, emitting `SIGINT` on the fake signals calls `stop()` once (a second signal does not call it again), and `run()` resolves to `0` with no listeners left on `signals`.
- [ ] A `UsageError` from `devServer.start()` propagates and installs no signal listeners.

**Validation**

- `node devkit/run-tests.js devkit/test/commands devkit/test/kixx.test.js` — command, registry, and entry-point tests pass.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite passes.
- `node devkit/kixx.js dev start --help` — help renders from the repo root.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task D5: Documentation and Deno permissions

**Status:** Not started
**Depends on:** D4
**Documentation:** Decision 12; `devkit/README.md`; `devkit/docs/configuration.md`; `devkit/deno.json`; `devkit/test/kixx.test.js` (`DENO_RUN_ARGS`)

**Objective**

Operators can install the devkit with the permissions `kixx dev start` needs and learn how to use it. No document still claims that the devkit never spawns subprocesses or never executes project code without naming the `dev` exception.

**Scope**

- In: `devkit/README.md`, a new `devkit/docs/dev.md`, `devkit/docs/configuration.md` (the "never executes project code" sentence), the `kixx` task in `devkit/deno.json`, and `DENO_RUN_ARGS` in `devkit/test/kixx.test.js`.
- Out: code behavior (D1–D4). `agents/plans/devkit.md` is not edited.

**Design and invariants**

- `devkit/deno.json` `tasks.kixx`: `deno run -RWNE --allow-sys=homedir --allow-run kixx.js`. `devkit/test/kixx.test.js` `DENO_RUN_ARGS` gains `--allow-run`, so it keeps mirroring the installed permission set.
- `devkit/README.md`:
  - The install and upgrade `deno install` lines gain `--allow-run`.
  - The permissions list gains `--allow-run`: "`kixx dev start` runs your app's `node-server.js` in a child Deno process with `-A`, so this grants it full access".
  - Replace the "No subprocess ... never executes project code" paragraph: no FFI is needed, and only `kixx dev start` runs project code; every other command reads project configuration as data.
  - The Commands list gains `kixx dev start` — run the app locally, restarting after code changes.
  - The Documentation list gains `dev.md` with an absolute GitHub link in the existing style (`https://github.com/kixx-framework/kixx/blob/main/devkit/docs/dev.md`).
  - Update the opening summary sentence to mention local development.
- `devkit/docs/configuration.md:99`: "devkit never executes project code" becomes true with the `kixx dev start` exception named and linked to `dev.md`.
- `devkit/docs/dev.md` (house style of `admin.md`/`app.md`: short sections, an options table):
  - Usage and options (`-p, --port`, `-e, --environment`, `--dotenv`), with defaults.
  - Requires `node-server.js` in the project directory, found from `.kixx/` or the working directory.
  - How restarts work: watched files (the exact filter, including the Decision 13 depth rules, R-c, and that `package.json`/`deno.json` changes need a manual restart per Decision 15), "next request after a change", stop-then-start, and that template/page/static edits need no restart in `development`.
  - The error page: 502, failed start versus crash, and that a failed start retries only after another watched change.
  - Runtimes: Node versus Deno (`deno run -A`), and that `node:sqlite` support under Deno is the app's concern.
  - Limitations: no live reload, no WebSockets, a `--dotenv` file outside the project is not watched (R-h), template and page edits are live only in `development` (Decision 18), and Windows untested.
  - Ctrl-C behavior: it stops the devserver and the child together (Decision 17).

**Expected touch points**

- `devkit/README.md`, `devkit/docs/dev.md`, `devkit/docs/configuration.md`, `devkit/deno.json`, `devkit/test/kixx.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `grep -rn --include='*.md' --exclude-dir=node_modules -e "never executes project code" -e "No subprocess" devkit` finds no unqualified claim.
- [ ] Every `deno install`/`deno run` permission string for `kixx` in `devkit/` includes `--allow-run`.
- [ ] `devkit/docs/dev.md` exists, documents every flag and default, and matches the implemented trigger filter and status code.
- [ ] `devkit/test/manifests.test.js` and `devkit/test/kixx.test.js` pass.

**Validation**

- `node devkit/run-tests.js devkit/test/manifests.test.js devkit/test/kixx.test.js` — manifest and entry-point tests pass.
- `deno run -A devkit/run-tests.js devkit/test/kixx.test.js` — the entry point works under the documented Deno permission set.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task D6: Real-process integration tests

**Status:** Not started
**Depends on:** D4
**Documentation:** Decisions 2–6, 8, 11; `devkit/test/kixx.test.js` (subprocess and timeout pattern)

**Objective**

Prove that the real collaborators (spawn, fs.watch, sockets, HTTP) work together on the runtime running the suite: serving, restarting after an edit, showing the error page for a broken edit, recovering after a fix, restarting after a crash, and shutting down cleanly. Fakes in D1–D4 cannot catch platform behavior; this task can.

**Scope**

- In: one integration test file using a generated fixture app in a temp directory, and any small test helper it needs.
- Out: running repo `lib/` or `test-app/` (operator runbook), Windows.

**Design and invariants**

- Each test creates a temp project with `fsp.mkdtemp` (resolved with `fsp.realpath`) and writes the fixture files from the test, so nothing under `devkit/test/fixtures/` has to be executable:
  - `node-server.js`: parses `--port` and `--environment` from `process.argv` with `node:util` `parseArgs` (`strict: false`). It dynamically imports `./message.js` and answers every request with `JSON.stringify({ message, host: req.headers.host, environment, pid: process.pid })`. Path `/crash` calls `process.exit(1)` after responding. SIGTERM closes the server and exits 0. It uses only `node:` modules, so it runs under both runtimes.
  - `message.js`: `export default 'v1';`.
  - `package.json`: `{ "type": "module" }`.
- Drive `DevServer` (built the same way as `createDevServer`'s default in D4, with real collaborators) on `port: 0`, and read `devServer.port`. Capture `stdout`/`stderr`/`log` with `captureOutput()` so the suite output stays clean.
- To wait for watcher latency, poll: repeat `GET` until the expected body appears or a 5 s deadline passes. Never use fixed sleeps as assertions.
- Every test stops the dev server and removes the temp directory in `finally`. Use `{ timeout: 20000 }` per test.
- Cases:
  1. Serves `v1`, and the upstream sees the client's `Host: app.example.test`.
  2. Rewrite `message.js` to `v2`; requests eventually return `v2` with a different `pid`.
  3. Write a syntax error into `message.js`; requests eventually return 502 HTML containing `SyntaxError` and `no-store`. A further request without a change spawns no new child (the log shows one failed start). Fixing the file recovers `v3`.
  4. `GET /crash`, then the next request returns a new `pid`.
  5. Writing `pages/x.js` and `.kixx/x.js` does not change the `pid`. Use a short settle wait, then assert the same `pid`; this is the one place a bounded wait is acceptable, and it must be documented in the test.
  6. After `stop()`, the child pid is no longer alive (`process.kill(pid, 0)` throws) and the port refuses connections.

**Expected touch points**

- `devkit/test/lib/devserver/dev-server-integration.test.js`
- Possibly `devkit/test/helpers/` for a `waitFor()` / HTTP `get()` helper.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All six cases pass on Node.
- [ ] All six cases pass on Deno, or a Deno-specific failure is recorded as a blocker with the exact error, not skipped silently.
- [ ] Ten consecutive Node runs of the file pass (flakiness check), recorded in the handoff.
- [ ] No orphaned fixture processes remain after the suite (`pgrep -f <tmpdir>` finds nothing).

**Validation**

- `node devkit/run-tests.js devkit/test/lib/devserver/dev-server-integration.test.js` — integration on Node.
- `deno run -A devkit/run-tests.js devkit/test/lib/devserver/dev-server-integration.test.js` — integration on Deno.
- `for i in 1 2 3 4 5 6 7 8 9 10; do node devkit/run-tests.js devkit/test/lib/devserver/dev-server-integration.test.js || break; done` — flakiness check.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/run-tests.js` — full suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

Operator Runbook
----------------

These steps are for the operator only. Agents never run them. Run them after D6.

- [ ] **O1 — Node, test-app.** Build test-app (`node tools/build-test-app.js`), then in `test-app/` run `node ../devkit/kixx.js dev start`. Load `http://localhost:2026/` and check that pages render and JSON log lines appear in the terminal.
- [ ] **O2 — Edit a route.** Change a handler under `test-app/routes/` or `test-app/app/`. The terminal logs "change detected"; the next reload shows the change, served by a new child.
- [ ] **O3 — Template edit.** Edit a template or page under `test-app/templates/` or `test-app/pages/`. The change shows on reload with no restart logged.
- [ ] **O4 — Syntax error.** Introduce a syntax error in a route file. The reload shows the 502 error page with the stack trace. Further reloads do not spawn new children. Fix the file; the next reload works.
- [ ] **O5 — Crash.** Trigger an unexpected error, if test-app has a way to, or kill the child pid. The next reload starts a new child.
- [ ] **O6 — Virtual hosts.** If test-app routes by hostname, request with a different `Host` (for example `curl -H 'Host: <host>' localhost:2026`) and confirm the routing.
- [ ] **O7 — Shutdown.** Ctrl-C exits promptly with no leftover `node-server.js` process (`pgrep -f node-server.js`). Repeat while a request is in flight; it still exits promptly.
- [ ] **O8 — Port in use.** Start a second `kixx dev start` on the same port. It prints a usage error suggesting `--port` and exits 1.
- [ ] **O9 — Deno.** Repeat O1, O2, O4, and O7 with `deno run -RWNE --allow-sys=homedir --allow-run ../devkit/kixx.js dev start`. Whether `lib/node-server.js` (including `node:sqlite`) runs under `deno run -A` is unverified. If it fails, decide whether that is a lib follow-up or a documented limitation; it is not a devkit blocker.
- [ ] **O10 — Linux (optional).** On Linux, check O2 with a project containing a large `node_modules/`. Recursive `fs.watch` sets up inotify watches for every directory, including excluded ones. If startup is slow or watch limits are hit, raise watching only non-excluded top-level directories as a follow-up.
