# Dev Server Reverse Proxy Implementation Plan

## Implementation Approach

Build `tools/devserver.js` as a Node-only CLI tool (outside `src/app/`, so it is not bound by the Cloudflare Workers cross-platform constraint) that listens on a stable public port and reverse-proxies every request to a child `src/node-server.js` process running on a dynamically discovered free port. The child's restart behavior — both the request-driven idle restart and unexpected-crash recovery — is owned by a single `AppServerProcess` class so the two trigger paths share one cutover routine and one in-flight-restart guard, instead of two parallel state machines. A restart is always a cutover: spawn a new child on a new free port, poll until it accepts TCP connections, swap the "current" port only once the new child is healthy, and only then `SIGTERM` the previous child — reusing `src/node-server.js`'s own graceful-shutdown draining rather than reimplementing it in the devserver. The proxy preserves the original `Host` header so `virtual-hosts.js` hostname-based routing is unaffected by the indirection, and child stdio is inherited directly so devserver requires no log-format parsing to observe child output. No new dependency is needed; everything is built on `node:http`, `node:net`, and `node:child_process`.

- [x] **Add CLI argument parsing and option resolution**
  - **Story**: `node tools/devserver.js` accepts the same flags as `src/node-server.js` and stands in for it directly.
  - **What**: Use `util.parseArgs` to parse `--port` (the devserver's own public listen port, default `2026`, matching `src/node-server.js`'s default) and pass `--config`, `--environment`, and `--secrets` through unchanged as forwarded child argv. Do not forward the devserver's own `--port` to the child.
  - **Where**: `tools/devserver.js`
  - **Documentation**: `src/node-server.js` (CLI parsing block), `src/docs/code-style-guide.md`
  - **Acceptance criteria**: Running with no flags listens on `2026`; `--port` changes only the devserver's listen port; `--config`/`--environment`/`--secrets` reach the child's argv unmodified.
  - **Depends on**: none

- [x] **Implement AppServerProcess: spawn, free-port discovery, readiness polling**
  - **Story**: The devserver can start a child app server instance without hardcoding or colliding with a fixed port.
  - **What**: Add an `AppServerProcess` class that opens a throwaway `net` server on port `0` to obtain a free port, closes it, then `spawn(process.execPath, [nodeServerPath, ...forwardedArgs, '--port', String(freePort)], { stdio: 'inherit' })`. Poll the assigned port with `net.connect` at a short interval until a connection succeeds or a bounded startup timeout elapses.
  - **Where**: `tools/devserver/app-server-process.js`
  - **Documentation**: `src/node-server.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`
  - **Acceptance criteria**: Starting the process spawns `src/node-server.js` as a child with inherited stdio; the start promise resolves once the child accepts TCP connections on its assigned port; it rejects after a bounded timeout if the child never becomes reachable.
  - **Depends on**: Add CLI argument parsing and option resolution

