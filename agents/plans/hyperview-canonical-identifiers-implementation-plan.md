# Hyperview Canonical Identifiers — Implementation Plan

## Implementation Approach

`HyperviewService` reads and writes five kinds of file, each addressed by an identifier
that becomes a storage key:

1. **Base templates** — `base/{templateId}`
2. **Page templates** — `pages/{templateId}`
3. **Partial templates** — `partials/{filepath}`
4. **Page data JSON** — `{pathname}/page.json`
5. **Include text files** — `{pathname}/{filename}`

Storage adapters disagree about case. A Cloudflare KV key is case-sensitive; a macOS
APFS path is not; a Linux ext4 path is. So an identifier that is not reduced to one
canonical form makes the *same site* behave differently on different deploy targets —
and, worse, behave correctly on the developer's machine while failing in production.

A previous plan (`case-insensitive-template-ids-implementation-plan.md`, complete)
solved this for template ids by folding them to lower case inside `HyperviewService`.
Page pathnames are folded separately, in the page request handlers and in the publishing
API route params. Two gaps remain:

- **Include filenames are never folded and never validated.** `getIncludes()` joins
  `includes[name].filename` out of `page.json` verbatim (`hyperview-service.js:332`), and
  `splitIncludeFilepath()` deliberately preserves the filename's case
  (`route-params.js:153`). A file published as `Body.md` against a `page.json` naming
  `body.md` renders on macOS and silently renders *nothing* on Cloudflare KV or Linux,
  because `getIncludes()` filters missing files out without an error
  (`hyperview-service.js:344-352`). Include filenames are also the only identifier in
  the system that never passes `validatePathname()`, so charset, whitespace, and
  non-ASCII input reach the store unchecked.

- **The rule has no single owner.** Template ids fold *inside* the service; page
  pathnames fold *outside* it in two different presentation modules. There is no one
  place to look and ask whether an identifier type is covered, which is how the includes
  gap survived — `src/app/presentation/README.md:51` documents the rule in detail and
  never mentions includes at all.

**This plan establishes one invariant with one owner: every identifier that
`HyperviewService` turns into a storage key is already canonical (lower case) and
already valid (`validatePathname()` charset, no traversal, no leading-dot segments) when
it arrives, and the service asserts that rather than fixing it.** Callers normalize;
the service enforces.

### Deliberate reversal of the previous plan

The completed template-ids plan aimed for *"neither the publishing API request handlers
nor the page request handlers know anything about case"* (that plan, lines 24-25) by
folding silently inside the service. This plan reverses that specific choice, and the
reversal is the central design decision here:

**Silent folding cannot distinguish a sloppy caller from wrong stored content.** When
the service folds, `page.json` declaring `"filename": "Body.md"` is quietly rewritten to
`body.md` — indistinguishable from an author who wrote it correctly. When the service
asserts, that same `page.json` is reported as the broken build it is. Because the
includes gap showed that content-sourced identifiers are the dangerous ones, the value
of a loud failure outweighs the convenience of handlers that know nothing about case.

Handlers therefore regain responsibility for normalization. This is not a regression to
the old per-kind table the previous plan removed: there is still exactly **one** rule
and **one** implementation of it, shared by every layer via a new module. What changes
is that the service's copy of the rule is an assertion instead of a rewrite.

### Cross-cutting concerns

- **Normalize at the edge, assert at the service.** Per
  `src/docs/server-error-handling.md:83`, assertions are for internal invariants between
  our own code units and must not substitute for user input validation. That splits the
  work by *provenance*, not by identifier type:
  - Values arriving from an HTTP client (URL pathnames, publishing API wildcard params,
    the `includes` map inside a PUT body) are **user input**: normalize and validate them
    at the presentation edge, throwing `BadRequestError` (400).
  - Values arriving at `HyperviewService` from our own code (request handlers,
    transaction scripts, future CLI deploy tooling) are **internal**: assert, throwing
    `AssertionError` (500).

