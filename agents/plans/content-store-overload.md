Content Store Overload Handling
===============================

**Status:** In progress

When the Cloudflare content-store Durable Object reports that it is overloaded, the Publishing API answers `503 Service Unavailable` with a `Retry-After` header instead of a generic `500`. The devkit's Publishing API client honors `Retry-After` and backs off for several seconds on a `503`, and `publishContent()` drops to one upload at a time for the rest of the run once the server has reported an overload. Non-overload failures keep their current behavior on both sides. This fixes the downstream failure in kixxauth/nydynamo_com#37, where `release` gave up on an object upload after about one second of retries against an overloaded Durable Object (the overload hit the `statFiles` call that `putObject` makes, before build assignment, so traffic was unaffected).

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Server: overload becomes 503 + `Retry-After`.** In `lib/plugins/cloudflare-content-store/lib/content-store.js` `#callDurableObject`, an error flagged `.overloaded` is still never retried (retrying worsens the overload), but it is thrown as an expected 503 error carrying a retry hint, which the router turns into a `Retry-After` header. All other Durable Object failures keep today's behavior: retry `.retryable` errors with backoff, then wrap in `OperationalError` (HTTP 500); rethrow local errors untouched.
2. **Platform code stays in `plugins/`.** Only the Cloudflare adapter knows about `.overloaded`. The framework pieces (`kixx/errors`, `kixx/http-router`) gain a generic, platform-neutral way to carry and emit `Retry-After`.
3. **Devkit client: honor `Retry-After`, slower backoff for 503.** Both `Retry-After` forms (delay-seconds and HTTP-date) are parsed and capped. A `503` without a usable `Retry-After` uses a longer exponential backoff (several seconds total). Other retryable failures (429 without the header, other 5xx, network failures) keep the existing fast 100 ms backoff.
4. **Devkit publishing: reduce pressure after an overload.** After the server reports a `503`, the upload phase drops its concurrency for the rest of the run.
5. **Keep the `statObjects` existence check** in `putObject` (`lib/app/presentation/request-handlers/publishing-api/objects.js`). Do not remove or reorder it.
6. **Admin API client is out of scope.** See "Admin API client" below.

### Planner decisions (routine implementation choices)

The orchestrator may override these values. Change them before implementation starts, not partway through.

- **P1. New error class `ServiceUnavailableError`** in `lib/kixx/errors/` (CODE `SERVICE_UNAVAILABLE_ERROR`, HTTP 503, `expected` defaults to `true`). It takes an optional `retryAfterSeconds` option. This follows the `MethodNotAllowedError` + `allowedMethods` precedent: the error carries the header data, and the error-response paths emit the header. Why not `OperationalError` with `httpStatusCode: 503`: `WrappedError` drops unknown options, so a retry hint would have to be bolted on after construction.
- **P2. `Retry-After` is emitted whenever an expected error carries a non-negative integer `retryAfterSeconds`**, whatever its status. Today only `ServiceUnavailableError` sets it. The header is lowercase `retry-after`, matching the existing `allow` header style.
- **P3. Server hint: 5 seconds.** The content store answers with `retryAfterSeconds: 5` and the error code `ContentStoreOverloaded`. The public message is safe to expose (no Durable Object names, keys, or ids), for example: `The content store is temporarily overloaded. Retry after 5 seconds.`
- **P4. Client retry policy** (`devkit/lib/publishing/publishing-api-client.js`):
  - `MAX_ATTEMPTS` stays 4.
  - A retryable response (429 or 5xx) with a valid `Retry-After` waits `min(retryAfterMs, MAX_RETRY_AFTER_MS)` plus up to 1000 ms of jitter. The cap is 30 s. The client never waits less than the (capped) value the server asked for. The jitter spreads out the in-flight workers that all got the same hint.
  - A `503` without a usable `Retry-After` uses exponential backoff from a 1000 ms base: 1 s, 2 s, 4 s nominal, times the existing `0.5 + random()` jitter, about 7 s in total.
  - Every other retry keeps the existing 100 ms base backoff.
  - An invalid or missing `Retry-After` is ignored and falls back to the status-based backoff. An HTTP-date in the past means a 0 ms hint (plus jitter).
  - Retry-ability itself does not change: `retry: false` requests (`assignBuild`) still make exactly one attempt.
