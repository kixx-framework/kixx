# Admin file uploads and publishing

## Implementation Approach

Add a shared admin file library whose records have stable identities and mutable
content. Store file records in the DocumentStore and bytes in a dedicated
ObjectStore bucket. Serve published bytes through `/files/<uuid>`, independently
of the ContentAddressableStore, Releases, and build assignments.

Implement the feature on Node.js and Cloudflare together. Use the existing
Collection, Record, Transaction Script, Form, and Hyperview boundaries. Extend
the existing object-store port only where streaming upload validation requires
it; do not introduce another platform abstraction or install dependencies.

The user approved the behavior below. Implementation and validation are complete.

### Approved behavior

- A new upload creates a new file with a random UUID. Identical filenames or
  bytes do not deduplicate files. The public pathname is known before publishing.
- New files are unpublished. Publishing serves their bytes at `/files/<uuid>`;
  unpublishing returns `404` there. Republishing uses the original pathname.
- Replacements happen from the detail page. Successful replacement changes the
  existing file's bytes immediately, preserving UUID, title, description, and
  publication state. Filename, size, and content type follow the new upload.
  Failed uploads preserve existing content. There are no drafts or versions.
- Title and description are optional admin-only plain text, limited to 200 and
  2,000 characters. They save explicitly and independently of upload/publication.
  An empty title falls back to the filename for display.
- Selecting multiple files starts uploads immediately: three active requests,
  with remaining files queued. Each file succeeds or fails independently.
- Every upload row has progress, editable metadata during upload, its own Save
  metadata button after success, and a separate Publish button after success.
  Publishing does not require saving metadata.
- Queued and active batch uploads can be canceled. Batch retry starts again from
  byte zero and retains the selected file and entered metadata while the page
  remains open.
  Retry deduplication is explicitly out of scope; uncertain outcomes can leave
  duplicate entries.
- Leaving the batch upload page abandons unfinished uploads and unsaved metadata.
  Warn while work is pending. Completed uploads and saved metadata persist.
- The listing has 25 entries per page, newest original uploads first. Edits and
  replacement do not reorder it. No search or filters. Each row has a Publish or
  Unpublish button appropriate to its state and links to its detail page.
- Detail pages provide metadata editing, replacement, authenticated download,
  and deletion. Show the stable public URL even while unpublished.
- Root Admin, Developer, Admin, and Editor manage every file in the shared
  library. There is no uploader ownership restriction or audit trail.
- Admin downloads always use attachment disposition and
  `Cache-Control: private, no-store`, including for unpublished files.
- Public browser-supported raster images, PDF, audio, video, and plain text use
  inline disposition. Markup files, including HTML, SVG, and XML, use attachment
  disposition, as do unsupported formats. No manual content-type override.
- Published responses use ETags and `Cache-Control: public, no-cache`:
  revalidation on every request, `304` for an unchanged representation, and new
  bytes after replacement. No byte-range support.
- The configurable per-file maximum defaults to 50 MiB (52,428,800 bytes).
  Zero-byte files are valid. A batch is multiple independent upload requests.
- Last write wins without stale-edit rejection. Each operation changes only
  its intended fields.
- Unpublishing needs no confirmation. Replacing content that was published when
  the detail page rendered requires client-side confirmation before uploading;
  the server does not recheck it. Permanent deletion requires unpublishing first
  and explicit server-validated confirmation; its UUID is never intentionally
  reused.
- This is admin-panel functionality, not an external API or Publishing API token
  capability. Uploads require JavaScript; use ordinary HTML forms elsewhere
  where practical.

### Repository findings

- `src/kixx/object-store/object-store-interface.js` already covers streaming
  reads/writes, object metadata, ETags, listing, and strong read-after-write
  consistency. Both platform registries already register ObjectStore adapters.
- Node config currently declares an `uploads` bucket. Cloudflare's ObjectStore
  bucket map contains only a commented `files` example. Configure an explicit
  `files` bucket on both platforms without repurposing the existing bucket.
- The Node adapter renames bytes into place before updating its SQLite object
  manifest. Overwriting the active object's key cannot preserve old bytes if
  that later manifest update fails. Use a fresh internal key for each attempt.
- DocumentStore Collections default to `crypto.randomUUID()` and provide signed
  pagination cursors and `updateWithRetry()`. No new ID library or search index
  is needed.
- `src/app/permissions/roles.js` restricts Editor to publishing resources and
  mostly get/create actions. Add an exact files-resource exception, as it already
  does for build updates; do not broaden Editor's general publishing grants.
- `validateCsrfFormData()` consumes the body through `request.formData()`. Raw
  uploads need token validation from a header before reading `request.body`.
- Both ServerRequest adapters expose Web streams. Browser behavior belongs in
  a `data-js-behavior` IIFE in `src/static-assets/javascript/site.js`. Its browser
  globals and syntax rules are defined in `eslint.config.js`.
- Admin pages use `admin.html`; forms with CSRF tokens disable rendered-page
  caching. Dynamic detail routes need an explicit Hyperview `pathname`.
- The filename-to-MIME mapping already exists at
  `src/kixx/static-assets/mime-types.js`; reuse it without adopting the static
  asset handler or its immutable caching behavior.
- `test/README.md`, mentioned in AGENTS.md, does not exist. The actual guides are
  `test/unit-tests/README.md` and `test/end-to-end/README.md`.
- There is no Cloudflare deployment/provisioning command in this repository's
  tools. Do not invent one or assume a config edit provisions an R2 bucket.

### Cross-cutting design and boundaries

**Storage and replacement.** Use `FileCollection`/`FileRecord` for document data
and a registered custom `FileContentCollection` gateway for object storage.
Transaction Scripts orchestrate them. A file record holds title, description,
publication state, original-upload ordering, and the current content reference
(object key, filename, content type, length, ETag/generation). Record validation
enforces the complete shape. Raw object keys never become public URLs.

Allocate each upload attempt a fresh random object key under its file UUID.
Upload and validate all bytes before committing that reference to the record.
For a new file, create its visible record only after storage succeeds. For a
replacement, atomically update the content reference on the latest record,
preserving other fields. Then remove displaced bytes. Internal upload keys are
an implementation mechanism, not user-visible staging or version history.

**Last write wins.** Apply operation-specific patches to the latest record using
bounded internal compare-and-swap retries. The last successful commit wins for
the fields it changes; there is no browser version field or stale-edit dialog.
Do not use a stale whole-record `put()`, which could undo an unpublish, lose
metadata, or resurrect a deleted file. Exhausted storage retries are an
operational failure, not a request to manually merge edits. The user's chosen
policy overrides the Collections guide's usual stale-user-edit rejection.

**Deletion and cleanup.** Recheck the unpublished precondition when committing
deletion. Remove the document conditionally before deleting its bytes, retrying
internal conflicts against current state. A concurrent publish can make deletion
ineligible; report that state error rather than deleting a published file.
Late replacement commits must fail when the record is gone and clean up their
uncommitted object. Never delete a winning replacement during loser cleanup.
Await normal cleanup and preserve diagnostic context on failure. A cleanup
failure after a committed change must not roll back the pointer or report that
the old file is still current. Document crash/orphan recovery; do not claim a
transaction spans DocumentStore and ObjectStore or that abort can undo a commit.

**Upload transport.** Send one raw file body per authenticated request, using
XMLHttpRequest for upload progress and abort. Supply a CSRF header, an encoded
filename header, and a declared byte-length header. Normalize and validate these
through a Form before domain work. Treat declared length and browser MIME as
untrusted. Enforce the configured limit and exact byte count while streaming;
never buffer a full upload through `formData()`, `arrayBuffer()`, or a stream tee.
Keep title/description out of the upload request.

