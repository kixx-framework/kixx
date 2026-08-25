# Node.js Developer Mode ContentStore

## Implementation Approach

A Kixx site is published as an immutable content-addressed closure: every file is
a blob named by the hash of its bytes, and one build id names one closure. That
model is correct for production and hostile to development, where a developer
edits a file on disk and expects the next page refresh to show it.

Developer mode adds a second Node.js `ContentStore` adapter that satisfies the
same `ContentStoreInterface` port while serving content directly from the
developer's source tree. Nothing above the port changes: `ContentAddressableStore`,
`ContentSnapshot`, `ContentAddressableIndex`, and `HyperviewService` are untouched.

The one exception is Task 1, which corrects a naming problem this feature would
otherwise entrench. It lands first because every later task depends on the names.

### The central problem: the source layout is not the storage layout

The developer's on-disk layout differs from the storage layout in three ways, and
the whole feature is this transform:

| Storage pathname | Source | Relationship |
| --- | --- | --- |
| `/pages/<p>/page.json` | `src/pages/<p>/page.json` | 1:1 |
| `/pages/<p>/<basename>` (template) | `src/templates/pages/<template>` | **relocated**, and `template` is *inherited* metadata |
| `/pages/<p>/__page-includes-bundle` | files named by `page.json` `includes` | **derived** from N files |
| `/pages/<p>/__page-partials-bundle` | files named by `page.json` `partials` | **derived** from N files |
| `/templates/__template-partials-bundle` | `src/templates/partials/**` | **derived** from N files |
| `/templates/__base-templates-bundle` | `src/templates/base/**` | **derived** from N files |
| `/assets/**` | `src/static-assets/**` | 1:1 |
| `/emails/<p>/__email-assets` | `src/emails/<p>/email.json` + named files | **derived** from N files |

Derived bundles do not exist as files on disk. They are assembled in memory on
read, which is why the adapter is built around a **manifest** — a map from
storage pathname to a *recipe* describing how to produce that blob — rather than
around a directory listing.

### Two passes over one manifest

`getIndex()` builds the manifest by walking the source trees with `readdir` and
`stat`, reading only the small JSON manifests (`page.json`, `email.json`). It
never opens a template, include, or static asset. Index hashes come from source
file identity plus `mtimeMs` and `size` — the same basis every static file server
uses for an ETag.

`getFile()` looks the storage pathname up in the manifest produced by the most
recent `getIndex()` and materializes the bytes: a direct read for a 1:1 recipe,
an assemble-and-canonicalize for a derived one.

### Deliberate deviations from the port contract

Three, each documented in code:

1. **Reads address by pathname, not by hash.** The port passes `pathname` to
   `getFile()` as a hint and blesses a filesystem adapter using it "for a readable
   layout". Developer mode makes it the address and ignores `hash`. Source files
   are mutable, so a hash cannot be an address here. This forfeits the port's
   cross-pathname deduplication guarantee, which no caller depends on.
2. **Writes throw.** `putFile()`, `saveIndex()`, and `assignBuild()` throw
   `AssertionError`. A developer-mode server being asked to publish is a
   misconfiguration, not an operational failure.
3. **`buildId` is ignored.** There is one closure — the disk — and it is rebuilt
   on every `getIndex()` call, which is what makes an edit visible on refresh.

### Judgment call: what "fast" excludes

The instruction was to skip byte hashing because `getIndex()` runs on every
request. The manifest-driven layout above makes reading `page.json` and
`email.json` unavoidable: the set of blobs in a page directory is *declared*
there, and `template` resolves through ancestor inheritance. Those reads are
small and bounded by page count. Content blobs — templates, includes, static
assets, which is where the bytes actually are — are never opened during
`getIndex()`. A parsed-manifest cache keyed by `filepath + mtimeMs + size` keeps
repeat requests from re-parsing unchanged JSON.

### Cross-cutting concerns

- **Missing source trees are empty, not fatal.** Neither `src/static-assets/` nor
  `src/emails/` exists today. `ENOENT` on a source root yields no entries.
- **Pathname validity.** `isValidPathname()` restricts segments to
  `[a-z0-9_.-]`. A source filename that violates it cannot be represented in the
  index. The scanner reports it as a `ValidationError` naming the offending
  filepath rather than crashing or silently dropping it.
- **A page directory is closed.** `batchGetPageAssets()` identifies a page's
  template by elimination — any blob in the page directory that is not a reserved
  filename. The scanner therefore emits *exactly* `page.json`, the resolved
  template, and the two bundles into `/pages/<p>/`. Files on disk that back
  includes are never emitted as their own blobs. Violating this makes
  `batchGetPageAssets()` assert "more than one page template".