- **`page.json` is an address, not a reference.** A non-canonical
  `includes[*].filename`, `baseTemplate`, or `pageTemplate` in stored page data is a
  broken build, not a value to be resolved. It asserts. This is the principle that
  decides the sibling cases consistently, and it deliberately applies to
  `baseTemplate`/`pageTemplate` as well as to include filenames — all three are authored
  addresses read out of the same file.

  The one exception is the **partial reference** in template source. `{{> Nav.html }}`
  continues to resolve `nav.html`, because a partial reference is a name written into
  markup, not an address, and because the Mustache spec renders a missing partial as an
  empty string with no error (`create-render-function.js:439`) — the previous plan's
  Task T2 exists specifically so that failure mode is impossible. See the
  `CaseInsensitiveMap` note in Task T2.

- **One rule, two error policies.** The validity rule already lives in
  `src/kixx/utils/validate-pathname.js`, but it is welded to `BadRequestError`. The rule
  must be extracted as a predicate so the service can apply the identical rule with an
  assertion. Do not restate the charset or the traversal rule in a second place.

- **Use `toLowerCase()`, never `toLocaleLowerCase()`.** `toLocaleLowerCase()` makes
  resolution depend on the server's locale — in a Turkish locale `I` folds to `ı`, not
  `i`. That is precisely the cross-platform divergence this work exists to remove. This
  constraint is already documented at `hyperview-service.js:617` and must survive.

  Validating before folding also keeps the fold well-behaved: `validatePathname()`
  restricts segments to `[a-z0-9_.-]` (case-insensitive), so a validated identifier is
  ASCII, where `toLowerCase()` is total and idempotent. Unvalidated Unicode is not
  (`'İ'.toLowerCase()` yields two code points). **Validate first, then fold.**

- **Static assets are explicitly out of scope and stay case-preserving.**
  `getWildcardFilepath()` preserves case on purpose (`route-params.js:82-88`) because
  `StaticFileRequestHandler` resolves the URL pathname verbatim and asset URLs are
  embedded in third-party HTML. The rule this plan enforces is *"canonicalize every
  identifier Hyperview resolves through a name it controls"*, not *"lowercase
  everything"*. Do not touch `getWildcardFilepath()` or the static file server.

- **Include map keys do not fold.** `includes.body`, `includes.header` — the keys of the
  `includes` object — are template variable names consumed as `{{ includes.body }}`, not
  addresses. Folding them would make template data resolution inconsistent with every
  other metadata property. Only the `filename` *values* are identifiers.

- **Adapters must never fold.** The previous plan established that folding belongs in the
  service and not in the two store plugins, but left that decision undocumented in the
  interface contracts. A future Deno or AWS Lambda adapter author has no way to discover
  it. Task T5 writes it into both interface files.

- **Red/green, test-first.** This reverses the previous plan's "no unit tests" rule at
  the user's explicit request. Every task writes failing tests that express the new
  behavior *before* the implementation, confirms they fail for the intended reason, then
  implements until they pass. Test conventions are in `test/unit-tests/README.md`.

  Verification cannot rely on running the app locally: macOS APFS is case-insensitive by
  default, so a dev-server smoke test passes whether or not the change works. Assertions
  must be made against **exact key strings** through mock stores.

- **No migration, and no trace of the old behavior.** Deployed builds containing a
  non-canonical include key become unreachable and are fixed by re-deploying. Write no
  migration and no compatibility branch. Per the previous plan's convention, do not leave
  comments anywhere describing the superseded preserve-the-filename-case behavior; the
  result must read as though it was always this way. This includes the explanatory
  comments in the end-to-end tests (Task T6).

- **Run the linter on every changed JavaScript file** — `node run-linter.js <pathname>`,
  per `README.md`.

---

### Task T1: Establish one shared definition of a canonical Hyperview identifier

**Status:** Not started
**Depends on:** None
**Documentation:** `src/docs/code-style-guide.md` (module sizing, naming); `src/docs/server-error-handling.md` (assert vs. validate); `test/unit-tests/README.md`

**Objective**

A single module defines what a canonical Hyperview identifier is, how to produce one,
and how to assert that a value already is one — so that the four call sites added by
T2-T4 cannot drift apart. The validity rule in `validate-pathname.js` becomes reusable
under two different error policies without being restated.

