# Hyperview Content Service

Date: 2026-08-20
Revision: 3 (supersedes revisions 1 and 2 from 2026-08-20)

## Revision note

Revision 3 incorporates the final plan-review decisions: the Node adapter stays
deferred and HCS-1 no longer promises a bootable Node process; Hyperview owns
independent page-path and template-filepath validators; the manifest rejects a
root template filepath while preserving its existing assertion/validation error
split; neither closure operation exposes the encoded index table; and the store
port drops `isValidPathname()` and store-level `computeHashFromStats()`.

Revision 1 assumed the Cloudflare adapter would keep exposing semantic Hyperview
resource methods (`putPageMetadata()`, `statBaseTemplates()`, `getPage()`, and
the manifest translation behind `commitChanges()`), and that
`HyperviewContentService` would be a thin framework facade in front of them.

That is the wrong boundary. Those operations are Hyperview vocabulary, not
content-addressable-storage vocabulary, and they currently live in the adapter
only for historical reasons. Revision 2 moves them into
`src/kixx/hyperview/` and reduces the adapter's public surface to a generic
content-addressable store.

Task IDs were renumbered because the partitioning changed. No work had started
under revision 1 (every task was "Not started"), so no progress notes are lost.
A copy of revision 1 is at `tmp/hyperview-content-service.SUPERSEDED.md`; it is
untracked scratch and is not project state.

## Implementation Approach

Hyperview owns its own content model. The platform adapter owns immutable blob
storage, an immutable index, and the digest wire format — nothing about pages,
templates, or bundles.

The evidence that this is the right seam is already in the code:

- `content-addressable-store.js:517` (`commitChanges()`) does nothing but flatten
  a Hyperview manifest into a generic `{ pathname, hash, size }` file list, pass
  it to `CloudflareContentStore#commitChanges(context, buildId, files)`, and
  reshape the result. The translation layer is already isolated.
- `cloudflare-content-store.js`, `content-addressable-index.js`, and
  `content-addressable-index-store.js` — 1,241 lines — contain no occurrence of
  `pages`, `templates`, or `BUNDLE`. They are already generic.
- All Hyperview vocabulary is confined to three files: the
  `ContentAddressableStore` facade (540 lines), the semantic half of
  `ContentSnapshot` (roughly 165 of 297 lines), and the layout section of
  `addressing.js` (roughly 60 lines).

So this is a relocation of an existing boundary, not the drawing of a new one.

### Target dependency direction

```text
Publishing request handlers ─┐
                             ├─> HyperviewContentService
HyperviewService ────────────┘            │
                                          ├── content layout vocabulary
                                          ├── HyperviewContentSnapshot
                                          └── ContentAddressableStoreInterface
                                                        │
                                                        ▼
                                              CloudflareContentStore
```

### Ownership

| Cloudflare CAS plugin | Kixx Hyperview |
| --- | --- |
| Hash algorithms and wire-format version (`FORMAT`, `KEY`, `hashBlob`, `hashTree`, `hashSet`, `hashEtag`, `hashValue`) | `/templates` and `/pages` layout |
| Blob and tree storage keys | Reserved bundle filenames |
| Defensive pathname safety check on its own key space | The canonical pathname rule, and Hyperview resource path construction |
| Raw immutable blobs | Text/JSON decoding of content objects |
| Generic index snapshots | Hyperview content snapshots |
| `putBlob()` | `putPageMetadata()`, `putBaseTemplates()`, and the rest |
| `statPath()`, `listStats()`, `getBlob()`, `getBlobs()`, `computeHashFromStats()` | `statPageMetadata()`, `getPage()`, and the rest |
| Commit a flat pathname/file closure | Validate and translate a Hyperview manifest |

### Decisions a later agent should not have to rediscover

**Do not split the constants from the operations.** Moving
`BASE_TEMPLATES_BUNDLE` and friends into Hyperview while leaving
`putPageMetadata()` in the adapter would force the adapter to import Hyperview's
layout module. The dependency would still point the wrong way, and the work
would have to be redone. The constants and the operations that use them move
together, in one task.

**Neither closure operation returns the encoded index table.** The adapter's
`commitClosure()` and `commitChanges()` currently return the encoded table, and
the facade calls `getRootHash(entries)` (imported from
`content-addressable-index.js`) to name the closure. No caller outside the
adapter needs the table: the only non-test caller of `commitClosure()` is
`commitChanges()`, and its tests can assert the stable closure descriptor instead.
Both methods will return `{ rootHash, nodeCount }`, keeping table construction and
encoding private to the adapter. The port exposes only `commitChanges()` with
that shape, so moving manifest translation to Hyperview does not recreate an
inverted dependency on `content-addressable-index.js`.

**`computeHashFromStats()` must be reachable from the generic snapshot, not the
store port.**
`ContentSnapshot#getPage()` computes a page's aggregate etag via
`this.#store.computeHashFromStats(...)`. After the split,
`HyperviewContentSnapshot` wraps only the generic snapshot and holds no store
reference, so the generic snapshot interface must expose aggregate hashing
directly. Move the existing algorithm from `CloudflareContentStore` into
`ContentSnapshot`; the snapshot can use the adapter's digest helpers directly.
Delete the store-level method rather than delegating to it. Neither
store-level `computeHashFromStats()` nor `isValidPathname()` belongs in the
framework port because no framework caller consumes either operation.

**Hyperview owns its pathname rule; the adapter keeps a defensive copy.** Do not
use `src/kixx/utils/validate-pathname.js` from `HyperviewService`,
`HyperviewContentService`, or the content-addressable-store adapter. That utility
serves unrelated static-file and Build ID validation and is expected to be
deprecated. `src/kixx/hyperview/content-layout.js` owns Hyperview normalization,
canonical page-path validation, and the stricter template-filepath rule. The
adapter's `addressing.js` retains its independent defensive check for its own key
space. Hyperview normalizes and validates before calling the port; `putBlob()`
asserts that the supplied pathname is already canonical rather than folding it.
The deliberate duplication is an invariant check across the port, not a shared
source of Hyperview semantics.

