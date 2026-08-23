# Hoist Shared ServerRequest Behavior Into a Framework Base Class

## Implementation Approach

The two `ServerRequest` adapters — `src/plugins/cloudflare-server-request/lib/server-request.js` (349 lines) and `src/plugins/node-server-request/lib/server-request.js` (453 lines) — both implement `src/kixx/http-router/server-request-interface.js`. Roughly 190 lines are byte-identical between them, and none of that duplicated code is platform-specific: it operates entirely on the Web `Headers` and `URL` primitives that both adapters already normalize to during construction.

That duplication is a correctness risk, not just an aesthetic one. A fix to cookie parsing, ETag list splitting, or bearer-token validation that lands in one file and not the other becomes a silent per-platform behavior split — the kind of divergence that only surfaces in production on one deploy target.

**Strategy.** Introduce `src/kixx/http-router/base-server-request.js`, owned by the port's own package alongside the interface it implements. Both adapters extend it. This follows the existing `src/kixx/context/base-context.js` precedent (`ApplicationContext` and `RequestContext` extend it) and preserves the plugin boundary rule in `src/plugins/README.md:38`: adapters import *upward* into `kixx/` — which they already do for `kixx/errors/` and `kixx/assertions/` — and never sideways into another plugin's `lib/`.

**The split.** After the refactor, each adapter owns only what is genuinely platform-shaped:

| Layer | Owns |
|---|---|
| `BaseServerRequest` | The `defineProperties` block establishing the immutable `id`/`ip`/`method`/`url`/`headers` contract; frozen route-param state and both setters; `body`, `queryParams`, `isHeadRequest`, `isFormURLEncodedRequest`, `getContentMediaType`, `getCookie`, `getCookies`, `getAuthorizationBearer`, `ifModifiedSince`, `ifNoneMatch`, `json()`, `text()`, `formData()`; `FORM_DATA_CONTENT_TYPES` and `getFirstHeaderListValue()` |
| Cloudflare adapter | `getRequestId()` (`cf-ray`), `resolveClientIp()` (`CF-Connecting-IP` → `True-Client-IP`, XFF deliberately ignored) |
| Node adapter | `buildHeaders()`, `resolveHost()`, `resolveProtocol()`, `hasRequestBody()`, the `Readable.toWeb()` body bridge, `getRequestId()` (`x-request-id`), `resolveClientIp()` with the `trustProxy` opt-in |

**Constructor-injection contract.** The base constructor takes a single options bag and performs every `Object.defineProperties` call; each subclass derives the platform values and passes them up:

```js
export default class BaseServerRequest {
    #bodyDelegate = null;
    #hostnameParams = Object.freeze({});
    #pathnameParams = Object.freeze({});

    constructor({ id, ip, method, url, headers, bodyDelegate }) {
        this.#bodyDelegate = bodyDelegate;
        Object.defineProperties(this, { /* id, ip, method, url, headers */ });
    }

    get body() { return this.#bodyDelegate.body; }
    async json() { /* delegates, wraps failures in BadRequestError */ }
}
```

`bodyDelegate` is any object exposing the Web `Request` body surface (`body`, `json()`, `text()`, `formData()`). Both platforms already have exactly such an object: on Workers it is the native `Request`; on Node it is the internal `Request` the adapter builds to bridge `Readable.toWeb()`. Constructor injection is used rather than an abstract getter so the delegate stays in a private field the subclass cannot reach or accidentally re-expose. Node builds its internal `Request` as a local `const` before calling `super()`, so there is no "`this` before `super`" problem.

**Cross-cutting constraint: this is a behavior-preserving refactor.** No observable behavior changes on either platform. Specifically preserved as-is:

- `getCookies()` mapping a bare `foo` (no `=`) to `''`, indistinguishable from `foo=`.
- Node's `hasRequestBody()` returning `false` when a non-GET/HEAD request has neither `Content-Length` nor `Transfer-Encoding`, so `body` is `null` rather than an empty stream.
- No new runtime assertions in the base constructor. Adding invariant checks (uppercase `method`, `url instanceof URL`) is tempting now that there is one place to put them, but it changes failure modes and is deliberately deferred — the payoff of this plan is that such a change later becomes a one-file edit.

The existing adapter test suites (563 + 693 lines) are the safety net for tasks 1 and 2 and must pass **unchanged** through both migrations. They are only restructured in task 3, once the implementation refactor is already proven green.

**Ordering rationale.** Cloudflare migrates first because it is the thinner adapter — the base class emerges from the simpler case. Node migrates second and stress-tests the result, since it carries the internal-`Request` body bridge and the `trustProxy` constructor option that the base contract must accommodate without special-casing.