**Scope**

- In: new `src/kixx/hyperview/canonical-identifiers.js`; extraction of a validity
  predicate from `src/kixx/utils/validate-pathname.js`; unit tests for both.
- Out: every call site (T2, T3, T4). This task adds code and changes no behavior.

**Design and invariants**

- Keep the API minimal. Per `code-style-guide.md:51-58`, do not write one
  `normalize*`/`assert*` pair per identifier type — the canonical form is identical for
  all five file types, and three copies of `toLowerCase()` is decomposition without
  simplification. The intended surface is:
  - `normalizeIdentifier(value)` — returns the canonical (lower case) form.
  - `isCanonicalIdentifier(value)` — predicate, true when already canonical.
  - `assertCanonicalIdentifier(value, messagePrefix)` — throws `AssertionError` when the
    value is not a non-empty string, not valid per the pathname rule, or not canonical.
    Callers supply a prefix naming the function and parameter, per
    `server-error-handling.md:106`.
- `assertCanonicalIdentifier()` checks **validity and canonical case together**, so no
  caller can assert one and forget the other.
- The module lives under `src/kixx/hyperview/` rather than `src/kixx/utils/` because the
  rule is Hyperview naming policy — the static file server deliberately does not apply
  it. Placing it beside `validate-pathname.js` would imply it is a general path utility.
- `validate-pathname.js` must expose the rule as a predicate (e.g. `isValidPathname`)
  and keep `validatePathname()`'s exported signature, `BadRequestError`, and message text
  **byte-identical** — it has three consumers (`route-params.js`,
  `static-file-server-request-handlers.js`, `hyperview-request-handlers.js`) and the
  static file server is out of scope for behavior change.
- Order is load-bearing: validity is checked before case, so an invalid identifier
  reports as invalid rather than as non-canonical.

**Expected touch points**

- `src/kixx/hyperview/canonical-identifiers.js` — new module (the three functions above)
- `src/kixx/utils/validate-pathname.js` — extract the predicate; `validatePathname()`
  delegates to it and is otherwise unchanged
- `test/unit-tests/kixx/hyperview/canonical-identifiers.test.js` — new
- `test/unit-tests/kixx/utils/validate-pathname.test.js` — new or extended; must pin the
  unchanged public behavior

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `normalizeIdentifier()` folds with `toLowerCase()`; a test pins that
      `toLocaleLowerCase()` semantics are not used.
- [ ] `assertCanonicalIdentifier()` throws `AssertionError` for: a non-string, an empty
      string, a traversal segment, a leading-dot segment, an out-of-charset character,
      and a correctly-formed but mixed-case value.
- [ ] `assertCanonicalIdentifier()` accepts a canonical multi-segment value
      (e.g. `blog/posts/welcome.html`), so nested page templates and nested include
      filenames both pass.
- [ ] An invalid *and* mixed-case value reports the validity failure, not the case one.
- [ ] The assertion message includes the caller-supplied prefix.
- [ ] `validatePathname()` still throws `BadRequestError` with the same message and still
      returns its input unchanged; existing consumers are unaffected.
- [ ] No call site outside this task changed.

**Validation**

- `node run-tests.js test/unit-tests/kixx/hyperview/canonical-identifiers.test.js` — proves
  the canonical-form contract, including the mixed-case rejection that T2 depends on.
- `node run-tests.js test/unit-tests/kixx/utils/validate-pathname.test.js` — proves the
  predicate extraction did not change the existing public behavior.
- `node run-tests.js` — proves the extraction broke no existing consumer.
- `node run-linter.js src/kixx/hyperview/canonical-identifiers.js src/kixx/utils/validate-pathname.js`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T2: `HyperviewService` asserts canonical identifiers at every storage boundary

**Status:** Not started
**Depends on:** T1
**Documentation:** `src/docs/server-error-handling.md`; `src/app/collections/README.md` is *not* relevant; `test/unit-tests/README.md` (MockTracker, thrown-error assertions)

**Objective**

No identifier reaches a page data store or template file store without having been
asserted canonical and valid. A non-canonical value produces a loud `AssertionError`
naming the offending method and parameter instead of a silent miss, a split cache entry,
or an empty include.