**`canonicalize()` moves to `src/kixx/utils/canonicalize.js`.** Deterministic
JSON serialization is needed on both sides: Hyperview produces the bytes it
uploads, and `hashSet`/`hashTree`/`hashEtag`/`hashValue` consume it inside the
adapter. It is also part of the publishing wire contract, because the client's
`x-checksum` is computed over exactly those bytes. A plugin importing a framework
utility is the correct direction, so one shared copy resolves the encode/decode
asymmetry without duplicating the algorithm. Its `compareStrings()` dependency
moves with it.

**Sync and async shapes are contractual.** `isValidPathname()`,
`isValidTemplateFilepath()`, and `normalizePathname()` are synchronous;
`hashValue()` is asynchronous. This is not cosmetic:
`HyperviewService#assertCanonicalIdentifier()`
(`hyperview-service.js:116`) evaluates
`isNonEmptyString(value) && this.#store.isValidPathname(value)` inside an
`assert()`. If `isValidPathname()` became async, the assertion would receive a
truthy Promise and every identifier would pass validation — a silent
authorization-relevant failure, not a type error.

### Sequencing

The adapter's facade stays registered and working until every caller has moved,
so the migration does not introduce a new runtime break. The pre-existing Node
content-store gap remains explicitly deferred:

1. HCS-1 fixes the plugin-map import bug, independent of everything else. It does
   not make the Node entry point fully bootable because Node has no
   content-addressable-store adapter yet.
2. HCS-2 defines the generic port and registers `CloudflareContentStore` under
   the final service name `ContentAddressableStore`. The doomed facade is
   re-registered under the transitional name `HyperviewContentFacade`, so the
   name churn lands on the object being deleted rather than the one being kept.
3. HCS-3 builds the Hyperview content layer alongside the facade. Nothing is
   wired to it yet.
4. HCS-4 migrates the renderer. HCS-5 migrates publishing.
5. HCS-6 deletes the facade once it has no callers. HCS-7 documents and verifies.

### Cross-cutting invariants and scope

- One snapshot per rendered response. `HyperviewService` opens exactly one
  `HyperviewContentSnapshot` and threads it through every page, template,
  partial, and cache-etag read for that response.
- Render output, JSON responses, missing-page errors, compiled-template caches,
  page-cache keys, JSON:API request/response shapes, route paths, response
  statuses, authorization, checksum semantics, and manifest semantics are
  unchanged by this work, except that the previously accepted invalid
  page-template filepath `/` is rejected in upload and manifest validation.
- Storage format, digest wire format, and the on-disk/on-KV representation are
  unchanged. This is a code-ownership refactor, not a data migration. No
  committed content becomes unreadable.
- No generic JSON:API resource-type string enters `HyperviewContentService`.
- No new Forms, publishing business rules, rollback API, storage format, or
  platform adapter is introduced. `assignBuild()` stays on the concrete adapter
  and is deliberately left out of the port until a rollback feature needs it.
- The Node content-addressable-store adapter is deferred. The Node entry point
  still cannot initialize the general Hyperview plugin after HCS-1; this is a
  known platform gap, not a completion criterion for this plan.
- Do not run or add end-to-end tests. Verification is lint plus unit tests, per
  the repository instructions.
- The `test/end-to-end/020-publishing-api/` suite is already obsolete against the
  current routes — it targets `/publishing-api/v1/templates/pages/*filepath`,
  expects HTTP 200, `data.type === 'Template'`, attributes
  `{ kind, filepath, buildId }`, and a `kixx-build-id` header, none of which the
  current implementation produces. Rewriting it is out of scope for this plan.
  Do not treat its passing or failing as a signal about this work.

---

### Task HCS-1: Correct plugin-map imports in both entry points

**Status:** Not started
**Depends on:** None
**Documentation:** `src/plugins/README.md` §"The Three Roles"; `src/docs/code-style-guide.md`; `test/unit-tests/README.md`

**Objective**

Both server entry points import the named plugin-map exports and construct the
intended merged map. This removes the first boot-time failure without claiming
that the Node process can fully initialize Hyperview before its deferred
content-addressable-store adapter exists.

**Scope**

- In: the plugin-map import in both entry points; side-effect-free regression
  coverage for plugin-map merge behavior.
- Out: any change to plugin behavior, registration order, or the set of plugins;
  a Node content-addressable-store adapter; starting either server for
  verification.

**Design and invariants**

- `src/node-server.js:19` and `src/cloudflare-server.js:13` both do
  `import generalPlugins from './plugins/general.js'`, but `general.js`,
  `node.js`, and `cloudflare.js` export only a named `plugins` binding. There is
  no default export, so native ESM module instantiation fails before either
  entry point can construct its merged map or register a plugin. Confirmed by
  `node -e "import('./src/plugins/general.js').then((m) => console.log(Object.keys(m), m.default))"`
  printing `[ 'plugins' ] undefined`.
- Fix by importing the named binding in both entry points. Do not add default
  exports: the named form is what the plugin-map modules already document, and
  the merge comment at `node-server.js:114` describes the named maps.
- Preserve the existing merge order — platform plugins override general plugins.
- Entry points have server/platform side effects and must not be imported by a
  Node unit test. Extract the map merge into a side-effect-free helper used by
  both entry points, test it with the general and representative platform maps,
  and keep the entry-point imports as named bindings. This proves merge and
  override behavior without starting a server or importing `cloudflare:workers`
  in the Node test process.

**Expected touch points**

