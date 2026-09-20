# Remove Inline Release Content

## Implementation Approach

The Publishing API accepts a manifest reference carrying literal text
(`{ "content": "...", "mediaType": "..." }`) in place of `{ objectId, size }`.
The server hashes it, stores it as an object, and rewrites the reference before
validating the manifest. The feature was introduced in T7 of
`agents/plans/publishing-api-v1-refactor.md` on the reasoning that a small site
should be able to publish in one request. Nothing in this repository has ever
produced an inline reference, and the external publishing CLI uploads objects.
We are removing it.

The feature is confined to one pre-pass in the presentation layer:
`prepareInlineContent()` in
`src/app/presentation/request-handlers/publishing-api/releases.js`. Nothing
below the handler knows inline content exists — `release-manifest.js` has never
accepted a `content` field, and `ContentAddressableStore#createRelease()`
validates the manifest independently. This is what makes the removal shallow.

Two facts shape the work:

**`prepareInlineContent()` does three jobs, and only one is going away.** It
rewrites inline references, enforces `MAX_MANIFEST_ENTRIES`, and rejects inline
content on the validation route. The entry cap is an unrelated request-size
bound that both Release endpoints must keep. Deleting the whole function would
silently drop it.

**Removing the feature deletes a special case, not just a code path.**
`POST /releases/validation` must persist nothing, so the inline pre-pass forced
an explicit "accepted only when creating a Release" rejection into the
validation route. That branch exists only because inline content exists, and it
goes with it. The read-only route becomes read-only by construction.

Rejection after removal needs no new code. `validateReference()` in
`release-manifest.js` calls `rejectUnknownFields()` against
`{ objectId, size }` (plus `mediaType` for static assets) and requires a valid
`objectId`, so an inline reference fails as `422 InvalidReleaseManifest`
naming both faults. A client that still inlines gets a precise error, not
silent acceptance.

### On the discovery contract

`GET /publishing-api/v1/` publishes `limits.maxInlineContentBytes`. Removing a
key from a published document is client-visible, and the discovery document has
no version of its own: `buildAssignmentProtocolVersion`,
`contentContractVersion`, and `addressingFormat` version the write protocol,
Release compatibility, and object addressing respectively. None covers the
shape of `limits`.

That would be a real constraint if a client were bound to it. It is not.
`docs/build-assignment-rollout.md` records that protocol 2 and format 4 have
never been cut over ("Nothing here has been executed"), the external CLI's
revision is `_pending_`, and the repository serves protocol 2 only. There is no
deployed client reading this document, so the key is removed outright rather
than retained as a zero or a deprecated field. If that assumption is wrong, the
fallback is to keep publishing the key while rejecting inline content — but do
not do this speculatively; a limit describing a capability the server does not
have is worse than its absence.

Task IC2 depends on IC1 because `MAX_INLINE_CONTENT_BYTES` has two consumers.

---

### Task IC1: Release endpoints reject inline manifest content

**Status:** Complete
**Depends on:** None
**Documentation:** `docs/publishing-api.md` — "Create a Release", "### Inline content"; `src/app/presentation/README.md`; `src/docs/server-error-handling.md`

**Objective**

`POST /releases` and `POST /releases/validation` accept only
`{ objectId, size }` content references. A manifest carrying `content` is
rejected as an invalid manifest by the existing schema rules, and neither route
writes an object derived from the request body. `POST /releases/validation`
persists nothing by construction rather than by an explicit guard.

**Scope**

- In: `prepareInlineContent()` and `replaceInlineReferences()`, the inline
  rejection branch on the validation route, the manifest-entry cap that
  currently lives inside the same function, the unit and end-to-end tests
  covering inline behavior, and the `### Inline content` section of
  `docs/publishing-api.md`.
- Out: the discovery document and `MAX_INLINE_CONTENT_BYTES` itself (IC2);
  `release-manifest.js`, which never knew about inline content; the object
  upload endpoints, which remain the only way to store content.

**Design and invariants**