- **P5. Shared parser** `devkit/lib/parse-retry-after.js`, a top-level single-purpose module like `parse-jsonc.js`, so the Admin API client can adopt it later without moving it.
- **P6. Overload signal.** `PublishingAPIClient` exposes a read-only, sticky `serverOverloaded` getter. It becomes `true` the first time any response through that client has status `503`, whether or not the request is then retried or fails. Only 503 sets it: that is the status the server uses for overload. 429 is not included because the Publishing API never sends it.
- **P7. Reduced concurrency is 1.** `publishContent()` uploads with `MAX_CONCURRENCY` (6) workers until `client.serverOverloaded` is true, then with `OVERLOADED_CONCURRENCY` (1) for the rest of the run. Uploads go one at a time: they are normally few (only missing objects), and serial uploads cannot contend with each other. A client without the getter (test fakes, older clients) reads as not overloaded.
- **P8. Overload is logged in the plugin.** The router's `error` listeners in the entry points log only unexpected errors, so `#callDurableObject` logs `logger.warn('durable object overloaded', { methodName })` before it throws, to keep production visibility.
- **P9. `.overloaded` takes precedence over `.retryable`.** If the runtime sets both flags, the call is not retried. This matches the intent already stated in the `#callDurableObject` comment ("never .overloaded ones").

### Admin API client

`devkit/lib/admin/admin-api-client.js` has the same fast backoff and ignores `Retry-After`. It is left unchanged because:

- No Admin API endpoint reads or writes through the content store, so it will not see the new `503` + `Retry-After`.
- Its retry rules differ on purpose: writes never retry 5xx (see `devkit/docs/error-handling.md`).

Adopting `parse-retry-after.js` there later is a small follow-up. It is not part of this plan.

### Not in scope

- Sharding the content store across Durable Object instances (all requests still go to one instance via `getByName` with a fixed name).
- Overload handling in other Cloudflare Durable Object adapters (document store engine, job queue). Only the content store has `.overloaded` handling today.
- Retrying `assignBuild` on 503.
- New CLI output when the client backs off.
- Changing the devkit's `MAX_CONCURRENCY` default.

### Ported modules check

No touched module is one of the devkit-ported `lib/` modules (`kixx/config/parse-jsonc.js`, `kixx/config/secrets-manifest.js`, `kixx/content-addressable-store/{addressing,content-layout}.js`). The devkit conformance tests are unaffected and need no run.

### Cross-cutting constraints