- `src/node-server.js` — import the named plugin map
- `src/cloudflare-server.js` — import the named plugin map
- `src/plugins/merge-plugin-maps.js` — side-effect-free shared merge operation
- `test/unit-tests/plugins/plugin-maps.test.js` — new merged-map regression test

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both entry points import the named `plugins` binding from their general
      and platform plugin-map modules.
- [ ] The merged map preserves platform-over-general override order.
- [ ] Side-effect-free unit coverage rejects non-iterable inputs and proves the
      expected merge and override behavior without starting a server.
- [ ] No acceptance criterion claims the Node entry point fully initializes
      Hyperview; that awaits the deferred Node content-store adapter.

**Validation**

- `node run-linter.js src/node-server.js src/cloudflare-server.js src/plugins test/unit-tests/plugins` — entry points, plugin maps, and tests are lint-clean.
- `node run-tests.js test/unit-tests/plugins` — plugin suites pass.
- `node --check src/node-server.js && node --check src/cloudflare-server.js` — both entry points parse without starting a server.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: This is a pre-existing import defect unrelated to
  the content-service refactor. Fixing it does not close the separately deferred
  Node content-store gap.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-2: Define the generic content-addressable store port

**Status:** Not started
**Depends on:** HCS-1
**Documentation:** This plan §"Ownership" and §"Decisions"; `src/plugins/README.md` §"How the Contracts Are Written"; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`

**Objective**

A framework-owned contract describes immutable content-addressable storage in
generic terms, `CloudflareContentStore` is declared as its implementation, and
that generic store is registered under the service name Hyperview will consume.
No Hyperview concept appears anywhere in the contract.

**Scope**

- In: the new port module; `commitClosure()` and `commitChanges()` return-shape
  changes on `CloudflareContentStore`; moving `computeHashFromStats()` from the
  concrete store to the generic snapshot; `canonicalize()` relocation; plugin
  registration of the generic store and transitional re-registration of the
  facade.
- Out: building the Hyperview content layer (HCS-3); deleting the facade (HCS-6).

**Design and invariants**

- Add `src/kixx/content-store/content-addressable-store-interface.js` exporting
  `ContentAddressableStoreInterface` and `ContentIndexSnapshotInterface` as JSDoc
  typedefs, with top-level invariants covering blob immutability, snapshot
  pinning and request lifetime, digest opacity, and caller-visible errors.
- Store contract: `hashValue(value)` (async), `openSnapshot(context)`,
  `putBlob(context, pathname, blob, metadata, etag)`, and
  `commitChanges(context, buildId, files)`. `assignBuild()` is deliberately
  excluded until a rollback feature needs it. `normalizePathname()`,
  `isValidPathname()`, and store-level `computeHashFromStats()` are excluded
  because no framework caller consumes them; pathname semantics belong to
  Hyperview, while aggregate hashing is consumed through the snapshot.
- Snapshot contract: the `rootHash` getter, `statPath(pathname)`,
  `listStats(prefix, options)`, `getBlob(hash)`, `getBlobs(hashes)`, and
  `computeHashFromStats(stats)`.
- Change both `CloudflareContentStore#commitClosure()` and `commitChanges()` to
  return `{ rootHash, nodeCount }` instead of the encoded index table.
  `commitClosure()` computes that descriptor while it still has the private
  table; `commitChanges()` uses `rootHash` for `assignBuild()` and returns the
  same descriptor. Move the `getRootHash(entries)` and
  `Object.keys(entries).length` calls out of the facade
  (`content-addressable-store.js:523`) and into the adapter. Update the facade to
  consume the descriptor so its `{ hash, count }` behavior is unchanged. No
  public method returns the encoded table after this task.
- Move `computeHashFromStats(stats)` from `CloudflareContentStore` to
  `ContentSnapshot`, preserving its order-independent digest algorithm and wire
  format. Update `ContentSnapshot#getPage()` to call its own method. The concrete
  store no longer exposes aggregate hashing; the snapshot is both the owner and
  the only framework-visible surface for that operation.
- Move `canonicalize()` and `compareStrings()` to
  `src/kixx/utils/canonicalize.js`. `addressing.js` imports them; its public
  re-export may be kept temporarily if it reduces churn, but the definition moves.
- Register `CloudflareContentStore` as the `ContentAddressableStore` service.
  Re-register the existing facade as `HyperviewContentFacade` and update its two
  consumers (`src/plugins/hyperview/plugin.js:36` and
  `src/app/transaction-scripts/publishing/mod.js`) to the transitional name. The
  final name is claimed by the generic store from the start so it never has to be
  renamed later.
- Do not change hashing behavior, storage keys, or any digest. Existing adapter
  tests must pass with closure-operation return-shape assertions updated and the
  unchanged aggregate-hashing cases relocated from the store suite to the
  snapshot suite.

**Expected touch points**

- `src/kixx/content-store/content-addressable-store-interface.js` — new generic port
- `src/kixx/utils/canonicalize.js` — relocated deterministic serialization
- `src/plugins/cloudflare-content-addressable-store/lib/addressing.js` — import relocated helpers
- `src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js` — `@implements`, closure result shapes, remove aggregate hashing
- `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js` — `@implements`, own `computeHashFromStats()`
- `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js` — consume the new commit result
- `src/plugins/cloudflare-content-addressable-store/plugin.js` — register generic store plus transitional facade name
- `src/plugins/hyperview/plugin.js`, `src/app/transaction-scripts/publishing/mod.js` — transitional service name
- `test/unit-tests/kixx/utils/canonicalize.test.js` — relocated serialization tests
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.test.js` — commit result shape
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js` — aggregate hashing at its new owner

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The port module contains no Hyperview vocabulary: no `pages`, `templates`,
      bundle filenames, or resource-specific method names.