**Scope**

- In: assertions at every `HyperviewService` method that builds a storage key or a cache
  key; per-include filename assertion inside `getIncludes()` and `putPageMetadata()`;
  removal of `#normalizeTemplateId()`; the `loadPartials()`/`CaseInsensitiveMap` split.
- Out: `mergePageMetadata()`'s canonical URL behavior (T3); every caller (T3, T4).

**Design and invariants**

- Methods that assert their `pathname` argument: `getPageMetadata`, `getCachedPage`,
  `setCachedPage`, `putPageMetadata`, `putIncludeContent`, `getIncludes`.
  `getCachedPage`/`setCachedPage` are included because the pathname is part of the cache
  key — an unasserted variant would silently split the page cache in two.
- Methods that assert their template id: `getBaseTemplate`, `getPageTemplate`,
  `putBaseTemplate`, `putPageTemplate`, `putPartial`. `#normalizeTemplateId()` is
  **deleted**, not repurposed; its `toLowerCase()` is replaced by an assertion.
- Assert **before** the cache key is built, preserving the previous plan's rule
  (that plan, lines 47-52): a rejected id must never produce a `#templateCache` entry.
- `getIncludes()` asserts every `includes[name].filename` it is about to join. This is
  where a broken `page.json` surfaces at render time, per the "page.json is an address"
  principle. The assertion message must name the include key and the page pathname, so
  the author can find the offending entry — a bare "invalid identifier" is useless when
  a page declares six includes.
- `putPageMetadata()` asserts the same for every filename in the `metadata.includes` map
  it is about to store, so a broken map cannot be written through a direct service call.
  It **does not rewrite** the metadata: `page.json` is still stored byte-verbatim, and
  the assertion is a gate, not a transform.
- **`CaseInsensitiveMap` stays, but stops being symmetric.** Its `get`/`has` folding is
  what makes `{{> Nav.html }}` resolve `nav.html`, and that author-facing behavior is
  deliberate and must survive. Its `set()` folding, however, would silently absorb a
  hand-placed `templates/partials/Nav.html` — exactly the wrong-content case this plan
  exists to surface. So `loadPartials()` asserts the name it derives from the store
  listing, and `set()` no longer folds. Update the class doc comment: it is now a
  case-insensitive *lookup* map, and the asymmetry is intentional and must be explained.
- Do not add assertions to the store adapters. The service is the chokepoint; duplicating
  the rule in two plugins is what T5 documents against.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — assertions at the eleven methods above;
  delete `#normalizeTemplateId()`; `CaseInsensitiveMap` and `loadPartials()` change
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — new or extended; mock
  stores asserting exact key strings

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Each of the eleven methods throws `AssertionError` when handed a mixed-case
      identifier, and the message names that method and parameter.
- [ ] A canonical identifier reaches the mock store as the **exact** expected key string
      — assertions are on the key, not on "it did not throw".
- [ ] `getIncludes()` throws when any `includes[*].filename` is non-canonical or invalid,
      and the message identifies the include key and the page pathname.
- [ ] `getIncludes()` still returns rendered content for a valid includes map, and still
      omits an include whose file is genuinely absent from the store.
- [ ] `putPageMetadata()` rejects a metadata object containing a non-canonical include
      filename, and stores metadata byte-verbatim when it accepts.
- [ ] `getBaseTemplate`/`getPageTemplate` create no `#templateCache` entry for a rejected
      id.
- [ ] `{{> Nav.html }}` still resolves a stored `partials/nav.html`.
- [ ] `loadPartials()` throws when the store lists a non-canonical partial filepath.
- [ ] `#normalizeTemplateId()` no longer exists.

**Validation**

- `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-service.test.js` — proves
  the enforcement boundary, including exact stored key strings.
- `node run-tests.js` — proves no other unit-tested caller regressed.
- `node run-linter.js src/kixx/hyperview/hyperview-service.js`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: Public page requests normalize at the edge and emit one canonical URL

**Status:** Not started
**Depends on:** T1, T2
**Documentation:** `src/app/presentation/README.md` (page handler behavior)