- **Commands run from the repo root** `/Users/kris/Documents/kixx`.
- **lib must work on Node.js and Cloudflare.** The framework changes (`kixx/errors`, `kixx/http-router`, `app/presentation/lib`) must not import `node:*` or `cloudflare:*`. The `.overloaded` vocabulary stays in `plugins/cloudflare-content-store/`.
- **devkit must work on Node.js and Deno, and stays stand-alone.** No imports from outside `devkit/`. No new dependencies or Deno permissions. Use the injectable seams (`fetch`, `wait`, `random`, and a new `now`) so tests never wait in real time.
- **Error messages exposed by the router are public.** Never put Durable Object names, KV keys, or raw upstream payloads in a `ServiceUnavailableError` message.
- **Branch on `error.name`/`error.code`, not `instanceof`** (both codebases' error guides).
- **Code style:** `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md` for lib, except that files in `lib/kixx/errors/` follow the existing style of that folder (mirror `method-not-allowed-error.js`). For devkit, follow `devkit/docs/code-style-guide.md` and `devkit/docs/code-documentation-guide.md`. Use blank lines between logical blocks and short comments that explain why.
- **Do not edit `test-app/` copied code.** `test-app/` picks up lib changes only when the operator rebuilds it (see Operator runbook).
- **Commits:** at least one commit per task, following the CLAUDE.md commit rules, with a journal entry in `agents/journal/YYYY-MM-DD.md` (America/New_York timestamps) committed alongside it.

---

### Task S1: Framework support for 503 errors with `Retry-After`

**Status:** Complete
**Depends on:** None
**Documentation:** `lib/docs/server-error-handling.md`, `lib/app/presentation/README.md` (Error Handling), `lib/kixx/errors/README.md`

**Objective**

Kixx has a standard way to say "temporarily unavailable, retry after N seconds". `ServiceUnavailableError` carries `retryAfterSeconds`, and every framework error-response path that already emits `Allow` for 405 also emits `Retry-After` when the error carries a retry hint. This is platform-neutral groundwork that S2 uses. It is verifiable on its own through router and error-page tests.

**Scope**

- In: the new `ServiceUnavailableError` class and its export. `Retry-After` emission in `HttpRouter#handleError` (`lib/kixx/http-router/http-router.js`) and in `setErrorHeaders` of `lib/app/presentation/lib/html-error-page.js`. A `503: 'Service unavailable'` heading in `STATUS_HEADINGS`. Tests and lib docs for these.
- Out: the content store (S2) and the Publishing API usage doc (S2). `lib/app/presentation/error-handlers/admin-data-api-error-handler.js` is also out: the Admin Data API does not read through the content store, so it is left alone.

**Design and invariants**

- `lib/kixx/errors/lib/service-unavailable-error.js` mirrors `method-not-allowed-error.js`: it `extends WrappedError`, has `static CODE = 'SERVICE_UNAVAILABLE_ERROR'` and `static HTTP_STATUS_CODE = 503`, and `expected` defaults to `true`. It defines an enumerable, non-writable `retryAfterSeconds` property. The value is the option when it is a non-negative integer, otherwise `null`. An invalid hint is dropped, not thrown on, consistent with how `allowedMethods` defaults.
- Export it from `lib/kixx/errors/mod.js` in alphabetical position.
- Router: after the existing 405/`Allow` block in `handleError`, set `response.setHeader('retry-after', String(error.retryAfterSeconds))` when `Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0` (P2). Unexpected errors still return `false` before any header is set.
- `html-error-page.js` `setErrorHeaders`: the same rule, so admin HTML routes that hit an overloaded store also send the hint.
- The JSON:API body is unchanged in shape: a `ServiceUnavailableError` is an HTTP error, so its message and code are serialized (`mapErrorToJsonApiError`). `applyCachePolicy` already forces `no-store` on error responses. Do not change it.

**Expected touch points**

- `lib/kixx/errors/lib/service-unavailable-error.js` — new class.
- `lib/kixx/errors/mod.js` — export.
- `lib/kixx/http-router/http-router.js` — `Retry-After` in `handleError`, plus its JSDoc.
- `lib/app/presentation/lib/html-error-page.js` — `Retry-After` in `setErrorHeaders` and the 503 heading.
- `lib/test/kixx/errors/service-unavailable-error.test.js` — new (no `lib/test/kixx/errors/` folder exists yet; create it).
- `lib/test/kixx/http-router/http-router.test.js` — `handleError` cases.
- `lib/test/app/presentation/lib/html-error-page.test.js` — header case.
- `lib/docs/server-error-handling.md` — in the error-class list under "Expected Operational Errors", one bullet: use `ServiceUnavailableError` with `retryAfterSeconds` when a backing service reports a temporary overload.
- `lib/app/presentation/README.md` — one sentence near the 405/`Allow` mention or in Error Handling: an expected error with `retryAfterSeconds` gets a `Retry-After` header.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `new ServiceUnavailableError('busy', { retryAfterSeconds: 5 })` has `name` `ServiceUnavailableError`, `code` `SERVICE_UNAVAILABLE_ERROR`, `httpStatusCode` 503, `httpError` true, `expected` true, and `retryAfterSeconds` 5. A custom `code` and `cause` are kept. `expected: false` is honored.
- [x] `retryAfterSeconds` is `null` when it is omitted or invalid (`-1`, `1.5`, `'5'`, `NaN`). `0` is kept.
- [x] `router.handleError()` with that error returns a 503 JSON:API response with header `retry-after: 5` and `errors[0].status === '503'`. Without a hint there is no `retry-after` header. An unexpected error that carries `retryAfterSeconds` still returns `false`.
- [x] Existing 405/`Allow` behavior and tests are unchanged.
- [x] The HTML error page for that error has status 503, header `retry-after: 5`, and heading "Service unavailable".
- [x] The docs above are updated.

**Validation**

- `node lib/run-tests.js lib/test/kixx/errors lib/test/kixx/http-router lib/test/app/presentation/lib/html-error-page.test.js` — new and existing focused tests pass.
- `node lib/run-tests.js` — full lib suite passes on Node.js.
- `deno run -A lib/run-tests.js` — full lib suite passes on Deno.
- `node lib/run-linter.js lib` — lint clean.

**Progress and handoff**

- Completed: `ServiceUnavailableError` (export, `retryAfterSeconds` null when invalid), `retry-after` header in `HttpRouter#handleError` and `setErrorHeaders`, 503 heading, tests, docs.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: `lib/kixx/errors/README.md` lists no error classes, so it needed no change.
- Actual files changed: `lib/kixx/errors/lib/service-unavailable-error.js` (new), `lib/kixx/errors/mod.js`, `lib/kixx/http-router/http-router.js`, `lib/app/presentation/lib/html-error-page.js`, `lib/test/kixx/errors/service-unavailable-error.test.js` (new), `lib/test/kixx/http-router/http-router.test.js`, `lib/test/app/presentation/lib/html-error-page.test.js`, `lib/docs/server-error-handling.md`, `lib/app/presentation/README.md`.
- Validation run: focused tests pass (173); `node lib/run-tests.js` 1843 pass; `deno run -A lib/run-tests.js` 1843 pass; `node lib/run-linter.js lib` clean.
- Blockers: None.

---

### Task S2: Cloudflare content store answers an overloaded Durable Object with 503

**Status:** Complete
**Depends on:** S1
**Documentation:** `lib/plugins/README.md`, `lib/docs/server-error-handling.md`, `usage-docs/kixx-app/publishing-api.md`

**Objective**

When a content-store Durable Object call fails with `.overloaded`, the adapter throws `ServiceUnavailableError` (`code: 'ContentStoreOverloaded'`, `retryAfterSeconds: 5`, `cause` set). Every Publishing API endpoint that reads through the store, including `PUT /objects/:objectId` via `statObjects`, then answers `503` with `Retry-After: 5`. Other failures are unchanged. The public Publishing API doc describes the new response.

**Scope**

- In: `#callDurableObject` in `lib/plugins/cloudflare-content-store/lib/content-store.js`. The `## Errors` section of the `ContentStoreInterface` JSDoc in `lib/kixx/content-addressable-store/content-store-interface.js`. The `@throws` JSDoc of the affected public adapter methods, where they list `OperationalError`. Tests. `usage-docs/kixx-app/publishing-api.md`.
- Out: the Node.js content store (it has no overload condition), other Cloudflare adapters, and the `statObjects` check in `objects.js` (it must stay).

**Design and invariants**

- Add constant `DURABLE_OBJECT_OVERLOADED_RETRY_AFTER_SECONDS = 5`, with a short comment explaining that Cloudflare gives no duration, so this is a client hint.
- In the `catch` of `#callDurableObject`, after the "is this a Durable Object error" marker check, handle `cause.overloaded` first (P9):
  1. log `this.#logger.warn('durable object overloaded', { methodName })`;
  2. throw `new ServiceUnavailableError(<public message>, { cause, code: 'ContentStoreOverloaded', retryAfterSeconds: DURABLE_OBJECT_OVERLOADED_RETRY_AFTER_SECONDS })`.

  It is never retried and never waits on the scheduler.
- Keep everything else exactly as it is: retry `.retryable` errors up to `DURABLE_OBJECT_MAX_ATTEMPTS` with jittered backoff, wrap other marked errors in `OperationalError` (500), rethrow unmarked local errors untouched. Update the method's leading comment to describe the 503.
- Callers (`statFiles`, `getBuild` via `#fetchBuild`, `registerFile`, `assignBuild`, …) already rethrow `#callDurableObject` errors unwrapped through `TraceLogger`. Confirm that no layer between the adapter and the router rewraps it: `ContentAddressableStore.statObjects`/`putObject`/`createRelease` and the publishing handlers do not wrap today. Keep it that way.
- The `getBuild` isolate cache must not cache the rejection. Existing behavior covers this; add no new cache logic.
- Interface JSDoc: in `## Errors`, add that an adapter whose backing store reports a temporary overload MAY throw `ServiceUnavailableError` with `code: 'ContentStoreOverloaded'` and a `retryAfterSeconds` hint instead of `OperationalError`. It is still an operational failure.
- Publishing API usage doc: add a row to the error-code table (`503` | `ContentStoreOverloaded` | The content store is temporarily overloaded; retry after the `Retry-After` delay). Add a short paragraph under "Protocol conventions" → "Error documents": any endpoint that reads or writes content may answer `503` with a `Retry-After` header in seconds; clients should wait at least that long and retry idempotent requests; nothing was written. Note that the existing "Bootstrap" `503` (no Release assigned) has no `Retry-After` and is not a reason to retry.

**Expected touch points**

- `lib/plugins/cloudflare-content-store/lib/content-store.js` — overload branch, constant, import, comments.
- `lib/kixx/content-addressable-store/content-store-interface.js` — Errors contract.
- `lib/test/plugins/cloudflare-content-store/lib/content-store.test.js` — "Durable Object retries" cases.
- `lib/test/app/presentation/request-handlers/publishing-api/objects.test.js` — propagation case.
- `usage-docs/kixx-app/publishing-api.md` — error table and `Retry-After` paragraph.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] The existing test "does not retry an overloaded failure" is updated. One call, no scheduler wait (inject a recording `scheduler.wait`). The error has `name` `ServiceUnavailableError`, `code` `ContentStoreOverloaded`, `httpStatusCode` 503, `expected` true, `retryAfterSeconds` 5, and `cause` is the original error.
- [x] New test: an error with both `.overloaded` and `.retryable` is not retried and yields the 503 error.
- [x] New test: `statFiles()` with an overloaded Durable Object rejects with the 503 error (the path from the incident).
- [x] New test: the warn log is emitted with `methodName` (use a recording logger in place of `SILENT_LOGGER` for that case).
- [x] Existing tests for retryable, remote, and local errors pass unchanged (500 `OperationalError` and untouched `TypeError`).
- [x] `objects.test.js`: when `statObjects` rejects with a `ServiceUnavailableError`, `putObject` rejects with that same error (same `code`, `httpStatusCode`, and `retryAfterSeconds`) and stores nothing.
- [x] Interface JSDoc and `publishing-api.md` are updated as described.