- [ ] `CloudflareContentStore` and `ContentSnapshot` carry `@implements`
      references and satisfy every documented operation.
- [ ] `commitClosure()` and `commitChanges()` both return
      `{ rootHash, nodeCount }`, and no public return value exposes the encoded
      index table.
- [ ] `computeHashFromStats()` is reachable from a snapshot without a store
      reference.
- [ ] The store port does not expose `normalizePathname()`, `isValidPathname()`,
      or store-level `computeHashFromStats()`.
- [ ] `CloudflareContentStore` itself no longer exposes
      `computeHashFromStats()`; the existing digest cases pass against
      `ContentSnapshot` instead.
- [ ] `canonicalize()` has exactly one definition, in `src/kixx/utils/`, and
      produces byte-identical output to the previous implementation for the
      existing test corpus.
- [ ] `ContentAddressableStore` names the generic store; the facade is reachable
      only as `HyperviewContentFacade`; the application still works unchanged.

**Validation**

- `node run-linter.js src/kixx/content-store src/kixx/utils src/plugins/cloudflare-content-addressable-store src/plugins/hyperview src/app/transaction-scripts/publishing test/unit-tests/kixx/utils test/unit-tests/plugins` — port, relocation, and adapter are lint-clean.
- `node run-tests.js test/unit-tests/plugins/cloudflare-content-addressable-store test/unit-tests/kixx/utils` — adapter and relocated-utility suites pass.
- Unit coverage: `canonicalize()` key ordering, undefined-property omission, and
  non-finite rejection at the new location; `commitClosure()` and
  `commitChanges()` result shapes; migrated order-independent aggregate-hashing
  cases on `ContentSnapshot`.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: `CloudflareContentStore` is already fully generic —
  `grep` for `pages|templates|BUNDLE` across it and the two index modules returns
  nothing — so this task defines a contract around behavior that already exists,
  plus two small return-shape corrections needed to keep the dependency direction
  correct in HCS-3.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-3: Build the Hyperview content layer

**Status:** Not started
**Depends on:** HCS-2
**Documentation:** This plan §"Ownership" and §"Decisions"; `src/plugins/README.md`; `src/docs/code-style-guide.md`; `src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

`src/kixx/hyperview/` owns the complete Hyperview content model — layout
vocabulary, content objects, request-scoped snapshots, resource reads and writes,
and manifest validation and translation — implemented over the generic port and
covered by tests. Nothing is wired to it yet, so the running application is
unchanged.

**Scope**

- In: content layout module; content object types; `HyperviewContentSnapshot`;
  `HyperviewContentService`; migration of the corresponding test cases.
- Out: renderer wiring (HCS-4); publishing wiring (HCS-5); deleting the adapter
  facade (HCS-6).

**Design and invariants**

- Add `src/kixx/hyperview/content-layout.js` owning `BASE_TEMPLATES_BUNDLE`,
  `TEMPLATE_PARTIALS_BUNDLE`, `PAGE_PARTIALS_BUNDLE`, `PAGE_INCLUDES_BUNDLE`,
  `RESERVED_PAGE_FILENAMES`, the `/templates` and `/pages` namespace mapping,
  `normalizePathname()`, `isValidPathname()`, and
  `isValidTemplateFilepath()`. Implement the Hyperview rules directly in this
  module; do not import or modify `src/kixx/utils/validate-pathname.js`, which is
  unrelated legacy validation expected to be deprecated. Page paths may be `/`;
  template filepaths must satisfy the canonical pathname rule and must name a
  non-root file path.
- Expose focused path constructors rather than generic prefix helpers, so callers
  cannot assemble arbitrary internal paths:
  `getBaseTemplatesPath()`, `getTemplatePartialsPath()`,
  `getPageMetadataPath(pathname)`, `getPagePartialsPath(pathname)`,
  `getPageIncludesPath(pathname)`, `getPageTemplatePath(filepath)`.
  Page-oriented constructors assert a valid page pathname;
  `getPageTemplatePath()` asserts a valid template filepath, so `/` can never map
  to a blob at the `/pages` namespace root.
- Add `HyperviewContentStat` and `HyperviewContentObject` (relocated from
  `content-object.js`), keeping the `text()` and `json()` decoders and the
  `kind`/`hash`/`size`/`metadata`/`etag` fields. The etag must continue to be
  carried onto content objects: compiled-template caches key on it and compare it
  against the matching stat's etag, so dropping it turns those caches into
  permanent misses.
- Add `HyperviewContentSnapshot` wrapping one `ContentIndexSnapshotInterface`. It
  owns `getPage()` and the semantic stat/get pairs relocated from
  `ContentSnapshot`. It holds no store reference and computes page etags through
  the snapshot's `computeHashFromStats()`.
- Add `HyperviewContentService` with the public contract in the table below. It
  holds the injected store in an ES2022 private field.
- Relocate manifest handling from the facade, preserving its error
  classification and existing entry-validation behavior except for closing the
  template-root hole:
  `#buildManifestFiles()`, `#checkBlobDescriptor()`,
  `#checkOnePageTemplatePerDirectory()`, and `#filepathDirname()`. A non-object
  manifest is an internal call-contract violation and remains an
  `AssertionError`, including when detected by the private
  `#buildManifestFiles()` helper. Once the top-level object shape is established,
  malformed client-supplied entries remain a `ValidationError` with every
  problem collected before throwing.
- Validate `manifest.pageTemplates[].filename` with
  `isValidTemplateFilepath()`, not the generic page-path rule. A root filename
  (`'/'`) must be collected as a field validation problem and must never be
  translated to a flat `{ pathname: '/pages', ... }` file descriptor.
- Preserve the reserved-filename check's subtlety: the basename tested against
  `RESERVED_PAGE_FILENAMES` is taken from the caller-supplied path, not the
  internal one, because the internal path always ends in a bundle filename this
  code appended itself.