- **No template is a 404, not an error.** `admin/page.json` carries
  `"template": ""`. `HyperviewService#getPage()` already returns null when a page
  has metadata but no template. The scanner emits no template blob in that case.
- **Errors** follow `src/docs/server-error-handling.md`: filesystem failures are
  `OperationalError` with `cause`; contract violations are `AssertionError`;
  malformed developer source is `ValidationError`.

---

### Task 1: Page build directives get clean names and leave the template context

**Status:** Not started
**Depends on:** None
**Documentation:** `src/kixx/hyperview/hyperview-page.js`; `src/app/presentation/README.md`; `test/unit-tests/README.md`

**Objective**

`page.json` declares its build directives as `template` and `partials`, and
neither reaches the template context. This lands before the scanner because every
later task reads these keys, and because renaming after the convention ships
would be a breaking change to published page data.

**Scope**

- In: renaming `pageTemplate` to `template` in existing page data, introducing
  `partials` as the page-partials directive name, removing both from the merged
  page context, and the tests and documentation covering that.
- Out: reading either key from disk — that is Task 2. Nothing here changes how a
  template is resolved today, because nothing resolves one today.

**Design and invariants**

- Every top-level key in `page.json` is deep-merged into the template context
  (`hyperview-page.js:91`), so `pageTemplate` is already visible to templates as
  `{{ pageTemplate }}`. `template` and `partials` are generic enough that a page
  author will plausibly want them for real data, so they must not be spent on
  build directives.
- `includes` is the precedent: a directive in `page.json` whose manifest shape is
  replaced by resolved content before any template runs
  (`pageContext.includes = includes`). `template` and `partials` follow the same
  rule, except that nothing useful replaces them, so they are deleted.
- Delete them **after** the metadata merge and **before** the response-props
  merge, matching where `includes` is assigned. Directives therefore come only
  from published page metadata, while the names stay available to a request
  handler that has a legitimate use for them. A response prop named `template`
  cannot affect template resolution, because Task 2's scanner reads `page.json`
  from disk independently of this merge.
- This removes a page's ability to read its own template name from inside a
  template. Nothing does that today. If it is ever wanted, the right shape is
  `page.template_id` inside the existing `page` namespace, set deliberately.
- Migration is contained: 5 `page.json` files, no template references
  `pageTemplate`, no document mentions it, and there is no publishing client to
  stay compatible with.

**Expected touch points**

- `src/pages/page.json`, `src/pages/admin/page.json`,
  `src/pages/admin/style-guide/page.json`, `src/pages/users/admin/page.json`,
  `src/pages/login/admin/page.json` — the rename
- `src/kixx/hyperview/hyperview-page.js` — strip the directives in `#mergeSources()`
- `test/unit-tests/kixx/hyperview/hyperview-page.test.js` — new file
- `src/app/presentation/README.md` — document both directives

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No `pageTemplate` key remains anywhere in the repository.
- [ ] `template` and `partials` published in `page.json` are absent from the
      assembled context, at the leaf and at every inherited ancestor.
- [ ] A response prop named `template` or `partials` survives into the context.
- [ ] `includes` still resolves to content, not to the `{ filename }` manifest.
- [ ] Existing rendering behavior is otherwise unchanged; the full suite passes.

**Validation**

- `node run-tests.js` — the full unit suite, proving no render path depended on
  the directives being present in the context
- `node run-linter.js`
- Manual: `node tools/devserver.js --port 2026`, confirm `/` and
  `/admin/style-guide` still render (they read page data through the same merge).

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 2: Source scanner produces a manifest of the developer's tree

**Status:** Not started
**Depends on:** Task 1
**Documentation:** `src/kixx/content-addressable-store/content-layout.js`; `src/docs/server-error-handling.md`; `src/docs/code-style-guide.md`

**Objective**

A scanner that walks the four developer source trees and returns a manifest: an
ordered map from canonical storage pathname to a recipe describing how that blob
is produced, with the stat metadata needed to hash it. This task owns every
source-layout convention; no later task re-derives a pathname.

**Scope**

- In: directory walking, stat collection, `page.json` / `email.json` parsing and
  caching, `template` and `partials` inheritance resolution, mapping source
  filepaths to storage pathnames, source validation.
- Out: hashing, index table construction (Task 3), blob materialization
  (Task 3), the store class (Task 4), plugin wiring (Task 5).