The object port can accept an optional `contentLength` for exact-length streams;
both adapters must enforce it, including zero, truncated input, and excess bytes.
Keep any Worker-specific fixed-length stream implementation inside its adapter.
Worker fixed-length streams error on length mismatch; verify the actual R2 upload
path rather than relying on a Node test double. See the official
[FixedLengthStream reference](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)
and [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

**Configuration.** Add `config.env.FILES.maxUploadBytes` and
`config.env.FILES.bucket`, with the same default limit and logical bucket on all
supported environments. Validate at boot. Node paths remain relative to
`DATA_DIRECTORY`; Cloudflare uses a private R2 binding. Do not expose a direct
bucket URL that bypasses publication checks. Raising the application limit does
not override hosting limits: Cloudflare documents account-dependent request-size
limits and a 128 MB Worker memory limit in its
[platform limits](https://developers.cloudflare.com/workers/platform/limits/).

**Serving.** Resolve publication state afresh before any conditional response.
Use a quoted opaque ETag tied to the committed content generation, so replacement
also invalidates a cached filename/content-type representation even if bytes
match. Admin-only metadata edits do not change it. Support GET and HEAD,
If-None-Match lists, weak comparison, and `*`. Never return `304` for unpublished
or absent files. Return non-cacheable `404` responses so publication is visible
on the next request. Ignore Range and serve the full representation; do not
advertise byte ranges. Close/cancel unused streams on HEAD, 304, and errors.

Choose inline disposition from a small explicit MIME allowlist using the existing
extension mapping. All other types are attachments, with unknown types defaulting
to `application/octet-stream`. Emit `X-Content-Type-Options: nosniff`. Normalize
filenames to basenames, reject control/header-injection characters, and encode
download filenames safely, including Unicode. Do not infer permission to render
markup from a browser-supplied MIME value. Serve original bytes without conversion.

**Forms and browser state.** Native listing/detail actions use CSRF-protected
POST forms and redirects. Upload rows enhance their independent metadata and
publish forms so a row action never navigates away from other uploads. Prefer
Hyperview partial responses for row updates. Keep metadata inputs intact when
upload completes; saving snapshots current values and must not discard edits
typed while that save is in flight. No autosave or implicit metadata save on
Publish. Warn about pending uploads, saves, or dirty metadata only while present.
Browser unload/abort is best effort: a request already committed may remain,
consistent with the accepted uncertain-response/duplicate behavior.

### Required documentation during implementation

Read the full applicable guide before modifying its area:

- `README.md` — local target instances, linting, test commands.
- `src/docs/code-style-guide.md` and `src/docs/code-documentation-guide.md` —
  server JavaScript, structure, and exported contracts.
- `src/docs/server-error-handling.md` — expected errors, causes, and fatal bugs.
- `src/plugins/README.md` and `docs/configuration.md` — portable contracts,
  adapter ownership, registration, configuration, and bindings.
- `src/app/collections/README.md` and
  `src/app/transaction-scripts/README.md` — persistence and domain boundaries.
- `src/app/presentation/README.md` — routing, forms, CSRF, partial rendering.
- `src/templates/README.md` and `src/docs/frontend-development-guide.md` —
  templates, existing design primitives, browser behavior, and lint constraints.
- `test/unit-tests/README.md` and `test/end-to-end/README.md` — test conventions
  and live-target implications.

## Implementation tasks

### Task F1: Support bounded streaming storage on both platforms

**Status:** Complete
**Depends on:** None
**Documentation:** Implementation Approach: Upload transport and Configuration;
`src/plugins/README.md`; `docs/configuration.md`;
`src/kixx/object-store/object-store-interface.js`; testing and server-code guides.

**Objective**

Provide a configured private files bucket and a streaming write contract that
enforces declared byte counts on both Node.js and Cloudflare.

**Scope**

- In: ObjectStore exact-length support, platform adapters, file configuration,
  boot validation, and shared adapter contract tests.
- Out: File records/lifecycle (F2), HTTP handling (F3/F4), and UI (F5/F6).

**Design and invariants**

- Add optional `contentLength` to write options without breaking existing callers.
  Supplied values are nonnegative safe integers; mismatch fails the write.
- Stream with backpressure. Count bytes and stop excess input; do not buffer the
  full body. Handle producer failure and cancellation without unhandled promises.
- In Cloudflare, keep fixed-length bridging in the adapter and verify R2 accepts
  the resulting stream. Zero-length uploads must work.
- Add `FILES` config with `maxUploadBytes: 52428800` and `bucket: 'files'` in every
  existing Node environment and Cloudflare production. Add the bucket allowlist
  entry; use a private R2 binding such as `OBJECT_STORE_FILES`.
- Preserve the existing `uploads` bucket. No dependency installation or global
  runtime changes. Do not add range support.

**Expected touch points**

- `src/kixx/object-store/object-store-interface.js` — optional length contract.
- `src/plugins/node-object-store/lib/object-store.js` — byte-count enforcement.
- `src/plugins/cloudflare-object-store/lib/object-store.js` — R2 streaming bridge.
- `src/node-config.js`, `src/cloudflare-config.js`, `src/app/app.js` — configuration
  and early invariants.
- `test/unit-tests/kixx/object-store/object-store-conformance.js` — shared cases.
- `test/unit-tests/plugins/node-object-store/` and
  `test/unit-tests/plugins/cloudflare-object-store/` — adapter coverage.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [ ] Both adapters accept exact-length streaming writes, including empty input.
- [ ] Short, excessive, failed, and canceled streams fail without publishing a
  partial object as successful.
- [ ] Existing callers without the new option retain their behavior.
- [ ] Configuration covers both platforms and all current Node environments.
- [ ] Private R2 provisioning requirements and stream-runtime validation are
  recorded for F7; a mocked R2 test is not presented as runtime proof.

**Validation**

- `node run-linter.js` — JavaScript lint, including changed contracts/config.
- `node run-tests.js test/unit-tests/plugins/node-object-store test/unit-tests/plugins/cloudflare-object-store` — adapter conformance after adding these suites.
- `node run-tests.js` — full required unit suite.
- F7 verifies actual Worker/R2 behavior with normal, zero-byte, and limit uploads.

**Progress and handoff**

- Completed: Added optional exact-length writes to the ObjectStore contract and
  both adapters; Node stages and counts before publication, while Cloudflare
  bridges Web streams through `FixedLengthStream` and awaits producer/storage
  settlement. Added the private `files` bucket, `FILES` settings, boot
  invariants, and shared adapter contract coverage.
- Current state: Complete. Repository tests and F7's live Worker/R2 validation
  passed.
- Remaining: Nothing.
- Decisions and discoveries: Length mismatch uses the stable expected error code
  `ObjectContentLengthMismatch`. Existing callers remain on the unsized path.
  The Cloudflare config names the required private bucket but does not provision
  it. The existing `uploads` bucket remains configured on Node.
- Actual files changed: `src/kixx/object-store/object-store-interface.js`,
  `src/plugins/node-object-store/lib/object-store.js`,
  `src/plugins/cloudflare-object-store/lib/object-store.js`,
  `src/node-config.js`, `src/cloudflare-config.js`, `src/app/app.js`,
  `test/unit-tests/kixx/object-store/object-store-conformance.js`,
  `test/unit-tests/plugins/node-object-store/lib/object-store.test.js`, and
  `test/unit-tests/plugins/cloudflare-object-store/lib/object-store.test.js`.
- Validation run: `node run-linter.js` passed; focused object-store suites passed
  (5 tests); `node run-tests.js` passed (1,378 tests); `git diff --check` passed.
- Blockers: None for repository work. Live R2 provisioning and runtime access
  remain an F7 prerequisite.

### Task F2: Implement stable file identity and mutable file lifecycle

**Status:** Complete
**Depends on:** F1
**Documentation:** Approved behavior; Storage and replacement, Last write wins,
Deletion and cleanup; Collections, Transaction Scripts, Forms, and error guides.

**Objective**

Create, replace, edit, publish, unpublish, list, read, and delete files with stable
UUIDs and operation-specific last-write-wins behavior.

**Scope**

- In: File record schema, document/blob gateways, validated input Forms,
  Transaction Scripts, normal cleanup, and race/failure tests.
- Out: Routes/authentication (F3), HTTP caching/disposition (F4), UI (F5/F6).

**Design and invariants**

- Register `File` and `FileContent` Collections. Storage keys, list ordering,
  pagination defaults, and record wrapping belong to the gateways.
- Use the existing random UUID hook. Establish an immutable sort key at initial
  successful upload, including a UUID tie-breaker; scan descending, limit 25.
  Replacement and metadata saves never recompute original-upload order.
- Keep one active content reference. Write fresh attempt bytes first, then
  commit the reference, then clean up displaced/uncommitted bytes.
- Use internal retries for field-specific patches; preserve publication status
  observed at commit, so a concurrent unpublish is not undone by replacement.
- Metadata saves patch title/description only. Publish/unpublish patch only
  publication state. Client input cannot supply storage keys or server ETags.
- Write scripts receive validated Forms; read scripts receive query values.
  Keep raw HTTP request/response objects out of the domain.
- Delete only while unpublished at commit. Deleted identities cannot be recreated
  by a late edit or replacement. Clean up known objects and document recovery
  for interrupted physical cleanup without adding user-visible version history.
- Normal input, stream disconnects, size violations, and storage failures remain
  expected errors. Preserve causes; do not crash a healthy server for an abort.

**Expected touch points**

- `src/app/collections/file-collection.js`, `file-record.js`,
  `file-content-collection.js` — record invariants and storage gateways.
- `src/app/transaction-scripts/files/` — one named script per operation.
- `src/app/presentation/forms/files/` — upload headers, metadata, file actions.
- `src/app/app.js` — gateway registration.
- Corresponding `test/unit-tests/app/collections/`,
  `test/unit-tests/app/transaction-scripts/files/`, and
  `test/unit-tests/app/presentation/forms/files/` suites.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [ ] New uploads are unpublished; duplicate uploads get independent UUIDs.
- [ ] Replacement preserves identity, metadata, order, and current publication
  state while updating the entire content reference atomically.
- [ ] Metadata bounds, zero-byte uploads, and configured size limits are enforced.
- [ ] Failed replacement never exposes incomplete bytes or a mismatched ETag.
- [ ] Concurrent unrelated edits survive; same-field writes use last commit wins.
- [ ] Publish/delete and replacement/delete races cannot resurrect deleted files
  or delete published files contrary to the deletion precondition.
- [ ] Pagination has deterministic ties and no user-facing search/filter surface.
- [ ] Cleanup errors cannot delete the winning content or misreport committed state.

**Validation**

- `node run-linter.js` — server and test lint.
- `node run-tests.js test/unit-tests/app/collections test/unit-tests/app/transaction-scripts/files test/unit-tests/app/presentation/forms/files` — lifecycle and input tests.
- `node run-tests.js` — full required unit suite.
- Use deterministic interleavings/failure injection for metadata versus replace,
  replace versus replace, unpublish versus replace, and delete versus publish.

**Progress and handoff**

- Completed: Added validated File records, deterministic newest-first paging,
  the private content gateway, upload/metadata/action Forms, and Transaction
  Scripts for create, replace, metadata, publish, unpublish, get, list, and
  conditional delete. Fresh generation keys protect replacements; field-specific
  retries preserve unrelated concurrent writes; post-commit cleanup cannot undo
  or misreport the winning pointer.
- Current state: Complete. The storage/domain lifecycle is registered and used
  by the completed HTTP and presentation layers.
- Remaining: Nothing. Operational orphan cleanup can list
  `<file UUID>/<generation UUID>` keys and remove references not named by the
  current File record.
- Decisions and discoveries: MIME type is derived from the shared extension map,
  ignoring browser claims. Blank metadata normalizes to null. Replacement retry
  tracks the content displaced by the successful commit, so overlapping
  replacements cannot delete the winning content. Cleanup failure is logged
  after a committed mutation and does not turn the successful logical change
  into a failed result.
- Actual files changed: `src/app/app.js`,
  `src/app/collections/file-collection.js`, `file-record.js`, and
  `file-content-collection.js`; `src/app/presentation/forms/files/`;
  `src/app/transaction-scripts/files/`; and matching tests under
  `test/unit-tests/app/collections/`, `app/presentation/forms/files/`, and
  `app/transaction-scripts/files/`.
- Validation run: `node run-linter.js` passed; focused F1/F2 suites passed (20
  tests); `node run-tests.js` passed (1,378 tests); `git diff --check` passed.
- Blockers: None.
- Fixed during F7: zero-byte uploads failed with `422` because Node.js and
  Workers expose an empty request body as `null`; `UploadFileForm` now turns a
  declared-zero upload with no body into empty bytes. A declared-size
  mismatch returned `500 ObjectContentLengthMismatch`; `storeContent()` in
  `transaction-scripts/files/lib.js` now translates it to
  `400 FileContentLengthMismatch` with the cause. Files:
  `upload-file-form.js`, `files/lib.js`, `create-file.js`, `replace-file.js`,
  and tests in `file-forms.test.js` and `replace-file.test.js`.

### Task F3: Expose authenticated admin file operations

**Status:** Complete
**Depends on:** F2
**Documentation:** Upload transport; `src/app/presentation/README.md`;
`src/app/permissions/roles.js`; server error and testing guides.

**Objective**

Provide session-authenticated admin endpoints for file operations, with early
authorization/CSRF checks and consistent browser error handling.

**Scope**

- In: Routes, role grants, header CSRF validation, raw upload handlers, action
  handlers, partial-response contracts, and authorization tests.
- Out: Public bytes/caching (F4), page markup (F5), browser queue (F6), external API.

**Design and invariants**

- Add exact `urn:kixx:publishing:files` grants for get/list/create/update/delete
  to the three non-root roles; Root Admin already has wildcard access. Extend
  Editor's registry assertion only for this exact resource. Publishing tokens
  still cannot authenticate against the admin-panel surface.
- Authenticate and authorize every file route through existing middleware.
  Authenticate/authorize and validate header CSRF before consuming upload bytes.
- Factor token verification in `csrf.js` so form-data and header paths share the
  same signer, cookie binding, expiry behavior, and error code.
- Proposed route surface: GET/HEAD `/admin/files`, `/admin/files/new`, and
  `/admin/files/:fileId`; POST `/admin/files/upload`, and
  `/admin/files/:fileId/{metadata,replace,publish,unpublish,delete}`; authenticated
  GET/HEAD `/admin/files/:fileId/download`. Use separate actual route definitions,
  not a literal brace-alternation pattern. Specific routes precede dynamic ones.
- Upload and replace requests carry raw bytes and validated headers. Initial
  success returns the new identity and server-rendered row controls; replacement
  success identifies the unchanged file. Finish storage commit before success.
- Metadata/publish row actions can request a Hyperview partial without leaving
  the batch page; normal submissions use redirects. Compile links/actions with
  reverse routing. Never accept arbitrary redirect destinations.
- Use a local machine-readable error contract for upload requests, including
  authentication expiry, CSRF expiry, validation, limit, and storage errors.
  Do not let an HTML login/error response appear as a successful upload.
- Missing or invalid UUIDs fail at presentation validation. Content-size failures
  return `413`; other input errors use project HTTP errors. No upload action
  implicitly changes title/description or publishes a new file.

**Expected touch points**

- `src/routes/admin-panel.js` — admin route surface before fallback.
- `src/app/permissions/roles.js` — narrow file-management grants.
- `src/app/presentation/lib/csrf.js` — header validation sharing existing logic.
- `src/app/presentation/request-handlers/admin-panel/admin-files.js` and
  `mod.js` — request parsing, actions, response contracts.
- `src/app/presentation/error-handlers/` — narrowly scoped upload errors if needed.
- Existing CSRF, role, and route tests plus new admin-file handler tests.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [ ] All four roles can manage shared files; unrelated permissions stay intact.
- [ ] Unauthenticated, unauthorized, and invalid-CSRF uploads fail before body
  storage, including when a raw stream is supplied.
- [ ] Existing CSRF-protected forms still work, including multiple tabs/forms.
- [ ] File operations call Forms/Transaction Scripts instead of raw platform APIs.
- [ ] Upload/row responses support independent batch controls without navigation.
- [ ] Limits and expected failures have correct status codes and usable messages.

**Validation**

- `node run-linter.js` — routes, permissions, handlers, helpers, and tests.
- `node run-tests.js test/unit-tests/app/permissions test/unit-tests/app/presentation test/unit-tests/routes` — auth, CSRF, handler, and route regressions.
- `node run-tests.js` — full required unit suite.
- Test that a forbidden upload's body reader/storage gateway is never invoked.

**Progress and handoff**

- Completed: Added exact file-management grants for Developer, Admin, and
  Editor; added ordered listing, creation, detail, download, upload,
  replacement, metadata, publication, and deletion routes; factored shared
  header/form CSRF verification; and added handlers that construct F2 Forms,
  call Transaction Scripts, redirect normal form actions, and return local JSON
  contracts for raw uploads and partial row actions. Upload errors are returned
  as machine-readable JSON, including errors raised by ancestor authentication.
- Current state: Complete. The page templates and browser JavaScript use the
  authenticated endpoint and transport contracts.
- Remaining: Nothing.
- Decisions and discoveries: The raw upload headers are intentionally local to
  the admin browser surface. Authorization remains before handlers, and header
  CSRF verification is the first operation inside raw handlers, so rejected
  requests never read or store body bytes. File partial responses use JSON until
  F5 provides server-renderable row sources; they include file state and
  reverse-routed detail, download, and public links.
- Actual files changed: `src/app/permissions/roles.js`,
  `src/app/presentation/lib/csrf.js`,
  `src/app/presentation/error-handlers/file-upload-error-handler.js`,
  `src/app/presentation/request-handlers/admin-panel/admin-files.js`,
  `src/app/presentation/request-handlers/admin-panel/mod.js`,
  `src/routes/admin-panel.js`; tests in
  `test/unit-tests/app/permissions/roles.test.js`,
  `test/unit-tests/app/presentation/lib/csrf.test.js`, and
  `test/unit-tests/routes/admin-panel.test.js`.
- Validation run: `node run-linter.js` passed; focused permissions,
  presentation, and route suites passed (165 tests); `node run-tests.js` passed
  (1,394 tests); `git diff --check` passed.
- Blockers: None.

### Task F4: Serve stable public URLs and private admin downloads

**Status:** Complete
**Depends on:** F2, F3
**Documentation:** Serving; `src/app/presentation/README.md`;
`src/kixx/object-store/object-store-interface.js`; server error and testing guides.

**Objective**

Serve the current published bytes with correct revalidation while allowing
authenticated attachment downloads regardless of publication state.

**Scope**

- In: Public route, binary handlers, response headers, MIME/disposition policy,
  conditional requests, stream disposal, and serving-race tests.
- Out: Byte ranges, public metadata pages, transforms, direct bucket URLs,
  immutable CDN caching, or a custom content-type editor.

**Design and invariants**

- Mount `/files/:fileId` before the static-asset/Hyperview catch-all. Reserve
  this namespace even for missing/unpublished files; never fall through to CAS.
- Read current publication state before matching ETags, including `*`. Do not
  cache file records in eventual-consistency KV or rendered-page cache.
- Published GET returns current bytes, length, content type, safe disposition,
  quoted ETag, nosniff, and `public, no-cache`. HEAD returns equivalent headers
  without a body. Matching If-None-Match returns bodyless `304` with validators
  and cache policy. Missing/unpublished responses are `404` with `no-store`.
- Admin GET/HEAD requires file privileges and always returns attachment
  disposition with `private, no-store`. No metadata leaks on public errors.
- Ignore Range/If-Range; never return `206` or advertise `Accept-Ranges: bytes`.
- Use metadata/ETag from the committed content reference. For public serving,
  when an old object disappears between record lookup and object read, resolve
  the record again with bounded retry rather than returning mismatched headers
  or false absence. Retrying authenticated admin downloads during this
  replacement race is outside Phase 1.
  Requests already reading committed old bytes may finish during replacement.
- Public representation ETags change on replacement, not title/description edits.
  Unpublish is checked even for validators issued before publication changed.
- Cancel unused body streams on early conditional responses and failed reads.

**Expected touch points**

- `src/virtual-hosts.js` and proposed `src/routes/files.js` — public route mount.
- `src/app/presentation/request-handlers/files/` — public/admin binary responses.
- `src/app/presentation/lib/file-response.js` — shared disposition/validator logic
  if it earns reuse between the two handlers.
- `src/kixx/static-assets/mime-types.js` — reuse existing mapping; only extend
  mappings when needed, preserving static-asset behavior.
- Corresponding handler, header-policy, and route unit tests.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [ ] GET/HEAD and conditional requests work before/after replacement and
  publish/unpublish/republish at the same UUID pathname.
- [ ] Stale ETags never hide replacement; matching ETags never reveal unpublished
  content. Unpublished `404` responses cannot remain fresh in caches.
- [ ] Public raster/PDF/media/plain-text responses are inline; markup/unknown
  responses and all admin downloads are attachments.
- [ ] Unicode and hostile filenames produce valid headers without injection.
- [ ] Zero bytes, ignored Range headers, and concurrent replacement are covered.

**Validation**

- `node run-linter.js` — handlers and tests.
- `node run-tests.js test/unit-tests/app/presentation test/unit-tests/routes` —
  validators, headers, authorization, and route precedence.
- `node run-tests.js` — full required unit suite.
- F7 runs the same HTTP cases against Node.js and Cloudflare.

**Progress and handoff**

- Completed: Reserved `/files/:fileId` before every catch-all and added public
  GET/HEAD serving plus authenticated admin GET/HEAD downloads. Responses use
  generation validators, weak/list/star If-None-Match matching, explicit inline
  MIME policy, safe ASCII and RFC 5987 filenames, nosniff, exact lengths, and
  the required public/private cache policies. Public absence and unpublication
  return non-cacheable 404s; Range is ignored; HEAD and 304 are bodyless.
- Current state: Stable public URLs and private admin downloads are complete on
  the shared Web-stream presentation boundary.
- Remaining: Nothing. F7 exercised the HTTP cases against live Node and
  Worker/R2 targets. Admin-download retry during replacement remains outside
  Phase 1.
- Decisions and discoveries: The committed generation is the representation
  ETag, so replacement invalidates clients even when object bytes hash equally.
  The handler does not open storage for a 304. If an opened record points to a
  missing object, the public handler re-resolves the record through bounded
  retries before treating the inconsistency as an operational failure. Public markup and
  unknown types are attachments; only the explicit raster, PDF, audio, video,
  and plain-text allowlist is inline.
- Actual files changed: `src/virtual-hosts.js`, `src/routes/files.js`,
  `src/app/presentation/lib/file-response.js`,
  `src/app/presentation/request-handlers/files/file-content.js`,
  `src/app/presentation/request-handlers/files/mod.js`, and tests in
  `test/unit-tests/app/presentation/lib/file-response.test.js`,
  `test/unit-tests/app/presentation/request-handlers/files/file-content.test.js`,
  and `test/unit-tests/routes/files.test.js`. The admin download route and grant
  integration also touch the F3 files listed above.
- Validation run: `node run-linter.js` passed; focused permissions,
  presentation, and route suites passed (165 tests); `node run-tests.js` passed
  (1,394 tests); `git diff --check` passed.
- Blockers: None.
- Fixed during F7: every public and admin `GET` sent headers, including
  `content-length`, but no body, then stalled until the connection closed.
  `respondFile()` read `request.isHeadRequest` as a property, but it is a
  method, so the always-truthy function dropped and canceled every body. The
  unit mock had the same mistake and now models a method. Plain text was also
  served as an attachment, because the map emits `text/plain; charset=utf-8`
  and the inline allowlist matched exact strings; disposition now matches the
  media type essence. Files: `file-content.js`, `file-response.js`, and tests in
  `file-content.test.js` and `file-response.test.js`.

### Task F5: Build the file listing and detail workflows

**Status:** Complete
**Depends on:** F3, F4
**Documentation:** Approved behavior; Forms and browser state; Presentation,
Templating, and Frontend Development guides; live admin style guide.

**Objective**

Let admins discover all uploaded files, manage publication, and perform file
detail operations through the existing admin shell.

**Scope**

- In: Listing/detail templates, form contexts, pagination links, admin directory
  entry, confirmations, notices, and replacement upload markup.
- Out: Batch selection/queue and replacement JavaScript transport (F6), search,
  filters, audit displays, bulk publication controls.

**Design and invariants**

- Add a Files entry to the admin directory. Use page-local sources under
  `src/pages/admin/files/`, with a stable `detail` page pathname for UUID routes.
- Listing shows title fallback, filename, size, publication state, detail link,
  and a separate state-appropriate Publish/Unpublish POST form per row.
- Use signed keyset cursors, newest first, 25 per page. Preserve valid pagination
  context after actions; an empty final page still offers a route back.
- Detail shows the permanent URL, current content information, metadata form,
  download, publication controls, replacement input, and delete workflow.
- Delete requires explicit confirmation and an unpublished record. Published
  replacement requires client-side confirmation before sending bytes based on
  the state rendered on the detail page; the replacement POST does not recheck
  confirmation or publication state. Plain unpublish is immediate. Recheck the
  delete confirmation and unpublished precondition in the POST workflow.
- Render accessible labels, errors, notices, and focus states. Reuse copy-field,
  form, button, and layout primitives. No inline style attributes.
- Disable page caching for CSRF forms and send private/no-store admin responses.
  JavaScript metadata validation preserves entered values and field errors. The
  no-JavaScript path may redirect with a generic notice and discard invalid input.
- Ordinary metadata/publication/delete forms work without JavaScript. Replacement
  upload explicitly requires JavaScript under the approved exception.

**Expected touch points**

- `src/pages/admin/files/page.json`, `page.html` — listing.
- `src/pages/admin/files/detail/` — detail templates and page-local partials.
- `src/pages/admin/page.html` — Files directory entry.
- `src/app/presentation/request-handlers/admin-panel/admin-files.js` — render props,
  form contexts, redirects, and notices.
- Page-local CSS only if existing shared components are insufficient.
- Admin-page handler tests and F7 HTML workflow tests.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [x] Listing paginates at 25, orders correctly, and exposes publication actions.
- [x] Detail supports metadata, download, publication, delete, and replacement UI.
- [x] Stable URL is visible while unpublished and does not change after edits.
- [x] Client-side replacement confirmation and server-side delete confirmation
  work; JavaScript metadata validation preserves context, while the no-JavaScript
  path uses the accepted generic notice.
- [x] HTML forms work without JavaScript except the agreed upload functionality.
- [x] Layout is usable on mobile/desktop, with keyboard access and both themes.

**Validation**

- `node run-linter.js` — changed server JavaScript and tests.
- `node run-tests.js` — full required unit suite when server JavaScript changes.
- F7's local target: review `/admin/style-guide`, listing, detail, empty state,
  26-file pagination, validation errors, confirmations, and no-JavaScript forms.

**Progress and handoff**

- Completed: Added `src/pages/admin/files/` (listing), `.../detail/` (detail),
  and a Files card on the admin directory. Listing shows title-fallback,
  filename, size, publication state, a detail link, and a state-appropriate
  Publish/Unpublish form per row, reusing one page-level CSRF token
  (`getCsrfToken()`, new in `csrf.js`) instead of minting one per row. Detail
  shows the permanent URL (via a `copy-field`, always visible), current
  content info, a metadata form, download link, publish/unpublish, a
  replacement upload section (markup only — behavior is F6), and a delete
  form gated by a native `required` confirmation checkbox instead of a
  server round trip. Extended `FileMetadataForm` with `static target`/
  `method` and a non-schema `fileId` so it can reverse-compile its own action
  URL and be reused as the page's shared CSRF source. Rewrote `admin-files.js`
  to wire pagination (`getCursorPaginationQueryParams`/
  `createCursorPaginationLinks`, previously unused by this handler), reverse-
  routed every link (including two that were still hardcoded strings), and
  added `getNewFiles` for the F6 upload page's CSRF/URL props.
- Current state: Complete. Focused handler tests, the full suite, and F7's
  browser pass cover the listing, detail, and directory-entry workflows.
- Remaining: Nothing. The no-JavaScript metadata path's generic validation
  notice is an accepted Phase 1 limitation; see Decisions below.
- Decisions and discoveries: (1) Found and fixed a pre-existing F3 bug —
  `respondAfterAction()` redirected to `file-detail/render-detail` by passing
  the whole `file` object as compile params instead of `{ fileId: file.id }`;
  the route needs `:fileId`, the object only has `.id`, so every non-partial
  publish/unpublish/metadata success would have thrown compiling the
  redirect. (2) The metadata POST route has no `HyperviewPageHandler` in its
  target chain (see `fileActionRoutes()`), so a validation failure cannot
  re-render the detail page inline the way other CSRF-protected forms in
  this codebase do. Decision: a `kixx-partial` (JavaScript) submission gets
  the full field-level errors back as JSON, preserving typed text — this is
  what F6's row editor actually uses; a plain HTML submission instead
  redirects to the detail page with a generic `?notice=metadata_invalid`
  query flag, since the specific invalid text cannot survive a redirect.
  This is a disclosed simplification of "preserve context" for the no-JS
  path only. (3) Row-level publish/unpublish/delete/metadata actions each
  compile to their own per-file URL (`/files/:fileId/<action>`), unlike the
  existing invites/tokens list pattern (one shared action URL + hidden id
  field), so those forms reuse one page-level CSRF token via the new
  `getCsrfToken()` helper in `csrf.js` rather than going through
  `BaseForm#getFormContext()` for each row.
- Actual files changed: `src/pages/admin/files/page.json`, `page.html`;
  `src/pages/admin/files/detail/page.json`, `page.html`; `src/pages/admin/page.html`;
  `src/app/presentation/request-handlers/admin-panel/admin-files.js`;
  `src/app/presentation/forms/files/file-metadata-form.js`;
  `src/app/presentation/lib/csrf.js` (added `getCsrfToken()`); `src/routes/admin-panel.js`
  (wired `getNewFiles`); and `test/unit-tests/app/presentation/request-handlers/admin-panel/admin-files.test.js`,
  `test/unit-tests/app/presentation/lib/csrf-token-helper.test.js` (new).
  `src/pages/admin/files/new/` and the upload-queue error handler are shared
  with F6 and are recorded once, under F6.
- Validation run: `node run-linter.js` passed (repo-wide); `node run-tests.js`
  passed (1,400 tests, up from 1,394); `git diff --check` passed.
- Blockers: None.
- Verified during F7: F7's browser pass on a Node target covered the empty
  state, 26-file pagination, the validation notice, both confirmations, the
  no-JavaScript forms, 390 px and desktop layouts in light and dark, and
  keyboard order and focus, so the two rendered-page criteria above are now
  checked. The no-JavaScript metadata path still reports a generic notice
  rather than echoing invalid text (decision (2) above).
- Fixed during F7: the delete confirmation was only the checkbox's native
  `required`, so a crafted or scripted POST skipped it, contrary to "recheck
  required confirmations". `postFileDelete()` now requires
  `confirm_delete=yes` and otherwise throws `400 FileDeleteNotConfirmed`
  before any storage call. Files: `admin-files.js` and `admin-files.test.js`.

### Task F6: Add independent batch uploads and replacement progress

**Status:** Complete
**Depends on:** F3, F5
**Documentation:** Approved behavior; Upload transport; Forms and browser state;
Frontend Development and Templating guides; `eslint.config.js` browser rules.

**Objective**

Let admins upload batches while editing metadata on the same page, with
independent progress, retry, cancellation, saving, and publication controls.

**Scope**

- In: Upload page, row partials, queue/progress JavaScript, enhanced row forms,
  navigation warnings, and reuse for detail-page replacement.
- Out: Autosave, resumable uploads, retry deduplication, persistent browser queues,
  background uploads after navigation, and new UI dependencies.

**Design and invariants**

- Attach a files behavior through `data-js-behavior` in the existing `site.js`.
  Use DOM APIs and server-rendered templates/partials; never interpolate filenames
  or metadata into unsafe HTML strings. Add required globals to ESLint explicitly.
- Selecting files creates editable rows immediately. Start at most three
  XMLHttpRequests; release a slot on success, failure, or abort. Preflight the
  size locally while keeping server enforcement authoritative.
- Track queued/uploading/finishing/succeeded/failed/canceled states separately
  from metadata dirty/saving/error and publication state. Reaching 100% uploaded
  is not success until the server confirms storage/record commit.
- Save metadata becomes available after that file succeeds. Save and Publish
  are independent row forms enhanced to stay on the page. Updating one row must
  not reset another row, interrupt its upload, or discard text typed during save.
- Retry sends a fresh request from the beginning with the retained File object;
  it can create a duplicate after an uncertain server outcome. No idempotency key.
- Cancel removes queued work or aborts the active request, retaining row data
  for retry. Once success is known, deletion uses the normal detail workflow.
- Warn on navigation only while uploads, saves, or unsaved metadata remain.
  Abort active requests and abandon queued work on exit where the browser allows;
  do not imply cancellation can retract a completed server commit.
- Replacement uses the same raw upload transport and progress reporting but
  targets the existing UUID. It uses client-side published-file confirmation.
  Cancel, retained retry, and navigation protection for replacement are outside
  Phase 1. Do not offer replacement from the batch creation page.
- Use accessible progress/status output and bounded live announcements. Surface
  CSRF/session expiry per row without silently losing other selected files.

**Expected touch points**

- `src/pages/admin/files/new/` — batch page and row partial sources.
- `src/pages/admin/files/detail/` — replacement behavior hooks/status.
- `src/static-assets/javascript/site.js` — queue, transport, form enhancement.
- `eslint.config.js` — globals for APIs actually used, such as XMLHttpRequest.
- `src/app/presentation/request-handlers/admin-panel/admin-files.js` — final row
  partial data/response integration if needed.
- Browser behavior tests using existing tooling where practical; F7 manual matrix.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

- [ ] Selection starts immediately; a fourth file waits until a slot is free.
- [ ] A failed or canceled row cannot stop other uploads or lose entered metadata.
- [ ] Each successful row saves metadata and publishes independently, without
  navigating or implicitly saving unsaved fields.
- [ ] Retry starts from zero and keeps the selected file/text in the open page.
- [ ] Upload completion/save responses preserve newer locally typed text.
- [ ] Navigation warning clears when work is settled; no background persistence.
- [ ] Published replacement confirms before upload and retains its permanent URL.

**Validation**

- `node run-linter.js src/static-assets/javascript eslint.config.js` — browser lint.
- `node run-linter.js` — remaining changed JavaScript.
- `node run-tests.js` — required when server JavaScript changes; run any newly
  added browser-behavior unit tests through the same runner.
- F7 browser checks: four-plus files, throttled progress, one oversize/failure,
  cancel/retry, edit during upload/save, publish with unsaved metadata, session
  expiry, and navigation while active versus fully saved.

**Acceptance criteria**

- [x] Selection starts immediately; a fourth file waits until a slot is free.
- [x] A failed or canceled row cannot stop other uploads or lose entered metadata.
- [x] Each successful row saves metadata and publishes independently, without
  navigating or implicitly saving unsaved fields.
- [x] Retry starts from zero and keeps the selected file/text in the open page.
- [x] Upload completion/save responses preserve newer locally typed text.
- [x] Navigation warning clears when work is settled; no background persistence.
- [x] Published replacement confirms before upload and retains its permanent URL.

**Progress and handoff**

- Completed: Added `src/pages/admin/files/new/` (batch upload page with a
  `<template>`-based row) and two new `data-js-behavior` blocks in `site.js`:
  `file-upload-queue` (batch page) and `file-replace` (detail page). The queue
  runs at most 3 concurrent `XMLHttpRequest` uploads with the rest queued;
  each row is its own closure tracking upload state (`queued`/`uploading`/
  `succeeded`/`failed`/`canceled`) independently from metadata
  dirty/saving state and publication state, per the plan's state-separation
  requirement. Save-metadata and Publish/Unpublish are `fetch()`-based row
  actions sent with a `kixx-partial` header so they never navigate; a
  snapshot-and-compare guard in `saveMetadata()` keeps a response from
  overwriting text the operator typed after the request was sent. Retry
  re-enters the same queue with the retained `File` object, starting a fresh
  `XMLHttpRequest` from byte zero. `beforeunload` only warns while some row
  still has unfinished upload/save work. Replacement on the detail page
  reuses the same raw-XHR-with-progress transport, gated by `window.confirm()`
  when the file is currently published, and reloads the page on success so
  the refreshed content info/etag come from the server rather than being
  hand-maintained in JS.
- Current state: Complete. The batch upload queue and Phase 1 replacement
  behavior are lint-clean and passed F7's manual browser matrix.
- Remaining: Nothing in Phase 1. Replacement cancel, retained retry, and
  navigation protection are explicitly deferred.
- Decisions and discoveries: (1) A publish/unpublish action succeeding on a
  batch row toggles one button's label between "Publish" and "Unpublish"
  rather than showing two separate buttons the way the listing/detail pages
  do — a deliberate, smaller UI for a freshly-uploaded row, not a
  correctness difference (it calls the same `links.publish`/`links.unpublish`
  URLs). (2) CSRF/session expiry during a long batch is surfaced per row: a
  new `fileActionErrorHandler` (`src/app/presentation/error-handlers/file-action-error-handler.js`)
  returns JSON only when the request carries `kixx-partial`, so a `fetch()`
  failure from an expired session parses as `{ error: { code, message } }`
  instead of an HTML error page breaking `response.json()`; a plain HTML
  submission still falls through to the normal admin error page. Wired onto
  the metadata/publish/unpublish/delete action routes in
  `routes/admin-panel.js` (replacement already had an equivalent handler,
  `fileUploadErrorHandler`, from F3). (3) The CSRF token embedded in the
  upload page and detail page is reused verbatim for both the raw-body XHR
  header (`x-kixx-csrf-token`) and the `fetch()` form-encoded body field —
  `csrf.js` tokens are not endpoint-bound, only sid/expiry-bound, so one
  minted token validates either transport. (4) No idempotency key exists for
  retry, matching the plan's explicitly accepted duplicate-on-uncertain-
  outcome tradeoff.
- Actual files changed: `src/pages/admin/files/new/page.json`, `page.html`;
  `src/static-assets/javascript/site.js` (`file-replace` and
  `file-upload-queue` behaviors); `eslint.config.js` (added `XMLHttpRequest`
  and `URLSearchParams` browser globals);
  `src/app/presentation/error-handlers/file-action-error-handler.js` (new);
  `src/routes/admin-panel.js` (wired `fileActionErrorHandler` onto the four
  action routes); `src/app/presentation/forms/files/file-upload-transport-form.js`
  (new, supplies the upload page's CSRF/URL context) and its use in
  `getNewFiles()` in `admin-files.js` (recorded under F5, since that handler
  file is shared).
- Validation run: `node run-linter.js src/static-assets/javascript eslint.config.js`
  passed; `node run-linter.js` (repo-wide) passed; `node run-tests.js` passed
  (1,400 tests); `git diff --check` passed. No browser-behavior test exists
  for this code (see Current state).
- Blockers: None for repository work. The manual browser matrix is an
  explicit F7 prerequisite and has not been run.
- Verified and fixed during F7: the browser matrix ran on a Node target (see
  F7). Defects fixed: (1) canceling a queued row and retrying it before its
  original queue entry drained uploaded the file twice; `startNext()` now
  starts only rows still `queued`, so stale entries are skipped. (2) The
  `hidden` attribute never hid `.field` or `.button` elements, whose
  component `display` beat the browser default, so every Retry and Cancel
  button and finished progress bar stayed visible; `reset.css` now has a
  `[hidden]` rule. (3) Upload-row Title and Description inputs had no
  accessible names; each row now gets unique ids, its labels point at its
  fields, and its progress bar and buttons are described by its filename.
  The detail page's replacement progress bar is labeled. (4) A failed row
  Publish/Unpublish re-enabled the button silently; it now shows the error in
  the row's status line. Files: `site.js`, `reset.css`,
  `pages/admin/files/new/page.html`, `pages/admin/files/detail/page.html`.

### Task F7: Verify the complete feature and document operations

**Status:** Complete
**Depends on:** F1, F2, F3, F4, F5, F6
**Documentation:** Entire approved behavior; `README.md`; Configuration,
Unit Testing, and End-to-End Testing guides.

**Objective**

Demonstrate the agreed workflows on Node.js and Cloudflare and document the
configuration, limits, provisioning, and recovery needed to operate them.

F7 has two phases with different owners:

- **Phase A — agent.** All repository work and all Node.js validation: the
  end-to-end suite, Local Target Instance runs, the browser matrix,
  documentation, and a Cloudflare runbook for Phase B.
- **Phase B — operator.** Provision the private R2 bucket and binding, deploy
  to Cloudflare, then run the Cloudflare end-to-end and validation steps from
  the Phase A runbook. Agents never deploy, provision, or run tests against a
  Cloudflare target.

**Scope**

- In (Phase A, agent): HTTP end-to-end suite, Node Local Target Instance runs,
  browser acceptance checks on Node, configuration/operator documentation, the
  Phase B runbook, and handoff evidence.
- In (Phase B, operator): R2 bucket provisioning and binding, Cloudflare
  deployment, the end-to-end suite against Cloudflare, real Worker/R2 streaming
  and limit checks, a Cloudflare browser smoke test, and recording results.
- Out: Agent-performed deployment, provisioning, or Cloudflare test runs; new
  deployment or provisioning tooling; changing the running build during file
  tests; unrelated publishing tests; claiming mock tests prove R2 behavior.

**Design and invariants**

- Add a dedicated `test/end-to-end/100-admin-files/` suite, usable against either
  platform with session authentication and real CSRF tokens. Use unique fixtures
  and clean up its own unpublished files; never touch unrelated file records.
- The suite selects its target only through the existing e2e flags and
  environment variables. It must not read the local data directory, instance
  files, or anything else unavailable when the operator runs it against
  Cloudflare.
- Cover create/metadata/publish/replace/unpublish/republish/download/delete, four
  roles, rejected auth/CSRF, 26-file pagination, zero bytes, disposition, ETags,
  HEAD, ignored Range, and failed replacement preserving old content.
- Use small configured-limit fixtures for routine automated boundary tests;
  separately validate the default 50 MiB boundary and three simultaneous uploads
  on real platform runtimes. Respect the e2e runner's 10-second test ceiling;
  do not pretend a large-file manual check belongs in a short-timeout test.
- Phase A browser validation runs on a Node Local Target Instance and covers
  queue state, per-row independence, dirty metadata, confirmations,
  cancellation, mobile/desktop, keyboard access, and light/dark, plus F5's
  rendered-page checks.
- Use a writable Local Target Instance, not the read-only devserver, for Node
  write workflows. Read instance credentials locally; do not commit or print them.
- The Phase B runbook, written by the agent in `docs/admin-files.md`, lets an
  operator without conversation history complete Phase B. It states:
  - Preconditions: the deployed Worker contains this implementation, and the
    private bucket `kixx-test-app-production-files` is provisioned and bound as
    `OBJECT_STORE_FILES` (names from `src/cloudflare-config.js`), with no public
    bucket URL.
  - The exact e2e command and the environment variables it needs.
  - Each manual check, how to produce its fixtures (zero bytes, default-limit,
    limit + 1 byte, a truncated/disconnected upload), and the expected outcome.
  - Where to record results in this task's handoff.
  Describe what the deployment must contain; leave the deployment method to the
  operator. Do not invent deployment or provisioning commands.
- When Phase A is complete, the agent sets **Status** to `Awaiting operator` and
  leaves every Phase B criterion unchecked. Only operator-supplied results mark
  Phase B criteria done and the task `Complete`. An agent may transcribe results
  the operator provides, but must not infer them.
- Document `FILES.maxUploadBytes`, files bucket isolation, no ranges/history/API,
  per-request revalidation, cancellation's commit race, and physical orphan
  recovery following interrupted cleanup. Normal operations remove replaced and
  deleted bytes; crashed cleanup can need operator recovery.
- Record actual files changed, commands, outcomes, platform evidence, remaining
  blockers, and any design changes under the owning task as work progresses.

**Expected touch points**

- `test/end-to-end/100-admin-files/` — portable HTTP lifecycle checks.
- `test/end-to-end/README.md` — suite setup and cleanup behavior.
- `docs/configuration.md`, `README.md`, proposed `docs/admin-files.md` — setup,
  feature behavior, private R2 provisioning, recovery notes, and the Phase B
  runbook.
- `agents/plans/admin-file-management.md` — task acceptance and handoff evidence.

Treat touch points as orientation; record actual changes in the handoff.

**Acceptance criteria**

Phase A — agent:

- [x] Full unit suite and required lint pass, with no unexplained regressions.
- [x] Dedicated HTTP suite passes against a writable Node Local Target Instance.
- [x] Default 50 MiB boundary and three concurrent default-limit uploads pass on
  the Node target.
- [x] Browser matrix passes on the Node target, including editing metadata
  without leaving uploads, and F5's unchecked rendered-page criteria.
- [x] File tests do not modify site release/build pointers or leave normal fixtures.
- [x] Configuration/provisioning and cleanup limitations are documented accurately.
- [x] The Phase B runbook is complete enough for an operator to follow without
  conversation history.
- [x] All task handoffs identify actual changes and validation; incomplete runtime
  checks remain visibly incomplete rather than being marked done.

Phase B — operator:

- [x] Private files bucket is provisioned and bound as `OBJECT_STORE_FILES`; the
  deployed Worker contains this implementation. Bucket, binding, deployed
  commit, and deployment method are recorded.
- [x] Dedicated HTTP suite passes against the Cloudflare deployment.
- [x] Real Worker/R2 streaming evidence covers zero bytes, the default limit,
  limit + 1 rejection, and length mismatch/disconnect without a stored partial
  object; three concurrent default-limit uploads succeed without whole-body
  buffering.
- [x] Cloudflare browser smoke test passes: a four-file batch upload, a
  published replacement, and public serving at `/files/<uuid>`.

**Validation**

Phase A — agent:

- `node run-linter.js` — final JavaScript lint.
- `node run-tests.js` — full unit suite.
- `git diff --check` — whitespace/errors in the final diff.
- `node tools/local-target.js create admin-files` — create an unused disposable
  instance name; use another name if it already exists.
- `node tools/local-target.js seed admin-files` — seed writable application content.
- `node tools/local-target.js serve admin-files` — start the Node target.
- `node run-tests.js --e2e test/end-to-end/100-admin-files` — run with
  `E2E_TESTS_BASE_URL`, `E2E_TESTS_ROOT_USERNAME`, and `E2E_TESTS_ROOT_PASSWORD`
  populated locally from the instance credentials.
- After stopping the local server, `node tools/local-target.js destroy admin-files`
  removes the disposable instance.
- Record manual browser and large-file checks separately with target and outcome.

Phase B — operator, after deploying:

- `node run-tests.js --e2e --cloudflare test/end-to-end/100-admin-files` — run
  against the deployment with `E2E_TESTS_ROOT_USERNAME` and
  `E2E_TESTS_ROOT_PASSWORD` set for that target.
- The runbook's manual streaming, large-file, concurrency, and browser smoke
  checks, recorded with target, deployed commit, and outcome.

**Progress and handoff**

- Completed: Phase A and operator-owned Phase B. Added the portable
  `test/end-to-end/100-admin-files/`
  suite (76 tests: access control, lifecycle, content policy, roles,
  pagination) and a standalone `large-upload-checks.js` for real-size uploads.
  Ran both, plus a browser matrix, on a Node Local Target Instance. Wrote
  `docs/admin-files.md` (behavior, configuration, recovery, Phase B runbook).
  Fixed the defects the runs exposed (below, and under the owning tasks).
- Current state: Complete. Phase A and operator-owned Phase B validation passed.
  The disposable `admin-files` instance was destroyed after validation.
- Remaining: Nothing.
- Decisions and discoveries:
  - Defects found by live runs and fixed (details under F2, F4, F5, F6):
    public/admin GET sent headers but no body (F4); plain text served as an
    attachment (F4); zero-byte uploads rejected (F2); declared-size mismatch
    returned 500 (F2); cancel-then-retry of a queued row uploaded the file
    twice (F6); `hidden` never hid `.field`/`.button` elements, so Retry,
    Cancel, and finished progress bars stayed visible (F6); upload-row fields
    had no accessible names (F6); a failed row publish showed no message
    (F6); delete confirmation was not rechecked by the server (F5).
  - Unit tests missed the F4 body defect because the mock modeled
    `request.isHeadRequest()` as a boolean property. The mock is now a method.
  - Known limitation, not fixed: after session or CSRF expiry mid-batch, each
    row shows the error, but signing in again rotates the CSRF cookie, so the
    open upload page must be reloaded, abandoning unfinished rows (the page
    warns). Completed uploads persist. Documented in `docs/admin-files.md`; a
    token-refresh mechanism would be new scope.
  - Server-side upload validation errors surface the generic "The file
    upload is invalid" on the row (e.g., a control character in the
    filename); field detail is not in the upload error JSON. Left as is.
  - The suite reads the target's upload limit from the upload page, so it
    needs no local config or instance files and runs unchanged against
    Cloudflare. Real-size checks are a separate script because of the 10 s
    e2e ceiling.
  - Browser queue checks used an in-page shim that defers each
    `XMLHttpRequest.send` by 6–8 s, because localhost uploads finish in
    milliseconds. The queue code ran unmodified; the shim only simulated
    latency and made `abort()` before the deferred send behave like aborting
    an in-flight request.
  - Node streaming evidence is supporting only: server RSS rose from 99 MiB
    to a 155 MiB peak across 150 MiB of concurrent uploads. The body path
    streams through `pipeline()`, but a fast local disk would not expose
    buffering. Phase B's concurrent uploads under the 128 MB Worker limit are
    the real proof.
  - `src/cloudflare-config.js` names the private bucket and binding but does
    not provision them. Deployment tooling is outside this repository.
    Deployment and all Cloudflare validation are operator-owned.
- Actual files changed: `test/end-to-end/100-admin-files/` (`helpers.js`,
  `010-access-control.test.js`, `020-lifecycle.test.js`,
  `030-content-policy.test.js`, `040-roles.test.js`,
  `050-pagination.test.js`, `large-upload-checks.js`);
  `test/end-to-end/test-helpers/admin-workflows.js` (exported
  `createInvitedAdmin()`); `test/end-to-end/README.md`;
  `docs/admin-files.md` (new); `docs/configuration.md`; `README.md`; this
  plan. Fixes to other tasks' files are listed under F2, F4, F5, and F6.
- Validation run (Node Local Target Instance `admin-files`, Node v24.13.1):
  - `node run-linter.js` — exit 0.
  - `node run-tests.js` — 1,406 tests passed.
  - `git diff --check` — clean.
  - `node run-tests.js --e2e test/end-to-end/100-admin-files` — 76 passed.
    File documents, `files` manifest rows, and body files were 0 before and
    after; content-store index and Activation/Release rows were byte-identical
    before and after (hash comparison).
  - `node run-tests.js --e2e` (all suites) — 159 passed.
  - `node test/end-to-end/100-admin-files/large-upload-checks.js` — 7/7
    passed: 0 bytes; exactly 52,428,800 bytes stored and served with a
    matching SHA-256; 3 concurrent limit-size uploads; limit + 1 declared →
    `413 FileUploadTooLarge`; limit + 1 declared as the limit →
    `400 FileContentLengthMismatch`; disconnect after 26,214,400 bytes → no
    record, no staged temp file, server healthy (logged as an expected
    `ECONNRESET` OperationalError). No objects remained afterward.
  - Browser matrix, Chrome, Node target: six-file selection started three
    uploads with the rest queued (peak three on the wire); queued and active
    cancel; retry from zero keeping typed text; oversize (browser preflight)
    and control-character filename (server 422) failed per row without
    affecting others; title typed during upload survived completion; publish
    with unsaved metadata left the title unsaved; a save response did not
    mark newer text saved; the navigation warning showed only while work was
    pending and cleared once settled; session expiry surfaced per row; the
    published replacement confirmed before sending (decline sent nothing) and
    kept the URL; the delete checkbox blocked submission until checked;
    no-JavaScript publish, metadata, and delete forms worked; empty state,
    validation notice, and 26-file pagination rendered; 390 px layouts had no
    horizontal overflow in light or dark; keyboard tab order was logical with
    a visible focus ring, and Enter submitted Publish.
- Blockers: None.

**Phase B results**

- Deployment via `../../devkit/kixx.js cloudflare release -e production` (resulting in commit `bb7c0b6b9e95c3519961376b65c870a0f7866856`)
- Re-deployed after bug fixes via `../../devkit/kixx.js cloudflare release -e production` (resulting in commit `31e1207a8fa9255c72abd278c4e336a394e3cfb6`)
- Ran runbook step 2 and 3 and 4: All tests pass and there are no leftover files in R2. E2E test output `Test run is complete. Ran 159 tests with 0 disabled tests in 89796ms. Passed with no errors`
- Did the browser smoke check and everything worked as expected:
  - [x] 1. Open **Files → Upload files** and select four files at once. Each row shows
   progress; on a slow enough connection the fourth waits as **Queued** until a
   slot frees.
  - [x] 2. Type a title into one row while it uploads, then **Publish** that row
   without saving the title. The title stays unsaved and editable.
  - [x] 3. Open that file's detail page, copy its permanent URL, and open it: the
   bytes are served.
  - [x] 4. Choose a replacement file. A confirmation appears because the file is
   published; accept it. The page reloads with the new filename and the same
   permanent URL, which now serves the new bytes.
  - [x] 5. Unpublish and delete every file you uploaded.
