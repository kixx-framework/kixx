# Publishing API v1 Refactor

**Status:** Proposed
**Scope:** Replace the unreleased Publishing API v1 in place. No v2 namespace and
no compatibility layer.

## Implementation Approach

### The objective this design serves

The Publishing API exists to do two things: publish a new version of a website
(static assets, templates, page metadata, email content), and roll back to a
prior version.

A third objective is not stated in the current documentation but is load-bearing
in the current design, and every decision below preserves it: **a release of
server-side code and a release of website content ship as one atomic unit.**

The mechanism is the `BUILD_ID` environment variable. `BUILD_ID` identifies one
build of the server source (Node.js or Cloudflare Worker). The content pointer
is keyed by it. A publishing client therefore:

1. chooses the `BUILD_ID` that CI will deploy next, before deploying it;
2. uploads content and points that not-yet-running build at it;
3. deploys the code with `BUILD_ID` set to that value.

The deploy is the activation. No separate atomic switch is needed, because a
Worker deploy and a process restart are already atomic, and reverting `BUILD_ID`
reverts the code and the content it was authored against as a single coordinate.

This is why the current `PUT /index/closure` accepts a client-supplied build id
while `PUT /build` refuses to touch anything but the running build. That
asymmetry is deliberate: one publishes forward to a future build, the other
repairs the current one. **Any redesign that makes the build id server-derived
and read-only deletes the pre-staging workflow and, with it, the atomic
code-plus-content release.** Do not do that.

### What is actually wrong

The model is sound. The API lacks the operations that make it safe and cheap to
use.

1. **A pre-staged release is unverifiable.** `GET /build` reports only the
   running build, so a client cannot read back what it just staged for the next
   build. The entire value of pre-staging is de-risking the deploy, and the
   staged state is write-only.

2. **Nothing is validated at publish time.** `commitChanges()` accepts
   client-supplied `{hash, size}` references and builds an index without
   checking that a single blob exists or that any size is truthful. A bad
   pre-stage is undetectable until the deploy goes live, and then surfaces as an
   `AssertionError` at render time (`references unreadable blob`) — a total
   outage produced by client input, which `src/docs/server-error-handling.md`
   forbids.

3. **A code-only deploy requires a full manifest republish.** There is no
   operation for "point build B2 at the closure B1 is already serving". Blobs
   deduplicate, but the client must reassemble and resend the whole content
   tree. Forgetting the step is a total outage rather than a stale site.

4. **Build ids are unregistered and unenumerable.** A typo in the pre-stage
   silently creates a phantom build. Nothing surfaces it until the real deploy
   comes up empty.

5. **Rollback needs client bookkeeping.** Prior closures are retained forever
   and are undiscoverable. There is no release history and no activation
   history.

6. **The content taxonomy is declared three times** — a stat route, an upload
   route, and a `ContentTree` facet per content kind. Sixteen endpoints where
   two suffice, because a blob's kind is a property of the manifest slot
   referencing it, not of the blob. `ContentStoreInterface` already states that
   pathnames take no part in addressing.

7. **Comparing local to live is O(files) requests.** No bulk "which of these
   hashes do you have", no whole-manifest read.

8. **Uploads open a snapshot they never use.** `putHandlerWithPathname()` calls
   `openSnapshot()` only to reach `put*` methods that write blobs and never
   touch the index. At genuine first boot no pointer exists, the assertion
   fires, and the first-ever publish is impossible.

### The shape of the fix

Keep the build-keyed pointer. Add a **Release** as a first-class, immutable,
fully validated object that is **not attached to any build**, and make build
pointers readable, listable, and assignable for any build id.

| Concept | Identity | Mutable | Meaning |
| --- | --- | --- | --- |
| Object | content hash | no | Immutable bytes. No pathname, no kind, no build. |
| Release | closure root hash | no | One complete, validated website version. |
| Build pointer | operator-chosen `buildId` | yes | Which Release a given server build serves. |

Rollback, forward publish, code-only carry-forward, and pre-staging all become
the same operation — assigning a Release to a build id — differing only in which
build id and which Release.

### Why Releases carry no build association

Decided in review, and the reasoning must survive:

- A code-only deploy is two build ids pointing at **the same content**. If a
  Release declared its build, carrying content forward would force a second
  Release record for byte-identical content.
- `releaseId` is the closure root hash. Content-derived identity and a declared
  build id contradict each other: identical content authored for two builds
  would need either two ids for one hash, or one record with two conflicting
  build fields.
- Bootstrapping a new site has no build to attach to.

The "authored for build X" signal is preserved as non-binding provenance on the
Release record. The binding compatibility check moves to build startup (Task 8),
which is the only place it can work anyway, because the target build is not
running when the Release is created.

### Why not named channels

Considered and rejected. A channel-keyed pointer (`production`) would survive
code deploys, but that is precisely the property we do not want: it permits
build B1's code to serve content C2 authored against B2's templates. The
build-keyed pointer makes `(code, content)` one revertible coordinate. Channels
remain available later as an orthogonal extension — a channel would select which
*build* a hostname routes to — and nothing here forecloses them.

### Cross-cutting decisions