- `MAX_MANIFEST_ENTRIES` enforcement must survive. It is a presentation-layer
  request-size bound and applies to both endpoints. Keep the
  `validateReleaseManifest()` call that counts entries; the store's own
  validation does not enforce this cap.
- The replacement helper takes the manifest and returns nothing, or returns the
  manifest unchanged. It must not `structuredClone()` — cloning existed only so
  references could be rewritten in place. Name it for what it now does
  (enforcing the entry cap), not for what it used to do.
- Both routes call the same helper, so the cap cannot drift between them.
- Do not add an explicit inline-content rejection. The manifest schema already
  rejects the shape with a precise error; a second check would duplicate a rule
  that lives in `release-manifest.js` and could disagree with it.
- The validation route must no longer be capable of a write. After this task
  `validateRelease()` reaches no `putObject()` call on any path.
- An inline manifest must fail with `422 InvalidReleaseManifest`, not `400`.
  The current validation-route rejection is a `BadRequestError`; that status
  changes, and the end-to-end assertion changes with it.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/releases.js` — delete
  both inline functions; replace with the entry-cap check
- `test/unit-tests/app/presentation/request-handlers/publishing-api/releases.test.js` —
  replace "publishes inline text content in one request" with coverage that an
  inline reference is rejected and nothing is stored
- `test/end-to-end/200-publishing-api/030-releases.test.js` — `inlineInValidationResponse`
  (declared line 53, issued 95-97, asserted 135-138) becomes a create-route
  rejection, or is dropped if the unit coverage is sufficient
- `docs/publishing-api.md` — remove `### Inline content`; check whether the
  "Creation runs, and fails before persisting anything" list still reads
  correctly without it

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] A `POST /releases` manifest containing a `content` reference returns
      `422 InvalidReleaseManifest` and stores no object.
- [x] A `POST /releases/validation` manifest containing a `content` reference
      returns `422 InvalidReleaseManifest` and stores no object.
- [x] A manifest exceeding `MAX_MANIFEST_ENTRIES` is still rejected on both
      routes.
- [x] A valid `{ objectId, size }` manifest still creates and validates exactly
      as before, including content-idempotent creation.
- [x] No symbol named for inline content remains in `releases.js`.
- [x] `docs/publishing-api.md` no longer documents inline content.

**Validation**

- `node run-tests.js` — the unit suite, including the rewritten releases tests
- `node run-linter.js` — no unused imports left by the deletion
  (`MAX_INLINE_CONTENT_BYTES`, `hashBlob`, and any now-unused error helper)
- `grep -rn -i inline src/app/presentation/request-handlers/publishing-api/` —
  expect only the discovery hit IC2 removes
- End-to-end `200-publishing-api` against a local target instance
  (`node tools/local-target.js create/seed/serve`) if the e2e suite is run for
  this change

**Progress and handoff**

- Completed: Read the task, dependencies, and relevant presentation, error,
  test, and manifest-contract documentation. Verified that no prerequisite
  task exists and that the only existing worktree edit is an unrelated,
  active update to `docs/publishing-api.md`.
- Current state: Complete.
- Remaining: Nothing in this task.
- Decisions and discoveries: The manifest schema already rejects `content` as
  an unknown reference field and requires `objectId` and `size`. Endpoint
  validation must pass that error through `classifyReleaseError()` so the API
  returns the documented `InvalidReleaseManifest` code.
- Actual files changed: `src/app/presentation/request-handlers/publishing-api/releases.js`,
  `test/unit-tests/app/presentation/request-handlers/publishing-api/releases.test.js`,
  `test/end-to-end/200-publishing-api/030-releases.test.js`, and
  `docs/publishing-api.md`.
- Validation run: `node run-tests.js` (1,446 passed); `node run-linter.js
  src/app/presentation/request-handlers/publishing-api/releases.js
  test/unit-tests/app/presentation/request-handlers/publishing-api/releases.test.js
  test/end-to-end/200-publishing-api/030-releases.test.js` (passed);
  `git diff --check` (passed).
- Blockers: None.

---

### Task IC2: Discovery stops publishing the inline content limit

