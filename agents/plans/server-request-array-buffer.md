# Add `arrayBuffer()` to the ServerRequest Contract, and Correct One-Shot Body Error Classification

## Implementation Approach

`ServerRequest` exposes three body read methods — `json()`, `text()`, and `formData()` — but no way to read a body as raw bytes. Any handler needing binary input (an image upload, a signature verification over the exact request bytes, a non-text content type) currently has to drop to `request.body` and drain the `ReadableStream` by hand. This plan adds the standard `Request#arrayBuffer()` method so that reading bytes is as ordinary as reading JSON.

Adding it surfaced a defect in the three existing methods, which this plan also fixes. The two pieces are separated into their own tasks because only the first is new surface; the second changes shipped behavior.

**Why this is a shared-layer change.** The `server-request-base-class.md` plan hoisted every platform-independent member into `src/kixx/http-router/base-server-request.js`, where the read methods delegate to a private `#bodyDelegate` — an object exposing the Web `Request` body surface. On Cloudflare that delegate *is* the native Workers `Request`; on Node it is an internal `Request` the adapter builds to bridge `Readable.toWeb()`. Both are real Web `Request` instances, so **both already implement `arrayBuffer()`, `bodyUsed`, and `body`**. Neither adapter is touched by this plan. An adapter edit appearing in the diff is a signal that something has been implemented in the wrong layer.

**Behavior, and where it deviates from MDN.** `arrayBuffer()` matches the standard signature (no arguments) and the standard result (a `Promise<ArrayBuffer>`; an empty `ArrayBuffer` for a bodyless request). It deviates from MDN on one point: MDN specifies rejection with a raw `TypeError`, whereas a failed *read* rejects with `BadRequestError`, matching its siblings. Per `src/docs/server-error-handling.md`, an unwrapped `TypeError` propagates as unexpected and yields a 500; a malformed or truncated request body is a client fault and must surface as a 400.

### The one-shot body defect

Request bodies can be consumed only once. A second read makes the delegate throw, with different wording per platform:

```
Node/undici:  TypeError: Body is unusable: Body has already been read
Workers:      TypeError: Body has already been used...
```

Today that lands in the same `catch` as a truncated upload and is re-thrown as `BadRequestError` → 400. So a handler calling `request.json()` after middleware already called `request.formData()` reports that *the client* sent a bad request. The log says 400, the bug is ours, and the error is hidden in the one place a maintainer would look.

That is a direct violation of `src/docs/server-error-handling.md`, which says *"Do not convert a programmer error into an operational error"* and reserves assertions for *"values that a correct program would never produce."* A double read is exactly such a value.

**Discriminate before delegating, not by classifying the throw.** Catching and inspecting the error would mean matching on `TypeError` or on message text, and the two platforms word it differently — a per-platform behavior split of precisely the kind the base class exists to prevent. Instead, guard on the standard Body-mixin state before calling the delegate. Verified transitions (Node 24, undici):

| Situation | `bodyUsed` | `body.locked` | Verdict |
|---|---|---|---|
| Fresh request with a body | `false` | `false` | proceed |
| After any completed read | **`true`** | — | programmer error |
| After manual `body.getReader()` + `read()` | **`true`** | `true` | programmer error |
| `getReader()` called, nothing read yet | `false` | **`true`** | programmer error |
| Bodyless request (`body === null`) | `false` permanently | — | proceed; repeat reads are legal and resolve empty |

The last row is what makes the guard safe: a bodyless request never trips it, so repeated `text()` on a plain GET keeps resolving `''`. The `locked`-but-not-yet-disturbed row is why both flags must be checked — `getReader()` alone leaves `bodyUsed` false while already poisoning the delegate.

This splits the two cases on their nature rather than on the shape of the thrown object:

- **Guard fails** → `AssertionError`, propagates as unexpected → 500 and the platform's fatal-error policy.
- **Delegate throws after the guard passed** → genuinely operational (a stream that errors mid-read surfaces the underlying error, e.g. `Error: socket reset`, not a `TypeError`) → `BadRequestError` → 400.

**Understand what a 500 means here before implementing.** Under `src/docs/server-error-handling.md` an unexpected error is not merely a 500 response: *"Crash the process, not just the response."* A double-read bug reaching production will take down the Node process or restart the Worker isolate. That is the intended and correct consequence of classifying it as a programmer error — it is chosen deliberately, not overlooked.

