# Admin File Library

The admin panel's file library (`/admin/files`) lets admins upload files,
describe them, and publish them at a permanent URL. This document covers
what the feature does, how to configure and operate it, how to recover from
interrupted cleanup, and the Cloudflare validation runbook.

## Behavior

- **Stable identity.** Every upload creates a new file with a random UUID;
  identical names or bytes are never deduplicated. The public URL,
  `/files/<uuid>`, is known before the file is published and never changes.
- **Publication.** New files are unpublished. Published files are served at
  `/files/<uuid>`; unpublished or deleted files return `404` there.
  Republishing reuses the same URL.
- **Replacement.** Replacing a file (from its detail page) swaps its bytes in
  place. The UUID, title, description, publication state, and listing order
  are kept; filename, size, and content type follow the new upload. A failed
  replacement leaves the previous content served. There are no drafts,
  versions, or history.
- **Metadata.** Title (200 characters) and description (2,000 characters) are
  optional, admin-only plain text. They are saved explicitly; publishing does
  not save them. A blank title displays the filename.
- **Deletion.** Permanent, requires the file to be unpublished, and requires
  an explicit confirmation that the server rechecks.
- **Access.** Root Admin, Developer, Admin, and Editor manage every file in
  the shared library. There is no uploader ownership, audit trail, external
  API, or Publishing API token access.
- **Uploads require JavaScript.** Each file is one raw request with its own
  progress, cancel, and retry. At most three files upload at once; the rest
  queue. Listing, metadata, publication, and delete forms work without
  JavaScript.

### Serving

| Response | Cache-Control | Disposition |
| --- | --- | --- |
| Published `GET`/`HEAD /files/<uuid>` | `public, no-cache` | Inline for raster images, PDF, audio, video, and plain text; attachment for everything else, including HTML, SVG, and XML |
| Unpublished or missing `/files/<uuid>` | `no-store` | — (`404`) |
| Admin download `/admin/files/<uuid>/download` | `private, no-store` | Always attachment |

- The `ETag` is the committed content generation. Clients revalidate on every
  request and get `304` while the content is unchanged. Replacement changes
  the ETag; metadata edits do not. Publication is checked before validators,
  so an old ETag never reveals an unpublished file.
- `Range` is ignored: every `200` carries the full representation, and
  `Accept-Ranges` is never advertised.
- The content type comes from the filename extension
  (`src/kixx/static-assets/mime-types.js`), never from the browser's claim.
  Unknown extensions are `application/octet-stream`. Every response carries
  `X-Content-Type-Options: nosniff`.

## Configuration

Both settings live in the platform config module under `FILES`, for every
environment (see [configuration.md](configuration.md)):

| Setting | Default | Meaning |
| --- | --- | --- |
| `FILES.maxUploadBytes` | `52428800` (50 MiB) | Per-file limit, enforced while streaming. Zero-byte files are valid. |
| `FILES.bucket` | `'files'` | Logical `OBJECT_STORE` bucket that holds file bytes. |

`src/app/app.js` validates both at boot, including that `FILES.bucket` names
a configured `OBJECT_STORE` bucket. The upload page shows the limit and the
browser checks it before sending, but the server's streaming check is
authoritative.

Raising `maxUploadBytes` does not raise hosting limits. Cloudflare applies
account-dependent request-size limits and a 128 MB Worker memory limit; see
[Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/).

### Bucket isolation

File bytes live only in the dedicated `files` bucket, never the `uploads`
bucket or the ContentAddressableStore. Published bytes are reachable only
through `/files/<uuid>`, which checks publication on every request.

- **Node.js:** `<OBJECT_STORE.path>/files/<file uuid>/<generation uuid>`,
  indexed by `<OBJECT_STORE.path>/.manifest.sqlite`, with in-progress uploads
  staged in `<OBJECT_STORE.path>/.tmp/`. `OBJECT_STORE.path` resolves against
  `DATA_DIRECTORY` when it is set.
- **Cloudflare:** an R2 bucket bound to the Worker as `OBJECT_STORE_FILES`
  (`src/cloudflare-config.js` names `kixx-test-app-production-files`). Keep it
  private: no `r2.dev` URL and no custom domain. A public bucket URL would
  serve unpublished and deleted-but-orphaned bytes.
  The config names the bucket and binding; it does not provision them.

## Storage and recovery

Each upload attempt writes its bytes to a fresh key,
`<file uuid>/<generation uuid>`, before committing that key to the File
record. Normal operations remove the bytes that a replacement displaces and
the bytes of a deleted file. There is no transaction spanning the document
store and the object store, so two situations leave orphaned objects:

- The process stops between writing an object and committing it, or between
  committing and removing the displaced object.
- Cleanup itself fails. The committed change still succeeds, and the server
  logs `File content cleanup failed after <operation>` with the key.

Orphans are never served: `/files/<uuid>` only reads the key the File record
names. They only cost storage. There is no built-in sweeper. To recover:

1. List the `files` bucket's keys (`ObjectStore#list`).
2. For each key, load the File record named by its first segment. The key is
   an orphan when that record is absent, or when its `content.key` differs.
3. Skip keys written in the last hour; an upload in progress has written its
   object but not yet committed it.