**Design and invariants**

- Recipe kinds: `file` (1:1), `includes`, `partials` (an ordered `{id, source}`
  array — serves global partials, base templates, and page partials), `email`.
- Every recipe carries the `{ filepath, mtimeMs, size }` of each constituent,
  plus the stats of every manifest file that determined membership. Editing
  `includes` in `page.json` must change the bundle's hash even when no constituent
  file changed; including `page.json`'s own stat in the recipe achieves this.
- `template` and `partials` are resolved by merging `page.json` from the root
  down to the leaf, matching `HyperviewPage`'s precedence. A nearer declaration
  wins; `""` means "no template" and clears an inherited value.
- `template` names a filepath relative to `src/templates/pages/`. `partials` maps
  id to a filepath relative to the same root.
- The template's storage pathname is `/pages/<p>/<basename of template>`. Assert
  the basename is not in `RESERVED_PAGE_FILENAMES`.
- Partial and base-template ids include the extension
  (`common-site-meta.html`, `admin.html`), matching `{{>common-site-meta.html}}`
  and `baseTemplateId: 'admin.html'`. Ids for `src/templates/partials/**` and
  `src/templates/base/**` are the path relative to that root.
- A page directory emits only `page.json`, the resolved template, and the two
  bundles. Nothing else.
- Manifest ordering is deterministic: sort by `compareStrings` from
  `addressing.js`, so an unchanged tree always produces an identical manifest.
- Source roots are constructor arguments, not hardcoded. A missing root
  contributes nothing.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-source-scanner.js` — the scanner
- `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js` — tests over a fixture tree

**Acceptance criteria**

- [ ] Scanning `src/pages`, `src/templates`, `src/static-assets`, `src/emails`
      yields a manifest whose keys are canonical storage pathnames.
- [ ] `/admin/style-guide/copy-fields` resolves its template to
      `style-guide-wrapper.html` through two levels of inheritance.
- [ ] `/admin` (with `"template": ""`) emits `page.json` but no template blob.
- [ ] A page directory never emits a blob for an includes source file.
- [ ] A missing `src/static-assets/` or `src/emails/` yields no entries and no error.
- [ ] A source filename outside the valid pathname character set raises a
      `ValidationError` naming the filepath.
- [ ] A malformed `page.json` raises a `ValidationError` naming the filepath.
- [ ] A `template` basename colliding with a reserved page filename raises.
- [ ] Repeat scans of an unchanged tree do not re-parse cached manifest JSON.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store` — scanner behavior
- `node run-linter.js src/plugins/node-content-store test/unit-tests/plugins/node-content-store`
- Unit coverage for inheritance, the closed-page-directory rule, missing roots,
  and each validation failure.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 3: Manifest becomes an index table and blob bytes

**Status:** Not started
**Depends on:** Task 2
**Documentation:** `src/kixx/content-addressable-store/content-addressable-index.js`; `src/kixx/content-addressable-store/addressing.js`; `src/kixx/hyperview/hyperview-service.js` (bundle shapes)

**Objective**

Two functions over a manifest: one producing an encoded index table that
`ContentAddressableIndex` accepts, and one materializing the bytes for a single
storage pathname. Together they are the only place that knows what a bundle's
serialized form is.

**Scope**

- In: hash derivation from stat metadata, size derivation, index table
  construction, bundle assembly and canonicalization, blob reads.
- Out: scanning (Task 2), the store class and manifest lifecycle (Task 4).

**Design and invariants**

- Delegate tree derivation and validation to
  `ContentAddressableIndex.buildIndex()` rather than hand-building the table. It
  derives directory entries, hashes them with `hashTree`, and guarantees the
  result satisfies `assertValidIndexTable()` — including the tuple arity the port
  requires.
- Blob hash = `hashString()` over the recipe's ordered constituent identity list
  (`filepath`, `mtimeMs`, `size` for each, plus the governing manifest stats). No
  file contents are read.
- Blob `size` must be a non-negative integer. For a 1:1 recipe it is the true
  file size. For a derived bundle it is the sum of constituent sizes — an
  approximation, and safe: `size` is consumed only by the publishing API's `stat`
  resources, which developer mode disables.
- Bundle serialized forms must match what `HyperviewService` parses:
  - `partials` recipes → `canonicalize([{ id, source }, ...])`
  - `includes` recipes → `canonicalize({ [name]: source })`
  - `email` recipes → `canonicalize({ contextData, htmlTemplate: {id, source},
    textTemplate: {id, source}, partials: [{id, source}], includes: {} })`,
    omitting absent representations