**Relationship to `SR-1`'s deferral.** `server-request-base-class.md` explicitly declined to add runtime assertions during the consolidation: *"it changes failure modes and is deliberately deferred — the payoff of this plan is that such a change later becomes a one-file edit."* This plan is that deferred change, and it is a one-file edit as predicted.

### Scope boundaries

- Only `arrayBuffer()` is added. `Request#bytes()` and `Request#blob()` are not.
- `src/app/presentation/lib/read-request-body.js` is **not** modified. Its `bufferRequestBodyWithLimit()` streams under a hard byte cap so it can abort mid-body once the cap is crossed; buffering first would defeat the property it exists for. It is also not refactored onto the new method.
- `arrayBuffer()` is uncapped, like its three siblings. Its JSDoc points handlers accepting untrusted uploads at `bufferRequestBodyWithLimit()`.

---

### Task AB-1: `arrayBuffer()` is part of the request contract on every platform

**Status:** Complete
**Depends on:** None
**Documentation:** `src/kixx/http-router/server-request-interface.js` (the normative contract); `src/docs/server-error-handling.md`; `src/docs/code-documentation-guide.md`; `src/docs/code-style-guide.md`; `test/unit-tests/README.md`; MDN `Request#arrayBuffer` — https://developer.mozilla.org/en-US/docs/Web/API/Request/arrayBuffer

**Objective**

Application code can call `await request.arrayBuffer()` on any deploy target and receive the request body as an `ArrayBuffer`. A failed read surfaces as a 400; reading an already-consumed body is reported as the programmer error it is. The behavior is described in the normative interface, implemented once in `BaseServerRequest`, and proven identical on both adapters by the shared conformance suite.

**Scope**

- In: the `arrayBuffer()` method; the private one-shot guard helper it uses; `BodyDelegate` typedef updates; interface contract additions; conformance cases run against both adapters.
- Out: applying the guard to `json()`, `text()`, and `formData()` (AB-2); `bytes()` and `blob()`; any adapter change; any change to `read-request-body.js`.

**Design and invariants**

- The method takes no arguments and resolves with an `ArrayBuffer`. No `maxBytes` option and no content-type gating — `formData()` is the only read method that gates on `Content-Type`, because it must select a parser.
- A bodyless request resolves with a zero-length `ArrayBuffer`, never `null` and never a rejection. Assert this rather than assume it.
- The one-shot guard is a **private helper method on the base class**, written once so AB-2 can apply it to the other three methods without duplication. It takes the calling method's name for the assertion message, so a production log names the exact call site as `src/docs/server-error-handling.md` requires:

  ```js
  #assertBodyUnread(methodName) {
      const delegate = this.#bodyDelegate;
      assert(
          !delegate.bodyUsed && !delegate.body?.locked,
          `ServerRequest#${ methodName }(): the request body has already been read`,
      );
  }
  ```

- Use `assert` from `../assertions/mod.js` (the module the base class already imports `isValidDate` from), per the "Prefer `assert*` Helpers Over Hand-Written Checks" rule. Do not hand-roll a thrown `Error`.
- The guard runs **before** the `try` block, never inside it, so its `AssertionError` cannot be caught and re-wrapped as a `BadRequestError`. This ordering is the whole point of the task; a guard inside the `try` reintroduces the exact defect.
- Both flags must be checked. `bodyUsed` alone misses a stream locked by `getReader()` but not yet read.
- A read failure that occurs *after* the guard passes is still wrapped: `throw new BadRequestError('<message>', { cause }, this.arrayBuffer)`. The third argument is the method reference, matching the existing methods; `cause` preserves the platform error.
- The method delegates to `this.#bodyDelegate.arrayBuffer()` and does nothing else. It must not read `this.body`, tee or re-wrap the stream, or buffer manually — the delegate's spec-compliant implementation is the point of the injection contract.
- Place `arrayBuffer()` after `text()` and before `formData()` so the read methods read as one group.
- The `BodyDelegate` typedef gains `arrayBuffer`, `bodyUsed`, and `body`. This widens the contract a future adapter owes; any adapter whose delegate is a Web `Request` already satisfies it, and one hand-rolling a delegate now knows the full surface.
- JSDoc must state three things the signature cannot convey: that the body is buffered entirely in memory with no size limit; that `bufferRequestBodyWithLimit()` in `src/app/presentation/lib/read-request-body.js` is the tool for untrusted uploads; and that the `BadRequestError` rejection is a deliberate deviation from MDN's `TypeError` so the router returns 400 rather than 500.
- The interface module is the single normative source. Add `arrayBuffer` to the "Application conveniences" list; an invariant stating it MUST resolve with an `ArrayBuffer` (empty for a bodyless request) and MUST reject with `BadRequestError` when the body cannot be read; and an `@property {function(): Promise<ArrayBuffer>} arrayBuffer` entry beside `json`, `text`, and `formData`. Do not restate invariants in the base class JSDoc.
- Conformance cases go in `test/unit-tests/kixx/http-router/server-request-conformance.js`, not in an adapter test file — nothing here is platform-specific. Follow that file's conventions: a `describe('contract: arrayBuffer', …)` group beside `contract: text`, the `{ method, path, headers, body }` factory shape, and the file-local `catchAsyncError` helper.
- The factory's `body` option is a string on both platforms, so the byte-fidelity case should use bytes that distinguish a real byte read from a UTF-8 round trip — a multi-byte character such as `ö` (UTF-8 `0xC3 0xB6`), asserted against the expected byte sequence and `byteLength`.