- Preserve the one-template-per-page-directory rule and its rationale:
  `getPage()` treats "whatever is left" in a page directory as the template, so
  two templates in one directory would silently collide.
- Errors from the port propagate unchanged. Do not add a blanket catch that
  renames storage errors.

Public contract:

| Method | Contract |
| --- | --- |
| `initialize({ contentStore })` | Connect the required `ContentAddressableStoreInterface`; assert when absent. |
| `normalizePathname(value)` | Sync. Fold to the canonical Hyperview pathname. |
| `isValidPathname(value)` | Sync. Report whether a value satisfies the canonical rule. |
| `isValidTemplateFilepath(value)` | Sync. Report whether a value is a canonical, non-root Hyperview template filepath. |
| `hashValue(value)` | Async. Deterministic digest used for cache identities. |
| `openSnapshot(context)` | Return a request-scoped `HyperviewContentSnapshot`. Callers must not retain it beyond the request. |

One-off publishing reads each open exactly one snapshot internally and return a
stat object or `null`: `statTemplatePartials(context)`,
`statBaseTemplates(context)`, `statPageMetadata(context, pathname)`,
`statPagePartials(context, pathname)`, `statPageIncludes(context, pathname)`,
`statPageTemplate(context, filepath)`.

Writes take an argument object and return the `{ hash, size, metadata }`
descriptor unchanged:

| Method | Arguments after `context` |
| --- | --- |
| `putTemplatePartials(context, args)` | `{ bundle, etag }` |
| `putBaseTemplates(context, args)` | `{ bundle, etag }` |
| `putPageMetadata(context, args)` | `{ pathname, metadata, etag }` |
| `putPagePartials(context, args)` | `{ pathname, bundle, etag }` |
| `putPageIncludes(context, args)` | `{ pathname, bundle, etag }` |
| `putPageTemplate(context, args)` | `{ filepath, source, etag }` |

`commitChanges(context, args)` accepts `{ buildId, manifest }`, defaults only an
`undefined` `buildId` to `context.runtime.build.id`, and returns
`{ hash, count }`. Explicit `null`, empty, or otherwise invalid build IDs
continue to reach validation rather than silently selecting the runtime build.

**Expected touch points**

- `src/kixx/hyperview/content-layout.js` — new layout vocabulary
- `src/kixx/hyperview/hyperview-content-object.js` — relocated stat/content types
- `src/kixx/hyperview/hyperview-content-snapshot.js` — semantic snapshot over the generic one
- `src/kixx/hyperview/hyperview-content-service.js` — resource reads, writes, manifest translation, commits
- `test/unit-tests/kixx/hyperview/content-layout.test.js` — path construction and pathname rule
- `test/unit-tests/kixx/hyperview/hyperview-content-snapshot.test.js` — migrated from `content-snapshot.test.js`
- `test/unit-tests/kixx/hyperview/hyperview-content-service.test.js` — migrated from `content-addressable-store.test.js`

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `src/kixx/hyperview/` imports nothing from `src/plugins/`.
- [ ] Every method in the public contract above is present, documented, and
      implemented over the generic port only.
- [ ] Each stat method opens exactly one snapshot and returns its result,
      including `null`, unchanged.
- [ ] Every write passes the correct semantic values and optional etag without
      mutation and returns the descriptor unchanged.
- [ ] `commitChanges()` uses the runtime build only for an omitted/`undefined`
      build ID, and preserves an explicitly supplied one.
- [ ] Given a manifest object, entry validation reports every problem in one
      `ValidationError`, with existing messages and field paths preserved except
      for the new root-template-filepath error.
- [ ] A non-object manifest still fails with `AssertionError`; malformed fields
      inside a manifest object fail with `ValidationError`.
- [ ] A `pageTemplates` manifest entry whose filename is `/` is rejected as a
      field validation error and never becomes a `/pages` blob descriptor.
- [ ] Duplicate pathnames, file/directory collisions, nesting under a file,
      reserved filenames, and two templates in one page directory are all still
      rejected, with the same error text.
- [ ] `getPage()` returns the same `{ etag, pageDataFiles, pageTemplateFilename,
      partials, includes }` shape, with metadata in root-to-leaf order.
- [ ] Initialization without a content store fails with an assertion naming
      `HyperviewContentService` and `contentStore`.
- [ ] `isValidPathname()`, `isValidTemplateFilepath()`, and
      `normalizePathname()` are synchronous; `hashValue()` is asynchronous.
- [ ] Hyperview content modules do not import
      `src/kixx/utils/validate-pathname.js`.

**Validation**

- `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview` — new layer and tests are lint-clean.
- `node run-tests.js test/unit-tests/kixx test/unit-tests/plugins` — the new layer passes and the still-registered adapter facade is unaffected.
- `rg -n "from '.*plugins/" src/kixx/hyperview` — returns no matches.
- `rg -n "validate-pathname" src/kixx/hyperview` — returns no matches.
- Unit coverage: every path constructor; page-path and template-filepath rules
  including empty-string, root, and mixed-case cases; missing initialization
  dependency; all six stats; all six writes; omitted and explicit build IDs;
  non-object manifest assertion; the full manifest entry-validation matrix,
  including a root page-template filename; `getPage()` inheritance and aggregate
  etag; error propagation from the port.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Roughly 750 lines of behavior move here, so the test
  migration is the bulk of the work. Migrate cases rather than rewriting them:
  the existing `content-addressable-store.test.js` (623 lines) and
  `content-snapshot.test.js` (259 lines) encode the manifest and page-assembly
  edge cases, and re-deriving them from scratch will lose coverage.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-4: Make rendering consume Hyperview content snapshots

