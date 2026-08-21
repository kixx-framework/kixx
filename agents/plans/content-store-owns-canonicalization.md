Content Store Owns Canonicalization
===================================

Move deterministic JSON serialization out of the Hyperview layer and behind the
content-addressable store port, by changing the port's write contract from
*bytes* to *values*.

Implementation Approach
-----------------------

### The problem

`canonicalize()` is a wire-format primitive: any two callers that serialize the
same logical value must produce byte-identical output, because the bytes are
hashed. Today it has ends on both sides of the port boundary:

- `HyperviewContentService` calls `encodeUtf8(canonicalize(bundle))` in five
  upload methods and passes the resulting bytes to `store.putBlob()`.
- The store's `hashBlob()`, `hashSet()`, `hashTree()`, `hashEtag()` and
  `hashValue()` consume or reproduce those same bytes.

Because both ends must agree byte-for-byte, the definition cannot be duplicated
without creating a silent-failure hazard: a drift in key sort order, `undefined`
handling, or number formatting produces mismatched digests with no error
anywhere. It currently lives in `src/kixx/utils/canonicalize.js` and the plugin
imports it across the boundary — a framework dependency in code that is supposed
to be portable.

### The insight

The leak exists because the port's write contract is expressed in bytes. Once
`putBlob(context, pathname, blob, …)` takes a `Uint8Array`, the value-to-bytes
step is *forced* outside the port, and that step is the wire contract.

Adding `putObject()` moves the contract boundary from bytes to values.
`canonicalize()` then has exactly one caller and becomes a private implementation
detail of the store. The duplication question dissolves rather than being
answered.

Three facts in the existing code confirm this is the intended shape:

1. `hashValue()` already works this way. `hyperview-service.js:602` passes
   `response.props` — a live object, not bytes — and the adapter canonicalizes
   internally. The read/hash side of the port already takes values. The write
   side is the inconsistent one.
2. The read path never needed `canonicalize()`. `HyperviewContentObject.json()`
   is plain `JSON.parse`, which is order-insensitive. This is a write-side-only
   leak, so closing it closes it completely.
3. The Publishing API already hands Hyperview a parsed value, not bytes.
   `publishing-api/mod.js:145` does `await request.json()` and the catalog passes
   `payload` straight through. The value-to-bytes step already happens entirely
   inside our own process, at a layer with no reason to own it.

### Relationship to the earlier plan

This supersedes one decision in `agents/plans/hyperview-content-service.md`
(lines 124-131), which moved `canonicalize()` into `src/kixx/utils/` on the
rationale that "Hyperview produces the bytes it uploads." That was correct given
a bytes-level port. This plan removes that premise: after Task 3, Hyperview
produces no bytes. Every other decision in that plan stands, including the
deliberate duplication of `isValidPathname()`/`normalizePathname()`, which is a
genuinely different case — two parallel invariants that may diverge, not one
contract with two ends.

### Where the definition lands

`src/kixx/content-store/`, beside `content-addressable-store-interface.js` — not
inside the Cloudflare adapter package.

The port defines the wire format; adapters implement it. Burying the definition
in one adapter means a second adapter (Node, Deno, Lambda) must either copy it or
cross-import from a sibling plugin, which rebuilds the same hazard one layer
down. Placing it in the port directory keeps a single normative definition that
every adapter imports, while still achieving the goal that matters: Hyperview
stops touching it.

### What this does not solve

`publishing-api/mod.js:147` reads `x-checksum` from a client request header. That
etag must equal `hashEtag(hashBlob(canonicalize(value)), null)`, so a remote
publishing client has to reproduce `canonicalize()` byte-for-byte. That end of
the contract lives outside this repository and no internal restructuring removes
it.

This argues *for* the relocation rather than against it. A published wire format
with third-party implementors deserves exactly one normative definition, sitting
next to the other things a client must match — `FORMAT`, the domain bytes, the
base32 alphabet. Task 4 documents it as such.

### Cross-cutting invariant

**Digest compatibility is mandatory.** For every value `v` and pathname `p`:

```
putObject(ctx, p, v, m, e)  ===  putBlob(ctx, p, encodeUtf8(canonicalize(v)), m, e)
```

Identical `hash`, identical `etag`, identical KV storage key. This is a pure
refactor of *where* serialization happens, never of *what bytes result*.
Already-committed closures stay valid, no republish or reindex is required, and
existing client checksums keep matching. Any task that changes a digest has
failed.

---

### Task 1: Port accepts values and text, not only bytes

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` (port and adapter contract); `src/kixx/content-store/content-addressable-store-interface.js`

**Objective**

`ContentAddressableStoreInterface` exposes three write verbs at three levels —
bytes, text, and value — so a caller with a JSON-compatible value or a string can
write it without knowing how the store turns it into bytes. The Cloudflare
adapter implements all three with identical addressing behavior.

**Scope**

- In: the two new interface methods and their adapter implementations; interface
  documentation for the new contract surface; adapter unit tests.
- Out: changing any `HyperviewContentService` call site (Task 3); relocating
  `canonicalize()` (Task 2).

**Design and invariants**

- `putObject(context, pathname, value, metadata, etag)` canonicalizes `value`,
  encodes UTF-8, and then behaves exactly as `putBlob()` does with those bytes.
- `putUtf8(context, pathname, text, metadata, etag)` encodes `text` as UTF-8 and
  then behaves exactly as `putBlob()`.
- Both return the existing `PutBlobResult` shape, unchanged. Do not rename that
  typedef in this task; the churn is not worth it.
- Both perform the same `etag` integrity check as `putBlob()`, against the etag
  recomputed from the produced bytes and metadata, rejecting with
  `ValidationError` and code `INTEGRITY_CHECK_FAILED`.
- Implement both by delegating to the existing `putBlob()` internals so there is
  one hashing and KV-write path, not three.
- `putObject()` propagates the `TypeError` from `canonicalize()` for a
  non-finite number or unsupported type. That is a programmer error, not client
  input; the Publishing API layer is responsible for rejecting bad payloads.
- **Decision:** `putBlob()` stays in the interface even though Task 3 leaves it
  with no callers outside the adapter (static assets go through
  `static-file-server-store-interface.js`, not this port). It is the primitive
  the other two are defined in terms of, and the honest escape hatch for
  genuinely binary content. The alternative — demoting it to adapter-private —
  is viable if a reviewer prefers a smaller port surface; record the choice here
  if it changes.

**Expected touch points**

- `src/kixx/content-store/content-addressable-store-interface.js` — add
  `putObject` and `putUtf8` `@property` entries; extend the "Caller-visible
  errors" section to cover their integrity check and `putObject`'s `TypeError`
- `src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js`
  — implement both, delegating to the existing `putBlob()` path
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.test.js`
  — coverage for both methods

**Acceptance criteria**

- [ ] `putObject()` and `putUtf8()` exist on the interface and the adapter.
- [ ] A test asserts `putObject(ctx, p, v, m)` returns the same `hash` and
      `etag` as `putBlob(ctx, p, encodeUtf8(canonicalize(v)), m)`.
- [ ] A test asserts `putUtf8(ctx, p, s, m)` matches
      `putBlob(ctx, p, encodeUtf8(s), m)`.
- [ ] A test asserts key-order independence: `putObject` of `{a:1,b:2}` and
      `{b:2,a:1}` yield the same hash.
- [ ] A test asserts a mismatched `etag` rejects with `ValidationError` on both
      new methods.
- [ ] No existing digest, storage key, or `putBlob()` behavior changes.

**Validation**

- `node run-tests.js test/unit-tests/plugins` — adapter behavior and digest
  equivalence