**Expected touch points**

- `src/kixx/http-router/base-server-request.js` — `arrayBuffer()`, `#assertBodyUnread()`, `BodyDelegate` typedef.
- `src/kixx/http-router/server-request-interface.js` — conveniences list, invariant, `@property`.
- `test/unit-tests/kixx/http-router/server-request-conformance.js` — the `contract: arrayBuffer` group.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes. If either adapter under `src/plugins/` needs to change, stop and re-read the Implementation Approach — that means the method landed in the wrong layer.

**Acceptance criteria**

- [x] `arrayBuffer()` resolves with an `ArrayBuffer` holding the exact request body bytes, verified against a multi-byte character.
- [x] A bodyless request resolves with a zero-length `ArrayBuffer`, and doing so twice still succeeds.
- [x] Calling `arrayBuffer()` after the body was consumed throws `AssertionError`, **not** `BadRequestError`, and the message names `arrayBuffer`.
- [x] Calling `arrayBuffer()` after `request.body.getReader()` (with nothing read) also throws `AssertionError`.
- [x] A read failure after the guard passes still rejects with `BadRequestError` carrying `cause`.
- [x] `#assertBodyUnread()` is written as a reusable private helper taking a method name, ready for AB-2.
- [x] The `BodyDelegate` typedef documents `arrayBuffer`, `bodyUsed`, and `body`.
- [x] `server-request-interface.js` lists, states the invariant for, and documents `arrayBuffer` without duplicating base class prose.
- [x] The conformance suite passes against **both** adapters.
- [x] Neither adapter file is modified; `read-request-body.js` and its callers are unchanged.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-server-request test/unit-tests/plugins/cloudflare-server-request` — the new contract cases run and pass on both adapters via the shared suite.
- `node run-tests.js` — no new failures. **Read this against the recorded baseline, not against zero:** `server-request-base-class.md` records a pre-existing red baseline of 60 errors in `hyperview`/content-store belonging to the in-flight `content-store-owns-canonicalization` work. Capture the baseline count and per-message distribution *before* changing anything and compare after; only a change in that distribution is a regression.
- `node run-linter.js src/kixx/http-router test/unit-tests/kixx/http-router` — clean, exit 0.
- Manual: confirm `git status src/plugins` is clean, proving the change stayed in the shared layer.
- Manual: move the guard inside the `try` block and confirm the double-read case flips from `AssertionError` to `BadRequestError` under **both** adapters, then revert. This proves the ordering is load-bearing and that the case runs twice rather than only appearing to.

**Progress and handoff**

- Completed: All of AB-1. `arrayBuffer()` and the reusable `#assertBodyUnread()` guard are implemented in `BaseServerRequest`, the contract is documented in the interface, and 5 conformance cases run against both adapters plus 1 Node-platform case.
- Current state: Complete and validated.
- Remaining: Nothing.
- Decisions and discoveries:
  - Decided in the plan conversation: wrap read failures in `BadRequestError` rather than propagate MDN's `TypeError`; leave the method uncapped and document the capped alternative rather than add a `maxBytes` option; add `arrayBuffer()` alone, without `bytes()` or `blob()`; classify a double read as a programmer error; keep the guard in the base class rather than making it a normative adapter obligation.
  - Verified on Node 24 before planning: a bodyless `Request` resolves `arrayBuffer()` with a zero-length `ArrayBuffer` and never sets `bodyUsed`; a completed read sets `bodyUsed`; `getReader()` sets `body.locked` while leaving `bodyUsed` false; a stream that errors mid-read surfaces the underlying `Error`, not a `TypeError`. All of this held in the implemented tests.
  - **The plan's predicted baseline was exact.** Pre-change: 995 tests, 60 errors (52 x `HyperviewService#initialize() requires a contentStore`, 5 x `sources is not iterable`, 1 x `this.compileTemplate is not a function`, 1 x `service.isJsonRequest is not a function`, 1 x `Expected Boolean(false) to be truthy`). Post-change the per-message distribution is byte-identical. Branch is `content-addressable-store`; the working tree was clean apart from this plan file.
  - **The "read failure still wraps as BadRequestError" criterion could not be covered in the shared suite.** The suite's factory takes a string body, and neither platform can be made to fail mid-stream through it. The case is instead covered as a Node-platform test that swaps in a `Readable` which destroys itself with `Error('socket reset')` on first read — a stream that fails this way is genuinely platform-shaped, so it belongs in the adapter file per the suite's own rule. It asserts both the `BadRequestError` name and that `cause` is preserved. Cloudflare has no equivalent local mechanism; the wrapping code is shared, so one platform proving it is sufficient.
  - `assertMatches` was added to the conformance suite's `kixx-assert` imports for the assertion-message check. The `AssertionError` message reads `ServerRequest#arrayBuffer(): the request body has already been read (Expected Boolean(false) to be truthy)` — the helper's own suffix follows the prefix, so a substring match is the right assertion.
  - `catchAsyncError` was added to the Node adapter test file. It is now duplicated in three test files, consistent with the SR-3 decision to keep these three-line helpers file-local rather than sharing them.
  - The one-shot invariant added to the interface is currently written as scoped to `arrayBuffer()`. AB-2 generalizes it to cover all four read methods, per that task's design notes.