**Objective**

A public page request for any case variant of a URL resolves the same stored page and
advertises the same canonical identity. `/Platform` and `/platform` load one page, share
one cache entry, and both emit `https://host/platform` as their canonical URL and
`og:url`.

**Scope**

- In: `normalizePagePathname()` in the page request handlers now delegates to the shared
  module; `mergePageMetadata()` folds `page.pathname` and the derived `canonical_url`.
- Out: redirecting a mixed-case request URL to its canonical form — considered and
  deliberately not adopted; the variant still renders, it just self-identifies
  canonically. Out: the publishing API (T4).

**Design and invariants**

- The handlers' private `normalizePagePathname()` is replaced by the shared
  `normalizeIdentifier()`. Both `HyperviewStaticPageHandler` and
  `HyperviewDynamicPageHandler` are affected, including their `options.pathname` override
  branch.
- **Validate before folding**, matching T1's ordering rule. The handlers currently call
  `validatePathname()` *after* deriving the pathname (`hyperview-request-handlers.js:111`
  and `:266`); the fold must sit on the validated value so the fold only ever sees ASCII.
- `mergePageMetadata()` currently assigns `page.pathname = url.pathname` and derives
  `canonical_url` from the raw request URL (`hyperview-service.js:225-232`), so today
  every case variant advertises itself as its own canonical page — a duplicate-content
  defect. Both now use the normalized pathname.
- `open_graph.url` needs no separate change: it already defaults to `page.canonical_url`
  (`hyperview-service.js:255-257`) and inherits the fix.
- **`page.href` stays raw.** It is documented as the current request URL and carries the
  query string; folding it would misreport what the client actually requested. Only the
  canonical identity folds. This asymmetry is deliberate and belongs in a code comment.
- Index-file stripping and format-extension stripping are orthogonal to case and must
  keep working in combination with it (`/Blog/Index.html` and `/blog` resolve alike).

**Expected touch points**

- `src/kixx/hyperview/hyperview-request-handlers.js` — import the shared normalizer;
  delete the private `normalizePagePathname()`; order fold after validation
- `src/kixx/hyperview/hyperview-service.js` — `mergePageMetadata()` canonical URL
- `test/unit-tests/kixx/hyperview/hyperview-request-handlers.test.js` — extend

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A request for `/Platform` resolves page data from `/platform` and hits the same
      page cache key as `/platform`.
- [ ] `page.canonical_url` and `og:url` are the folded pathname for a mixed-case request.
- [ ] `page.pathname` is the folded pathname.
- [ ] `page.href` still reflects the request URL as sent, including query string.
- [ ] A mixed-case URL combined with an index file and a `.json` format extension still
      resolves the same page as its canonical form.
- [ ] Both the static and dynamic handlers behave identically, including via
      `options.pathname`.
- [ ] An invalid pathname still produces `BadRequestError` (400), not `AssertionError`.

**Validation**

- `node run-tests.js test/unit-tests/kixx/hyperview/hyperview-request-handlers.test.js` —
  proves edge normalization and canonical URL output.
- `node run-tests.js` — proves the service assertions from T2 are satisfied by the
  handlers, i.e. the two layers agree.
- `node run-linter.js src/kixx/hyperview/hyperview-request-handlers.js src/kixx/hyperview/hyperview-service.js`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: The publishing API canonicalizes and validates client input at the edge

**Status:** Not started
**Depends on:** T1, T2
**Documentation:** `src/docs/server-error-handling.md` (400 vs. 500); `src/app/presentation/README.md`; `src/app/transaction-scripts/README.md`

**Objective**

Every identifier a publishing client sends is canonicalized and validated before
authorization runs, so the authorized URN, the echoed response id, and the written
storage key all name the same thing — and a client that sends something unusable gets an
actionable 400 at publish time rather than a 500 at render time.

**Scope**

- In: `route-params.js` helpers route through the shared module; `splitIncludeFilepath()`
  folds the filename; validation of the `includes` map inside a page metadata PUT body.
- Out: `getWildcardFilepath()` and static asset publishing, which stay case-preserving.

**Design and invariants**