---

### Task SR-1: Base class exists and the Cloudflare adapter extends it

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/http-router/server-request-interface.js`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`

**Objective**

`src/kixx/http-router/base-server-request.js` exists and holds every member of the request contract that is expressible in terms of Web `Headers`/`URL` primitives. The Cloudflare adapter is reduced to its platform-specific derivation (`id`, `ip`, and the native-`Request` body delegate) and extends the base. The Cloudflare adapter's existing test file passes without a single edit, which is what proves the base class is behaviorally identical to the code it replaces.

**Scope**

- In: the new base class module and its JSDoc; rewriting `src/plugins/cloudflare-server-request/lib/server-request.js` to extend it.
- Out: the Node adapter (SR-2); any test restructuring (SR-3); documentation updates to `src/plugins/README.md` and the interface module (SR-4).

**Design and invariants**

- The base class is framework-owned and lives beside the interface it implements. It must contain no platform vocabulary — no `cf-`, no `node:` imports, no reference to `IncomingMessage` or Workers.
- The base constructor performs all `Object.defineProperties` calls, so the interface's immutability invariants for `id`, `ip`, `method`, `url`, and `headers` are enforced in exactly one place. All five stay `enumerable: true` and non-writable, matching current behavior.
- `#bodyDelegate`, `#hostnameParams`, and `#pathnameParams` are private fields on the base. Subclasses must not be able to reach them.
- `setPathnameParams()` / `setHostnameParams()` keep `deepFreeze(structuredClone(params))` and keep returning `this` — the router chains these calls, so a non-`this` return breaks routing.
- Both param fields must still initialize to frozen empty objects, because a 404 error handler observes them before the router ever stamps params.
- `json()`, `text()`, and `formData()` keep passing the method reference as the third `BadRequestError` argument (`this.json`, `this.text`, `this.formData`) so error call-site capture is unchanged.
- Per-platform JSDoc currently attached to `id` and `ip` ("Cloudflare Ray ID when available…") is lost from the property definitions when they move to the base. Relocate that prose to the subclass's own class-level JSDoc or its private derivation helpers so the platform behavior stays documented.
- `FORM_DATA_CONTENT_TYPES` and `getFirstHeaderListValue()` move to the base module. They are implementation details, not part of the public export surface.

**Expected touch points**

- `src/kixx/http-router/base-server-request.js` — new; the shared implementation.
- `src/plugins/cloudflare-server-request/lib/server-request.js` — reduced to `getRequestId()`, `resolveClientIp()`, a constructor that calls `super()`, and the module-level `serverRequestSequence` counter.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `BaseServerRequest` implements: `body`, `hostnameParams`, `pathnameParams`, `queryParams`, `isHeadRequest()`, `isFormURLEncodedRequest()`, `getContentMediaType()`, `setPathnameParams()`, `setHostnameParams()`, `getCookie()`, `getCookies()`, `getAuthorizationBearer()`, `ifModifiedSince`, `ifNoneMatch`, `json()`, `text()`, `formData()`.
- [ ] The Cloudflare adapter declares no method that merely calls `super`, and retains no copy of any hoisted logic.
- [ ] `test/unit-tests/plugins/cloudflare-server-request/lib/server-request.test.js` passes with zero modifications.
- [ ] The base class carries JSDoc meeting `src/docs/code-documentation-guide.md`, including a class-level block explaining the `bodyDelegate` contract and what a subclass is required to supply.
- [ ] No new dependencies; imports resolve through relative paths only.

**Validation**

- `node run-tests.js test/unit-tests/plugins/cloudflare-server-request` — proves behavioral equivalence against the untouched suite.
- `node run-tests.js` — proves nothing else in the framework regressed.
- `node run-linter.js src/kixx/http-router/base-server-request.js src/plugins/cloudflare-server-request` — style and lint clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task SR-2: Node adapter extends the base class

**Status:** Not started
**Depends on:** SR-1
**Documentation:** `src/kixx/http-router/server-request-interface.js` (the `ip` trust-boundary invariant); `src/docs/code-style-guide.md`

**Objective**

The Node adapter is reduced to its platform-specific derivation — Web `Headers` construction from Node's header bag, URL reconstruction from the request line plus authority, client-IP resolution under the `trustProxy` opt-in, and the `Readable.toWeb()` body bridge — and extends `BaseServerRequest`. Its existing test file passes without edits. This task is where the base contract is proven general rather than Cloudflare-shaped.

**Scope**