**Validation**

- `node lib/run-tests.js lib/test/plugins/cloudflare-content-store lib/test/app/presentation/request-handlers/publishing-api` — focused tests pass.
- `node lib/run-tests.js` — full lib suite passes on Node.js.
- `deno run -A lib/run-tests.js` — full lib suite passes on Deno.
- `node lib/run-linter.js lib` — lint clean.
- A real Durable Object overload cannot be reproduced in unit tests. The fake Durable Object stub with `error.overloaded = true` stands in for it.

**Progress and handoff**

- Completed: overload branch in `#callDurableObject` (warn log, `ServiceUnavailableError` 503, `ContentStoreOverloaded`, `retryAfterSeconds: 5`, checked before `.retryable`), `@throws` JSDoc on methods that list `OperationalError`, interface Errors contract, tests, usage doc.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: Confirmed `ContentAddressableStore.statObjects`/`putObject` and `objects.js` do not wrap errors. The overload check uses truthiness (`cause.overloaded`), since the marker check uses `in`.
- Actual files changed: `lib/plugins/cloudflare-content-store/lib/content-store.js`, `lib/kixx/content-addressable-store/content-store-interface.js`, `lib/test/plugins/cloudflare-content-store/lib/content-store.test.js`, `lib/test/app/presentation/request-handlers/publishing-api/objects.test.js`, `usage-docs/kixx-app/publishing-api.md`.
- Validation run: focused 126 pass; `node lib/run-tests.js` 1847 pass; `deno run -A lib/run-tests.js` 1847 pass; lint clean.
- Blockers: None.