**JSON:API stays.** The Admin API uses it, `src/app/presentation/lib/json-api.js`
exists, and the error-document shape is already documented. Dropping the
envelope is churn orthogonal to these objectives. `PUT /objects/:hash` is the
one exception and takes raw bytes, as static-asset uploads already do.

**One blob addressing domain.** `hashStringBlob` and `hashArrayBufferBlob` use
different domain bytes today, so an object address does not determine how to
hash the payload, and every manifest reference would have to carry a
`representation` field. Collapsing the two domains (Task 1) makes an address
derivable from bytes alone. This is a `FORMAT` bump, which is free before
release and expensive after.

**Preconditions are mandatory on every pointer write.** `If-Match` for
"must equal", `If-None-Match: *` for "must be unassigned". Neither is `428`.
There is no unconditional assignment, which also closes the race where two
publishers stage the same future build.

**Validation is expected-error territory.** Every manifest failure returns a 4xx
with a JSON:API error document. No client-controlled value may reach an
assertion. See `src/docs/server-error-handling.md`.

**Release creation is naturally idempotent.** `releaseId` is the root hash, so
re-creating identical content returns the existing Release. No idempotency keys
anywhere in this API.

**Consistency note for Cloudflare.** Blobs live in KV (eventually consistent);
build pointers and the object registry live in a Durable Object (strongly
consistent). Release validation can therefore succeed while a freshly uploaded
blob is not yet readable in every colo. Pre-staging absorbs this: content is
published before the deploy that serves it. This is another reason the
pre-stage model is worth preserving, and it must be documented rather than
engineered away.

### Task order

T1 → T2 → T4 → T5 → {T6, T8} → T7 → {T9, T10}. T3 is independent of T1 and can
run in parallel with T1/T2.

---

### Task T1: Objects are addressed by their bytes alone

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/content-addressable-store/addressing.js` module comment

**Objective**

A content address is derivable from a payload's bytes with no out-of-band
representation flag. `PUT /objects/:hash` can then verify an upload without a
header, and a manifest reference is a single string instead of an
`{objectId, representation}` pair.

**Scope**

- In: merging `DOMAIN_ARRAY_BUFFER_BLOB` and `DOMAIN_STRING_BLOB` into one blob
  domain; the resulting `FORMAT` bump to 3; every call site of the two hash
  functions; the Node adapter's `format-N` directory and fresh SQLite schema.
- Out: `hashTree`, `hashSet`, and `hashString` domains, which are unchanged.
  Manifest schema changes (T4). Object endpoints (T7).

**Design and invariants**

- A string and its UTF-8 encoding MUST produce the same address. The store may
  return either representation for one object, so two addresses for one byte
  sequence is a defect, not a feature.
- The text/binary domain split bought no safety the pathname namespaces in
  `content-layout.js` do not already provide.
- `FORMAT = 3` re-isolates blob keys, the Cloudflare Durable Object instance
  name, the index cache URL, and every root hash. Nothing is deployed, so this
  records the change rather than migrating anything. Add the entry to the
  `FORMAT` history list in `addressing.js`.
- The Node adapter's `format-3/index.sqlite` is created fresh. T3 may therefore
  extend the schema without writing a migration.
- `isValidHash()` and `DIGEST_PATTERN` are unchanged: 26 base32 characters.

**Expected touch points**

- `src/kixx/content-addressable-store/addressing.js` — merge the domains, bump `FORMAT`, extend the history comment
- `src/kixx/content-addressable-store/content-snapshot.js` — `#putFile()` no longer selects a hash function by type
- `test/unit-tests/kixx/content-addressable-store/*` — expected digests

**Acceptance criteria**

- [ ] One exported blob hash function accepts a string or an `ArrayBuffer`.
- [ ] `hashBlob('abc')` equals `hashBlob(new TextEncoder().encode('abc').buffer)`.
- [ ] `FORMAT` is 3 and its history comment records why.
- [ ] No caller selects a hash function by declared representation.
- [ ] Unit tests assert the string/bytes equivalence and pin at least one digest
      as a regression guard against silent format drift.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store` — hashing and index behavior
- `node run-linter.js src/kixx/content-addressable-store` — style

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T2: The content store can report which objects it holds

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`

**Objective**

A caller can ask the store, in one call, which of up to 100 content addresses
exist and how large each stored payload is. This is the primitive behind both
`POST /objects/status` and the manifest verification that closes the
publish-time validation hole.

**Scope**

- In: a new `statFiles()` port method; its Node, Cloudflare, and developer
  adapter implementations; the Cloudflare object registry required to answer it
  without fetching payload bytes; the port documentation.
- Out: manifest validation itself (T4, T5). HTTP surface (T7).

**Design and invariants**

- `statFiles(context, hashes)` resolves an array positionally aligned with
  `hashes`, holding `{ size }` for a stored object and `null` for an absent one.
  Adapters MUST NOT compact, sort, or deduplicate the result — the alignment is
  how callers re-associate.
- The 100-key cap matches `getFiles()`. Over-cap is a programmer error and
  asserts; adapters MUST NOT fan out. The caller decides how many objects one
  read is worth.