- Actual files changed:
  - `src/kixx/http-router/base-server-request.js` — `assert` import, `BodyDelegate` typedef gains `bodyUsed` and `arrayBuffer`, class JSDoc delegate surface updated, `arrayBuffer()` added between `text()` and `formData()`, `#assertBodyUnread()` added as the last class member.
  - `src/kixx/http-router/server-request-interface.js` — `arrayBuffer` added to the conveniences list, two invariants (resolution/rejection, and double-read classification), and an `@property` entry.
  - `test/unit-tests/kixx/http-router/server-request-conformance.js` — `contract: arrayBuffer` group with 5 cases; `assertMatches` import.
  - `test/unit-tests/plugins/node-server-request/lib/server-request.test.js` — mid-stream read failure case; `catchAsyncError` helper.
  - Neither adapter under `src/plugins/` was modified, and `read-request-body.js` is untouched (`git status` confirms both clean).
- Validation run:
  - `node run-tests.js test/unit-tests/plugins/node-server-request test/unit-tests/plugins/cloudflare-server-request` — 148 tests, 0 errors (was 137 before this task: +5 conformance cases x 2 platforms, +1 Node case).
  - `node run-tests.js` — 1006 tests, 60 errors; per-message distribution identical to the recorded baseline, so no regression.
  - `node run-linter.js src/kixx/http-router test/unit-tests/kixx/http-router test/unit-tests/plugins/node-server-request` — clean, exit 0.
  - Manual: `git status src/plugins src/app/presentation/lib/read-request-body.js` empty, proving the change stayed in the shared layer.
  - Manual (the guard-ordering check): moving `#assertBodyUnread()` inside the `try` produced exactly 4 failures — the double-read and locked-stream cases on **both** platforms, each reporting `Expected String(BadRequestError) to equal (===) String(AssertionError)`. This proves the ordering is load-bearing and that the cases genuinely run twice. Reverted from a scratchpad backup and re-verified green.
- Blockers: None.

---

### Task AB-2: A double read is a programmer error on every read method

**Status:** Complete
**Depends on:** AB-1
**Documentation:** `src/docs/server-error-handling.md` (the expected/unexpected split and the assertion rules); `src/kixx/http-router/server-request-interface.js`

**Objective**