4. Delete orphans through `ObjectStore#delete(context, 'files', key)`. On
   Node.js, do not delete body files by hand: the manifest row and body file
   must be removed together.

### Known limitations

- **Cancel races the commit.** Canceling, or leaving the page, during an
  upload cannot retract a request the server has already committed; that file
  appears in the listing. Retrying after an uncertain outcome can create a
  duplicate. Delete unwanted copies from the detail page.
- **Session or form expiry during a batch.** Each affected row shows the
  error, and completed uploads persist. The upload page's form token cannot
  be refreshed in place: signing in again rotates it, so recovering requires
  a reload, which abandons unfinished uploads and unsaved metadata (the page
  warns before leaving).

## Cloudflare validation runbook (Task F7, Phase B)

Phase A validated the feature on Node.js. Phase B repeats the checks on a
real Worker and R2 bucket. It is operator-owned: agents do not deploy,
provision, or test against Cloudflare.

### Preconditions

- The deployed Worker contains this implementation; record the commit.
  The deployment method is yours to choose and record.
- The private R2 bucket `kixx-test-app-production-files` exists and is bound
  to the Worker as `OBJECT_STORE_FILES`, with no public bucket URL.
- You have the target's root admin email and password.
- You can count the objects in that R2 bucket (dashboard or your R2 tooling),
  to confirm nothing partial is left behind.

The steps below assume `https://cloudflare.kixx-testing.dev/`, which is what
`--cloudflare` selects. Substitute another URL with `--base-url` and
`E2E_TESTS_BASE_URL`.

### 1. Record the starting object count

Count the objects in `kixx-test-app-production-files`. Every check below
cleans up after itself, so the count should return to this number.

### 2. HTTP end-to-end suite

```bash
E2E_TESTS_ROOT_USERNAME='<root email>' \
E2E_TESTS_ROOT_PASSWORD='<root password>' \
node run-tests.js --e2e --cloudflare test/end-to-end/100-admin-files
```

Expected: every test passes (76 at the time of writing). The suite covers
lifecycle, four roles, rejected auth and CSRF, 26-file pagination, zero bytes,
dispositions, ETags, `HEAD`, ignored `Range`, and failed replacement. It
deletes every file it creates. Like the other suites, it leaves behind the
Developer, Admin, and Editor accounts it invites and one revoked Publishing
API token.

### 3. Large-upload and streaming checks

```bash
E2E_TESTS_BASE_URL='https://cloudflare.kixx-testing.dev/' \
E2E_TESTS_ROOT_USERNAME='<root email>' \
E2E_TESTS_ROOT_PASSWORD='<root password>' \
node test/end-to-end/100-admin-files/large-upload-checks.js
```

The script reads the configured limit from the upload page and writes random
fixtures to a temporary directory: an exact-limit file and a limit + 1 file.
It can send up to about 325 MiB and reads back 50 MiB, so allow for your
bandwidth. It prints one `PASS` or `FAIL` line per check and exits non-zero on
any failure:

| Check | Expected |
| --- | --- |
| zero bytes | `201`, stored length 0 |
| exactly the configured limit | `201`; published bytes read back with a matching SHA-256 |
| 3 concurrent uploads at the limit | all `201` |
| limit + 1 bytes, declared | `413 FileUploadTooLarge`, or the connection closed before a response |
| limit + 1 bytes, declared as the limit | `400 FileContentLengthMismatch`, or the connection closed before a response |
| disconnect after half the declared bytes | client closes the socket; the target keeps serving |
| rejected uploads created no file records | listing unchanged |

Three concurrent 50 MiB uploads exceed the Worker's 128 MB memory limit, so
their success shows the bodies stream rather than buffer. Also confirm the
Worker's logs show no exceeded-memory errors for these requests.

If the exact-limit checks fail with a non-JSON `413` from Cloudflare itself,
the account's request-size limit is below the configured limit. Record that
as a platform limit rather than an application defect.

### 4. Confirm no partial objects

Count the bucket's objects again. It should equal the starting count.
Fixtures from an interrupted run have filenames starting with `e2e-`. Delete
leftovers from `/admin/files` (unpublish first), then recount.

### 5. Browser smoke test

Signed in to `/admin` as any file-managing admin:

1. Open **Files → Upload files** and select four files at once. Each row shows
   progress; on a slow enough connection the fourth waits as **Queued** until a
   slot frees.
2. Type a title into one row while it uploads, then **Publish** that row
   without saving the title. The title stays unsaved and editable.
3. Open that file's detail page, copy its permanent URL, and open it: the
   bytes are served.
4. Choose a replacement file. A confirmation appears because the file is
   published; accept it. The page reloads with the new filename and the same
   permanent URL, which now serves the new bytes.
5. Unpublish and delete every file you uploaded.

### 6. Record the results

In `agents/plans/admin-file-management.md`, under Task F7's
**Progress and handoff**, add a `Phase B results` entry with:

- Bucket, binding, deployed commit, and deployment method.
- The e2e command's summary line.
- The large-upload script's output.
- Starting and ending object counts.
- Browser smoke test outcome.
- Any failure, verbatim, with what was observed.

Then check the Phase B acceptance criteria that passed. Set the task to
`Complete` only when all four pass.