- In: rewriting `src/plugins/node-server-request/lib/server-request.js`; any adjustment to `BaseServerRequest` that the Node case reveals as necessary.
- Out: test restructuring (SR-3); documentation updates (SR-4).

**Design and invariants**

- The `trustProxy` constructor option stays a Node-only concern. It must not leak into the base constructor's options bag — the base has no opinion about proxy trust, and the interface deliberately assigns that judgment to the adapter.
- The internal Web `Request` remains a **body-parsing delegate only**. `headers`, `url`, `method`, and `id` must continue to be derived independently, because the `Request` constructor strips forbidden request headers such as `Host` — reading them back off the delegate would silently break virtual-host routing. Preserve the existing comment explaining this; it is the single most load-bearing comment in the file.
- The internal `Request` is constructed as a local `const` before `super()` and passed as `bodyDelegate`.
- `ip` must continue to be resolved eagerly during construction, because the `IncomingMessage` and its socket are not retained once the delegate is built.
- `duplex: 'half'` stays on the request init whenever a stream body is attached.
- If the Node case forces a change to `BaseServerRequest`, re-run the Cloudflare suite before considering this task done — a base change silently regressing the other platform is the specific failure mode this ordering exists to catch.

**Expected touch points**

- `src/plugins/node-server-request/lib/server-request.js` — reduced to the constructor plus `buildHeaders()`, `resolveHost()`, `resolveProtocol()`, `resolveClientIp()`, `hasRequestBody()`, `getRequestId()`.
- `src/kixx/http-router/base-server-request.js` — only if the Node case requires it.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The Node adapter declares no method that merely calls `super`, and retains no copy of any hoisted logic.
- [ ] `test/unit-tests/plugins/node-server-request/lib/server-request.test.js` passes with zero modifications.
- [ ] `test/unit-tests/plugins/cloudflare-server-request/lib/server-request.test.js` still passes with zero modifications.
- [ ] The combined line count of both adapters plus the base class is meaningfully below the current 802, and neither adapter contains logic present in the other.
- [ ] The trust-boundary rationale for `resolveClientIp()` and the delegate-only rationale for the internal `Request` remain documented in the Node adapter.

**Validation**

- `node run-tests.js test/unit-tests/plugins` — both adapter suites green against untouched tests.
- `node run-tests.js` — full unit suite green.
- `node run-linter.js src/kixx/http-router/base-server-request.js src/plugins/node-server-request src/plugins/cloudflare-server-request` — lint clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task SR-3: Shared conformance suite replaces duplicated adapter tests

**Status:** Not started
**Depends on:** SR-2
**Documentation:** `test/unit-tests/README.md`

**Objective**

A single reusable conformance suite asserts the shared request contract and is executed against **both real adapters**, so a future divergence in shared behavior fails on both platforms rather than being caught on one. Each adapter test file keeps only its platform-specific cases. The duplication removed from the implementation in SR-1 and SR-2 is removed from the tests too, rather than being left to accumulate there.

**Scope**

- In: a new shared suite module; rewriting both adapter test files to run it plus their platform-specific cases; a `test/unit-tests/README.md` addendum covering shared suites.
- Out: implementation changes (those are done); documentation of the source layout (SR-4).

**Design and invariants**

- The suite runs against the **real adapters**, never against a fake subclass of `BaseServerRequest`. Testing the base directly would leave nothing proving the shipped adapters satisfy the contract, which is the property that actually matters.
- The suite module must **not** be named `*.test.js`. The runner walks directories and only executes `*.test.js`, so a helper named `server-request-conformance.js` is collected by neither suite and runs only when imported. Placing it at `test/unit-tests/kixx/http-router/server-request-conformance.js` mirrors the source tree per the README convention.
- Injection point: each adapter test file passes a factory conforming to a suite-defined options shape `{ method, path, headers, body }`. The two existing `makeServerRequest()` factories already accept nearly this shape but differ on URL: the Node factory takes a path plus a `host` header, while the Cloudflare factory takes an absolute URL. The adapter factories absorb that difference (Cloudflare prefixes a fixed origin; Node passes the path through and sets `host`) so the suite never constructs a URL itself.
- The suite integrates with `kixx-test` nesting by receiving the enclosing `describe` handle: `serverRequestConformance(describe, makeServerRequest)`, called from inside each adapter's top-level `describe` callback. Group names must stay distinct enough that a failure report identifies which platform failed.
- Suite coverage: `queryParams`, `isHeadRequest`, `isFormURLEncodedRequest`, `getContentMediaType`, param defaults and both setters (including the deep-freeze immutability assertions), `getCookies`/`getCookie`, `getAuthorizationBearer`, `ifModifiedSince`, `ifNoneMatch`, `json`, `text`, `formData`.
- Retained per-adapter: Cloudflare — `cf-ray` and fallback `id`, `CF-Connecting-IP`/`True-Client-IP`/XFF-ignored `ip`, core property derivation, `body`. Node — `x-request-id` and fallback `id`, `trustProxy` on and off, socket fallback, `:authority`/`Host` and `x-forwarded-proto`/`encrypted` URL reconstruction, HTTP/2 pseudo-header skipping, multi-valued header appending, body framing via `Content-Length`/`Transfer-Encoding`.
- `test/unit-tests/README.md:77` currently says "Prefer small file-local helpers over shared global fixtures." A cross-adapter conformance suite is a deliberate, narrow exception to that guidance and must be documented as such — when it applies (one contract, several implementations) and when it does not — so the exception does not get read as a general licence for shared fixtures.
- Net assertion coverage must not shrink. Any case dropped as redundant is named in the handoff notes with its justification.