- Static assets are read as `ArrayBuffer` for a `'stream'` or `'arrayBuffer'`
  read; a `'stream'` read wraps them in a `ReadableStream` that a non-consuming
  caller can cancel.
- Hashing is done with the shared helpers in `addressing.js`. Do not introduce a
  second hashing path.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-index.js` — manifest → index table
- `src/plugins/node-content-store/lib/developer-blobs.js` — manifest + pathname → bytes
- `test/unit-tests/plugins/node-content-store/developer-index.test.js`
- `test/unit-tests/plugins/node-content-store/developer-blobs.test.js`

**Acceptance criteria**

- [ ] The produced table is accepted by `new ContentAddressableIndex(table)`.
- [ ] Touching a source file changes exactly the hashes of the entries that
      depend on it, and the hashes of its ancestor trees.
- [ ] Editing `includes` in `page.json` changes the includes-bundle hash.
- [ ] An unchanged tree produces a byte-identical table across scans.
- [ ] Each bundle's serialized form round-trips through the corresponding
      `HyperviewService` parser without assertion failure.
- [ ] A `'stream'` read of a static asset yields a cancellable `ReadableStream`.
- [ ] A read whose source file has been deleted since the scan resolves `null`
      rather than throwing, matching the port's absence semantics.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store`
- `node run-linter.js src/plugins/node-content-store test/unit-tests/plugins/node-content-store`
- Unit coverage asserting each bundle shape against the real `HyperviewService`
  compile path, not a restatement of the serializer.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 4: DeveloperContentStore implements the port

**Status:** Not started
**Depends on:** Task 3
**Documentation:** `src/kixx/content-addressable-store/content-store-interface.js`; `src/docs/server-error-handling.md`

**Objective**

A class satisfying `ContentStoreInterface` that serves reads from the developer's
source tree and refuses writes, such that `ContentAddressableStore.openSnapshot()`
and a full page render work against it unchanged.

**Scope**

- In: the seven port methods, manifest lifecycle across `getIndex()` and
  `getFile()`, type validation, the bulk-read cap, error classification.
- Out: scanning and materialization (Tasks 2–3), registration (Task 5).

**Design and invariants**

- `getIndex(context, buildId)` rescans, replaces the retained manifest, and
  returns the table. `buildId` is ignored.
- `getFile()` and `getFiles()` resolve against the retained manifest by
  `pathname`, ignoring `hash`. A pathname absent from the manifest resolves
  `null`.
- Retaining one manifest means two concurrent requests interleaving a scan can
  cause the later request's reads to see a slightly newer tree than the index it
  opened with. This is acceptable for a single-developer local server and must be
  documented in the class comment as the one place the snapshot-pinning guarantee
  is weakened.
- Type validation is unchanged from the production adapter: `getFile()` accepts
  `text` / `arrayBuffer` / `stream`, `getFiles()` accepts `text` only, and the
  100-blob cap rejects rather than fans out.
- `putFile()`, `saveIndex()`, and `assignBuild()` throw `AssertionError` naming
  developer mode and the method.
- `close()` is a no-op beyond marking the instance closed; there is no database
  and no file handle to release.