`json()`, `text()`, and `formData()` classify a consumed-body read the same way `arrayBuffer()` does: as a programmer error that propagates as unexpected, rather than a `BadRequestError` that blames the client for our bug. After this task the four read methods share one rule, and a 400 from any of them means the client actually sent something bad.

**Scope**

- In: applying `#assertBodyUnread()` to the three existing read methods; the interface invariant covering all four; conformance cases for the three; an audit of existing callers.
- Out: `arrayBuffer()` itself (AB-1); `read-request-body.js`; any change to what the methods do on a *successful* read; any change to the wrapping of genuine read failures.

**Design and invariants**

- This is a deliberate behavior change, and the only one in this plan. A double read that previously produced a 400 now produces an `AssertionError` — a 500 plus the platform's fatal-error policy, meaning process exit or isolate restart. Do not soften this into a logged warning or a recovered response; a half-measure would leave the error classification wrong while adding noise.
- Apply the existing helper from AB-1. Do not write a second guard, and do not vary the message format between methods — pass each method's own name so the log identifies the call site.
- The guard goes before the `try` in each method, never inside it, for the same reason as AB-1.
- `formData()` keeps its `Content-Type` check. Order matters: the media-type rejection is about the request as sent and should still be a 415 regardless of body state, so the media-type check stays first and the one-shot guard follows it.
- Repeat reads of a **bodyless** request must remain legal on all four methods. The existing conformance case asserting `text()` resolves `''` for a bodyless request must keep passing, and a case should assert it twice in a row to lock the behavior in.
- Audit existing callers before changing behavior. Known body readers, all currently single-read per request: `src/app/presentation/lib/csrf.js:116` (`formData()`), `src/app/presentation/lib/json-api.js:45` (`json()`), `src/app/presentation/request-handlers/publishing-api/mod.js:146` (`text()` **or** `json()`, never both). The audit must confirm no middleware-plus-handler pair reads the body twice across a single request — a static grep for a second call site is not sufficient on its own, because the two reads can sit in different layers of the same chain.
- Note the `read-request-body.js` interaction even though that file is out of scope: `bufferRequestBodyWithLimit()` drains `request.body` directly, which sets `bodyUsed`, so any read method called after it will now assert. That is correct behavior — the body really is gone — and it is currently theoretical, because that helper has **no callers in `src/`** (see discoveries). Record it so a future caller is not surprised.
- Update the interface invariants to state the rule once, covering all four methods, rather than repeating it per method.
- `src/app/presentation/README.md:953` already warns that `validateCsrfFormData()` owns `request.formData()` and that handlers must not call it again. That prose is now enforced rather than advisory; check whether it is worth a sentence saying so.

**Expected touch points**