**Status:** Not started
**Depends on:** HCS-3
**Documentation:** This plan §"Sequencing"; `agents/plans/hyperview-snapshot-consistency.md` Tasks HV-2 through HV-4; `src/app/presentation/README.md` §"Hyperview Page Context"; `src/plugins/README.md` §"The Plugin Module Contract"; `test/unit-tests/README.md`

**Objective**

`HyperviewService` performs every content operation through
`HyperviewContentService`, preserving its rendering output, cache behavior, and
the guarantee that one response reads one immutable content snapshot. The general
Hyperview plugin registers and wires both services through its two-phase
lifecycle.

**Scope**

- In: `HyperviewService` dependency change and delegation; Hyperview plugin
  registration and initialization; renderer and plugin unit tests.
- Out: publishing handlers (HCS-5); changes to template compilation, cache
  identity, or the snapshot protocol.

**Design and invariants**

- Replace `HyperviewService.#store` with `#contentService`. `initialize(args)`
  accepts `{ contentService, kvStore }` and asserts both. Update the JSDoc at
  `hyperview-service.js:98`, which currently names `ContentAddressableStore`.
- `normalizePathname()`, `isValidPathname()`, `hashValue()`, `openSnapshot()`,
  and `assertCanonicalIdentifier()` delegate through `#contentService`.
  `assertCanonicalIdentifier()` must keep its `isNonEmptyString()` guard, because
  the canonical rule accepts the empty string.
- Workflow methods continue to accept the snapshot directly, so every render
  still opens one snapshot and threads it through page, template, partial, and
  cache-etag reads. The renderer uses exactly seven snapshot operations —
  `statTemplatePartials`, `getTemplatePartials`, `statBaseTemplates`,
  `getBaseTemplates`, `statPageTemplate`, `getPageTemplate`, `getPage` — and must
  not acquire more.
- The Hyperview plugin registers `HyperviewContent` and `Hyperview` during
  `register()`. During `initialize()`, resolve `ContentAddressableStore`
  (the generic store, per HCS-2), initialize `HyperviewContent` with it as
  `contentStore`, then initialize `Hyperview` with `HyperviewContent` and
  `KeyValueStore`.
- Note the platform gap and do not paper over it: `src/plugins/node.js` registers
  no content-addressable store, so a general plugin resolving
  `ContentAddressableStore` restricts Hyperview to the Cloudflare target. Record
  this as a known constraint in the plugin's module comment, naming the port a
  future Node adapter must implement. Do not add a Node adapter here.
- Adapt existing Hyperview test doubles from the raw store shape to the content
  service shape. Do not weaken snapshot-consistency, cache-key, or render
  assertions.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — consume the content service and its snapshots
- `src/plugins/hyperview/plugin.js` — register and initialize both general services
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — update doubles, preserve behavior coverage
- `test/unit-tests/plugins/hyperview/plugin.test.js` — new lifecycle and wiring tests

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `HyperviewService` has no store dependency or store type reference and
      requires `contentService` plus `kvStore` at initialization.
- [ ] Every render opens exactly one snapshot through `HyperviewContentService`,
      and all content reads for that response use it.
- [ ] Render output, JSON responses, missing-page errors, template caches,
      page-cache keys, and concurrent snapshot behavior are unchanged.
- [ ] The plugin registers `HyperviewContent` and `Hyperview`, and initializes
      the content service before injecting it into the renderer.
- [ ] Plugin tests fail clearly if either service name or dependency edge drifts.
- [ ] Existing Hyperview tests retain behavioral assertions rather than being
      rewritten around implementation calls.

**Validation**

- `node run-linter.js src/kixx/hyperview src/plugins/hyperview test/unit-tests/kixx/hyperview test/unit-tests/plugins/hyperview` — renderer, wiring, and tests are lint-clean.
- `node run-tests.js test/unit-tests/kixx/hyperview test/unit-tests/plugins/hyperview` — rendering and plugin lifecycle suites pass.
- Unit coverage: both missing renderer dependencies; both registered services;
  initialization order; one snapshot per render; the existing mid-publication
  snapshot-consistency and cache-identity cases.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: `HyperviewService` already threads a snapshot
  through rendering, so this changes who supplies the snapshot, not the render
  algorithm.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-5: Route publishing through HyperviewContentService

**Status:** Not started
**Depends on:** HCS-3, HCS-4
**Documentation:** `src/app/presentation/README.md` §"JSON:API Endpoint"; `src/app/transaction-scripts/README.md`; `src/docs/server-error-handling.md`; `test/unit-tests/README.md`

**Objective**

The Publishing API performs resource stats, uploads, and commits through
`HyperviewContentService` with one authoritative external-resource catalog. The
application no longer reaches around the framework service to a platform store,
and the pass-through publishing Transaction Script is removed.

**Scope**

- In: publishing request-handler service calls and resource catalog; canonical
  plural `page_templates` behavior; removal of the obsolete Transaction Script;
  handler unit tests.
- Out: route paths, authorization, new Forms, API redesign, end-to-end tests.

**Design and invariants**

- Replace imports from `app/transaction-scripts/publishing/mod.js` with
  `context.getService('HyperviewContent')` inside the request handlers.
- Replace `CHECK_PATHNAME_TYPES`, `TEXT_PAYLOAD_TYPES`, and both type switches
  with one module-private immutable resource-definition map keyed by the six
  canonical external identifiers: `template_partials`, `base_templates`,
  `page_metadata`, `page_partials`, `page_includes`, `page_templates`.