- Reuse the production adapter's stream-reading helper rather than writing a
  second one, or extract it to a shared module if reuse forces a change there.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-content-store.js`
- `test/unit-tests/plugins/node-content-store/developer-content-store.test.js`

**Acceptance criteria**

- [ ] `new ContentAddressableIndex(await store.getIndex(ctx, null))` succeeds
      against the repository's own `src/` tree.
- [ ] A `ContentSnapshot` over that index resolves `batchGetPageAssets('/')` with
      metadata, template, and includes populated.
- [ ] `batchGetPageAssets('/admin/style-guide/copy-fields')` resolves the
      inherited template.
- [ ] Editing a source file between two `getIndex()` calls changes the returned
      table without a restart.
- [ ] `putFile`, `saveIndex`, and `assignBuild` each throw `AssertionError`.
- [ ] `getFiles()` rejects a list longer than 100 and preserves positional
      alignment, including `null` holes.
- [ ] An unsupported read type throws `AssertionError`.
- [ ] A filesystem failure that is not `ENOENT` surfaces as `OperationalError`
      with `cause` set.

**Validation**

- `node run-tests.js test/unit-tests/plugins/node-content-store`
- `node run-linter.js src/plugins/node-content-store test/unit-tests/plugins/node-content-store`
- Integration-style unit test driving a real `ContentSnapshot` over the adapter,
  proving the port is satisfied rather than that the methods exist.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 5: Plugin selects the adapter from configuration

**Status:** Not started
**Depends on:** Task 4
**Documentation:** `src/plugins/README.md`; `src/node-config.js`

**Objective**

`node tools/devserver.js --environment development` serves pages from
`src/pages/`, `src/templates/`, and `src/static-assets/` with no code change at
any entry point, while staging and production keep the SQLite adapter.

**Scope**

- In: the registration branch in `plugin.js`, config shape and validation, the
  `development` environment entry in `src/node-config.js`.
- Out: `src/public/` deprecation (explicitly deferred); wiring a request handler
  for `/assets/**`, which has no caller today.

**Design and invariants**

- One flag at the wiring seam: `config.env.CONTENT_STORE.developerMode === true`
  selects `DeveloperContentStore`. Two clean implementations rather than a
  two-branch method on one class — they share no storage mechanism.
- Developer mode requires no `rootDirectory`; production mode still asserts it.
  Assert the arguments each branch actually needs, and no more.
- Source roots come from config and are resolved with `config.resolveFilepath`,
  defaulting to `./src/pages`, `./src/templates`, `./src/static-assets`,
  `./src/emails`.
- Set `developerMode: true` only in the `development` environment. Assert it is
  absent or false elsewhere, so it cannot reach a deployed target.
- Nothing in `src/app/` learns that developer mode exists.

**Expected touch points**

- `src/plugins/node-content-store/plugin.js` — the registration branch
- `src/node-config.js` — `development.CONTENT_STORE.developerMode` and source roots
- `test/unit-tests/plugins/node-content-store/plugin.test.js`

**Acceptance criteria**

- [ ] With `developerMode: true`, the plugin registers `DeveloperContentStore`.
- [ ] Without it, the plugin registers the SQLite `ContentStore` unchanged.
- [ ] Developer mode does not require `rootDirectory`; production mode still
      asserts it.
- [ ] `developerMode: true` outside the `development` environment raises at
      registration.
- [ ] Existing `node-content-store` tests pass unchanged.

**Validation**

- `node run-tests.js` — the full unit suite, proving nothing above the port broke
- `node run-linter.js` — the full tree
- Manual: `node tools/devserver.js --port 2026`, load `/` and
  `/admin/style-guide/copy-fields`, edit `src/pages/body.html` and
  `src/templates/base/default.html`, and confirm both changes appear on refresh
  without a restart.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 6: Document the source layout and the port deviations

**Status:** Not started
**Depends on:** Task 5
**Documentation:** `src/plugins/README.md`; `src/app/presentation/README.md`; `README.md`

**Objective**

A developer can learn where to put a page, a template, a partial, an include, a
static asset, and an email — and a later agent can learn why the developer
adapter is allowed to break three clauses of the port contract — without reading
the implementation.

**Scope**

- In: a source-layout reference table, the `partials` and `email.json`
  conventions introduced by this feature, the three documented port deviations,
  and how to enable developer mode.
- Out: rewriting the templating or presentation guides beyond the cross-links
  needed to reach the new material. Task 1 already documents the `template` and
  `partials` directives; this task extends that section rather than restating it.

**Design and invariants**

- The deviations belong beside the contract they bend: add a short "Developer
  mode" note to `content-store-interface.js` stating that a local development
  adapter may address by pathname, refuse writes, and ignore `buildId`, and say
  why each is safe.
- The `email.json` manifest is a new public convention. Document it where a
  developer will look — the presentation guide — not only in the plugin.
- Record that `src/public/` deprecation is deferred, so a later agent does not
  read its continued existence as an oversight.

**Expected touch points**

- `src/kixx/content-addressable-store/content-store-interface.js` — deviation note
- `src/plugins/README.md` — developer-mode adapter and the config flag
- `src/app/presentation/README.md` — source layout table, `email.json`
- `README.md` — enabling developer mode in the dev server section

**Acceptance criteria**

- [ ] A source-layout table maps every storage namespace to its source location.
- [ ] The `email.json` manifest is documented with an example.
- [ ] The three port deviations are stated with their justification.
- [ ] The deferred `src/public/` deprecation is recorded.
- [ ] JSDoc on every new exported symbol follows
      `src/docs/code-documentation-guide.md`.

**Validation**

- `node run-linter.js` — clean
- Read-through: a developer with no conversation history can place a new page,
  template, partial, include, and static asset correctly from the docs alone.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