---

### Task D1: Publishing API client honors `Retry-After` and backs off longer on 503

**Status:** Complete
**Depends on:** None (independent of S1/S2; it reacts to any 503 or `Retry-After`)
**Documentation:** `devkit/docs/error-handling.md` (Retries), `devkit/docs/packaging-and-runtimes.md` (test seams), `devkit/docs/code-style-guide.md`

**Objective**

`PublishingAPIClient` waits as long as the server asks, up to a cap, on retryable responses. It backs off for several seconds on a bare `503`, keeps fast backoff for everything else, and exposes a sticky `serverOverloaded` signal for D2. Parsing `Retry-After` lives in a small shared module with its own tests.

**Scope**

- In: new `devkit/lib/parse-retry-after.js`. Retry-delay selection, the `now` option, and the `serverOverloaded` getter in `devkit/lib/publishing/publishing-api-client.js`. Tests. The "Retries" section of `devkit/docs/error-handling.md`.
- Out: the concurrency change in `publish-content.js` (D2), `admin-api-client.js` (see "Admin API client"), and `usage-docs/kixx-devkit/app.md` (D2).

**Design and invariants**

- `parseRetryAfter(value, nowMs)` returns milliseconds (≥ 0) or `null`:
  - `null`, `undefined`, or an empty or whitespace string → `null`.
  - Delay-seconds form: trimmed value matching `/^\d+$/` → `seconds * 1000`.
  - Otherwise `Date.parse(value)`. `NaN` → `null`. Else `max(0, date - nowMs)`.
  - Negative numbers, decimals, and garbage → `null`.

  It applies no cap: the policy belongs to the caller. JSDoc it as public (it is exported for reuse).