- `src/kixx/http-router/base-server-request.js` — the guard call in `json()`, `text()`, `formData()`.
- `src/kixx/http-router/server-request-interface.js` — the one-shot invariant covering all four methods.
- `test/unit-tests/kixx/http-router/server-request-conformance.js` — double-read cases for the three methods; a repeat-read-of-bodyless case.
- `src/app/presentation/README.md` — only if the CSRF note needs the enforcement sentence.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] A second read via `json()`, `text()`, or `formData()` throws `AssertionError`, not `BadRequestError`, on both adapters.
- [x] The assertion message names the method that was called second.
- [x] Cross-method double reads are covered, not just same-method ones — at minimum `formData()` after `text()`, since that mirrors the real CSRF-middleware-then-handler bug this task exists to expose.
- [x] Repeat reads of a bodyless request still succeed on all four methods.
- [x] `formData()` still throws `UnsupportedMediaTypeError` for a bad media type even when the body was already consumed, proving the check order.
- [x] Genuine read failures still reject with `BadRequestError` carrying `cause`.
- [x] The caller audit is complete and its result is recorded in the handoff notes, naming every body-reading call site found and confirming none double-reads.
- [x] The interface states the one-shot rule once for all four methods.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-server-request test/unit-tests/plugins/cloudflare-server-request` — the new cases pass on both adapters.
- `node run-tests.js` — compare against the same recorded baseline described in AB-1. Any *new* failure here is most likely a real double read this task has just exposed; treat it as a found bug and fix the caller, not as a reason to weaken the guard.
- `node run-linter.js src/kixx/http-router test/unit-tests/kixx/http-router` — clean, exit 0.
- Manual: the caller audit described above.

**Progress and handoff**

- Completed: All of AB-2, and with it the whole plan. All four read methods now classify a consumed-body read as a programmer error.
- Current state: Complete and validated.
- Remaining: Nothing.
- Decisions and discoveries:
  - Decided in the plan conversation: apply the guard to all four read methods rather than only the new one, accepting the behavior change to the three existing methods; keep the rule in the base class rather than making it a normative obligation on hand-rolled adapters.
  - **`bufferRequestBodyWithLimit()` has no callers in `src/`.** The only references outside its own module are this plan and a comment in `test/end-to-end/020-publishing-api/put-static-asset-errors.test.js:367` noting that its size-cap fast path belongs in a unit test. This does not change the guidance in AB-1's JSDoc — it is still the right tool for capped reads — but it means the AB-2 audit surface is smaller than it first appears, and that the helper is currently untested at the unit level.
  - **Caller audit complete: no existing double read.** Every body-reading call site in `src/`, and what it reads:
    - `src/app/presentation/lib/csrf.js:116` — `formData()`, inside `validateCsrfFormData()`. Called once per request by six handlers across `admin-users.js`, `admin-invites.js`, and `admin-publishing-api-tokens.js`. The two call sites per file are in **separate exported handler functions** (verified individually), not sequential calls in one chain.
    - `src/app/presentation/lib/json-api.js:45` — `json()`, inside `parseJsonApiResource()`. Called once each by four handlers.
    - `src/app/presentation/request-handlers/publishing-api/mod.js:146` — `text()` **or** `json()`, never both, inside `PutResource`. Line 165 in the same file calls `parseJsonApiResource()` (and so `json()`), but from `CommitChanges`, a **different** handler factory. This pair was the closest thing to a real double read and it is not one.
    - `src/app/presentation/lib/read-request-body.js:33,37` — reads `request.body` directly; no callers in `src/` (see above).
    - No middleware reads the body, so there is no middleware-then-handler pair to worry about.
    The empirical check agrees with the static one: the full suite produced zero occurrences of the guard's `already been read` message.
  - **The `read-request-body.js` interaction, recorded for a future caller:** `bufferRequestBodyWithLimit()` drains `request.body` via `getReader()`, which sets `bodyUsed`, so any read method called after it now asserts. That is correct — the body really is gone — but it will surprise whoever first pairs that helper with a read method. The file itself remains out of scope and unmodified.
  - `src/app/presentation/README.md` was updated: the CSRF paragraph's "do not call `request.formData()` again" advice now also names `json()`, `text()`, and `arrayBuffer()` (they read the same consumed body), and says the rule is enforced rather than advisory.
  - The interface's one-shot invariant, written scoped to `arrayBuffer()` by AB-1, was generalized to cover all four methods in any combination, as planned.
- Actual files changed:
  - `src/kixx/http-router/base-server-request.js` — `#assertBodyUnread()` calls added to `json()`, `text()`, and `formData()`. In `formData()` the guard is placed **after** the media-type check, with a comment explaining why.
  - `src/kixx/http-router/server-request-interface.js` — the one-shot invariant generalized to all four read methods.
  - `test/unit-tests/kixx/http-router/server-request-conformance.js` — new `contract: one-shot body` group with 6 cases.
  - `src/app/presentation/README.md` — the CSRF one-shot paragraph.
- Validation run:
  - `node run-tests.js test/unit-tests/plugins/node-server-request test/unit-tests/plugins/cloudflare-server-request` — 160 tests, 0 errors (148 after AB-1: +6 cases x 2 platforms).
  - `node run-tests.js` — 1018 tests, 60 errors; per-message distribution identical to the recorded baseline. **No new failure, meaning no pre-existing double read was exposed**, which independently confirms the caller audit. Also grepped the run output for the guard's assertion message: zero occurrences.
  - `node run-linter.js src/kixx/http-router test/unit-tests/kixx/http-router test/unit-tests/plugins` — clean, exit 0.
  - Manual (check-order): moving the `formData()` guard *before* the media-type check produced exactly 2 failures — `checks the formData() media type before the one-shot guard` on **both** platforms, each reporting `Expected String(AssertionError) to equal (===) String(UnsupportedMediaTypeError)`. This proves the 415-before-guard ordering is load-bearing and covered on both platforms. Reverted from a scratchpad backup and re-verified green.
- Blockers: None.