- Each catalog entry carries a **path kind**, not a boolean:
  `none`, `page-path`, or `template-filepath`. These are genuinely different
  contracts and must not share one validation branch:
  - `page-path` (`page_metadata`, `page_partials`, `page_includes`) — route
    pattern `{/*path}`, the root page is meaningful, and the existing
    `segments.length === 1 && segments[0] === '' → '/'` folding applies.
  - `template-filepath` (`page_templates`) — route pattern `/*path`, must name a
    file, and the root fold must **not** apply. Validate it with
    `HyperviewContentService.isValidTemplateFilepath()`, not
    `isValidPathname()`. The generic page-path rule accepts `/`, while the
    filepath rule rejects it; reusing the page-path branch would let a
    `/page-templates/` request through to
    `putPageTemplate(context, { filepath: '/' })`, which maps to `/pages` and
    would write a blob over the pages root node.
- Each entry also carries the body format (JSON or text) and the explicit
  `HyperviewContentService` stat and write methods.
- This fixes the current `page_templates`/`page_template` drift:
  `src/routes/publishing-api-v1.js:102,190` configure `page_templates`, while
  `publishing-api/mod.js:19,23` and the Transaction Script recognize only
  `page_template`. Page-template publishing is therefore broken today — the
  payload is JSON-parsed and the script throws `AssertionError` on the unknown
  type. Fixing the catalog activates this path for the first time, which is
  exactly why the filepath rule above must land with it.
- Handler factories assert the configured type against the catalog: an unknown
  type is an internal configuration bug. A bad request pathname remains an
  expected `BadRequestError` with the existing `PagePathRequired` and
  `InvalidPagePath` codes.
- The service and layout constructors assert their path preconditions but do not
  translate bad handler input into operational errors. The presentation layer
  must call the validator for the catalog's exact path kind before invoking the
  service, so client mistakes become `BadRequestError` rather than programmer
  errors. State this load-bearing contract in the handler module comment.
- Map handler `payload` to semantic service arguments (`metadata`, `bundle`, or
  `source`), and a page-template path to `filepath`.
- Keep `NotFoundError` construction, JSON:API resource construction, response
  statuses and content types, and the commit response shape unchanged.
- Delete `src/app/transaction-scripts/publishing/mod.js` and its now-empty
  `publishing/` directory. Do not replace it with another pass-through script.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/mod.js` — content-service integration and resource catalog
- `src/routes/publishing-api-v1.js` — verify every route type identifier matches the catalog
- `src/app/transaction-scripts/publishing/` — remove the obsolete pass-through module and directory
- `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js` — new handler tests

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All six stat endpoints and all six upload endpoints invoke the matching
      explicit `HyperviewContentService` method and preserve their HTTP contracts.
- [ ] `page_templates` is the single canonical identifier across route
      configuration and handler dispatch; its body is read as text and its
      wildcard path is validated as a filepath and passed as `filepath`.
- [ ] A `template-filepath` request that resolves to `/` is rejected with
      `BadRequestError`, not forwarded to the service.
- [ ] Path-bearing resources normalize and validate through
      `HyperviewContentService`, with page paths using `isValidPathname()` and
      template filepaths using `isValidTemplateFilepath()`; invalid client paths
      still produce the existing `BadRequestError` codes.
- [ ] Missing stats still become `NotFoundError` in the presentation layer.
- [ ] Commit requests preserve JSON:API parsing, the omitted-build fallback,
      manifest field mapping, and response shape.
- [ ] `src/app/transaction-scripts/publishing/` and all imports of it are gone.
- [ ] `rg -n "ContentAddressableStore|HyperviewContentFacade" src/app` returns no
      matches.

**Validation**

- `node run-linter.js src/app/presentation/request-handlers/publishing-api src/routes/publishing-api-v1.js test/unit-tests/app` — publishing presentation code and tests are lint-clean.
- `node run-tests.js test/unit-tests/app test/unit-tests/kixx/hyperview` — publishing dispatch and content service behavior pass together.
- `rg -n "ContentAddressableStore|HyperviewContentFacade|transaction-scripts/publishing" src/app src/routes` — no stale application dependency remains.
- Unit coverage: all six catalog entries; root and nested page-path
  normalization; the `template-filepath` root rejection; both `/page-metadata`
  and `/page-metadata/` spellings, so the optional-wildcard behavior is recorded
  rather than assumed; missing and invalid paths; JSON versus text body
  selection; not found; successful stat and upload responses; commit delegation
  and response.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: `test/unit-tests/app/` does not exist yet — this
  task creates the first test under it, so any `rg` over that path will fail
  until the first file lands.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-6: Retire the adapter's Hyperview facade

**Status:** Not started
**Depends on:** HCS-4, HCS-5
**Documentation:** This plan §"Ownership"; `src/plugins/README.md`; `src/docs/code-style-guide.md`

**Objective**

The Cloudflare plugin's public surface is a generic content-addressable store.
No Hyperview vocabulary remains anywhere under `src/plugins/`, and the
transitional facade registration is gone.

**Scope**

- In: deleting the facade, the semantic half of the adapter snapshot, the
  relocated content-object module, and the layout section of `addressing.js`;
  removing the transitional service registration; pruning the corresponding
  adapter tests.
- Out: any behavior change to the generic store, index, or digest format.

**Design and invariants**

- Delete `content-addressable-store.js` and `content-object.js`.
- Reduce `ContentSnapshot` to `rootHash`, `statPath()`, `listStats()`,
  `getBlob()`, `getBlobs()`, and `computeHashFromStats()`. Remove `getPage()`,
  the semantic stat/get pairs, `#getPath()`, `#statPath()`, and
  `#assertPagePath()`.
- Remove `BASE_TEMPLATES_BUNDLE`, `TEMPLATE_PARTIALS_BUNDLE`,
  `PAGE_PARTIALS_BUNDLE`, `PAGE_INCLUDES_BUNDLE`, `normalizeTemplatePath()`, and
  `normalizePagePath()` from `addressing.js`. Keep `FORMAT`, `KEY`, the byte
  helpers, the digest functions, and the defensive `isValidPathname()` /
  `normalizePathname()` used as index invariants — with a comment recording that
  Hyperview owns its independent canonical rule and these are an adapter-local
  defensive copy. Do not replace them with an import from
  `src/kixx/utils/validate-pathname.js`.