- `splitIncludeFilepath()`'s filename carve-out (`route-params.js:148-155`) is removed:
  the filename now folds with the directory segments. Delete the comment explaining the
  old rationale rather than amending it.
- This changes the include authorization URN — `urn:kixx:publishing:include:blog/Body.md`
  becomes `urn:kixx:publishing:include:blog/body.md`. That is a wire-visible change to
  the permission vocabulary and is accepted; no compatibility branch. `authorization.js`
  needs no code change, because it already shares the helper
  (`authorization.js:52-59`) — but the change must be verified, not assumed.
- `getWildcardTemplateFilepath()`'s fold stops being cosmetic. Its current comment
  (`route-params.js:105-111`) explains that storage is consistent regardless because the
  service folds — after T2 the service *rejects* instead, so this fold is load-bearing.
  The comment must be rewritten to say so; leaving it would actively mislead.
- **Page metadata PUT bodies need include-map validation.** The `includes` map inside a
  PUT body is client input, so per `server-error-handling.md:83` a bad filename there is
  a `BadRequestError` (400) naming the offending include key — not the `AssertionError`
  that T2's `putPageMetadata()` would raise. T2's assertion remains as the backstop for
  non-API callers. Decide and record whether this validation belongs in the request
  handler or the `put-page-metadata` transaction script; the transaction script is the
  better home if any non-HTTP caller should also get the checked behavior.
- Existing empty-segment rejection and traversal rejection are orthogonal to case and
  must survive untouched.