**Status:** Complete
**Depends on:** IC1
**Documentation:** `docs/publishing-api.md` — "Discovery"; `docs/build-assignment-rollout.md` — "Client handoff"

**Objective**

The discovery document's `limits` map describes only limits the server
enforces. `maxInlineContentBytes` is gone from the response, the constant
module, and the documented example.

**Scope**

- In: `MAX_INLINE_CONTENT_BYTES` in `constants.js`, its use in `discovery.js`,
  the discovery unit test, and the discovery example in `docs/publishing-api.md`.
- Out: the three version fields, which are unchanged — this is not a protocol
  revision; the other three limits, which all still describe enforced bounds.

**Design and invariants**

- Remove the key rather than publishing `0` or `null`. A limit of zero reads as
  "inline content is supported but nothing fits," which is a different and
  wrong statement.
- Do not bump `buildAssignmentProtocolVersion` or `contentContractVersion`.
  Neither versions the discovery document shape, and neither write protocol nor
  Release compatibility changed. Bumping one to signal this would corrupt what
  it means.
- The rollout doc's client handoff section lists what the external CLI must do.
  It does not mention inline content, so it needs no change — but confirm that
  while working, rather than assuming it.

**Expected touch points**

- `src/app/presentation/request-handlers/publishing-api/constants.js` — delete
  the constant
- `src/app/presentation/request-handlers/publishing-api/discovery.js` — drop
  the import and the `limits` key
- `test/unit-tests/app/presentation/request-handlers/publishing-api/discovery.test.js` —
  assert the key is absent alongside the existing limit assertions
- `docs/publishing-api.md` — the discovery JSON example

**Acceptance criteria**

- [x] `GET /publishing-api/v1/` returns a `limits` object with exactly
      `maxObjectBytes`, `maxObjectStatusIds`, and `maxManifestEntries`.
- [x] The discovery unit test asserts `maxInlineContentBytes` is absent, so a
      reintroduction fails a test rather than passing silently.
- [x] The documented discovery example matches the served document field for
      field.
- [x] No `MAX_INLINE_CONTENT_BYTES` symbol remains anywhere in `src/`.

**Validation**

- `node run-tests.js` — discovery unit tests
- `node run-linter.js`
- `grep -rn -i "inline" src/app/presentation/request-handlers/publishing-api/ docs/publishing-api.md` —
  expect no results
- Compare the served discovery document against the doc example on a local
  target instance

**Progress and handoff**

- Completed: Confirmed IC1 is complete and the rollout document's client
  handoff does not mention inline content.
- Current state: Complete.
- Remaining: Nothing in this task.
- Decisions and discoveries: The discovery response has no separate version,
  and the documented rollout remains unexecuted, so the key is removed rather
  than retained with a sentinel value.
- Actual files changed: `src/app/presentation/request-handlers/publishing-api/constants.js`,
  `src/app/presentation/request-handlers/publishing-api/discovery.js`,
  `test/unit-tests/app/presentation/request-handlers/publishing-api/discovery.test.js`,
  and `docs/publishing-api.md`.
- Validation run: `node run-tests.js` (1,446 passed); `node run-linter.js`
  (passed); `node run-tests.js --e2e --base-url http://localhost:49960/
  --username <local-target-root> --password <local-target-password>
  test/end-to-end/200-publishing-api` (37 passed); `git diff --check`
  (passed); searches found no inline-content symbols in the publishing API or
  documentation. The temporary local target was destroyed after validation.
- Blockers: None.

---

## Known stale references

Not tasks — historical plan files that record the feature's rationale and
should not be edited to hide it:

- `agents/plans/publishing-api-v1-refactor.md:738-741, 794, 806, 809, 1040` —
  T7's design note, acceptance criterion, and handoff notes. This is the record
  of why the feature existed; leave it intact.
- `agents/plans/admin-panel-publishing.md:643-650` — suggests building a second
  Release with inline content to exercise the admin panel's rollback controls.
  Already stale: those controls were removed in `cd97de5`.
