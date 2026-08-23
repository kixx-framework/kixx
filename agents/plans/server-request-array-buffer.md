# Add `arrayBuffer()` to the ServerRequest Contract

## Implementation Approach

`ServerRequest` exposes three body read methods — `json()`, `text()`, and `formData()` — but no way to read a body as raw bytes. Any handler needing binary input (an image upload, a signature verification over the exact request bytes, a non-text content type) currently has to drop to `request.body` and drain the `ReadableStream` by hand. This plan adds the standard `Request#arrayBuffer()` method so that reading bytes is as ordinary as reading JSON.

**Why this is now a one-file change.** The `server-request-base-class.md` plan hoisted every platform-independent member into `src/kixx/http-router/base-server-request.js`, where the three existing read methods delegate to a private `#bodyDelegate` — an object exposing the Web `Request` body surface. On Cloudflare that delegate *is* the native Workers `Request`; on Node it is an internal `Request` the adapter builds to bridge `Readable.toWeb()`. Both are real Web `Request` instances, so **both already implement `arrayBuffer()`**. This plan therefore adds one method to the base class and touches neither adapter. Realizing the payoff the consolidation plan predicted — that a change to shared request behavior becomes a one-file edit — is the point of doing it this way, and an adapter edit appearing in the diff is a signal that something has been implemented in the wrong layer.

**Behavior, and where it deviates from MDN.** The method matches the standard signature (no arguments) and the standard result (a `Promise<ArrayBuffer>`; an empty `ArrayBuffer` for a bodyless request — verified on Node: `new Request(url).arrayBuffer()` resolves with `byteLength === 0`). It deviates from MDN on exactly one point: MDN specifies rejection with a raw `TypeError`, whereas this method wraps a delegate failure in `BadRequestError`, matching `json()`, `text()`, and `formData()`. That deviation is deliberate and load-bearing. Per `src/docs/server-error-handling.md`, an unwrapped `TypeError` propagates as an *unexpected* error and yields a 500; a malformed or truncated request body is a client fault and must surface as a 400. Making `arrayBuffer()` the one read method that answers a bad body with a 500 would be a worse inconsistency than the spec deviation, so the deviation is documented in the JSDoc rather than avoided.

**A known consequence of that choice, inherited rather than introduced.** Request bodies are one-shot. Reading the body twice makes the delegate throw `TypeError: Body is unusable`, which this method will report as a 400 even though it is a programmer error, not a client fault. `json()` and `text()` already behave exactly this way today; `arrayBuffer()` inherits the tradeoff instead of diverging from its siblings. Changing that policy would mean changing it for all four methods at once, and is out of scope here.

**Uncapped buffering, and the helper that isn't.** `arrayBuffer()` buffers the entire body with no size limit — the same exposure `json()`, `text()`, and `formData()` already carry. The project separately has `src/app/presentation/lib/read-request-body.js`, whose `bufferRequestBodyWithLimit()` streams the body under a hard byte cap and throws `PayloadTooLargeError`. These two are easy to confuse, because after this change they will look like two ways to get the bytes of a request body. They are not interchangeable, and the JSDoc on `arrayBuffer()` must point a handler accepting untrusted uploads at the capped helper. `read-request-body.js` itself is **not** modified: it deliberately streams so it can abort mid-body once the cap is crossed, which buffering first would defeat.

**Scope boundaries.** Only `arrayBuffer()` is added. `Request#bytes()` (a `Uint8Array`) and `Request#blob()` are not, and the base class stays free of any body method whose name is not already in the contract. `read-request-body.js` is not refactored to sit on top of the new method.

**One task, deliberately.** This plan has a single task. The change is roughly thirty lines of implementation plus its conformance cases, and the natural-looking split — implementation first, contract documentation and tests second — would leave an intermediate state in which the base class ships a method that the normative interface does not describe and no test exercises. The implementation, the contract text, and the cross-platform coverage are one reviewable unit.

---

### Task AB-1: `arrayBuffer()` is part of the request contract on every platform

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/http-router/server-request-interface.js` (the normative contract); `src/docs/server-error-handling.md`; `src/docs/code-documentation-guide.md`; `src/docs/code-style-guide.md`; `test/unit-tests/README.md`; MDN `Request#arrayBuffer` — https://developer.mozilla.org/en-US/docs/Web/API/Request/arrayBuffer

**Objective**

Application code can call `await request.arrayBuffer()` on any deploy target and receive the request body as an `ArrayBuffer`, with a failed read surfacing as a 400 through the existing error pipeline. The behavior is described in the normative interface, implemented once in `BaseServerRequest`, and proven identical on both the Node and Cloudflare adapters by the shared conformance suite.

**Scope**

- In: the `arrayBuffer()` method on `BaseServerRequest`; the `BodyDelegate` typedef; the interface contract additions (invariant, conveniences list, `@property`); conformance suite cases run against both adapters.
- Out: `bytes()` and `blob()`; any change to either platform adapter; any change to `read-request-body.js` or its callers; any change to the shared one-shot-body or error-wrapping policy of the existing read methods.

**Design and invariants**