- Client constants: keep `MAX_ATTEMPTS = 4` and `RETRY_BASE_DELAY_MS = 100`. Add `OVERLOADED_RETRY_BASE_DELAY_MS = 1000`, `MAX_RETRY_AFTER_MS = 30000`, and `RETRY_AFTER_JITTER_MS = 1000`, each with a one-line comment explaining why.
- Constructor option `now` (default `Date.now`), asserted as a function like `wait` and `random`, and documented in the constructor JSDoc.
- `#request`: when a response arrives and `response.status === 503`, set `#serverOverloaded = true` before deciding whether to retry. When a retryable status will be retried, compute the delay from the response:
  1. `parseRetryAfter(response.headers?.get?.('retry-after'), this.#now())` is not `null` → `min(hint, MAX_RETRY_AFTER_MS) + random() * RETRY_AFTER_JITTER_MS`;
  2. else status 503 → `OVERLOADED_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + random())`;
  3. else the existing fast backoff.

  Network-failure retries keep the fast backoff. Read the header defensively (`?.`) because test fakes may omit `headers`. The existing `makeResponse` fake already supports `headers.get`.
- `get serverOverloaded()` returns a boolean and is read-only, with JSDoc stating that it is sticky for the life of the client.
- Unchanged: which statuses are retryable, `retry: false` single attempts, attempt counts on errors, token redaction, and error classes.
- The existing test "retries 429 and 503 responses before succeeding" asserts waits `[100, 200]`. Its 503 wait changes to the overload backoff. Update the assertion deliberately (with `random: () => 0.5`: 429 at attempt 1 → 100, 503 at attempt 2 → 2000). Do not keep the old expectation.