- `node run-linter.js src/kixx/content-store src/plugins` — style and lint

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 2: Relocate canonicalization into the port

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` (where interface contracts live)

**Objective**

`canonicalize()` and `compareStrings()` have exactly one definition, in
`src/kixx/content-store/`, owned by the port that defines the wire format they
serve. `src/kixx/utils/canonicalize.js` no longer exists.

**Scope**

- In: moving the module and its unit test; updating every importer; keeping the
  `addressing.js` re-export.
- Out: removing the Hyperview import (Task 3 does that, after which the
  framework has zero remaining users).

**Design and invariants**

- The function bodies do not change. This is a relocation, not a rewrite — the
  bytes produced must be identical before and after.
- New home: `src/kixx/content-store/canonicalize.js`.
- `addressing.js` updates its import path and **keeps** its existing public
  re-export of both symbols, so intra-package callers
  (`content-snapshot.js:2`, `content-addressable-index.js:11`) are unaffected.
- After Task 3 the only importers are `addressing.js` and the tests. Until then
  `hyperview-content-service.js:17` imports from the new path.
- Do not leave a re-export shim at the old path. A second import path for a
  single-definition wire primitive is exactly the ambiguity this plan removes.

**Expected touch points**

- `src/kixx/content-store/canonicalize.js` — new home, content unchanged
- `src/kixx/utils/canonicalize.js` — deleted
- `src/plugins/cloudflare-content-addressable-store/lib/addressing.js:25` —
  import path updated
- `src/kixx/hyperview/hyperview-content-service.js:17` — import path updated
  (removed entirely in Task 3)
- `test/unit-tests/kixx/content-store/canonicalize.test.js` — relocated from
  `test/unit-tests/kixx/utils/canonicalize.test.js`, assertions unchanged
- `test/unit-tests/kixx/hyperview/hyperview-content-service.test.js:85` — import
  path updated

**Acceptance criteria**

- [ ] `src/kixx/utils/canonicalize.js` does not exist.
- [ ] `grep -rn "utils/canonicalize" src test` returns nothing.
- [ ] `canonicalize` and `compareStrings` have exactly one definition in the
      repository.
- [ ] The relocated test suite passes unchanged.
- [ ] `addressing.js` still re-exports both symbols.

**Validation**

- `node run-tests.js` — full unit suite, proving no importer was missed
- `node run-linter.js` — no unresolved imports

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 3: Hyperview stops producing bytes

**Status:** Not started
**Depends on:** Task 1, Task 2
**Documentation:** `src/kixx/hyperview/README.md`; `src/app/presentation/README.md`

**Objective**

`HyperviewContentService` writes content by handing values and text to the port.
It contains no serialization logic, no `canonicalize` import, and no
`TextEncoder`. The framework layer owns *what* is stored and *where*; the store
owns *how* it becomes bytes.

**Scope**

- In: the six upload methods; removing the module's `encodeUtf8` helper and
  `canonicalize` import; updating the service's unit tests and its port double;
  deleting the now-obsolete rationale comment in `addressing.js`.
- Out: the Publishing API request handlers and the resource catalog, which pass
  values through already and need no change.

**Design and invariants**

- Five methods switch to `putObject()`: `putTemplatePartials`,
  `putBaseTemplates`, `putPageMetadata`, `putPagePartials`, `putPageIncludes`.
  Each becomes a path computation plus one port call.
- `putPageTemplate` switches to `putUtf8()`. This one is about interface
  symmetry rather than safety — `TextEncoder` is a deterministic platform
  builtin, not a drift risk — but leaving a single bytes-level call in the
  service reintroduces the "why is this one different" question.
- The `StoredContentDescriptor` return shape and every method signature stay
  exactly as they are. This change is invisible to the Publishing API and to the
  transaction scripts above it.
- The existing `@throws {TypeError} When bundle cannot be canonicalized` JSDoc
  tags remain accurate — the throw now originates inside the port, but callers
  see the same behavior.
- Delete `const encoder = new TextEncoder();` and the `encodeUtf8()` helper from
  `hyperview-content-service.js:33-37` once unused.
- The `canonicalize`/`compareStrings` rationale comment that stood at
  `addressing.js:26-38` **has already been removed**, ahead of this plan, along
  with the paragraph in the pathname comment that cross-referenced it. Nothing
  to do here; the re-export now carries a one-line note. The
  pathname-duplication comment itself **stays** — it documents a live and
  deliberate decision this plan does not change.
- The service's test double at
  `hyperview-content-service.test.js:78` must grow `putObject` and `putUtf8`.
  Implement them in the double as canonicalize/encode plus the existing fake
  `putBlob`, so the double keeps modeling the port's real equivalence.

**Expected touch points**

- `src/kixx/hyperview/hyperview-content-service.js` — six methods, one import,
  the `encodeUtf8` helper
- `src/plugins/cloudflare-content-addressable-store/lib/addressing.js` — no
  change expected in this task; the comment work was done ahead of the plan
- `test/unit-tests/kixx/hyperview/hyperview-content-service.test.js` — extend
  the port double; update assertions that inspect `putBlobCalls`

**Acceptance criteria**

- [ ] `hyperview-content-service.js` imports neither `canonicalize` nor
      `TextEncoder`.
- [ ] All six upload methods call `putObject()` or `putUtf8()`; none calls
      `putBlob()`.
- [ ] Existing tests asserting stored content — for example
      `assertEqual(canonicalize(bundle), content.text())` at
      `hyperview-content-service.test.js:282` — still pass, proving the stored
      bytes are unchanged.
- [ ] The Publishing API handler tests pass with no modification, proving the
      change is invisible above the service.
- [ ] `grep -rn "canonicalize" src/kixx/hyperview` returns only prose in JSDoc.

**Validation**

- `node run-tests.js` — full unit suite
- `node run-linter.js` — style and lint
- Manual check: confirm no digest changed, by diffing a `putPageMetadata` result
  hash for a fixed input against the value produced before the change.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 4: Document the checksum wire contract

**Status:** Not started
**Depends on:** Task 2
**Documentation:** `src/kixx/hyperview/README.md` (publication flow)

**Objective**

The `x-checksum` request header has one normative specification, at the site that
owns the format, so a third-party publishing client can compute a matching etag
without reading implementation source.

**Scope**

- In: documenting the etag derivation and the canonical serialization rules a
  client must reproduce.
- Out: any change to how the checksum is computed or verified; any client
  implementation.

**Design and invariants**

- The specification belongs with the format it serves: alongside `FORMAT`, the
  domain bytes, and the base32 alphabet in the store's addressing module and the
  port interface — not in the Publishing API handler, which merely reads a
  header, and not in a generic utilities directory.
- Record the full derivation for a JSON resource:
  `etag = hashEtag(hashBlob(encodeUtf8(canonicalize(value))), null)`, and for a
  page template the same with the raw UTF-8 source in place of the canonical
  bytes.
- Record the canonicalization rules a client must match exactly: object keys
  sorted by UTF-16 code unit, `undefined`-valued object properties omitted, no
  insignificant whitespace, numbers formatted as `JSON.stringify` does, and
  non-finite numbers rejected.
- Note the version coupling: this derivation is tied to `FORMAT`, so a format
  bump is a breaking change for existing clients.
- This is the one part of the contract that a refactor cannot make internal.
  Say so explicitly, so a future agent does not "simplify" `canonicalize()` on
  the assumption that the store is its only consumer.

**Expected touch points**

- `src/kixx/content-store/canonicalize.js` — module JSDoc stating this is a
  published wire format with implementors outside the repository
- `src/kixx/content-store/content-addressable-store-interface.js` — the etag
  derivation, in or beside the "Digest opacity" section
- `src/kixx/hyperview/README.md` — reference the derivation from the
  upload/commit publication flow

**Acceptance criteria**

- [ ] A reader can compute a valid `x-checksum` from the documentation alone,
      without reading `addressing.js` source.
- [ ] The documentation states that `canonicalize()` has consumers outside this
      repository.
- [ ] The `FORMAT` version coupling is stated.
- [ ] No behavior changes.

**Validation**

- `node run-linter.js` — style and lint
- Review check: follow the documented steps by hand for one small object and
  confirm the result matches what `hashEtag(hashBlob(...))` returns for it.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