- [x] **Implement graceful cutover restart**
  - **Story**: Both idle-triggered and crash-triggered restarts replace the running child without dropping requests still being served by the outgoing one.
  - **What**: Add a private cutover method on `AppServerProcess`: start a new child on a new free port, wait for it to become ready, swap the "current" child/port only after the new one is healthy, then send `SIGTERM` to the previous child without waiting for its exit (it drains and exits via `src/node-server.js`'s own shutdown handling). Guard against concurrent triggers with a single in-flight promise so simultaneous callers collapse into one restart instead of racing.
  - **Where**: `tools/devserver/app-server-process.js`
  - **Documentation**: `src/node-server.js` (`shutdown()` function), `src/docs/code-quality.md`
  - **Acceptance criteria**: While a restart is in flight, the previous child continues serving its own in-flight requests; the "current" port changes only after the new child is confirmed ready; concurrent restart triggers spawn at most one new child; if the new child fails to become ready, the previous child remains current and the failure is surfaced to the caller without killing the working process.
  - **Depends on**: Implement AppServerProcess: spawn, free-port discovery, readiness polling

- [x] **Implement idle-triggered restart**
  - **Story**: After the dev server sits idle for at least 5 seconds, the next request restarts the app server and is itself served by the fresh process.
  - **What**: Track `lastActivityAt`, updated whenever a proxied response finishes (success or error) — idle is measured from the last completed response, not the last request's arrival. Add an `ensureFresh()` method called before proxying each request: if `Date.now() - lastActivityAt` is at least the idle threshold (5000ms) and no restart is already in flight, trigger the cutover restart and await it before returning; otherwise resolve immediately. Requests that arrive while a triggered restart is already in flight await that same restart rather than triggering a second one.
  - **Where**: `tools/devserver/app-server-process.js`
  - **Documentation**: none existing — this behavior is specific to this plan
  - **Acceptance criteria**: A request arriving 5+ seconds after the previous response completed restarts the child and is proxied to the new one; a burst of concurrent requests after an idle gap triggers exactly one restart and all of them are served by the new child; requests arriving within the idle threshold never trigger a restart.
  - **Depends on**: Implement graceful cutover restart

- [x] **Implement crash detection and backoff respawn**
  - **Story**: If the app server process exits unexpectedly (not as part of an intentional restart), the devserver recovers automatically instead of proxying into a dead process forever.
  - **What**: Listen for the current child's `exit` event. When it exits other than as part of an intentional cutover or devserver shutdown, treat it as a crash: log it, and respawn, retrying with increasing backoff (e.g. 500ms, 1s, 2s, capped) if the immediate respawn attempt also fails to become ready. While there is no healthy child, proxied requests are answered with `502`.
  - **Where**: `tools/devserver/app-server-process.js`
  - **Documentation**: `src/docs/error-handling.md` (expected vs. unexpected failure framing)
  - **Acceptance criteria**: Killing the child out-of-band causes the devserver to log the crash, retry spawning with backoff, and resume proxying once a new child is ready; an intentional cutover restart does not itself trigger the crash/backoff path.
  - **Depends on**: Implement graceful cutover restart

- [x] **Implement the reverse proxy HTTP handler**
  - **Story**: Requests to the devserver's public port reach the current app server child with their original request/response semantics preserved.
  - **What**: Add a request handler that calls `appServerProcess.ensureFresh()`, then forwards the request to `127.0.0.1:<currentPort>` with `http.request()`, piping the request body through, and copying the response status/headers back unchanged — including the original `Host` header on the outgoing request so `virtual-hosts.js` hostname matching is unaffected by the proxy indirection. Call `appServerProcess.markActivity()` when the proxied response finishes. Return `502` when no child is currently reachable.
  - **Where**: `tools/devserver.js`
  - **Documentation**: `src/app/presentation/README.md` (VirtualHost hostname matching), `src/node-server.js` (`sendResponse`/`pipeStream`)
  - **Acceptance criteria**: GET/HEAD/POST requests with bodies proxy transparently; the `Host` header reaching the child matches the original request; streamed/chunked child responses are piped through without buffering; a request during an unreachable-child window receives `502`.
  - **Depends on**: Implement idle-triggered restart, Implement crash detection and backoff respawn

- [x] **Wire devserver startup, shutdown, and signal forwarding**
  - **Story**: `node tools/devserver.js` behaves as a single drop-in replacement for running `src/node-server.js` directly.
  - **What**: In `tools/devserver.js`, construct the `AppServerProcess`, call `start()` before listening, create the `http.createServer()` with the proxy handler, and listen on the resolved devserver port. On `SIGINT`/`SIGTERM`, stop accepting new devserver connections, call `appServerProcess.stop()` (`SIGTERM` to the current child with a bounded wait), and exit.
  - **Where**: `tools/devserver.js`
  - **Documentation**: `src/node-server.js` (`shutdown()` function, `SIGTERM`/`SIGINT` handling)
  - **Acceptance criteria**: `node tools/devserver.js` starts the child, becomes reachable on the resolved devserver port, and `Ctrl-C`/`SIGTERM` cleanly stops both the devserver and the child without leaving an orphaned process.
  - **Depends on**: Implement the reverse proxy HTTP handler