**Expected touch points**

- `test/unit-tests/kixx/http-router/server-request-conformance.js` — new; the exported suite.
- `test/unit-tests/plugins/cloudflare-server-request/lib/server-request.test.js` — reduced to platform cases plus the suite call.
- `test/unit-tests/plugins/node-server-request/lib/server-request.test.js` — same.
- `test/unit-tests/README.md` — the shared-suite exception.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The conformance suite runs against both real adapters and covers every member listed above.
- [ ] Neither adapter test file still asserts shared behavior independently.
- [ ] A deliberately introduced bug in one hoisted base method (for example, `getFirstHeaderListValue`) fails the suite under both adapters. Revert the bug afterward.
- [ ] `test/unit-tests/README.md` documents the shared-suite exception and its boundaries.
- [ ] Running only `node run-tests.js test/unit-tests/kixx/http-router` does not attempt to execute the suite module standalone.

**Validation**

- `node run-tests.js` — full unit suite green.
- `node run-tests.js test/unit-tests/plugins/node-server-request` — a narrowed run still executes the shared suite via import.
- `node run-linter.js test/unit-tests/kixx/http-router test/unit-tests/plugins` — lint clean.
- Manual: the deliberate-bug check above, confirming both platforms fail.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task SR-4: Documentation reflects the new layer

**Status:** Not started
**Depends on:** SR-3
**Documentation:** `src/plugins/README.md`; `src/kixx/http-router/server-request-interface.js`

**Objective**

An agent adding a Deno or AWS Lambda adapter learns from the docs that `BaseServerRequest` exists, what a new adapter is actually required to write, and what it gets for free. Without this, the next platform adapter gets written by copying an existing one — recreating the exact duplication this plan removes.

**Scope**

- In: updating the "Adapters That Skip the Registry" section and the new-platform checklist in `src/plugins/README.md`; adding an implementation note to `server-request-interface.js`.
- Out: any code or test changes.

**Design and invariants**

- `src/plugins/README.md:42` explains that `ServerRequest` has no `plugin.js` because it is a per-request value. That reasoning is unchanged and must be preserved — extending a framework base class does not make it a registry service.
- The interface module stays the normative contract. The note added there should say that `BaseServerRequest` provides a conforming implementation of the application-conveniences subset and of the router-facing param setters, while `id`, `ip`, `url`, `headers`, and the body delegate remain the adapter's responsibility. It must not restate the invariants — one normative source only.
- The new-platform checklist at `src/plugins/README.md:157` and the summary at `:168` should direct a new adapter to extend the base rather than copy a sibling.
- Reference the `base-context.js` precedent so the pattern reads as an established project convention rather than a one-off.

**Expected touch points**

- `src/plugins/README.md` — the skip-the-registry section, the new-platform checklist, the summary list.
- `src/kixx/http-router/server-request-interface.js` — a short implementation note.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `src/plugins/README.md` names `BaseServerRequest`, its location, and the four things a new adapter must supply.
- [ ] The new-platform checklist instructs extending the base class.
- [ ] `server-request-interface.js` points to the base class without duplicating any invariant.
- [ ] Every file path and line reference cited in the updated prose is accurate as of this change.

**Validation**

- `node run-linter.js src/kixx/http-router/server-request-interface.js` — lint clean (JSDoc-only change).
- `node run-tests.js` — unchanged and green.
- Manual: read the updated new-platform checklist end to end and confirm it is sufficient to write a third adapter without opening either existing one.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