- Node: blobs are sharded files under `format-3/blobs`; answer from `fs.stat`.
- Cloudflare: KV has no cheap existence-or-size probe, and reading values to
  test presence would fetch whole static assets. The adapter therefore keeps an
  object registry in the Durable Object, written after a successful `putFile()`
  KV write.
  - The registry MUST live in the Durable Object, not KV. It must be strongly
    consistent: a false "missing" is safe (the client re-uploads, idempotently),
    a false "present" is not (it would let an unreadable Release validate).
  - Writing KV first and the registry second is the safe order. A failure
    between them leaves an unregistered blob, which is inert and self-heals on
    the next upload.
  - Cost is one Durable Object write per uploaded object, alongside a transfer
    that already dominates. Record this tradeoff in the adapter comment.
- Developer mode rejects writes already; `statFiles()` follows `putFile()` and
  asserts rather than pretending to answer.

**Expected touch points**

- `src/kixx/content-addressable-store/content-store-interface.js` — contract, typedef, cap, alignment and consistency rules
- `src/plugins/node-content-store/lib/content-store.js` — `fs.stat`-backed implementation
- `src/plugins/cloudflare-content-store/lib/content-store.js` — registry write in `putFile()`, `statFiles()` via the Durable Object
- `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js` — registry storage and lookup
- `src/plugins/node-content-store/lib/developer-content-store.js` — assert
- `test/unit-tests/plugins/**` — adapter tests

**Acceptance criteria**

- [ ] `statFiles()` returns a positionally aligned array with `null` for absent objects.
- [ ] A list longer than 100 asserts rather than splitting.
- [ ] The Cloudflare adapter answers without reading payload bytes.
- [ ] A registry write failing after a successful KV write leaves the object
      reported missing, and a repeat upload repairs it.
- [ ] Both adapters report the same sizes `putFile()` returned.
- [ ] Port documentation covers the cap, the alignment rule, and why the
      registry must be strongly consistent.

**Validation**

