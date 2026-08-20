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

**Status:** Complete
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

- Completed: Both entry points now import the named `plugins` binding from
  their general and platform plugin-map modules. A new side-effect-free
  `mergePluginMaps()` helper replaces the inline `new Map([...a, ...b])` spread
  in both entry points, asserting both arguments are `Map` instances
  (`AssertionError` naming the offending parameter) before merging with
  platform-over-general override order. Regression coverage exercises merge,
  override, non-mutation of inputs, and both non-Map rejection cases.
- Current state: Complete. Acceptance criteria satisfied.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - Confirmed the described defect before fixing it:
    `node -e "import('./src/plugins/general.js').then((m) => console.log(Object.keys(m), m.default))"`
    printed `[ 'plugins' ] undefined`, matching the plan's diagnosis.
  - `src/plugins/README.md`'s own "Composition root" example already shows the
    correct named-import form (`import { plugins as nodePlugins } from
    './plugins/node.js';`), so this fix brings the entry points in line with
    already-documented intent rather than introducing a new convention.
  - Named the new test file `merge-plugin-maps.test.js` (mirroring the source
    filename `src/plugins/merge-plugin-maps.js`) rather than the plan's
    orientation name `plugin-maps.test.js`, per the unit testing guide's
    "mirror the source tree" convention. It is the first file under
    `test/unit-tests/plugins/*.test.js` (previously only nested plugin
    directories had tests).
  - `assert()` + `isMap()` from `kixx/assertions/mod.js` gives a clear
    `AssertionError` naming the bad parameter if a non-Map is ever passed,
    rather than letting a bad input fail later with an opaque
    "is not iterable" `TypeError` from the spread syntax.
  - Did not attempt to make the Node entry point fully bootable — no Node
    content-addressable-store adapter exists yet, per this plan's explicit
    deferral. `node --check` only proves the module parses/resolves, not that
    `node src/node-server.js` can start and initialize the general Hyperview
    plugin successfully.
- Actual files changed:
  - `src/node-server.js` — named `plugins` imports for `general.js`/`node.js`;
    use `mergePluginMaps()`.
  - `src/cloudflare-server.js` — named `plugins` imports for
    `general.js`/`cloudflare.js`; use `mergePluginMaps()`.
  - `src/plugins/merge-plugin-maps.js` — new side-effect-free merge helper.
  - `test/unit-tests/plugins/merge-plugin-maps.test.js` — new regression
    coverage.
