# Node server: drain unread request bodies

GitHub issue: https://github.com/kixx-framework/kixx/issues/160

## Implementation Approach

`src/plugins/node-server-request/lib/server-request.js` bridges the
`IncomingMessage` into the body-delegate `Request` with
`Readable.toWeb(nativeRequest)`. `toWeb()` attaches a `data` listener, which
sets `req._consuming`. Node's `resOnFinish()` then skips its usual `req._dump()`.
When the handler never reads the body, or reads only part of it, the stream
stays paused under backpressure, the unread bytes stay on the socket, and the
client sees `ECONNRESET`, either on the current request or on the next request
that reuses the keep-alive socket.

This repo is affected, not just downstream apps. `UploadFileForm` throws
`PayloadTooLargeError` from `X-File-Size` before the upload body is read
(`admin-files.js` `makeUploadForm()`).

Investigation findings (Node v24.13.1, scratch reproductions):

| Handler behavior | `toWeb()` today | Owned bridge + discard on finish |
| --- | --- | --- |
| Never reads body (300 KB / 2 MB) | intermittent `ECONNRESET` | ok |
| Reads one chunk, then responds | intermittent `ECONNRESET` | ok |
| Calls `request.body.cancel()` | intermittent `ECONNRESET` | ok |
| Reads full body | ok | ok |

Two options from the issue were ruled out:

- **`webStream.cancel()` + `nativeRequest.resume()` on finish.** This crashes
  the process with an uncaught `ERR_INVALID_STATE: Controller is already
  closed`. `toWeb()`'s `cancel` destroys the `IncomingMessage`, and `resume()`
  then flushes buffered chunks into the closed controller's still-attached
  `data` listener.
- **`Connection: close` only.** The client still gets `ECONNRESET` for bodies
  still in flight, because closing a socket with unread receive data sends a
  TCP RST.

The fix replaces `Readable.toWeb()` with a small bridge that the adapter owns.
The bridge's listeners and end-of-body state are then under our control:

1. `cancel()` detaches the bridge's listeners and resumes the
   `IncomingMessage` so the rest of the body is discarded. It does not destroy
   it. This covers consumers that cancel the stream, such as a `pipeline()`
   failure in the Node object store tearing down `Readable.fromWeb(body)`.
2. A Node-only `discardUnreadBody()` method does the same thing. The entry
   point calls it on the Node response's `finish` event. It covers handlers
   that respond without reading, or after reading only part of the body.

Draining is unbounded, which matches Node's own `_dump()`. The server's
`requestTimeout` (Node default 300 s; `node-server.js` does not override it) is
the backstop against a client that streams forever. This was verified: with
`requestTimeout: 2000`, a client that received its 413 and kept trickling a
1 GB body had its connection closed at 2 s. Node sends a stray 408 first, which
is harmless. A byte-count cap was rejected. It would need counting, socket
destruction, config, and tests, while the timeout costs nothing. Discarded
bytes are not buffered, so only bandwidth is spent. If that matters, lower
`requestTimeout`.

Cloudflare is out of scope. The edge terminates the client connection there.

## Tasks