- `node run-tests.js test/unit-tests/plugins` — both adapters
- `node run-linter.js src/kixx/content-addressable-store src/plugins` — style

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: Build pointers are readable, listable, and assignable for any build

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`

**Objective**

An operator can read what any build id is pointed at, enumerate every registered
build, and assign a Release to a build that is not running — including a build
that has never been assigned. This makes pre-staging verifiable, makes phantom
build ids visible, and makes a code-only deploy a pointer write instead of a
manifest republish.

**Scope**

- In: `getBuildPointer()`, `listBuilds()`, and a three-mode precondition on
  `assignBuild()`; both adapters; the Node SQLite schema addition.
- Out: HTTP surface and precondition header mapping (T7). Release records (T6).

**Design and invariants**

- `getBuildPointer(context, buildId)` resolves `{ rootHash, assignedAt }` or
  `null`. It MUST NOT load the index table: `getBuild()` returns every entry,
  which is far too heavy for a pointer read and for listing.
- `listBuilds(context)` resolves every registered build's pointer, newest
  assignment first. Build ids are operator-chosen and unbounded in principle;
  the adapter returns all of them, and T7 owns any paging.
- `assignBuild()` gains a third precondition mode. The assignment object accepts:
  - `expectedRootHash` absent — unconditional (retained for internal callers only);
  - `expectedRootHash` a string — assign only if the current pointer equals it;
  - `expectedRootHash: null` — assign only if the build has **no** current pointer.
  The comparison and the write MUST be one atomic storage operation. A mismatch
  reports `CONFLICT` and leaves the pointer and every cache untouched.
- `MISSING_CLOSURE` still means the named closure was never saved. Because
  `releaseId` is the root hash, this doubles as the "no such Release" check, so
  assignment needs no Release-record lookup to be correct.
- Node: `format-3` is created fresh by T1, so add `assigned_at` to the `builds`
  table directly and raise `SCHEMA_VERSION`. No migration.
- Cloudflare: the Durable Object already owns pointers; add listing and the
  unassigned-precondition branch there. Cache invalidation continues to happen
  only after a durable assignment.

**Expected touch points**

- `src/kixx/content-addressable-store/content-store-interface.js` — three precondition modes, new methods
- `src/plugins/node-content-store/lib/content-store.js` — schema, listing, conditional assignment
- `src/plugins/cloudflare-content-store/lib/content-store.js` — listing, conditional assignment
- `src/plugins/cloudflare-content-store/lib/content-addressable-index-store.js` — Durable Object side
- `test/unit-tests/plugins/**` — adapter tests

**Acceptance criteria**

- [ ] `getBuildPointer()` returns a pointer without loading index entries.
- [ ] `listBuilds()` reports every registered build, newest assignment first.
- [ ] `expectedRootHash: null` assigns only when the build is unassigned and
      reports `CONFLICT` otherwise.
- [ ] A stale `expectedRootHash` string reports `CONFLICT` and mutates nothing.
- [ ] Assigning a root hash with no saved closure reports `MISSING_CLOSURE`.
- [ ] Both adapters behave identically across all three modes.

**Validation**

- `node run-tests.js test/unit-tests/plugins test/unit-tests/kixx/content-addressable-store`
- `node run-linter.js src/kixx/content-addressable-store src/plugins`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: A release manifest has one schema, validated in one place

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/docs/server-error-handling.md`; `src/kixx/content-addressable-store/content-layout.js`

**Objective**

One pure module owns the release manifest's shape and reports every problem in a
submitted manifest at once, as expected validation errors. It replaces the
per-content-kind validation scattered across eight upload handlers and the
separate pathname checks inside `flattenContentTree()`.

**Scope**

- In: manifest schema; canonical pathname rules; per-content-kind payload
  schemas; collision detection; conversion to the flat `IndexSourceFile` list.
- Out: I/O of any kind — object existence, size verification, and template
  compilation belong to T5. HTTP shapes (T7).

**Design and invariants**

- The module is pure and synchronous where possible, and takes no store. It is
  the most heavily tested piece of this plan and must be testable without a
  store.
- Every failure is a `ValidationError` accumulating **all** problems with a
  JSON-pointer-style `source`. Nothing here asserts on client input.
- Pathnames are **rejected, not normalized**. The current API silently lowercases
  route paths, which lets two client pathnames publish to one location. The error
  MAY carry the canonical suggestion in `meta`.
- The manifest keeps the existing structured facets — `staticAssets`,
  `globalTemplatePartials`, `baseTemplates`, `pages`, `emails`. A flat
  pathname map would scale better but pushes the layout rules in
  `content-layout.js` onto every client. Structured wins for this project's
  audience; revisit only if manifests routinely exceed the T7 cap.
- A manifest is a **complete replacement**. An omitted facet is absent from the
  Release; it never inherits from whatever is currently live.
- Replace the `page.template.pathname` special case with a
  `templates: { "<filename>": "<objectId>" }` map per page. The filename cannot
  be derived from the page pathname, which is why the special case exists; a map
  states it plainly and allows more than one template per page. Filenames are
  still checked against `RESERVED_PAGE_FILENAMES`.
- A content reference is `{ objectId, size }` plus, for static assets only, an
  optional `mediaType`. There is no `representation` field — T1 removed the need.
- `mediaType` is **optional**. `static-asset-request-handler.js` derives a
  content type from the pathname extension today; when `mediaType` is present it
  is stored in the index entry's `metadata` and preferred over the derived type.
  Requiring it would force every client to implement media-type detection for no
  current benefit.
- Zero-byte objects are valid. The current API's empty-static-asset rejection is
  dropped: an empty stylesheet is legitimate content.
- Per-kind payload schemas move here verbatim from the upload handlers in
  `src/app/presentation/request-handlers/publishing-api/mod.js`: partial and
  base template bundles are arrays of `{id, source}` with unique non-empty ids;
  page includes and email includes are string-valued objects; page metadata is
  any JSON object; an email bundle carries at least one of `htmlTemplate`,
  `textTemplate`, `partials`, `includes`.
- Unknown fields in a structured bundle are rejected, so a misspelling fails at
  publish time instead of silently producing incomplete content.
- File/directory and reserved-path collisions are detected and reported, not
  asserted.

**Expected touch points**

- `src/kixx/content-addressable-store/release-manifest.js` — new module
- `src/kixx/content-addressable-store/content-addressable-index.js` — `flattenContentTree()` and its pathname validation move out
- `src/kixx/content-addressable-store/content-layout.js` — reuse; extend only if the templates map needs it
- `test/unit-tests/kixx/content-addressable-store/release-manifest.test.js` — new

**Acceptance criteria**

- [ ] A valid manifest converts to the flat `IndexSourceFile` list `buildIndex()` consumes.
- [ ] A non-canonical pathname is rejected with a `source` and is never normalized.
- [ ] Every malformed facet, bundle entry, and reference is reported in one
      `ValidationError` rather than failing on the first.
- [ ] `pages.<path>.templates` accepts a filename-to-object map and rejects
      reserved filenames.
- [ ] Unknown fields in any structured bundle are rejected.
- [ ] Zero-byte references validate.
- [ ] No input path reaches an assertion. Malformed containers, wrong types, and
      hostile keys all produce `ValidationError`.

**Validation**

- `node run-tests.js test/unit-tests/kixx/content-addressable-store` — schema coverage
- `node run-linter.js src/kixx/content-addressable-store`
- Every per-kind rule deleted from `mod.js` has an equivalent test here.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Releases are created, fully verified, and assigned as separate operations

**Status:** Not started
**Depends on:** T2, T3, T4
**Documentation:** `src/app/transaction-scripts/README.md` (framework-service boundary)

**Objective**

`ContentAddressableStore` gains a Release lifecycle: create-and-verify, verify
only, and assign to a build id. A Release that cannot be served completely
cannot be created, which closes the hole where client input became a render-time
assertion. Creation touches no build pointer.

**Scope**

- In: `createRelease()`, `validateRelease()`, `assignRelease()`,
  `getBuildPointer()`, `listBuilds()`, `getReleaseManifest()`; the content
  contract version and its reserved index entry; removal of `commitChanges()`
  and `assignCurrentBuild()`.
- Out: Release provenance and activation history records (T6). HTTP (T7).
  Startup behavior (T8).

**Design and invariants**

- `createRelease(context, manifest, options)` performs, in order, and aborts
  with a `ValidationError` before persisting anything:
  1. manifest schema validation (T4);
  2. object existence and size verification via `statFiles()`, batched at the
     100-object cap — a manifest reference whose stored size differs from the
     claimed size is a validation failure, not a silent overwrite;
  3. structured payload parsing for every referenced JSON bundle;
  4. template compilation with the same compiler and options used at runtime;
  5. resolution of every base template and partial each page and email refers to.
  Rendering with application data is out of scope: runtime response props do not
  exist at publish time.
- Missing objects are reported **in bulk**, up to a documented cap, so a client
  repairs a Release in one pass instead of one round trip per missing object.
- `validateRelease()` runs the identical pipeline and persists nothing, so CI can
  gate a build without creating unreferenced closures.
- `releaseId` **is** the closure root hash. Creation is therefore content
  idempotent: re-creating identical content returns the existing Release. This is
  why the API needs no idempotency keys.
- `assignRelease(context, buildId, { releaseId, precondition })` maps onto
  `assignBuild()`'s three modes and works for **any** build id, running or not.
  It never publishes content: `MISSING_CLOSURE` surfaces as a `NotFoundError`,
  `CONFLICT` as a `ConflictError`.
- Assigning the Release a build already points at is a **success no-op**, not a
  conflict. A conflict there would break retry-after-lost-response and any
  unconditional restore script.
- The content contract version is a framework constant, written into each
  closure as a reserved index entry so it travels with the content and needs no
  side lookup. Bump it only when template or metadata semantics change in a way
  that makes an older Release unsafe for newer code. T8 consumes it.
- `openSnapshot()` keeps resolving `context.runtime.build.id`. Nothing about
  serving changes.
- Per `src/app/transaction-scripts/README.md`, this is framework-service work
  under `src/kixx/`, and request handlers may call it directly. Note while here:
  that README cites a `HyperviewContentService` that no longer exists — T9 fixes
  the reference.

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-store.js` — Release lifecycle; delete `commitChanges()` and `assignCurrentBuild()`
- `src/kixx/content-addressable-store/release-manifest.js` — consumed here
- `src/kixx/content-addressable-store/content-snapshot.js` — a snapshot-free object write path, so uploads never open an index
- `test/unit-tests/kixx/content-addressable-store/content-addressable-store.test.js`

**Acceptance criteria**

- [ ] A Release naming an object the store does not hold cannot be created, and
      the error lists every missing object up to the cap.
- [ ] A Release whose claimed size disagrees with the stored size cannot be created.
- [ ] A Release containing a template that fails to compile, or referring to an
      unresolvable base template or partial, cannot be created.
- [ ] `validateRelease()` persists nothing on success or failure.
- [ ] Creating an identical Release twice yields one `releaseId` and one closure.
- [ ] `assignRelease()` works for a build id that is not running and for one
      that has never been assigned.
- [ ] Assigning the already-assigned Release succeeds without mutating the pointer.
- [ ] Writing an object never opens a snapshot.
- [ ] `commitChanges()` and `assignCurrentBuild()` no longer exist.

**Validation**

- `node run-tests.js test/unit-tests/kixx` — service behavior
- `node run-linter.js src/kixx`
- A test proves a manifest referencing an unwritten object fails at creation
  rather than at read time.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T6: Release provenance and activation history are discoverable

**Status:** Not started
**Depends on:** T5
**Documentation:** `src/app/collections/README.md`; `src/app/transaction-scripts/README.md`

**Objective**

An operator can list prior Releases and see which build was pointed at what,
when, by whom, and why — so a rollback needs no root hash the client happened to
retain. This is what makes the second stated objective of the API achievable.

**Scope**

- In: a `Release` Collection and Record, an `Activation` Collection and Record,
  and the Transaction Scripts that coordinate them with
  `ContentAddressableStore`.
- Out: HTTP surface (T7). Retention and garbage collection, which stay
  unsolved deliberately — `ContentStoreInterface` has no delete, and inventing
  one before a retention policy exists would invite unsafe use.

**Design and invariants**

- These records are **metadata, not content**. The build pointer remains the sole
  source of truth for what is live. A metadata write failing after a successful
  pointer move leaves a gap in history, which is recoverable and
  non-corrupting — the same philosophy the port already applies to
  `saveIndex()` followed by `assignBuild()`.
- Because `releaseId` is the root hash, `assignRelease()` validates Release
  existence via `MISSING_CLOSURE` and never needs to read these records. That is
  what allows them to live in the application layer instead of the port, and it
  avoids a distributed transaction across two stores.
- `Release` record: `releaseId`, `createdAt`, `createdBy` (publishing token id),
  `objectCount`, `totalBytes`, `contractVersion`, and `provenance`
  (`sourceRevision`, `message`, `client`, `intendedForBuildId`). Provenance is
  optional, immutable, and rejects unknown fields. `intendedForBuildId` is a
  non-binding hint recording the pre-stage intent.
- Re-creating an existing Release does not overwrite the original record. First
  creation wins; subsequent publishes of identical content are visible in
  activation history instead.
- `Activation` record: `buildId`, `fromReleaseId`, `toReleaseId`, `activatedAt`,
  `activatedBy`, and `reason` (`publish`, `rollback`, `carry-forward`,
  `restore`). `reason` is audit metadata and changes no semantics.
- Orchestration across a Collection and a framework service is exactly what a
  Transaction Script is for: `create-release.js`, `assign-release.js`,
  `list-releases.js`, `list-activations.js` under
  `app/transaction-scripts/publishing/`.
- Listing is newest first with stable cursor pagination.

**Expected touch points**

- `src/app/collections/release-collection.js`, `release-record.js` — new
- `src/app/collections/activation-collection.js`, `activation-record.js` — new
- `src/app/app.js` — register both Collections
- `src/app/transaction-scripts/publishing/*.js` — new
- `test/unit-tests/app/collections/*`, `test/unit-tests/app/transaction-scripts/*`

**Acceptance criteria**

- [ ] Creating a Release records provenance and rejects unknown provenance fields.
- [ ] Re-creating an identical Release leaves the original record unchanged.
- [ ] Every successful assignment appends an Activation naming the prior and new
      Release ids.
- [ ] Listings are newest first and paginate with a stable cursor.
- [ ] A failed metadata write leaves the pointer authoritative and is logged.
- [ ] A rollback is performable using only data these endpoints return.

**Validation**

- `node run-tests.js test/unit-tests/app` — Collections and Transaction Scripts
- `node run-linter.js src/app`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T7: The HTTP surface expresses objects, releases, and build pointers

**Status:** Not started
**Depends on:** T5, T6
**Documentation:** `src/app/presentation/README.md`; `src/docs/server-error-handling.md`

**Objective**

Sixteen content-kind endpoints collapse to two object endpoints, and the API
exposes Release creation, Release history, and build-pointer reads and writes.
Publishing, rollback, carry-forward, and pre-staging become the same operation
against different build ids.

**Scope**

- In: routes, request handlers, permissions, preconditions, discovery, limits.
- Out: framework behavior (T5), records (T6), startup (T8), docs (T9), e2e (T10).

**Design and invariants**

Endpoint surface:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Discovery: contract version, running build id, addressing format, limits |
| `POST` | `/objects/status` | Which of these addresses does the store hold |
| `PUT` | `/objects/:objectId` | Upload one immutable object |
| `POST` | `/releases` | Create and fully verify a Release |
| `POST` | `/releases/validation` | Verify without persisting |
| `GET` | `/releases` | Release history |
| `GET` | `/releases/:releaseId` | Release metadata |
| `GET` | `/releases/:releaseId/manifest` | Complete manifest, for whole-site diffing |
| `GET` | `/builds` | Every registered build pointer |
| `GET` | `/builds/:buildId` | One build pointer, running or not |
| `PUT` | `/builds/:buildId` | Assign a Release to that build |
| `GET` | `/builds/:buildId/activations` | Activation history for that build |

- `GET /builds/:buildId` is the endpoint that makes pre-staging verifiable, and
  `GET /builds` is what surfaces a phantom build id from a typo. Neither exists
  today; both are the point of this task.
- `PUT /builds/:buildId` requires a precondition and has no unconditional form:
  - `If-Match: "<etag>"` — assign only if the pointer still matches;
  - `If-None-Match: *` — assign only if the build is unassigned (pre-stage, bootstrap);
  - neither — `428 Precondition Required`;
  - stale — `412 Precondition Failed`.
  `GET /builds/:buildId` returns the `ETag` these consume. It MUST change
  whenever the pointer changes and MUST read the authoritative pointer, not a
  content-serving cache.
- `PUT /objects/:objectId` takes raw bytes and no envelope. The server recomputes
  the address from the received bytes and rejects a mismatch with `422`. It MUST
  NOT open a snapshot, so a first-ever publish works. Already-present is success.
  Distinguish `201` (stored) from `200` (already present) so a client can report
  bytes actually transferred.
- `POST /objects/status` **deduplicates** input rather than rejecting duplicates:
  the same file at two pathnames yields the same address, and rejecting that
  pushes deduplication into every client. The response is a set; no order is
  promised.
- A manifest MAY carry inline `content` for small text objects instead of an
  `objectId`, under a published total cap. This lets a small site publish in one
  request, which for this project's stated audience is the headline capability,
  not an afterthought. Batched uploads remain the path for large sites.
- Discovery publishes the **actual configured** limits: maximum object bytes,
  maximum addresses per status call, maximum manifest entries, and maximum
  inline content bytes. Set the manifest cap to a number a single JSON body can
  honestly carry, on the order of 10,000 entries — not a number that implies a
  multi-megabyte request body the server must fully parse before responding.
- Permissions are keyed by responsibility, not storage facet. Keep them distinct
  so a release-creator who cannot activate, or a read-only auditor, is
  expressible later. Grant all of them to `editor` initially.

| Action | Resource |
| --- | --- |
| `urn:kixx:create` | `urn:kixx:publishing:objects` |
| `urn:kixx:get` | `urn:kixx:publishing:releases` |
| `urn:kixx:create` | `urn:kixx:publishing:releases` |
| `urn:kixx:get` | `urn:kixx:publishing:builds` |
| `urn:kixx:update` | `urn:kixx:publishing:builds` |

- Note in the handler module that `urn:kixx:create` on objects lets a token
  consume storage that nothing can currently reclaim, since the port has no
  delete. Object size and count limits are the only bound.
- Handlers parse the protocol document, call the service or Transaction Script,
  and serialize. They own no validation rules — every rule lives in T4/T5.
- Every recognized path rejects unsupported methods with `405` and an `Allow`
  header.

Error codes:

| Status | Code | Meaning |
| --- | --- | --- |
| `404` | `ReleaseNotFound` | No such Release |
| `404` | `BuildNotFound` | No such build pointer |
| `409` | `ObjectSizeMismatch` | Stored size disagrees with the manifest |
| `412` | `BuildPointerConflict` | Precondition no longer holds |
| `422` | `ObjectIdMismatch` | Uploaded bytes do not match the address |
| `422` | `MissingContentObjects` | Manifest names objects the store lacks |
| `422` | `InvalidReleaseManifest` | Manifest structure or content is invalid |
| `428` | `PreconditionRequired` | Pointer write omitted a precondition |

**Expected touch points**

- `src/routes/publishing-api-v1.js` — replace the whole route table
- `src/app/presentation/request-handlers/publishing-api/` — split `mod.js` into `discovery.js`, `objects.js`, `releases.js`, `builds.js`
- `src/app/presentation/lib/json-api.js` — reuse; extend only if a shape is genuinely missing
- `test/unit-tests/app/presentation/request-handlers/publishing-api/*`

**Acceptance criteria**

- [ ] Two object endpoints replace all sixteen per-content-kind endpoints.
- [ ] A pointer write without a precondition returns `428`; with a stale one, `412`.
- [ ] `If-None-Match: *` assigns an unassigned build and conflicts on an assigned one.
- [ ] An object whose bytes do not match its address returns `422` and stores nothing.
- [ ] Uploading works when no build has ever been assigned.
- [ ] A manifest with inline content publishes a small site in one request.
- [ ] Discovery reports the running build id, contract version, and real limits.
- [ ] `GET /builds/:buildId` reads a build that is not running.
- [ ] Every malformed client input returns a 4xx error document; none reaches an assertion.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation` — handlers
- `node run-linter.js src/routes src/app/presentation`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T8: A build states plainly whether it can serve its content

**Status:** Not started
**Depends on:** T5
**Documentation:** `src/plugins/README.md`; `src/docs/server-error-handling.md`

**Objective**

A build whose pointer is missing, or whose assigned Release was validated under a
content contract this code cannot honor, reports that condition clearly instead
of asserting on every request. This is the compatibility check the "release is
validated for a runtime build" idea is reaching for, placed where it can
actually work.

**Scope**

- In: contract verification when a build resolves its Release; the response and
  logging for an unservable build.
- Out: the contract constant and its reserved index entry (T5). API surface (T7).

**Design and invariants**

- The check cannot live in the Publishing API. A Release is created and assigned
  while a *different* build is running, so nothing at publish time can verify the
  target build's contract. The first moment the running code and its assigned
  content are both known is when that build resolves its pointer.
- Two failure conditions, both currently ending in `assert(build, ...)` inside
  `openSnapshot()` — a 500 on every request with no diagnosis:
  1. **No pointer.** Under the pre-stage workflow this means the deploy shipped
     with a `BUILD_ID` nothing was published for. Serve `503` with a plain
     explanation and log at fatal level naming the build id.
  2. **Contract mismatch.** The Release predates or postdates what this code
     supports. Serve `503` and log the expected and found versions.
- `503`, not a crash: on Cloudflare there is no useful "fail to boot", and an
  operator needs a diagnosable response rather than an opaque error. The response
  MUST name the build id so the fix is obvious.
- Verify once per build resolution and cache the outcome; do not re-check per
  request.
- A programmer error inside a served Release still asserts. This task changes
  only the two conditions above, both of which are deploy configuration faults.

**Expected touch points**

- `src/kixx/content-addressable-store/content-addressable-store.js` — resolution outcome instead of a bare assert
- `src/app/presentation/error-handlers/` or the virtual-host error path — the `503` response
- `src/kixx/hyperview/hyperview-service.js` — propagate the unservable outcome
- `test/unit-tests/kixx/**`

**Acceptance criteria**

- [ ] A build with no assigned Release serves `503` naming the build id, not a 500.
- [ ] A build assigned a Release with an unsupported contract version serves `503`
      naming both versions.
- [ ] Both conditions log at fatal level once, not per request.
- [ ] A build with a compatible Release serves normally with no added per-request cost.

**Validation**

- `node run-tests.js test/unit-tests/kixx` — resolution outcomes
- `node run-linter.js src/kixx src/app`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T9: Documentation matches the API

**Status:** Not started
**Depends on:** T7, T8
**Documentation:** `docs/publishing-api.md`; `src/app/transaction-scripts/README.md`

**Objective**

A client author can implement publishing, rollback, code-only carry-forward, and
first-time bootstrap from the documentation alone, and the internal architecture
docs stop describing modules that no longer exist.

**Scope**

- In: a rewritten `docs/publishing-api.md`; the port and service documentation
  touched by T2, T3, and T5; the stale `HyperviewContentService` reference.
- Out: an official client package, which is worth building and is not this plan.

**Design and invariants**

- Lead with the **atomic release model**, because it explains why build ids are
  client-supplied and why pre-staging exists. A reader who does not understand
  that will misuse every endpoint in the document.
- Document four workflows end to end:
  1. **Content-only publish** — create a Release, assign it to the running build.
  2. **Code-plus-content release** — create a Release, assign it to the next
     build id with `If-None-Match: *`, verify with `GET /builds/:next`, deploy.
  3. **Code-only deploy** — read the running build's pointer, assign that same
     Release to the next build id. Two small requests, no manifest.
  4. **Rollback** — list Releases or activations, assign an earlier Release to
     the running build with `If-Match`. Stop and investigate on `412`; do not
     retry blindly.
- Document the bootstrap case explicitly: no build assigned anywhere, uploads
  still work, `If-None-Match: *` makes the first assignment.
- State the Cloudflare consistency note: blobs are eventually consistent while
  pointers and the object registry are strongly consistent, and pre-staging is
  what absorbs the gap.
- Fix `src/app/transaction-scripts/README.md`, which cites `HyperviewContentService`
  — a service that no longer exists — as its worked example of a framework
  service a request handler may call directly. The principle is still correct;
  point it at `ContentAddressableStore`.
- Update `src/app/presentation/README.md` where it describes publishing handlers.

**Expected touch points**

- `docs/publishing-api.md` — rewrite
- `src/app/transaction-scripts/README.md` — corrected example
- `src/app/presentation/README.md` — handler description
- `src/kixx/content-addressable-store/content-store-interface.js` — contract prose from T2/T3

**Acceptance criteria**

- [ ] The atomic release model and the role of `BUILD_ID` are stated before any endpoint.
- [ ] All four workflows are documented with concrete requests and responses.
- [ ] Bootstrap from an empty store is documented.
- [ ] Every endpoint, error code, permission, and limit in T7 appears.
- [ ] No documentation references `HyperviewContentService`, `commitChanges`, `/index/closure`, or `/resources/*`.
- [ ] The Cloudflare consistency tradeoff is stated, not omitted.

**Validation**

- `node run-linter.js` — clean across the repo
- Read the document against the T7 route table; every endpoint appears exactly once.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T10: End-to-end tests cover the workflows, not the endpoints

**Status:** Not started
**Depends on:** T7, T8
**Documentation:** `test/end-to-end/README.md`

**Objective**

The end-to-end suite proves the four publishing workflows and the failure modes
that matter, rather than porting the old endpoint-per-file tests to new URLs.

**Scope**

- In: rewriting `test/end-to-end/200-publishing-api/` and
  `test/end-to-end/test-helpers/publishing-workflows.js`.
- Out: unit tests, which belong to their own tasks.

**Design and invariants**

- Test observable workflows. The old suite is organized by endpoint group
  (`020-resource-uploads`, `030-index-reads`, `050-closure`), which is why it
  never caught that a Release could name objects that do not exist.
- Required coverage:
  - first publication with nothing assigned anywhere;
  - object deduplication, and an address/bytes mismatch;
  - Release creation that verifies completely, and one that fails on a missing
    object, a wrong size, and a template that does not compile;
  - `validation` persisting nothing;
  - assignment to the running build with `If-Match`;
  - assignment to a **non-running** build with `If-None-Match: *`, read back
    before any deploy — the pre-staging case;
  - code-only carry-forward: two build ids, one Release;
  - rollback discovered purely from `GET /releases` and `GET /builds/:id/activations`;
  - a stale precondition rejected, and a missing one rejected;
  - assigning the already-assigned Release succeeding as a no-op;
  - coherent reads while an assignment happens.
- Helpers must restore any pointer they move, using the retained value as the
  precondition, and must fail loudly on `412` rather than retrying over a
  pointer something else moved. The existing helper gets this right; keep it.

**Expected touch points**

- `test/end-to-end/200-publishing-api/*` — rewrite
- `test/end-to-end/test-helpers/publishing-workflows.js` — object, Release, and build-pointer helpers
- `test/end-to-end/README.md` — if the suite layout changes

**Acceptance criteria**

- [ ] Every workflow above has a test.
- [ ] A test proves a Release naming an unwritten object cannot be created.
- [ ] A test proves a non-running build can be staged and read back.
- [ ] A test proves rollback needs no client-retained root hash.
- [ ] No test references `/resources/*`, `/index/*`, or `/build`.
- [ ] Helpers restore pointers they move and fail loudly on conflict.

**Validation**

- `node run-tests.js --e2e test/end-to-end/200-publishing-api` — per `test/end-to-end/README.md`
- `node run-linter.js test`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

## Open decisions

1. **Manifest entry cap.** T7 proposes roughly 10,000, against the inline-content
   cap and the maximum object size. Needs a real number before T7.
2. **Release and activation retention.** Nothing is ever deleted, and the port
   has no delete method. Rollback depth is currently unbounded and so is storage
   growth. A policy is needed eventually; this plan does not invent one.
3. **Cursor format** for Release and activation listings, per the Collections
   pagination conventions.
4. **Exact template compilation performed at validation.** T5 says "the same
   compiler and options used at runtime". Confirm which entry point that is
   before implementing.
5. Whether `GET /builds` needs paging. Build ids accumulate one per deploy, so
   it will eventually matter.