- The method takes no arguments and resolves with an `ArrayBuffer`. No `maxBytes` option, no content-type gating — `formData()` is the only read method that gates on `Content-Type`, and it does so because it must select a parser.
- A bodyless request resolves with a zero-length `ArrayBuffer`, never `null` and never a rejection. This falls out of the delegate's own behavior and must be asserted rather than assumed.
- Failure is wrapped: `throw new BadRequestError('<message>', { cause }, this.arrayBuffer)`. The third argument is the method reference, matching the three existing read methods so call-site capture is consistent; `cause` preserves the underlying platform error.
- The method delegates to `this.#bodyDelegate.arrayBuffer()` and does nothing else. It must not read `this.body`, must not tee or re-wrap the stream, and must not buffer manually — the delegate's spec-compliant implementation is the whole point of the injection contract.
- Place the method with its siblings, after `text()` and before `formData()`, so the read methods read as one group.
- The `BodyDelegate` typedef gains an `arrayBuffer` property. This widens the contract a future adapter must satisfy, which is correct: any adapter whose delegate is a Web `Request` already satisfies it, and one that hand-rolls a delegate now knows the full surface it owes.
- JSDoc must state three things a caller cannot infer from the signature: that the body is buffered entirely in memory with no size limit, that `bufferRequestBodyWithLimit()` in `src/app/presentation/lib/read-request-body.js` is the right tool for untrusted uploads, and that the `BadRequestError` rejection is a deliberate deviation from MDN's `TypeError` so the router returns a 400 rather than a 500.
- The interface module is the single normative source. Add to it: `arrayBuffer` in the "Application conveniences" list; an invariant paragraph stating it MUST resolve with an `ArrayBuffer` (empty for a bodyless request) and MUST reject with `BadRequestError` when the body cannot be read; and an `@property {function(): Promise<ArrayBuffer>} arrayBuffer` entry alongside `json`, `text`, and `formData`. Do not restate the invariants in the base class JSDoc.
- Conformance cases belong in `test/unit-tests/kixx/http-router/server-request-conformance.js`, not in either adapter's test file. This is shared behavior; per that file's own doc block, platform-specific derivation is what belongs in an adapter file, and nothing about this method is platform-specific.
- Follow the suite's existing conventions: a `describe('contract: arrayBuffer', …)` group placed next to the `contract: text` group, the `{ method, path, headers, body }` factory shape, and the file-local `catchAsyncError` helper for rejection cases.
- The factory's `body` option is a string on both platforms, so a byte-fidelity case should send bytes that distinguish a real byte read from a UTF-8 round trip — a multi-byte character such as `ö` (UTF-8 `0xC3 0xB6`) asserted against the expected byte sequence and `byteLength`.

**Expected touch points**

- `src/kixx/http-router/base-server-request.js` — the `arrayBuffer()` method and the `BodyDelegate` typedef entry.
- `src/kixx/http-router/server-request-interface.js` — conveniences list, invariant, `@property`.
- `test/unit-tests/kixx/http-router/server-request-conformance.js` — the new `contract: arrayBuffer` group.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes. In particular, if either adapter under `src/plugins/` needs to change, stop and re-read the Implementation Approach — that would mean the method has been put in the wrong layer.

**Acceptance criteria**

- [ ] `BaseServerRequest#arrayBuffer()` resolves with an `ArrayBuffer` holding the exact request body bytes.
- [ ] A bodyless request resolves with a zero-length `ArrayBuffer`.
- [ ] A delegate failure rejects with `BadRequestError`, carrying the original error as `cause`.
- [ ] The `BodyDelegate` typedef documents `arrayBuffer`.
- [ ] `server-request-interface.js` lists `arrayBuffer` as an application convenience, states its invariant, and documents it as a `@property`, without duplicating the base class prose.
- [ ] The conformance suite covers byte fidelity (including a multi-byte character), the bodyless case, and the `BadRequestError` rejection, and passes against **both** adapters.
- [ ] Neither `src/plugins/node-server-request/lib/server-request.js` nor `src/plugins/cloudflare-server-request/lib/server-request.js` is modified.
- [ ] `read-request-body.js` and its callers are unchanged.
- [ ] JSDoc meets `src/docs/code-documentation-guide.md` and records the uncapped-buffering warning, the pointer to `bufferRequestBodyWithLimit()`, and the MDN error deviation.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-server-request test/unit-tests/plugins/cloudflare-server-request` — the new contract cases run and pass on both adapters via the shared suite.
- `node run-tests.js` — no new failures. **Read this against the recorded baseline, not against zero:** `server-request-base-class.md` records a pre-existing red baseline of 60 errors in `hyperview`/content-store belonging to the in-flight `content-store-owns-canonicalization` work. Capture the baseline count and per-message distribution *before* making any change, and compare after; only a change in that distribution is a regression.
- `node run-linter.js src/kixx/http-router test/unit-tests/kixx/http-router` — clean, exit 0.
- Manual: confirm `git status src/plugins` is clean, proving the change stayed in the shared layer.
- Manual: break the new method in the base class (for example, return the delegate promise without the `try`/`catch`) and confirm the rejection case fails under **both** adapters, then revert. This is the same cross-platform check SR-3 used, and it is what proves the new cases are actually running twice rather than only appearing to.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries:
  - Decided before implementation, from the plan conversation: wrap failures in `BadRequestError` rather than propagate MDN's `TypeError`; leave the method uncapped and document the capped alternative rather than add a `maxBytes` option; add `arrayBuffer()` alone, without `bytes()` or `blob()`.
  - Verified on Node before planning: a Web `Request` with no body resolves `arrayBuffer()` with a zero-length `ArrayBuffer`, and a second read after `text()` throws `TypeError: Body is unusable`. The latter will be reported as a 400 — an inherited inconsistency shared with `json()` and `text()`, not one introduced here.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