### Task NURB-1: Discard unread request bodies so responses and keep-alive sockets survive

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` (adapters, entry points);
`src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`;
`src/docs/server-error-handling.md`; `test/unit-tests/README.md`;
`src/kixx/http-router/base-server-request.js` (BodyDelegate contract).

**Objective**

Any response the Node server sends (early rejection, partial read, cancelled
body, or router 500) reaches the client, and the connection is left reusable.
Body reading semantics are unchanged for handlers that consume the body.

**Scope**

- In: the Node request-body bridge in `server-request.js`; a Node-only
  `discardUnreadBody()` on the Node `ServerRequest`; wiring it to
  `nodeResponse` `finish` in `src/node-server.js`; unit tests for both.
- Out: Cloudflare adapter; `ServerRequestInterface` and `BaseServerRequest`
  (discarding is a Node transport concern, not part of the cross-platform
  contract); a drain size cap or `Connection: close` policy (rejected in favor
  of `requestTimeout`; see Implementation Approach); `tools/devserver.js`
  proxy behavior; new end-to-end tests.

**Design and invariants**

- The bridge is a `ReadableStream` built over the `IncomingMessage`:
  - `start` attaches `data`, `end`, and `error` listeners.
  - `data` enqueues a `Uint8Array` and pauses the `IncomingMessage` when
    `desiredSize <= 0`.
  - `pull` resumes it.
  - `end` closes the controller.
  - `error` errors the controller, so the existing `BadRequestError` wrapping
    of mid-stream failures still applies.
  - `cancel` detaches the listeners and calls `resume()`. It must never
    destroy the `IncomingMessage`, because destroying it resets the socket.
- The bridge tracks its own "ended" state. Do not rely on `req.complete`: the
  unit-test stand-in is a plain `Readable` without it. `discardUnreadBody()` is
  a no-op when there is no body, the body has ended, or the body is already
  discarding. It is idempotent.
- Do not remove listeners the bridge did not add. Detach only the bridge's own
  handlers, which is the reason for owning the bridge instead of calling
  `removeAllListeners('data')` on `toWeb()`'s listeners.
- The body stream must not be closed or errored by discarding. The response is
  already finished, so nothing awaits it. Leaving it pending avoids enqueue-
  after-close races.
- `node-server.js` registers `nodeResponse.once('finish', ...)` right after
  constructing the request, before routing. This covers normal, HEAD, and
  router-500 responses. If the constructor throws, no bridge exists, and
  Node's own `_dump()` still applies. Keep the listener registration outside
  `sendResponse()` so every exit path is covered.
- Keep `duplex: 'half'` and the `hasRequestBody()` framing rules unchanged.
- Update the class JSDoc and the constructor comment, which currently say the
  body is bridged with `toWeb()`. Document `discardUnreadBody()` as a
  Node-adapter method outside `ServerRequestInterface`.

**Expected touch points**

- `src/plugins/node-server-request/lib/server-request.js`: owned body bridge;
  `discardUnreadBody()`; JSDoc.
- `src/node-server.js`: call `request.discardUnreadBody()` on response
  `finish`.
- `test/unit-tests/plugins/node-server-request/lib/server-request.test.js`:
  bridge and discard tests.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The shared `serverRequestConformance` suite and the existing Node adapter
      tests pass unchanged, including the mid-stream failure →
      `BadRequestError` test.
- [ ] Unit test (stand-in `Readable`): after a partial read,
      `discardUnreadBody()` lets the source flow to `end` without enqueueing
      into the Web stream, and does not throw.
- [ ] Unit test: `request.body.cancel()` does not destroy the source. The
      source is resumed and reaches `end`.
- [ ] Unit test: `discardUnreadBody()` is a no-op for a bodyless request and
      after the body was fully read, and is safe to call twice.
- [ ] Integration-style unit test: a real `http.createServer` on port 0 uses
      the adapter and calls `discardUnreadBody()` on `finish`. A keep-alive
      client (an `http.Agent` with `keepAlive: true, maxSockets: 1`, which
      forces socket reuse) sends 2 MB POST bodies that the handler answers with
      413 without reading, then sends a second request. Both requests get
      responses, and the server-side `IncomingMessage` reaches `end`. Assert on
      server-side drain completion, not only on the absence of `ECONNRESET`,
      because the reset is timing dependent. Close the server and agent in
      `after`.
- [ ] Manual: against `node tools/local-target.js serve <name>`, an admin
      upload with `X-File-Size` above `FILES.maxUploadBytes` and a real
      oversized body gets the 413 response, and a follow-up request on the same
      client succeeds.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-server-request` — adapter
  and bridge behavior.
- `node run-tests.js` — full suite.
- `node run-linter.js src/plugins/node-server-request src/node-server.js test/unit-tests/plugins/node-server-request`
  — lint.
- Manual local-target check above.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Root cause confirmed on Node v24.13.1 (`_dumped`
  stays false after finish when `toWeb()` is attached). The `cancel()` +
  `resume()` fix from the issue crashes the process. A scratch bridge that
  detaches its own listeners and resumes passed the none, partial, cancel, and
  full read patterns at 300 KB, 2 MB, and 8 MB, with socket reuse.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