**Expected touch points**

- `devkit/lib/parse-retry-after.js` — new.
- `devkit/test/lib/parse-retry-after.test.js` — new.
- `devkit/lib/publishing/publishing-api-client.js` — delay selection, `now`, `serverOverloaded`, constants.
- `devkit/test/lib/publishing/publishing-api-client.test.js` — new and updated retry tests.
- `devkit/docs/error-handling.md` — Retries section.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `parseRetryAfter` handles `'5'` → 5000, `' 0 '` → 0, a future HTTP-date relative to the injected now, a past HTTP-date → 0, and `'-1'`, `'1.5'`, `'soon'`, `''`, `null` → `null`.
- [x] Client: a 503 with `retry-after: 5` then a 201 waits exactly `5000 + random() * 1000` (assert with a fixed `random`).
- [x] Client: `retry-after: 120` is capped to 30000 (+ jitter).
- [x] Client: an HTTP-date `Retry-After` is honored using the injected `now`.
- [x] Client: a 429 with `Retry-After` honors it.
- [x] Client: a bare 503 retried three times waits 1000/2000/4000 × `(0.5 + random())`, and the final error has `status` 503 and `attempts` 4.
- [x] Client: a 500 and a network failure keep the 100/200/400 schedule.
- [x] Client: an invalid `Retry-After` on a 503 falls back to the 503 backoff.
- [x] `serverOverloaded` is `false` on a new client. It becomes `true` after any 503, including one followed by success and the single 503 on `assignBuild` (which still makes exactly one attempt). It stays `false` after 429, 500, and network failures.
- [x] Constructing with a non-function `now` fails the assertion.
- [x] `devkit/docs/error-handling.md` Retries section is corrected and extended:
  - Idempotent Publishing API writes (object `PUT`, Release `POST`) retry like reads. The current text says writes retry on 429 only, which does not describe this client.
  - A `Retry-After` header is honored up to 30 s.
  - A bare 503 backs off from 1 s.
  - Other retries back off from 100 ms.
  - Build assignment never retries.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/parse-retry-after.test.js devkit/test/lib/publishing/publishing-api-client.test.js` — focused tests pass.
- `node devkit/run-tests.js` — full devkit suite passes on Node.js.
- `deno run -A devkit/run-tests.js` — full devkit suite passes on Deno.
- `node devkit/run-linter.js devkit` — lint clean.
- All waits go through the injected `wait`, so no test sleeps in real time.

**Progress and handoff**

- Completed: `parseRetryAfter`, client delay selection (`Retry-After` capped at 30 s + jitter, 1 s base for bare 503, 100 ms otherwise), `now` option, sticky `serverOverloaded` getter, tests, Retries docs.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: `Date.parse` accepts numeric-looking strings like `'-1'` as dates, so `parseRetryAfter` rejects values made only of digits, signs, dots, and spaces before trying the HTTP-date form. The Retries doc says the client sets `serverOverloaded`; D2 should add that `publishContent()` reads it.
- Actual files changed: `devkit/lib/parse-retry-after.js` (new), `devkit/test/lib/parse-retry-after.test.js` (new), `devkit/lib/publishing/publishing-api-client.js`, `devkit/test/lib/publishing/publishing-api-client.test.js`, `devkit/docs/error-handling.md`.
- Validation run: focused 35 pass; `node devkit/run-tests.js` 734 pass; `deno run -A devkit/run-tests.js` 734 pass; `node devkit/run-linter.js devkit` clean.
- Blockers: None.

---

### Task D2: Publishing drops to serial uploads after a server overload

**Status:** Not started
**Depends on:** D1
**Documentation:** `usage-docs/kixx-devkit/app.md` (`publish`), `devkit/docs/architecture.md`

**Objective**

Once the server has reported an overload, `publishContent()` stops adding load: the upload phase continues with one worker for the rest of the run. In-flight uploads finish (with the client's retry policy). This uses D1's `serverOverloaded` signal and keeps the change local to the worker pool.

**Scope**

- In: `mapWithConcurrency` and the upload phase in `devkit/lib/publishing/publish-content.js`, its tests, and the `publish` section of `usage-docs/kixx-devkit/app.md`.
- Out: client retry behavior (D1), the status and release phases (they are already sequential, single requests), and a CLI message about throttling.

**Design and invariants**

- Add `OVERLOADED_CONCURRENCY = 1` next to `MAX_CONCURRENCY = 6`, with a comment that the drop is sticky for the run because the store has already shown it cannot keep up.
- Give `mapWithConcurrency` a way to read the current limit: for example, pass a `getConcurrency` function, and have the upload phase pass `() => (client.serverOverloaded === true ? OVERLOADED_CONCURRENCY : MAX_CONCURRENCY)`. Each worker knows its index. Before it takes the next item, a worker whose index is `>= getConcurrency()` exits. Worker 0 always keeps going, so the run always finishes. Workers never restart. Keep the existing first-error behavior: stop taking items after the first failure and rethrow it.
- A strict `=== true` check means a fake or older client without the getter keeps full concurrency.
- Result shape, phase errors, and `completedUploadCount` accounting do not change.
- Usage doc: one short paragraph under `publish` steps. If the server reports it is busy (`503`), the command waits (honoring `Retry-After`, up to 30 s) and retries, then uploads the remaining objects one at a time. If it still fails, nothing was assigned, and rerunning later is safe.

**Expected touch points**

- `devkit/lib/publishing/publish-content.js` — constant, limit function, worker exit check.
- `devkit/test/lib/publishing/publish-content.test.js` — fake client gains an optional `serverOverloaded` flag that the test can flip mid-run, plus new tests.
- `usage-docs/kixx-devkit/app.md` — busy-server paragraph.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The existing test "limits object upload concurrency to six requests" still passes.
- [ ] New test: with 20 pending objects and a fake client whose `serverOverloaded` flips to `true` during the first upload, every object is uploaded once. After the in-flight uploads drain, at most one upload is active (record active counts per upload start after the flip). The Release is created.
- [ ] New test: a client that is already `serverOverloaded` before the upload phase never has more than one active upload.
- [ ] New test: a failing upload after the drop still surfaces as `PublishContentError` with `phase` `'upload'`.
- [ ] `usage-docs/kixx-devkit/app.md` is updated.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/publishing/publish-content.test.js` — focused tests pass.
- `node devkit/run-tests.js` — full devkit suite passes on Node.js.
- `deno run -A devkit/run-tests.js` — full devkit suite passes on Deno.
- `node devkit/run-linter.js devkit` — lint clean.

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

Agents do not perform these steps.

- [ ] Rebuild the test app with `node tools/build-test-app.js` so `test-app/` carries the S1/S2 lib changes, then deploy it and run the e2e suite before a release.
- [ ] Optional: watch the Worker logs during a large `kixx app publish` for `durable object overloaded` warnings, and confirm the client recovers.
- [ ] Release the lib and devkit changes, then update kixxauth/nydynamo_com to pick them up and close issue #37.