- Validation run:
  - `node run-linter.js src/node-server.js src/cloudflare-server.js src/plugins test/unit-tests/plugins` — clean, no output, exit 0.
  - `node run-tests.js test/unit-tests/plugins` — 428 tests passed, 0 disabled.
  - `node --check src/node-server.js && node --check src/cloudflare-server.js` — both parse.
  - `node run-tests.js` (full suite, run as an extra sanity check beyond this
    task's required validation) — 910 tests passed, 0 disabled.
- Blockers: None.

---

### Task HCS-2: Define the generic content-addressable store port

**Status:** Complete
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

- Completed:
  - Added `src/kixx/content-store/content-addressable-store-interface.js`
    (JSDoc-only, no executable code) documenting
    `ContentAddressableStoreInterface` (`hashValue`, `openSnapshot`, `putBlob`,
    `commitChanges`) and `ContentIndexSnapshotInterface` (`rootHash`,
    `statPath`, `listStats`, `getBlob`, `getBlobs`, `computeHashFromStats`),
    with top-level invariants for blob immutability, snapshot pinning and
    request lifetime, digest opacity, caller-visible errors, context
    pass-through, and why pathname validation is deliberately absent.
  - Moved `canonicalize()`/`compareStrings()` to `src/kixx/utils/canonicalize.js`.
    `addressing.js` imports and re-exports both under a comment explaining why
    (deterministic serialization is needed on both sides of the publishing wire
    contract). Every internal `addressing.js` caller (`hashSet`, `hashEtag`,
    `hashTree`, `hashValue`) keeps working unchanged through the re-export.
  - `CloudflareContentStore`: added `@implements` for
    `ContentAddressableStoreInterface`; added a `hashValue(value)` method
    (delegates to `addressing.js`'s free function — the port requires it at
    store level even though the old facade called the free function directly);
    removed `computeHashFromStats()`; `commitClosure()` and `commitChanges()`
    now return `{ rootHash, nodeCount }` instead of the encoded index table
    (computed from the table before it goes out of scope, so the encoded table
    is never returned to any caller).
  - `ContentSnapshot`: added `@implements` for `ContentIndexSnapshotInterface`;
    added its own `computeHashFromStats(stats)` (the exact algorithm moved
    verbatim from the store, using `hashSet`/`compareStrings` imported directly
    from `addressing.js`); `getPage()` now calls `this.computeHashFromStats(...)`
    instead of `this.#store.computeHashFromStats(...)`. `ContentSnapshot` still
    holds `#store` for `getBlob`/`getBlobs`/etc. in this task — HCS-6 is where
    the semantic half of this class (including any store coupling that HCS-3
    relocates) gets pruned, not this task.
  - `content-addressable-store.js` facade: `commitChanges()` now destructures
    `{ rootHash, nodeCount }` from the store call and returns `{ hash: rootHash,
    count: nodeCount }` — its own public `{ hash, count }` return shape is
    unchanged. Removed the now-unused `getRootHash` import.
  - `plugin.js` (cloudflare-content-addressable-store): constructs one
    `CloudflareContentStore` and registers it under both `ContentAddressableStore`
    (final name) and, wrapped by the facade, `HyperviewContentFacade`
    (transitional name) — so reads/writes through either name observe the same
    blobs, index cache, and Durable Object binding.
  - Updated all consumers of the old `ContentAddressableStore` service name to
    `HyperviewContentFacade`.
  - Deleted the migrated `compareStrings()`/`canonicalize()` describe blocks
    from `addressing.test.js` (now covered by the new `canonicalize.test.js`,
    byte-identical assertions preserved); deleted the migrated
    `computeHashFromStats` describe block from `cloudflare-content-store.test.js`
    (now covered by a new describe block on `ContentSnapshot` in
    `content-snapshot.test.js`, same order-independence/hash-change cases);
    updated `commitClosure`/`commitChanges` tests in
    `cloudflare-content-store.test.js` for the new return shape; updated the
    `commitChanges` backing-store mock and three `page.etag` assertions in
    `content-snapshot.test.js` and one in `content-addressable-store.test.js`
    that depended on the deleted store-level `computeHashFromStats` mock (see
    discoveries below).
- Current state: Complete. Acceptance criteria satisfied; full unit suite and
  targeted lint both pass.
- Decisions and discoveries:
  - **Found a third consumer of the old service name that the plan did not
    list.** The plan's "two consumers" (`src/plugins/hyperview/plugin.js:36`
    and `src/app/transaction-scripts/publishing/mod.js`) missed
    `src/app/presentation/request-handlers/publishing-api/mod.js`, which calls
    `context.getService('ContentAddressableStore')` directly (twice, for
    `normalizePathname()`/`isValidPathname()` in `StatResource`/`PutResource`)
    rather than going through the transaction script. Left unrenamed, this
    handler would have silently broken at runtime the moment
    `'ContentAddressableStore'` started resolving to the generic store, which
    has neither method — directly contradicting this plan's own sequencing
    invariant ("the migration does not introduce a new runtime break"). Renamed
    both call sites to `'HyperviewContentFacade'` as well, with the same
    transitional-name comment used at the other two sites. No test file exists
    yet for this handler (`test/unit-tests/app/` is not created until HCS-5, per
    that task's own handoff note), so there was no test double to update.
  - **Test doubles that stubbed `computeHashFromStats()` on a mock *store* went
    silent once `ContentSnapshot` stopped delegating to the store for that
    operation.** Both `content-snapshot.test.js`'s `makeStore()` and
    `content-addressable-store.test.js`'s `makeBackingStore()` had a
    `computeHashFromStats()` mock returning a fixed, readable string (e.g.
    `'root-v1:template-v1:page-v1'`, `'computed-etag'`). After moving the real
    algorithm into `ContentSnapshot`, those mocks are simply never called, and
    `getPage()` computes a real base32 digest instead. Removed the dead mock
    methods and changed the four affected `page.etag` assertions from an exact
    literal to `assert(page.etag, '...')` — non-empty-string presence — with a
    comment pointing to the two dedicated `computeHashFromStats` tests (in
    `content-snapshot.test.js`) that own verifying the real algorithm
    (order-independence, changes when a hash changes). The surrounding
    `pageDataFiles`/`pageTemplateFilename`/pinning assertions in those tests
    were untouched and still carry the tests' primary intent.
  - `CloudflareContentStore` is already fully generic — confirmed again after
    the fact via `rg -n "pages|templates|BUNDLE" src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index-store.js`
    returns nothing — so this task defined a contract around behavior that
    already existed, plus the two return-shape corrections and the new
    `hashValue()` store method needed to make `CloudflareContentStore` actually
    satisfy every operation the port promises.
  - Kept `ContentSnapshot`'s constructor and `#store` field exactly as they
    were (still takes `{ store, context, index }`); this task only relocated
    the one method's algorithm and its one caller. HCS-3/HCS-6 are where the
    class's shape changes further.
- Actual files changed:
  - `src/kixx/content-store/content-addressable-store-interface.js` (new)
  - `src/kixx/utils/canonicalize.js` (new)
  - `src/plugins/cloudflare-content-addressable-store/lib/addressing.js`
  - `src/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.js`
  - `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js`
  - `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js`
  - `src/plugins/cloudflare-content-addressable-store/plugin.js`
  - `src/plugins/hyperview/plugin.js`
  - `src/app/transaction-scripts/publishing/mod.js`
  - `src/app/presentation/request-handlers/publishing-api/mod.js` (not listed
    in the plan's expected touch points — see discoveries above)
  - `test/unit-tests/kixx/utils/canonicalize.test.js` (new)
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/addressing.test.js`
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/cloudflare-content-store.test.js`
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js`
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.test.js`
- Validation run:
  - `node run-linter.js src/kixx/content-store src/kixx/utils src/plugins/cloudflare-content-addressable-store src/plugins/hyperview src/app/transaction-scripts/publishing src/app/presentation/request-handlers/publishing-api test/unit-tests/kixx/utils test/unit-tests/plugins/cloudflare-content-addressable-store` — clean, no output, exit 0 (widened slightly from the plan's listed command to also cover the third consumer discovered above; `test/unit-tests/app` does not exist yet so it is not part of this run).
  - `node run-tests.js test/unit-tests/plugins/cloudflare-content-addressable-store test/unit-tests/kixx/utils` — 251 tests passed, 0 disabled.
  - `node run-tests.js` (full suite) — 910 tests passed, 0 disabled.
  - Manual `rg` checks: no `pages|templates|BUNDLE` vocabulary in the new port
    file (only incidental prose saying it has none); exactly one `canonicalize`
    definition (`src/kixx/utils/canonicalize.js`); no `computeHashFromStats` on
    `CloudflareContentStore`; both services registered in `plugin.js`.
- Blockers: None.

---

### Task HCS-3: Build the Hyperview content layer

**Status:** Complete
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

- Completed:
  - `src/kixx/hyperview/content-layout.js`: layout vocabulary
    (`BASE_TEMPLATES_BUNDLE`, `TEMPLATE_PARTIALS_BUNDLE`, `PAGE_PARTIALS_BUNDLE`,
    `PAGE_INCLUDES_BUNDLE`, `RESERVED_PAGE_FILENAMES`), an independent
    `isValidPathname()`/`normalizePathname()` implementation (duplicated from,
    not imported from, the adapter's `addressing.js` — see design note below),
    the new `isValidTemplateFilepath()` (canonical AND non-root), and the six
    focused path constructors (`getBaseTemplatesPath`, `getTemplatePartialsPath`,
    `getPageMetadataPath`, `getPagePartialsPath`, `getPageIncludesPath`,
    `getPageTemplatePath`). Page-oriented constructors assert page-pathname
    validity internally; `getPageTemplatePath()` asserts template-filepath
    validity internally, so a caller cannot construct a `/pages` blob at the
    namespace root through this module.
  - `src/kixx/hyperview/hyperview-content-object.js`: `HyperviewContentStat` and
    `HyperviewContentObject`, relocated from the adapter's `content-object.js`,
    decoding with a local `TextDecoder` (a Web Platform global, not an adapter
    import) instead of `addressing.js`'s `bufferToString`.
  - `src/kixx/hyperview/hyperview-content-snapshot.js`: `HyperviewContentSnapshot`
    wraps one `ContentIndexSnapshotInterface` (a plain object, e.g. from
    `CloudflareContentStore#openSnapshot()`), holds no store reference, and
    owns the six stat/get pairs plus `getPage()`, all relocated from the
    adapter's `ContentSnapshot`. `getPage()`'s page-directory-prefix need (for
    listing a leaf directory's immediate children) is met with a private
    `getPageDirectoryPath()` helper that derives the directory from
    `getPageMetadataPath()` by stripping `/page.json`, rather than adding a
    seventh, unfocused path constructor to `content-layout.js`.
  - `src/kixx/hyperview/hyperview-content-service.js`: `HyperviewContentService`
    implementing the full public contract table — `initialize()`,
    `normalizePathname()`/`isValidPathname()`/`isValidTemplateFilepath()` (sync,
    delegate to `content-layout.js`), `hashValue()` (async, delegates to the
    injected store), `openSnapshot()`, six one-off `stat*` reads (each opens
    exactly one snapshot), six `put*` writes (each takes one args object,
    returns `{hash, size, metadata}`), and `commitChanges()`. Manifest
    validation/translation (`#buildManifestFiles`, `#checkBlobDescriptor`,
    `#checkOnePageTemplatePerDirectory`, `#filepathDirname`) is relocated from
    the adapter's facade with the same error classification and every original
    rejection case preserved, plus the new root-template-filepath fix (see
    below).
  - **The root-template-filepath fix**: `checkArray()` (the manifest
    entry-validator closure inside `#buildManifestFiles`) now takes an explicit
    `pathnameValidator` + `pathDescription` pair instead of hardcoding
    `isValidPathname`. `pageMetadata`/`pagePartials`/`pageIncludes` still use
    `isValidPathname` with the original message text `"... must be a valid
    pathname"`. `pageTemplates` now uses `isValidTemplateFilepath` with a new
    message `"... must be a valid, non-root template filepath"`. A
    `pageTemplates` entry with `filename: '/'` is now rejected at this
    validity check — before `toInternalPathname()` (now `getPageTemplatePath()`,
    which itself asserts) is ever reached — so it is impossible for a root
    manifest entry to become a `/pages` blob descriptor.
  - Test coverage, migrated and extended rather than rewritten from scratch,
    all under `test/unit-tests/kixx/hyperview/`: `content-layout.test.js` (34
    tests: every constructor, both pathname rules including empty-string/root/
    mixed-case), `hyperview-content-snapshot.test.js` (17 tests, migrated from
    the adapter's `content-snapshot.test.js`), `hyperview-content-service.test.js`
    (38 tests, migrated from the adapter's `content-addressable-store.test.js`,
    plus new cases for the root-template-filepath rejection and the
    omitted/explicit/explicit-null build ID contract).
- Current state: Complete. Acceptance criteria satisfied; targeted lint and
  test runs pass, and the full unit suite passes with the new layer present
  but unwired (confirmed by `rg` — no file outside `src/kixx/hyperview/` and
  its own tests imports any of the three new modules; only explanatory
  comments in the HCS-2 transitional-name sites mention the future move).
- Decisions and discoveries:
  - **The migrated test doubles deliberately do not depend on the adapter's
    real index/hashing machinery.** The original `content-snapshot.test.js`
    and `content-addressable-store.test.js` built real
    `ContentAddressableIndex` instances and used `addressing.js`'s real
    `hashBlob`/`canonicalize` to produce test fixtures. `HyperviewContentSnapshot`
    and `HyperviewContentService` are consumers of the generic
    `ContentAddressableStoreInterface`/`ContentIndexSnapshotInterface` port, not
    of the Cloudflare adapter, so their tests mock the port directly with
    self-contained, deterministic fakes (a flat pathname→stat map with a
    simple prefix-listing implementation; a content-derived fake hash instead
    of the real SHA-256/base32 digest). This is also what makes `rg -n
    "from '.*plugins/" src/kixx/hyperview` return nothing even under the test
    tree's sibling location — the test files themselves also import nothing
    from `src/plugins/`, though that specific `rg` command only targets
    `src/kixx/hyperview` per the plan.
  - Roughly 750 lines of behavior moved here as anticipated, and the test
    migration was indeed the bulk of the work — cases were adapted (new mock
    shapes, new argument-object call signatures, three `page.etag` literal
    assertions loosened to presence checks because the real digest algorithm
    is no longer reachable through these mocks — see HCS-2's handoff for the
    parallel discovery on the adapter side) rather than re-derived from
    scratch, so no manifest or page-assembly edge case was lost.
  - `HyperviewContentSnapshot#getPage()` and `HyperviewContentService`'s
    manifest validator both needed a "page directory" pathname that
    `content-layout.js` deliberately does not expose as a public constructor.
    Both solved it the same way: derive it privately from
    `getPageMetadataPath()` (`getPage()`'s `getPageDirectoryPath()`) or reuse
    plain `normalizePathname()` for basename extraction (the manifest
    validator's reserved-filename check) — rather than adding a seventh,
    unfocused constructor that would let other callers assemble arbitrary
    `/pages` paths.
- Actual files changed:
  - `src/kixx/hyperview/content-layout.js` (new)
  - `src/kixx/hyperview/hyperview-content-object.js` (new)
  - `src/kixx/hyperview/hyperview-content-snapshot.js` (new)
  - `src/kixx/hyperview/hyperview-content-service.js` (new)
  - `test/unit-tests/kixx/hyperview/content-layout.test.js` (new)
  - `test/unit-tests/kixx/hyperview/hyperview-content-snapshot.test.js` (new)
  - `test/unit-tests/kixx/hyperview/hyperview-content-service.test.js` (new)
- Validation run:
  - `node run-linter.js src/kixx/hyperview test/unit-tests/kixx/hyperview` — clean (one pre-existing `no-warning-comments` warning in `hyperview-request-handlers.js`, unrelated to this task's files).
  - `node run-tests.js test/unit-tests/kixx test/unit-tests/plugins` — 998 tests passed, 0 disabled.
  - `node run-tests.js` (full suite) — 999 tests passed, 0 disabled.
  - `rg -n "from '.*plugins/" src/kixx/hyperview` — no matches.
  - `rg -n "^import.*validate-pathname" src/kixx/hyperview` — no matches (one prose mention of the filename in a comment explaining why it is *not* imported).
  - `rg -n "hyperview-content-service|hyperview-content-snapshot|content-layout\.js|HyperviewContentService" src/plugins src/app src/routes` — only explanatory comments from HCS-2's transitional renames, no actual import or wiring.
- Blockers: None.

---

### Task HCS-4: Make rendering consume Hyperview content snapshots

**Status:** Complete
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

- Completed:
  - `HyperviewService`: renamed the private `#store` field to
    `#contentService`; `initialize({ contentService, kvStore })` replaces
    `initialize({ contentAddressableStore, kvStore })`, asserting
    `contentService` with a message naming it; every internal call site
    (`assertCanonicalIdentifier`, `isValidPathname`, `normalizePathname`,
    `openSnapshot`, `hashValue` in cache-key computation) now reads
    `this.#contentService` instead of `this.#store`. No call-site logic
    changed — only what object those calls are made on, since
    `HyperviewContentService` and `HyperviewContentSnapshot` (built in HCS-3)
    already expose the identical method names and signatures the old raw
    store did. JSDoc `@param`/`@returns` types updated to reference
    `./hyperview-content-service.js` and `./hyperview-content-snapshot.js`
    instead of the retired `ContentAddressableStore`/`ContentSnapshot` names.
  - `src/plugins/hyperview/plugin.js`: `register()` now also constructs and
    registers `HyperviewContentService` under the service name
    `HyperviewContent`, alongside the existing `Hyperview` registration.
    `initialize()` resolves `ContentAddressableStore` (the generic store, per
    HCS-2), initializes `HyperviewContent` with it as `contentStore`, then
    resolves `KeyValueStore` and initializes `Hyperview` with `{ kvStore,
    contentService: hyperviewContent }` — in that order, so the content
    service is fully initialized before the object reference reaches
    `HyperviewService#initialize()`. Removed the transitional
    `HyperviewContentFacade` lookup and its explanatory comment; added a
    module-level comment recording the Node platform gap (no
    `ContentAddressableStore` registration in `src/plugins/node.js` yet) and
    naming the port (`src/kixx/content-store/content-addressable-store-interface.js`)
    a future Node adapter must implement.
  - Test doubles in `hyperview-service.test.js` adapted from the raw-store
    shape to the content-service shape: every `contentAddressableStore` key in
    an `initialize({...})` call became `contentService`; the helper
    `makeContentStore()` was renamed `makeContentService()` (same
    implementation — it already returned an object shaped like
    `HyperviewContentService`: pass-through methods plus an `openSnapshot()`
    that returns a snapshot-shaped object exposing the seven read methods).
    The "requires both stores" initialization test was renamed to "requires
    both dependencies" and its missing-dependency variable/assertion updated
    to check for `'contentService'` instead of `'contentAddressableStore'` in
    the `AssertionError` message. No behavioral assertion in this 2670-line
    file was rewritten around implementation calls — every change was a
    rename of the dependency key/variable/message text the tests already
    exercised.
  - New `test/unit-tests/plugins/hyperview/plugin.test.js` (first file under
    `test/unit-tests/plugins/hyperview/`, and the first `plugin.js` lifecycle
    test in the repository — no precedent existed to follow, so this task set
    one): constructs a real `ApplicationContext` (not a mock) with a fake
    logger, calls the plugin's exported `register()`/`initialize()` directly,
    and asserts (a) `register()` puts a `HyperviewContentService` instance at
    `HyperviewContent` and a `HyperviewService` instance at `Hyperview`; (b)
    `initialize()` wires `HyperviewContent` to whatever is registered as
    `ContentAddressableStore` (proved by a fake store's `hashValue()` spy
    reachable through `hyperviewContent.hashValue()`); (c) `initialize()`
    wires `Hyperview` to the *same* `HyperviewContent` instance `register()`
    created (proved by monkey-patching a spy onto
    `hyperviewContent.isValidPathname` after `register()` but before
    `initialize()`, then observing the spy fire through
    `hyperviewService.isValidPathname()` — object-identity proof that
    survives regardless of exact call order, since JS holds objects by
    reference); (d) `initialize()` fails with a clear `AssertionError` naming
    the missing service when `ContentAddressableStore` or `KeyValueStore` is
    not registered.
- Current state: Complete. All acceptance criteria satisfied; targeted lint
  and test runs pass, and the full unit suite passes.
- Decisions and discoveries:
  - `HyperviewService` already threads a snapshot through rendering, so this
    task changed who supplies the snapshot (`HyperviewContentService` instead
    of the adapter facade), not the render algorithm. Confirmed by grep that
    the renderer still calls exactly the seven documented snapshot operations
    (`statTemplatePartials`, `getTemplatePartials`, `statBaseTemplates`,
    `getBaseTemplates`, `statPageTemplate`, `getPageTemplate`, `getPage`) and
    no others.
  - The rename was mechanically safe specifically because HCS-3 already built
    `HyperviewContentService`/`HyperviewContentSnapshot` to match the raw
    store's method names and signatures (`isValidPathname`,
    `normalizePathname`, `hashValue`, `openSnapshot`, and the snapshot's
    seven read methods) — there was no shape to adapt, only a dependency name
    and its call sites to rename. This is also why the 2670-line test file
    needed only a mechanical key rename (`contentAddressableStore` →
    `contentService`, plus one assertion-message string) rather than new
    mock shapes.
  - Registering `HyperviewContent` first and `Hyperview` second in
    `register()`, and initializing `HyperviewContent` before `Hyperview` in
    `initialize()`, matches this plan's §"Sequencing"/design note ("registers
    `HyperviewContent` and `Hyperview` during `register()` ... resolve
    `ContentAddressableStore` ... initialize `HyperviewContent` with it as
    `contentStore`, then initialize `Hyperview`"). Both entries in each
    registry are plain sequential statements, so there is no dependency-order
    ambiguity for a later plugin registry change to reintroduce.
  - Left `src/plugins/cloudflare-content-addressable-store/plugin.js`'s
    `HyperviewContentFacade` registration untouched: publishing
    (`src/app/transaction-scripts/publishing/mod.js` and
    `src/app/presentation/request-handlers/publishing-api/mod.js`) still
    consumes it and is not migrated until HCS-5. Confirmed via `rg -n
    "HyperviewContentFacade" src` that only the adapter's registration and
    those two publishing files reference it now that `plugin.js` no longer
    does.
  - Did not touch `src/plugins/README.md`'s "General Plugins" section, which
    still describes Hyperview as reading "through the two Hyperview store
    ports" — that phrasing is now stale (there is one port,
    `ContentAddressableStoreInterface`, consumed by `HyperviewContentService`,
    not two Hyperview-specific ports), but updating plugin documentation is
    HCS-7's explicit scope, not this task's.
- Actual files changed:
  - `src/kixx/hyperview/hyperview-service.js`
  - `src/plugins/hyperview/plugin.js`
  - `test/unit-tests/kixx/hyperview/hyperview-service.test.js`
  - `test/unit-tests/plugins/hyperview/plugin.test.js` (new)
- Validation run:
  - `node run-linter.js src/kixx/hyperview src/plugins/hyperview test/unit-tests/kixx/hyperview test/unit-tests/plugins/hyperview` — clean except one pre-existing, unrelated `no-warning-comments` warning in `hyperview-request-handlers.js` (a `TODO` comment predating this task).
  - `node run-tests.js test/unit-tests/kixx/hyperview test/unit-tests/plugins/hyperview` — 153 tests passed, 0 disabled (148 renderer + 5 new plugin-lifecycle tests).
  - `node run-tests.js` (full suite) — 1004 tests passed, 0 disabled (up from 999 before this task).
  - `node --check src/kixx/hyperview/hyperview-service.js && node --check src/plugins/hyperview/plugin.js` — both parse.
  - `git diff --check` — no whitespace errors.
  - `rg -n "ContentAddressableStore" src/kixx/hyperview/hyperview-service.js` — no matches (renderer names no store type).
- Blockers: None.

---

### Task HCS-5: Route publishing through HyperviewContentService

**Status:** Complete
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

- Completed:
  - Rewrote `src/app/presentation/request-handlers/publishing-api/mod.js`
    around a single module-private, `Object.freeze()`-protected
    `RESOURCE_CATALOG`, keyed by the six canonical identifiers
    (`template_partials`, `base_templates`, `page_metadata`, `page_partials`,
    `page_includes`, `page_templates`). Each entry carries `pathKind`
    (`'none'` | `'page-path'` | `'template-filepath'`), `bodyFormat` (`'json'`
    | `'text'`), and explicit `stat`/`put` functions that call the matching
    `HyperviewContentService` method with the right argument shape (`{
    bundle, etag }` for the two bundle resources, `{ pathname, metadata,
    etag }` for page metadata, `{ pathname, bundle, etag }` for page
    partials/includes, `{ filepath, source, etag }` for page templates).
    Replaced `CHECK_PATHNAME_TYPES`/`TEXT_PAYLOAD_TYPES` and both `switch`
    statements entirely — no trace of either remains.
  - Added `getCatalogEntry(type)`, which `assert()`s the entry exists (an
    unregistered type is a route-configuration bug, so `StatResource({type})`
    /`PutResource({type})` — called once per route at module-load time —
    throw `AssertionError` immediately rather than deferring to the first
    request), and `resolvePathname(contentService, entry, type, handlerName,
    request)`, the one function implementing all three `pathKind` branches:
    `'none'` returns `undefined` with no wildcard read at all; `'page-path'`
    keeps the pre-existing `segments.length === 1 && segments[0] === '' →
    '/'` fold and validates with `contentService.isValidPathname()`;
    `'template-filepath'` never folds to root and validates with
    `contentService.isValidTemplateFilepath()` instead — so a
    `/page-templates/` request (segments `['']`) normalizes to `'/'` and is
    then rejected by the filepath rule (which requires non-root), never
    reaching `putPageTemplate()`. Both `StatResource` and `PutResource` now
    resolve `context.getService('HyperviewContent')` per request and call
    `entry.stat`/`entry.put` — no direct call to any storage-layer method
    remains in this file.
  - `CommitChanges()`: replaced the Transaction Script call with
    `context.getService('HyperviewContent').commitChanges(context, {
    buildId, manifest })`. The omitted-build fallback (`isUndefined(buildId)
    ? context.runtime.build.id : buildId`) already lives inside
    `HyperviewContentService#commitChanges()` (built in HCS-3), so the
    handler now simply forwards whatever `buildId` the JSON:API payload
    contained, including `undefined` — it does not duplicate the fallback
    logic itself. Manifest field mapping (`templatePartials`, `baseTemplates`,
    `pageMetadata`, `pagePartials`, `pageIncludes`, `pageTemplates`) and the
    `{ hash, count }` → `{ hash, nodeCount }` response shape are unchanged.
  - `src/routes/publishing-api-v1.js` needed no changes: both the stat and
    put routes already configured `type: 'page_templates'` (plural) at what
    is now lines 102 and 190 — the drift described in this plan's design
    section was entirely on the handler/Transaction-Script side (which
    recognized only singular `page_template`), confirmed fixed by grep (see
    discoveries).
  - Deleted `src/app/transaction-scripts/publishing/mod.js` and the
    now-empty `src/app/transaction-scripts/publishing/` directory. No test
    file existed for it (confirmed before deleting) and no remaining source
    file imports it (confirmed by `rg` after deleting).
  - New `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js`
    — the first file under `test/unit-tests/app/`, so this task created that
    directory tree. 17 tests: all six `StatResource` catalog entries invoke
    their matching explicit method; the `page_templates` root-path rejection
    (`path: ['']`, simulating `/page-templates/`) is rejected as
    `BadRequestError`/`InvalidPagePath` without calling the service; the
    complementary `page_metadata` root acceptance (`path: ['']` folds to
    `'/'`) proves the two `pathKind` branches are genuinely different, not a
    shared one relaxed for both; a `path: {}` case (no `path` key at all,
    simulating the bare `/page-metadata` spelling with no trailing slash)
    is rejected as `BadRequestError`/`PagePathRequired`, recording — not
    assuming — which of the two spellings is the valid "root" one, per this
    task's own validation note; an invalid page path (`['..','secret']`) is
    rejected as `InvalidPagePath` without calling the service; a `null` stat
    result becomes `NotFoundError` naming the pathname; `PutResource` cases
    cover a JSON payload (`page_metadata`) and a text payload
    (`page_templates`), asserting the exact argument object forwarded to the
    service, plus the same root-rejection and no-path-validation-for-bundle-
    resources cases; `CommitChanges` cases cover full manifest field mapping
    plus response shape, and the omitted-`buildId` forwarding case
    specifically asserting `args.buildId` is `undefined` (not resolved by
    the handler) when the JSON:API payload omits it. The fake
    `HyperviewContent` service double reuses the *real*
    `normalizePathname`/`isValidPathname`/`isValidTemplateFilepath` from
    `src/kixx/hyperview/content-layout.js` (imported directly, not
    reimplemented) so path-validation assertions exercise the actual
    production rule, not a loose stand-in; its six stat/six put/commitChanges
    methods are generated from one list into a `calls` array of `[methodName,
    ...args]` tuples per call, configurable per test via a `results` map, to
    avoid dozens of hand-written mock methods.
- Current state: Complete. All acceptance criteria satisfied; targeted lint
  and test runs pass, and the full unit suite passes.
- Decisions and discoveries:
  - **Fixed a pre-existing bug while rewriting the line it lived on**:
    `CommitChanges()` called `parseJsonApiResource(request, 'ContentTree')`
    without `await`, even though that function is `async` (it awaits
    `request.json()` internally) and every other caller in the codebase
    (`create-publishing-api-token.js`, `run-migration.js`, `accept-invite.js`)
    correctly awaits it. Unawaited, `{ attributes }` destructures off a
    pending `Promise`, so `attributes` would always be `undefined` and every
    real `CommitChanges` request would throw — this endpoint could not have
    worked in production. Confirmed via `rg -n "parseJsonApiResource" src`
    that every other call site awaits it before fixing this one. Added the
    missing `await`. This is a one-token fix on a line this task was already
    rewriting to change its data source, not a scope expansion — leaving a
    known request-breaking bug in freshly-touched code would have been
    irresponsible, and the plan's own validation for this task explicitly
    covers "Commit requests preserve JSON:API parsing... and response shape,"
    which a still-broken `parseJsonApiResource` call would have silently
    failed to satisfy.
  - Confirmed the `page_templates`/`page_template` drift this task's design
    section describes was already isolated to the handler and Transaction
    Script: `rg -n "page_template\b" src` before this task's edit showed
    only the two `case 'page_template':` lines inside the now-deleted
    `transaction-scripts/publishing/mod.js`; the route file already used
    plural `page_templates` throughout. The new catalog uses `page_templates`
    exclusively, so the route/catalog identifier now matches on both ends of
    every request.
  - No handler-level test precedent existed anywhere in the repository
    (`find test -path "*request-handlers*" -name "*.test.js"` found only an
    unrelated static-file-server suite under `test/unit-tests/kixx/`), so
    this task set the pattern for `test/unit-tests/app/`: a plain fake
    `context` object with a `getService()` stub (not a real
    `ApplicationContext`, since these tests exercise handler dispatch, not
    service-registry wiring — that is HCS-4's `plugin.test.js`), a plain fake
    `request`, and a real `ServerResponse` instance from
    `src/kixx/http-router/server-response.js` so `response.status`/
    `response.body` reflect the exact production serialization — mirroring
    the one existing precedent for framework-level request-handler tests
    (`static-file-server-request-handlers.test.js`).
  - Left `src/app/presentation/README.md`'s Publishing API guidance and
    `src/app/transaction-scripts/README.md`'s framework-service-versus-
    Transaction-Script boundary description untouched; both are HCS-7's
    explicit scope, not this task's.
- Actual files changed:
  - `src/app/presentation/request-handlers/publishing-api/mod.js`
  - `src/app/transaction-scripts/publishing/mod.js` (deleted, directory removed)
  - `test/unit-tests/app/presentation/request-handlers/publishing-api/mod.test.js` (new)
- Validation run:
  - `node run-linter.js src/app/presentation/request-handlers/publishing-api src/routes/publishing-api-v1.js test/unit-tests/app` — clean, no output, exit 0.
  - `node run-tests.js test/unit-tests/app test/unit-tests/kixx/hyperview` — 165 tests passed, 0 disabled.
  - `node run-tests.js` (full suite) — 1021 tests passed, 0 disabled (up from 1004 after HCS-4).
  - `rg -n "ContentAddressableStore|HyperviewContentFacade" src/app` — no matches.
  - `rg -n "ContentAddressableStore|HyperviewContentFacade|transaction-scripts/publishing" src/app src/routes` — only unrelated `transaction-scripts/publishing-api-tokens/*` matches (a different, still-live directory for API-token management, matched only because the substring `publishing` overlaps); no match against the deleted content-publishing script.
  - `git diff --check` — no whitespace errors.
- Blockers: None.

---

### Task HCS-6: Retire the adapter's Hyperview facade

**Status:** Complete
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

- Completed:
  - Deleted `content-addressable-store.js` (the facade) and `content-object.js`
    (the relocated-to-Hyperview `ContentObject`/`StatObject` pair). Confirmed
    before deleting that nothing outside those two files imported
    `content-object.js`, and that `content-addressable-store.js`'s only
    remaining importer was `plugin.js`'s `HyperviewContentFacade`
    registration.
  - Reduced `ContentSnapshot` (`lib/content-snapshot.js`) to exactly
    `rootHash`, `statPath()`, `listStats()`, `getBlob()`, `getBlobs()`, and
    `computeHashFromStats()`. Removed `getPage()`, the six semantic stat/get
    pairs (`statTemplatePartials`/`getTemplatePartials`/`statBaseTemplates`/
    `getBaseTemplates`/`statPageTemplate`/`getPageTemplate`,
    `statPageMetadata`/`statPagePartials`/`statPageIncludes`), the private
    `#getPath()` (directory-check + unreadable-blob assertion +
    `ContentObject` construction), the private `#statPath()` (`StatObject`
    wrapping), and `#assertPagePath()`. Dropped the now-unused imports
    (`AssertionError`, `assert`, the four bundle constants,
    `normalizePagePath`/`normalizeTemplatePath`, `ContentObject`/`StatObject`)
    — the file now imports only `isUndefined`, `compareStrings`, and
    `hashSet`.
  - `addressing.js`: removed `BASE_TEMPLATES_BUNDLE`, `TEMPLATE_PARTIALS_BUNDLE`,
    `PAGE_PARTIALS_BUNDLE`, `PAGE_INCLUDES_BUNDLE`, `normalizeTemplatePath()`,
    and `normalizePagePath()`. Kept `FORMAT`, `KEY`, the byte helpers
    (`stringToUint8Array`/`bufferToString`/`typedArrayToBuffer`), all four
    digest functions, and the defensive `isValidPathname()`/
    `normalizePathname()` pair — unchanged in behavior, but now preceded by a
    comment explicitly recording that this is a deliberate duplicate of
    Hyperview's canonical pathname rule (not a shared source of Hyperview
    semantics), that it guards only this store's own key space, and that it
    must not import `content-layout.js` or the deprecated
    `validate-pathname.js`. Rewrote the module's top docblock, which
    previously claimed this module "defines the logical pathname namespace
    its callers address content by" — no longer true — to describe it as
    owning deterministic serialization/hashing/encoding plus a defensive
    pathname check only, with content-layout ownership pointed at
    `src/kixx/hyperview/content-layout.js`.
  - `plugin.js`: removed the `ContentAddressableStore` (facade class) import
    and the `HyperviewContentFacade` registration line. `register()` now
    registers exactly one service, `ContentAddressableStore`, bound to
    `CloudflareContentStore`. Replaced the stale "transitional name" comment
    (which described the now-deleted two-service registration) with one
    stating the plugin's public surface is a generic content-addressable
    store and pointing Hyperview vocabulary at `src/kixx/hyperview/`.
  - Test pruning in
    `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/`:
    deleted `content-addressable-store.test.js` outright (all of its coverage
    was already migrated to `hyperview-content-service.test.js` in HCS-3, per
    that task's handoff note: "38 tests, migrated from
    content-addressable-store.test.js"). In `content-snapshot.test.js`,
    deleted eight `getPage()`/semantic-`getPath()` cases whose direct
    counterparts already exist in
    `test/unit-tests/kixx/hyperview/hyperview-content-snapshot.test.js`
    (confirmed by name/behavior match: "throws when a pathname resolves to a
    directory," "throws when an indexed blob is unreadable," "returns
    content carrying the same etag the matching stat method reports,"
    "throws an AssertionError for an invalid page pathname" (both the
    stat-method and `getPage()` variants), "returns null when the leaf page
    has no committed metadata," "returns null when an indexed pathname is
    absent," and the two `getPage()` pinned-index/blob-read cases — all
    present in the Hyperview suite). Kept the `computeHashFromStats`
    describe block verbatim (still exactly the generic algorithm this
    reduced class owns) and the "continues to read its original index after
    a build reassignment" test, **rewritten** rather than deleted: it
    previously demonstrated pinning through the semantic
    `getTemplatePartials()`, which no longer exists on this class, but the
    pinning guarantee it demonstrates — a `ContentSnapshot` instance keeps
    resolving through the index it was constructed with even after a new
    snapshot observes a reassigned build — is a property of the *generic*
    `statPath()`/`getBlob()` pair too, not something `getPage()` added. The
    plan says "do not delete cases covering generic storage, indexing, or
    digests"; deleting this one outright would have quietly dropped that
    generic pinning coverage instead of relocating it, so it was rewritten
    to exercise `statPath()`+`getBlob()` against a generic (non-Hyperview)
    pathname/blob pair, using `addressing.js`'s `bufferToString()` to decode
    the returned bytes for comparison (a `Uint8Array`'s own `.toString()`
    gives comma-joined byte values, not the decoded text, which would have
    made the original naive rewrite pass for the wrong reason).
    `addressing.test.js` and `cloudflare-content-store.test.js` needed no
    changes — confirmed by grep that neither referenced any of the removed
    vocabulary before this task touched them.
- Current state: Complete. All acceptance criteria satisfied; targeted lint
  and test runs pass, and the full unit suite passes.
- Decisions and discoveries:
  - This task was deletion-and-reduction only, as its own design note
    anticipated, and nothing needed a caller fix — every consumer of the
    facade had already moved off it in HCS-4 (`HyperviewService`) and HCS-5
    (publishing). `rg -n "HyperviewContentFacade" src` returned no matches
    immediately, confirming the facade was already orphaned before this
    task's edits began.
  - The one place this task deviated from pure deletion was the pinning test
    in `content-snapshot.test.js`, per the reasoning above: rewriting one
    generic-behavior test is not the same as losing coverage, and the plan's
    own instruction ("do not delete cases covering generic storage,
    indexing, or digests") is what this rewrite honors.
- Actual files changed:
  - `src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js` (deleted)
  - `src/plugins/cloudflare-content-addressable-store/lib/content-object.js` (deleted)
  - `src/plugins/cloudflare-content-addressable-store/lib/content-snapshot.js`
  - `src/plugins/cloudflare-content-addressable-store/lib/addressing.js`
  - `src/plugins/cloudflare-content-addressable-store/plugin.js`
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.test.js` (deleted)
  - `test/unit-tests/plugins/cloudflare-content-addressable-store/lib/content-snapshot.test.js`
- Validation run:
  - `node run-linter.js src/plugins/cloudflare-content-addressable-store test/unit-tests/plugins` — clean, no output, exit 0.
  - `node run-tests.js` (full suite) — 983 tests passed, 0 disabled (down from 1021 after HCS-5, reflecting deleted/migrated coverage, not a regression — every deletion was traced to a counterpart already present in `test/unit-tests/kixx/hyperview/`).
  - `rg -n "BUNDLE|normalizePagePath|normalizeTemplatePath|getPage\b" src/plugins` — no matches.
  - `rg -n "HyperviewContentFacade" src` — no matches.
  - `rg -n "pages|templates|BUNDLE" src/plugins/cloudflare-content-addressable-store/lib` — only the two incidental prose lines in `addressing.js`'s module docblock explaining what this module does *not* own; no code vocabulary.
  - `rg -n "validate-pathname" src/plugins/cloudflare-content-addressable-store` — no matches.
  - `git diff --check` — no whitespace errors.
- Blockers: None.

---

### Task HCS-7: Document the boundary and verify the complete migration

**Status:** Complete
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

- Completed:
  - New `src/kixx/hyperview/README.md`: the architectural reference this task's
    design section called for. Documents the two-service split
    (`HyperviewContentService` registered as `HyperviewContent`,
    `HyperviewService` registered as `Hyperview`) and their dependency
    direction; the content layout vocabulary in `content-layout.js`,
    including why `isValidPathname()` and `isValidTemplateFilepath()` are two
    different rules rather than one relaxed for both; the one-snapshot-per-
    render guarantee (`HyperviewContentSnapshot` holds no store reference, one
    `HyperviewService#respondWithHypertext()` call opens exactly one
    snapshot) and the narrower per-call snapshot used by the six one-off
    `stat*` reads; the two-phase upload/commit publication flow, including the
    manifest's rejection rules and the omitted-build-id default; the public
    service boundary (no JSON:API resource-type string or platform type
    crosses it); and port/adapter ownership, ending on the Node platform gap.
    Cross-links to `src/app/presentation/README.md`, `src/templates/README.md`,
    `src/plugins/README.md`, `src/kixx/utils/validate-pathname.js`, and the
    content-store interface rather than duplicating their content — every
    linked heading and file path was verified to exist before publishing (see
    discoveries).
  - `src/plugins/README.md`: rewrote the "General Plugins" section's
    Hyperview paragraph, which previously said the `Hyperview` service
    "reads through the two Hyperview store ports" — no longer accurate, since
    the surviving port (`ContentAddressableStoreInterface`) is explicitly
    generic, not Hyperview vocabulary, which is the entire premise of this
    plan. The rewritten section names both registered services, states the
    fixed `register()`/`initialize()` wiring order (content service
    initialized, then handed to the renderer), and documents the Node
    platform gap identified in HCS-4 — which port a Node adapter would need
    to implement and which service name to register it under — with a
    forward reference to the existing "Adding a New Port" checklist for the
    adapter-authoring steps.
  - `src/app/transaction-scripts/README.md`: added a new "When Not to Write a
    Transaction Script" section, placed right after the file's opening
    description of what a Transaction Script is (before "File and Naming
    Conventions"). States the test for when presentation code may call a
    framework service directly instead — the service already owns the
    complete operation (validation, storage, error semantics) and no
    application business policy sits between the request and the call — and
    names the Publishing API's direct `HyperviewContentService` calls as the
    concrete example, including why the old pass-through
    `app/transaction-scripts/publishing/mod.js` (deleted in HCS-5) was not
    replaced with an equivalent rather than updated. Explicitly notes this
    exception is narrow and most application writes still belong in a
    Transaction Script, so the guidance does not read as license to bypass
    the pattern generally.
  - `src/app/presentation/README.md`: reviewed but left unchanged. Grepped
    for `ContentAddressableStore`, `HyperviewContentFacade`,
    `putPageMetadata`/`putBaseTemplates`/`putTemplatePartials`/
    `commitChanges`, and `Publishing API` — no matches. This README never
    documented the Publishing API's write path or named a platform store, so
    it had no "legacy write owner" to correct; its existing "Hyperview File
    Layout" and "Page Context Data" sections describe only the dev-authored
    static-file read path, which this migration does not touch.
  - `test/end-to-end/020-publishing-api/*.test.js` (all 12 files): prepended
    an identical obsolescence comment block to each file, before its first
    `import`, stating the suite targets stale URL paths (verified per-file:
    `/publishing-api/v1/templates/**` for the template/partial suites,
    `/publishing-api/v1/assets/**` for the static-asset suite — the initial
    draft of this comment incorrectly generalized the asset suite's path as
    `/publishing-api/v1/static-assets/**`, caught and corrected before
    finalizing, see discoveries) against the current
    `/publishing-api/v1/resources/**`/`/publishing-api/v1/index/**` routes,
    that this predates and is unrelated to this plan, and that passing or
    failing here is not a signal about it. No other stale comment existed in
    these files to correct — they operate entirely at the HTTP level and
    never named an internal service, so there was nothing beyond the route
    paths themselves (the test bodies, left untouched per this task's scope)
    that was factually wrong.
  - `test/end-to-end/README.md`: added a "Known obsolete suite:
    `020-publishing-api/`" section stating the same obsolescence fact once,
    at the suite level, with pointers to the current routes file and to
    `src/kixx/hyperview/README.md#publication-flow` and the current
    publishing request-handler module for the real, currently-tested
    behavior.
  - `AGENTS.md`: added a "Hyperview Content Model and Rendering" entry to the
    Developer Documentation index, pointing at the new
    `src/kixx/hyperview/README.md`, placed between "Transaction Scripts" and
    "Presentation Layer Guide" to match its position in the dependency
    layering (presentation depends on Hyperview rendering; Hyperview
    rendering depends on nothing above it). This file is not in this task's
    listed "Expected touch points," but AGENTS.md's own instruction ("Before
    starting any task, including planning, ALWAYS review this documentation
    index") makes an architecturally-significant new README invisible to
    future agents unless it is indexed here — leaving it unindexed would have
    directly undermined this task's own objective ("Maintainers and future
    agents can identify the content-service, renderer, presentation,
    Transaction Script, port, and adapter boundaries without rediscovering
    them from implementation details").
  - Ran the complete verification this task requires: full lint, full unit
    suite, and a whitespace check across every changed and new file in the
    working tree (see Validation run below).
- Current state: Complete. All acceptance criteria satisfied.
- Decisions and discoveries:
  - Verified every relative link and heading anchor in the new
    `src/kixx/hyperview/README.md` resolves before publishing it: checked
    each linked file path exists on disk (`content-layout.js`,
    `hyperview-content-snapshot.js`, `hyperview-content-service.js`,
    `hyperview-service.js`, `validate-pathname.js`,
    `content-addressable-store-interface.js`, `plugins/hyperview/plugin.js`,
    `plugins/README.md`, `templates/README.md`,
    `app/presentation/README.md`, `app/transaction-scripts/README.md`,
    `plugins/cloudflare-content-addressable-store/`), and confirmed the two
    heading anchors it links into (`#hyperview-file-layout` in the
    presentation README, `#general-plugins` in the plugins README) exist as
    written. A broken internal link in a document whose whole purpose is
    "so future agents don't have to rediscover this from implementation
    details" would have defeated the point.
  - Caught and fixed one inaccuracy in the end-to-end test comments before
    finalizing them: the static-asset suite's actual stale route is
    `/publishing-api/v1/assets/*filepath` (confirmed by grep), not
    `/publishing-api/v1/static-assets/**` as an initial draft of the shared
    comment text assumed. Rewrote the comment to describe the pattern
    generically (an example path plus "URL paths that predate the current
    routes") instead of enumerating every suite's exact stale path, so the
    identical comment block stays accurate across all 12 files without
    needing a "close enough" statement for any one of them.
  - Considered, and rejected, updating the illustrative sentence in
    `src/plugins/README.md`'s "Ports" section ("`HyperviewService` owns the
    shape of the template store it reads from..."). It is generic filler
    illustrating the "ports live next to their consumer" principle in the
    document's introduction, not a factual claim about
    `HyperviewContentService`/`ContentAddressableStoreInterface`'s actual
    file layout, and this task's design section scopes the required update
    to the "General Plugins" section specifically. Left it as-is rather than
    rewriting prose outside this task's stated scope.
  - Confirmed via grep across `src/` (excluding `agents/plans/` and
    `TODO.md`, which are historical/plan documents recording what happened
    and are not living reference documentation) that no other Markdown file
    in the living documentation tree references `ContentAddressableStore` or
    `HyperviewContentFacade` in a way that misattributes a current
    responsibility.
  - `src/app/README.md` does not exist, so there was no top-level
    application-layer doc to check beyond the ones this task's design
    section already named.
- Actual files changed:
  - `src/kixx/hyperview/README.md` (new)
  - `src/plugins/README.md`
  - `src/app/transaction-scripts/README.md`
  - `AGENTS.md`
  - `test/end-to-end/README.md`
  - `test/end-to-end/020-publishing-api/put-base-template-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-base-template.test.js`
  - `test/end-to-end/020-publishing-api/put-page-include-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-page-include.test.js`
  - `test/end-to-end/020-publishing-api/put-page-metadata-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-page-metadata.test.js`
  - `test/end-to-end/020-publishing-api/put-page-template-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-page-template.test.js`
  - `test/end-to-end/020-publishing-api/put-partial-template-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-partial-template.test.js`
  - `test/end-to-end/020-publishing-api/put-static-asset-errors.test.js`
  - `test/end-to-end/020-publishing-api/put-static-asset.test.js`
  - `src/app/presentation/README.md` (reviewed, no change needed)
- Validation run:
  - `node run-linter.js` (full repo) — clean except the same pre-existing,
    unrelated `no-warning-comments` warning in `hyperview-request-handlers.js`
    seen throughout this plan's earlier tasks (a `TODO` comment predating
    this work); exit 0.
  - `node run-tests.js` (full suite) — 983 tests passed, 0 disabled, matching
    HCS-6's post-deletion count (no behavior changed in this documentation-
    only task).
  - `git diff --check` against every tracked and new file (staged with `git
    add -A` for the check, then `git reset` immediately after to leave the
    working tree unstaged, matching the state before this task) — no
    whitespace errors.
  - Manual review confirmed: every method in this plan's public contract
    tables (HCS-2's port, HCS-3's `HyperviewContentService` table) has both a
    JSDoc block on the implementing method and dedicated unit coverage
    (verified during HCS-2/HCS-3's own validation, reconfirmed by re-reading
    those tasks' handoff notes here); every task HCS-1 through HCS-7 in this
    plan has a completed "Progress and handoff" section naming its actual
    files changed and the exact commands run.
  - No end-to-end server or remote service was started; the only end-to-end
    directory touched received comment-only edits, per this task's explicit
    scope boundary.
- Blockers: None.