- The existing test asserting the opposite behavior
  (`route-params.test.js:254`, *"preserves the filename case…"*) is inverted, not
  deleted — the new test should pin that the filename now folds.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/route-params.js` — shared
  normalizer; filename fold; rewritten comments
- `src/app/presentation/request-handlers/publishing-api/put-page-metadata.js` and/or
  `src/app/transaction-scripts/publishing/put-page-metadata.js` — includes-map validation
- `test/unit-tests/app/presentation/request-handlers/publishing-api/route-params.test.js` — invert and extend
- `test/unit-tests/app/presentation/request-handlers/publishing-api/authorization.test.js` — verify the URN

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `splitIncludeFilepath()` folds the filename; `filepath`, `pathname`, and `filename`
      are all canonical.
- [ ] The include authorization URN and the handler's echoed response `id` are identical
      for a mixed-case request.
- [ ] A page metadata PUT whose `includes` map contains a non-canonical or invalid
      filename is rejected with `BadRequestError` (400) naming the include key.
- [ ] A page metadata PUT with a valid includes map stores the metadata byte-verbatim.
- [ ] Static asset publishing still preserves case (`Images/Logo.png` round-trips).
- [ ] Empty-segment and traversal rejections still produce their existing codes.
- [ ] No comment anywhere describes the superseded preserve-the-filename-case behavior.

**Validation**

- `node run-tests.js test/unit-tests/app/presentation/request-handlers/publishing-api/` —
  proves edge canonicalization, the URN change, and the preserved static-asset behavior.
- `node run-tests.js` — proves the full unit suite is green before the e2e task.
- `node run-linter.js src/app/presentation/request-handlers/publishing-api/route-params.js`

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Write the invariant into the store contracts and the author documentation

**Status:** Not started
**Depends on:** T1, T2, T3, T4
**Documentation:** `src/docs/code-documentation-guide.md`; `src/plugins/README.md` (interface contract rules)

**Objective**

A future adapter author and a site author can both discover the rule from the docs
without reading `HyperviewService`. The presentation README stops describing a rule that
omits includes.

**Scope**

- In: both store interface contracts; `src/app/presentation/README.md`; verification of
  `src/templates/README.md`.
- Out: any behavior change.

**Design and invariants**

- Both interface files gain an explicit clause: filepaths arrive already canonical and
  validated, and **adapters MUST NOT apply their own case folding or normalization**.
  This states in the contract what the previous plan decided but left implicit
  (that plan, lines 36-45). Place it under the existing "Invariants" heading in
  `template-file-store-interface.js` and `page-data-store-interface.js` so it sits with
  the other MUST clauses.
- `src/app/presentation/README.md:51` is rewritten. The current paragraph documents
  pathnames and the three template kinds, never mentions includes, and frames lower-case
  naming as advice ("Name every directory and file … in lower case anyway"). It must now
  cover **all five file types**, and state the rule as mechanical: non-canonical names
  are rejected, not tolerated. Include what an author sees when they get it wrong — a
  400 from the publishing API, an `AssertionError` at render for checked-in pages.
- `src/templates/README.md:1210,1301` state that partial *reference* resolution is
  case-insensitive. That remains true after T2 and must **not** be changed — but verify
  it, because T2 makes the stored side strict while the reference side stays lenient, and
  the docs should not blur the two.
- Do not document the previous behavior or frame any of this as a change.

**Expected touch points**

- `src/kixx/hyperview/template-file-store-interface.js` — invariant clause
- `src/kixx/hyperview/page-data-store-interface.js` — invariant clause
- `src/app/presentation/README.md` — rewrite the case paragraph to cover five file types
- `src/templates/README.md` — verify; change only if it now misleads

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both interface files state that keys arrive canonical and that adapters must not
      fold.
- [ ] `src/app/presentation/README.md` documents the rule for all five file types,
      including include filenames.
- [ ] The README states the failure mode an author will actually encounter.
- [ ] `src/templates/README.md`'s partial-reference statements are verified accurate.
- [ ] No documentation describes the superseded behavior.

**Validation**

- `node run-linter.js src/kixx/hyperview/` — JSDoc edits must not break lint.
- Manual: re-read `src/app/presentation/README.md:51` against the five file types in this
  plan's opening list and confirm each is covered. This cannot be expressed as a command.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T6: Reconcile the end-to-end suite with the new invariant

**Status:** Not started
**Depends on:** T1, T2, T3, T4
**Documentation:** `test/end-to-end/README.md`

**Objective**

The end-to-end suite exercises the new behavior against a real server and stops
documenting the superseded one. This is the only layer that proves the publishing API,
the service, and the page handlers agree end to end.

**Scope**

- In: the four publishing-API e2e files whose assertions or comments encode
  preserve-the-filename-case; new coverage for the include round-trip.
- Out: unit-level coverage (T1-T4).

**Design and invariants**

- Four files carry explanatory comments about the old rule and must be reconciled:
  `put-page-include.test.js:159`, `put-page-metadata.test.js:211-212`,
  `put-page-template.test.js:267`, `put-partial-template.test.js:278` and `:291`. Several
  reference `splitIncludeFilepath()`'s deliberate case preservation as settled design.
  Rewrite them to describe the current rule; do not annotate them as changed.
- The load-bearing new e2e case is the **include round-trip that used to fail silently**:
  publish an include via the API with a mixed-case filename, publish a `page.json`
  referencing it canonically, then request the page and assert the include's content
  actually appears. Under the old behavior this passed on macOS and failed on a
  case-sensitive store; it must now pass deterministically because both sides canonicalize.
- Add the negative case: a `page.json` whose `includes[*].filename` is non-canonical is
  rejected at publish time with a 400, rather than producing a page that renders without
  the include.
- E2E runs need `--e2e`; per `README.md` the suites never share a process.

**Expected touch points**

- `test/end-to-end/020-publishing-api/put-page-include.test.js`
- `test/end-to-end/020-publishing-api/put-page-metadata.test.js`
- `test/end-to-end/020-publishing-api/put-page-template.test.js`
- `test/end-to-end/020-publishing-api/put-partial-template.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record
the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] A mixed-case include published via the API is readable by a page whose `page.json`
      names it canonically, and its content appears in the rendered page.
- [ ] A `page.json` with a non-canonical include filename is rejected with a 400 naming
      the include key.
- [ ] The four files' comments describe the current rule only.
- [ ] The existing template and static-asset e2e expectations still pass unchanged.

**Validation**

- `node run-tests.js --e2e test/end-to-end/020-publishing-api/` — proves the publishing
  API and the render path agree.
- `node run-tests.js --e2e` — proves the full e2e suite is green.
- `node run-tests.js` — proves the unit suite stayed green.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