- Remove the `HyperviewContentFacade` registration. `plugin.js` registers only
  `CloudflareContentStore` as `ContentAddressableStore`.
- Delete adapter test cases whose behavior moved in HCS-3. Do not delete cases
  covering generic storage, indexing, or digests.
- Confirm removal by search, not by inspection alone: no `pages`, `templates`, or
  `BUNDLE` token may remain in the plugin's source.

**Expected touch points**

- `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js` — delete
- `src/plugins/cloudflare-content-addressable-store/lib/content-object.js` — delete
- `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js` — reduce to generic operations
- `src/plugins/cloudflare-content-addressable-store/lib/addressing.js` — remove layout vocabulary
- `src/plugins/cloudflare-content-addressable-store/plugin.js` — register the generic store only
- `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/` — prune migrated cases

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `rg -n "BUNDLE|normalizePagePath|normalizeTemplatePath|getPage\b" src/plugins`
      returns no matches.
- [ ] `rg -n "HyperviewContentFacade" src` returns no matches.
- [ ] The plugin registers exactly one service, `ContentAddressableStore`, bound
      to `CloudflareContentStore`.
- [ ] No test coverage is lost: every deleted adapter case has a counterpart in
      `test/unit-tests/kixx/hyperview/`.
- [ ] The full unit suite passes.

**Validation**

- `node run-linter.js src/plugins/cloudflare-content-addressable-store test/unit-tests/plugins` — the reduced adapter is lint-clean.
- `node run-tests.js` — the complete unit suite passes after deletion.
- `rg -n "pages|templates|BUNDLE" src/plugins/cloudflare-content-addressable-store/lib` — only incidental prose in comments, no code vocabulary.
- `rg -n "validate-pathname" src/plugins/cloudflare-content-addressable-store` — returns no matches.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: This task is deletion only. If anything here cannot
  be deleted, a caller was missed in HCS-4 or HCS-5 — fix the caller rather than
  keeping the facade alive.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task HCS-7: Document the boundary and verify the complete migration

**Status:** Not started
**Depends on:** HCS-6
**Documentation:** This complete plan; `README.md` §"Linting" and §"Testing"; `src/plugins/README.md`; `src/app/transaction-scripts/README.md`; `src/app/presentation/README.md`; `src/docs/code-documentation-guide.md`

**Objective**

Maintainers and future agents can identify the content-service, renderer,
presentation, Transaction Script, port, and adapter boundaries without
rediscovering them from implementation details, and the complete migration is
verified as one integrated unit-test suite.

**Scope**

- In: durable Hyperview architecture documentation; updates to plugin,
  presentation, and Transaction Script guidance; stale source and test comments;
  full lint and unit-test verification.
- Out: user-facing publishing API documentation; end-to-end execution or repair;
  any behavior beyond HCS-1 through HCS-6.

**Design and invariants**

- Add `src/kixx/hyperview/README.md` documenting the two services, the content
  layout vocabulary, snapshot lifetime, the publication flow, the public service
  boundary, and port/adapter ownership. Link to the content-store interface and
  the existing template and presentation guides rather than duplicating them.
- Update `src/plugins/README.md`: the Hyperview content model is framework-owned,
  the plugin implements a generic content-addressable port, and the general
  Hyperview plugin has a two-service lifecycle. Record the Node platform gap
  identified in HCS-4 and what a Node adapter would have to implement.
- Update `src/app/transaction-scripts/README.md` to distinguish a real
  application workflow from a pass-through call to a framework service, and state
  that presentation code may call a framework service directly when that service
  already owns the complete operation and no application business policy is
  involved.
- Update presentation guidance where it names legacy write owners.
- State in the documentation that `test/end-to-end/020-publishing-api/` is
  obsolete against the current routes and is not a signal about this work.
  Correct stale comments only; do not run or repair those tests.
- Run the complete unit suite, because this rewires a general plugin used across
  the application.

**Expected touch points**

- `src/kixx/hyperview/README.md` — new architectural reference
- `src/plugins/README.md` — port ownership, plugin lifecycle, platform gap
- `src/app/transaction-scripts/README.md` — framework-service versus Transaction Script boundary
- `src/app/presentation/README.md` — Publishing API service usage
- `test/end-to-end/020-publishing-api/*.test.js` — comment-only corrections, plus an obsolescence note

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Documentation names one owner per responsibility and matches the
      implemented registration names, dependency graph, and public API.
- [ ] Documentation preserves the one-snapshot-per-render guarantee and keeps
      JSON:API and presentation policy out of the content service.
- [ ] Transaction Script guidance explains why the removed pass-through module is
      not replaced, while preserving scripts for future application policy.
- [ ] No stale comment attributes Hyperview content writes to `HyperviewService`,
      or application access to a platform store.
- [ ] All changed JavaScript is lint-clean and the complete unit suite passes
      without weakening or disabling tests.
- [ ] No end-to-end server or remote service is started for verification.

**Validation**

- `node run-linter.js` — all JavaScript selected by the lint configuration passes.
- `node run-tests.js` — the complete unit suite passes.
- `git diff --check` — changed files contain no whitespace errors.
- `rg -n "ContentAddressableStore" src/app src/kixx/hyperview/hyperview-service.js` — no application or renderer dependency remains.
- Manual review: every method in this plan's contract tables appears in JSDoc and
  focused unit coverage, and every task's progress and handoff section records
  actual files and commands.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: No Hyperview architecture README exists today.
  Adding one keeps the service split and its snapshot and publication invariants
  discoverable outside this plan, which is what stops the boundary from eroding
  again.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
