Admin Background Jobs
=====================

Add a "Background Jobs" section to the starter app's admin panel (`lib/`), linked from the existing Developers sidebar group. `/admin/jobs` lists jobs newest first, with status and job-name filters (a GET form) and Previous/Next cursor paging that keeps the filters. `/admin/jobs/:id` shows every `JobRecord` field, including the payload as pretty JSON and `lastError` with its stack trace, and offers Retry for a `failed` job. `/admin/jobs/schedules` lists the declared recurring schedules. `/admin/jobs/registered` lists every entry in `lib/app/jobs/mod.js` with its resolved defaults, and has a Run now form per job with an optional JSON payload. Run now enqueues with the dedupe key `admin-run:<name>` and redirects to the new (or already active) job. Retry and Run now are plain forms with post/redirect/get and allow-listed `?notice=` codes; there is no JavaScript. Bad Run now input re-renders the form with an error and the submitted text kept. When `JOB_QUEUE.enabled` is `false`, every jobs page shows a warning that jobs are recorded but not run. The panel calls the same `JobQueue` service as the Admin API, under the same `urn:kixx:admin:jobs` resource. It adds a Run now path that has no API or CLI equivalent.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Navigation: a "Background Jobs" link in the existing Developers sidebar group** (`lib/templates/partials/admin-nav.html`, below Data Migrations). Every admin sees it, and roles without the grant get the standard 403. Reason: this matches migrations decision 5. Permission-aware navigation is out of scope.
2. **Four pages: a jobs list, a job detail page, a Schedules page, and a separate Registered jobs page.** Schedules and Registered jobs stay separate pages; do not merge them.
   - Jobs list `/admin/jobs`: newest first. Filter by status and job name with a GET form. Cursor paging uses `lib/app/presentation/lib/pagination.js` (Previous/Next), and the filters survive paging. Filter values are validated.
   - Job detail `/admin/jobs/:id`: every `JobRecord` field. The payload renders as pretty JSON, and `lastError` with its stack trace renders escaped and preformatted. Reason: the Admin API already exposes the same data, and only Developer and Root Admin can reach the page. An unknown or purged id shows a not-found state with status 404.
   - Schedules: name, cron (UTC), `nextRunAt`, `lastEnqueuedAt`, and a link to `lastJobId`.
   - Registered jobs: every registry entry, with name, description, `maxAttempts`, and `timeoutSeconds` (defaults resolved), cron if any, and a Run now form per job. The registry ships empty, so the page shows an empty state.
3. **Actions.**
   - **Retry**: on the detail page, for `failed` jobs only, through `JobQueue.retry()`. `NotFoundError` and `ConflictError` (the job is not failed, or its key or schedule is in use) show clear notices. Post/redirect/get with an allow-listed `?notice=`.
   - **Run now**: an optional JSON payload textarea, defaulting to `{}`. The server parses and validates it: it must be valid JSON, and the queue's `PayloadTooLargeError` enforces the 128 KB limit. Bad input re-renders the form with an error and keeps the submitted text; notices never echo it. Run now enqueues with the dedupe key `admin-run:<name>`. When the result has `created: false`, it shows an "already queued" notice. On success it redirects to the new (or existing) job's detail page with a notice. Reasons: the dedupe key stops double clicks and duplicate manual runs, and frees itself once the job finishes. Real jobs need payloads, hence the textarea.
   - Run now exists only in the panel. Adding it to the Admin API or the devkit is out of scope.
4. **Queue disabled** (`context.config.env.JOB_QUEUE.enabled === false`): the jobs pages show a warning callout saying jobs are recorded but not run. Actions stay enabled. Reason: the operator's preference. The pages are still useful for inspection and testing.
5. **No JavaScript enhancement.** Each action is one request, using plain forms and post/redirect/get.
6. **Permissions.** Use the resource `urn:kixx:admin:jobs`, held only by Developer and Root Admin (`lib/app/permissions/roles.js`, `action: '*'`). Roles do not change. The page GETs use `urn:kixx:list` (the list, Schedules, and Registered jobs pages) and `urn:kixx:get` (the detail page), matching the Admin API (`lib/routes/admin-api-v1.js`). Retry uses `urn:kixx:update`, as the API does. Run now uses `urn:kixx:create`.
7. **Out of scope:** cancel or delete, bulk retry, and any change to the JobQueue port (`lib/kixx/jobs/job-queue-interface.js`) or its plugins (`node-job-queue`, `cloudflare-job-queue`). Also out of scope: Admin API changes, devkit changes, auto-refresh or live updates, permission-aware navigation, and role changes.
8. **Docs:** the Admin Sidebar section of `lib/app/presentation/README.md`; a "Running from the Admin Panel" section in `lib/app/jobs/README.md` (like `lib/app/migrations/README.md`); `lib/docs/doc-index.md`; and an "Admin panel" note in the Jobs section of `usage-docs/kixx-app/admin-api.md`, following the migrations note there.

### Routine choices made by the planner (from project conventions)

These are not operator decisions. A later agent may revise one, but must record the reason.

- **Read and Retry handlers call `context.getService('JobQueue')` directly**, as the Admin API handlers do (`lib/app/presentation/request-handlers/admin-api/{list-jobs,get-job,retry-job,list-job-schedules}.js`). `lib/app/transaction-scripts/README.md` ("When Not to Write One") allows this when the service owns the whole operation and no business policy applies, and that is true of list, get, retry, and listSchedules.
- **Registry projection and Run now are Transaction Scripts** in a new `lib/app/transaction-scripts/jobs/` group. Run now adds business rules: it rejects a name that is not registered, owns the `admin-run:<name>` dedupe-key policy, and decides which enqueue errors are expected. Without a check first, an unregistered name is an `AssertionError` inside `enqueue()`, which would crash the request. The scripts README puts anything that enforces a rule or classifies errors in a script. The registry projection lives beside it so that one group owns "what is registered".
  - `listRegisteredJobs` calls `validateJobRegistry(jobs)` itself. `validateJobRegistry` comes from `lib/kixx/jobs/job-registry.js`, which is framework code and allowed in `app/`; `jobs` comes from `lib/app/jobs/mod.js`. Resolving defaults through `validateJobRegistry` keeps the shown `maxAttempts`/`timeoutSeconds` identical to what the queue uses, with no duplicated constants. `runJobNow` needs only `jobs.has(name)`: the registry was already validated at boot (`lib/app/app.js`), and its keys are the names. So there is no shared `lib.js` helper. The panel never reads the registry back from the queue, and no getter is added to the port (Decision 7).
  - `listRegisteredJobs(context)` and `runJobNow(context, { name, payload })` are the scripts. Like `createAdminInvite(context, { createdBy, roleId: form.role_id })`, the handler passes plain values from a validated Form.
- **Tests register fixture jobs by temporarily adding entries to the exported `jobs` Map**, always removing them in `finally`. The shipped registry is empty, and `lib/test/app/jobs/mod.test.js` asserts that it stays empty. Each test file that needs a registered job defines a local `withRegisteredJobs(entries, fn)` helper that sets the raw entries, awaits `fn()`, and deletes them in `finally`. Tests run sequentially in one process, so this leaks nothing as long as the `finally` is never skipped. Rejected alternatives: an optional `registry` argument on the scripts, and an app-level `JobRegistry` service. Both add production surface only for tests.
- **URL layout nests every page under `/admin/jobs`.** The routes, in order, all before `{/}` and `*`:
  1. `/jobs/registered`: `job-registry`, targets `render-list` (`GET, HEAD`) and `run-now` (`POST`)
  2. `/jobs/schedules`: `job-schedules`, target `render-list`
  3. `/jobs/:id/retry`: `job-retry`, target `retry` (`POST`)
  4. `/jobs/:id`: `job-detail`, target `render-detail`
  5. `/jobs`: `jobs`, target `render-list`

  `registered` and `schedules` precede `/jobs/:id`. Job ids are UUIDs, so they can never collide. The page directories nest the same way, so `subpage.section: "jobs"` is set once in `pages/admin/jobs/page.json` and inherited. Template-only paths such as `/admin/jobs/detail` are matched by `/jobs/:id`, find no job, and render the 404 state. That is the same behavior as migrations.
- **Run now posts to the Registered jobs route itself.** It is a second target, `run-now`, with a trailing `HyperviewPageHandler`, which is the `invites` `create-invite` pattern. Each job's form carries its name in a hidden `name` field, which is the `AdminInviteRevokeForm` pattern. One route then hosts one POST target, and a rejected submission re-renders the same page. Redirect paths call `skip()` first.
- **`RunJobNowForm`** (`lib/app/presentation/forms/jobs/run-job-now-form.js`) extends `BaseForm`, with `target = 'admin-panel/job-registry/run-now'` and `method = 'POST'`. Its schema has `name` (`fieldType: 'hidden'`) and `payload` (`fieldType: 'textarea'`, `label: 'Payload (JSON)'`).
  - `name` is normalized with `normalizeStringAttribute`.
  - `payload` is kept **exactly as submitted** (a string), so a re-render shows the operator's text unchanged.
  - `validate()` checks the payload only:
    - A non-string payload is "The payload must be text."
    - A blank payload (whitespace only) is "Enter a JSON payload. Use {} for an empty payload."
    - Text that `JSON.parse` rejects is "The payload must be valid JSON." The message is fixed and never includes the parser's message, which can quote input.
  - On success, `validate()` stores the parsed value in `this.payloadValue`.
  - Blank is an error, not an implicit `{}`, so the queued payload is always what the operator saw. The textarea starts as `{}`.
  - The name is not checked in the form. `runJobNow` owns that rule (see the handler flow in T6).
- **The 128 KB limit is not pre-checked.** The queue's `PayloadTooLargeError` is the only source of the limit (`MAX_PAYLOAD_BYTES` in `job-state-store.js`). It works on both platforms: the Cloudflare adapter restores the class by name over RPC (`plugins/cloudflare-job-queue/lib/job-queue.js`). The handler turns it into a field error on `payload` and responds with status 413. A size check on the submitted text would also be wrong, because whitespace in pretty-printed input is not in the serialized size.
- **The Run now payload may be any JSON value**, including `null`, arrays, and scalars, because `enqueue()` accepts `*`. The handler for a scheduled job receives `scheduledFor: null` on a Run now. The help text says so.
- **Notice text lives privately in the handler module**, `admin-jobs.js`, not in a separate presentation module. The other admin handlers with notices keep a private allow-list `Set` too (`ALLOWED_FILE_NOTICES` in `admin-files.js`, `ALLOWED_TOKEN_NOTICES` in `admin-data-api-tokens.js`). Migrations has a separate module only because its HTML and JSON paths share it; jobs has one consumer. The module holds a frozen `NOTICES` table of `{ code, tone, role, title, message }` objects (the shape the shared `admin/notice.html` partial renders), one allow-list `Set` per page, and a private `getNotice(raw, allowed)` that returns `null` unless `allowed.has(raw)`. Do not add `lib/app/presentation/lib/job-notices.js`, and do not touch `migration-run-outcomes.js`.
- **Jobs-list filter validation is left to the queue**, as in the Admin API's `list-jobs.js`. The handler only rejects a repeated `status` or `name` parameter (an array) with `BadRequestError`, treats a blank value as no filter, and trims `name`. Every `ValidationError` from `queue.list()` (bad status or bad cursor; `job-state-store.js` `list()`) becomes `BadRequestError(cause.message, { cause })`, which renders the standard 400 admin error page. Branch on `error.name === 'ValidationError'`, never `instanceof`. Do not duplicate the status list in the panel; the `<select>` offers only valid values, so a bad status comes only from a crafted URL. `rethrowInvalidCursorAsBadRequest` does not apply, because the queue throws `ValidationError`, not `InvalidCursorError`. The status filter is a `<select>` (Any, pending, running, completed, failed). The name filter is a plain text input.
- **Filters survive paging** because the handler passes a base URL that already carries them as `pathname` to `createCursorPaginationLinks`, for example `/admin/jobs?status=failed&name=send-email`, built with `URLSearchParams` over the compiled list pathname. The helper parses it with `new URL()` and only sets `cursor` and appends `history`, so the filters carry through. Submitting the filter form drops the cursor and goes back to page one. The page size is the queue's default, 50, passed as an explicit `PAGE_SIZE` constant.
- **Notices per page.** Every redirect is `${ pathname }?notice=<code>`, with the URL compiled through `getHttpTarget`.

  | Code | Tone | Shown on | Meaning |
  |---|---|---|---|
  | `job_not_found` | error | list | No job has that id. It may have been purged by retention. |
  | `retry_queued` | success | detail | The job was reset to attempt 0 and is due now. |
  | `retry_conflict` | warning | detail | The job could not be retried. Only failed jobs can be retried, and not while another active job holds its dedupe key or schedule. |
  | `run_now_enqueued` | success | detail | The job was queued to run now. |
  | `run_now_already_queued` | info | detail | A manual run of this job is already pending or running, so no new job was queued. This is that job. |
  | `job_not_registered` | error | registered | That job is not registered in this build. |
  | `form_expired` | warning | detail, registered | Nothing ran because the page expired. Reload and try again. |

  `retry_conflict` is one code because the queue throws `ConflictError` with no distinguishing `code` for "not failed" and for "key or schedule in use". Parsing messages is fragile.
- **Handling of an unknown job id.** `GET /admin/jobs/:id` with `get()` returning `null` sets status 404 and props `{ missing: true, links }`. The missing state says the job may have been purged (completed jobs after 7 days and failed jobs after 30 in the shipped config). It never echoes the id. A Retry POST whose `retry()` throws `NotFoundError` redirects 303 to `/admin/jobs?notice=job_not_found`.
- **Run now `form_expired` redirects** 303 to `/admin/jobs/registered?notice=form_expired`. `validateCsrfFormData` consumes the body before it throws, so the submitted text cannot be recovered anyway. Retry's `form_expired` redirects to the detail page.
- **Error classification.** Branch on `error.name` and `error.code`, never `instanceof`. Only the codes above are handled; everything else is rethrown. Decision 10 of the migrations plan (the sanctioned exception for logging unexpected errors) does **not** extend to jobs.
- **Shared partials.**
  - Rename `lib/templates/partials/admin/migration-notice.html` to `lib/templates/partials/admin/notice.html`. It already renders any `{ tone, role, title, message }` notice. Update its four references in `lib/pages/admin/migrations/` and its header comment, so that comment no longer names the migrations module.
  - Add `lib/templates/partials/admin/job-status-badge.html`, which reads `status` from the current context. `pending` uses `--info`, `running` uses `--warning`, `completed` uses `--success`, and `failed` uses `--danger`.
  - Add `lib/templates/partials/admin/jobs-subnav.html` (in T4, once all three targets exist): a `<nav aria-label="Background jobs">` with a `cluster list-unstyled` list of Jobs, Schedules, and Registered jobs links, from `links.jobs`, `links.schedules`, and `links.registered`. It marks `aria-current="page"` with `{{#ifEqual jobsView "..."}}` (the values are `list`, `schedules`, and `registered`). The detail page passes `jobsView: "list"`. Do not add it earlier with conditional links.
  - Add `lib/templates/partials/admin/job-queue-disabled.html`: `{{#if queueDisabled}}` a `callout callout--warning` (`[!]`) saying the queue is disabled in this environment (`JOB_QUEUE.enabled` is `false`), so jobs are recorded but not run, and the actions still work.
  - **Gotcha:** partials inherit the context stack. Inside `{{#with}}`, a missing `notice` falls through to the root `notice`.
- **The handler computes `canRetry`** (`status === 'failed'`), so the template holds no lifecycle logic. There is no separate "waiting to retry" indicator: the Attempts column (`attempt / maxAttempts`) beside a `pending` badge already shows it.
- **Detail rendering.**
  - The handler precomputes `payloadJson = JSON.stringify(job.payload, null, 2)`.
  - The template renders the payload and `lastError.stack` in `<pre class="code-block"><code>{{ ... }}</code></pre>`. Double-mustache escapes them. `.code-block` comes from `admin-style-guide.css`, which `admin.css` loads on every admin page; it scrolls horizontally inside its box.
  - Null dates render "Not yet" or "None", as fits.
  - `scheduleName` links to the Schedules page.
  - `lastError.expected` renders as "Expected" or "Unexpected".
- **Cross-links.** On the Registered jobs and Schedules pages, each job name links to the jobs list filtered by that name (`/admin/jobs?name=<name>`, built with `URLSearchParams`). A schedule's `lastJobId` links to its detail page, which may show the purged/404 state.
- **No new CSS.** Use `.table-list` (with row headers on detail tables), `.callout`, `.status-badge`, `.card flow`, `.cluster`, `.field` / `.field__select` / `.field__input`, `.button--primary` / `--secondary` / `--small`, and `.code-block`. No inline styles.

### Cross-cutting constraints

- **Layering and platforms.** Code under `lib/app/` never imports from `lib/plugins/` or a native module (`node:*`, `cloudflare:*`). It may import `lib/kixx/`. Everything must work on Node.js and on Cloudflare, where `JobQueue` calls cross a Durable Object RPC and errors arrive with their class restored by name. Leave `lib/kixx/vendor/` and the copied code in `test-app/` alone. No devkit-ported module is touched.
- **Do not change** `lib/kixx/jobs/` (the port, registry, state store, runner, or anything else there), `lib/plugins/node-job-queue/`, `lib/plugins/cloudflare-job-queue/`, `lib/app/jobs/mod.js` (it ships empty), `lib/routes/admin-api-v1.js`, the Admin API handlers, `lib/app/permissions/roles.js`, `lib/app/presentation/lib/migration-run-outcomes.js`, or anything in `devkit/`.
- **Error handling** (`lib/docs/server-error-handling.md`, `lib/app/presentation/README.md` Error Handling). Branch on `error.name`, `error.code`, and `error.expected`. Handle only the codes in the notice table, plus `ValidationError` from `queue.list()` and from `RunJobNowForm`, and `PayloadTooLargeError` from Run now. Rethrow everything else.
- **CSRF** (`lib/docs/cross-site-request-forgery.md`). Every POST calls `validateCsrfFormData()` before any domain work, and catches only `INVALID_CSRF_TOKEN_CODE`. Never call `request.formData()` twice. Every page with a form mints a token with `getCsrfToken()` (one token shared by the page's forms) or `getCsrfFormContext()`.
- **Never echo request data** into notices. Only allow-listed codes go in `?notice=`. Filter values are echoed only as escaped form field values. The not-found text is fixed.
- **Reverse routing.** Compile every URL with `context.getHttpTarget('<name>').compilePathname(params).pathname`; never hand-build a pathname. Query strings are appended with `URLSearchParams`. Target names:
  - `admin-panel/jobs/render-list`
  - `admin-panel/job-detail/render-detail`
  - `admin-panel/job-retry/retry`
  - `admin-panel/job-schedules/render-list`
  - `admin-panel/job-registry/render-list`
  - `admin-panel/job-registry/run-now`
- **Route order and page cache.** Follow the URL layout in Routine choices. Every target's first request handler is an `authorize` gate with an explicit decision, including HEAD, so no page under `pages/admin/jobs/` is reachable through the unauthorized `*` fallback. Every `HyperviewPageHandler` uses `baseTemplateId: 'admin.html'` and `usePageCache: false`, because these pages show live queue state and carry session-bound CSRF tokens. Add a `JOB_RESOURCE` constant and a `jobDecision(action)` helper next to `migrationDecision`, with a comment giving that reason.
- **Server-side style.** `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md` apply: JSDoc on exported handlers, scripts, and module exports only, none on module-private functions. Leave blank lines between logical blocks.
- **Templates.** Follow `lib/templates/README.md`. Page markup is `<main class="admin-main"><article class="admin-content-section flow">`. Detail pages use the `admin-content-section__header` back-link pattern from `lib/pages/admin/migrations/detail/page.html`. Copy the table-list markup from `lib/pages/admin/style-guide/table-lists/body.html`: a focusable region with `aria-labelledby` pointing at a visible caption, and a unique caption `id` per table. Place pagination outside the `{{#if jobs}}` block, as `lib/pages/admin/files/page.html` does. No `style="`.
- **Commands run from the repo root** (`/Users/kris/Documents/kixx`):
  - `node lib/run-tests.js <path>` for tests (the path must be inside `lib/test/`)
  - `node lib/run-linter.js <path>` for lint
  - `node lib/run-tests.js` and `deno run -A lib/run-tests.js` for the full suites

  No e2e suite in agent validation. Browser checks are in the Operator Runbook.
- **Test style.** Use hand-rolled stubs, as `lib/test/app/presentation/request-handlers/admin-panel/admin-migrations.test.js` does:
  - `makeContext` with a stub `JobQueue` that records calls, a CSRF `getService` stub, `config.env.JOB_QUEUE.enabled`, `user`, and `getHttpTarget` over a `TARGET_PATTERNS` map with `:id` substitution
  - `makeRequest` / `makePostRequest` (FormData, read once)
  - `makeResponse`
  - `makeSkip`

  `kixx-assert`'s `assertEqual` is not deep; compare single fields or joined strings.
- **Admin sessions.** Agents do not create accounts or enter credentials. Template output is checked by rendering with the vendored templating engine from a scratch script in `tmp/`, as the migrations tasks did (`tmp/render-migration-pages.mjs`). Browser checks belong to the operator.
- **Related plans.** `agents/plans/admin-data-migrations.md` (complete) supplies the Developers nav group, the notice/outcome pattern, and the partials that T3 generalizes. `agents/plans/admin-table-list.md` (complete) supplies `.table-list` and `.status-badge`. There are no conflicts.

---

### Task T2: Add the job registry scripts and the Run now form

**Status:** Not started
**Depends on:** None
**Documentation:** `lib/app/transaction-scripts/README.md` (When Not to Write One; Files and Signatures; Return Values; Error Handling); `lib/app/presentation/README.md` (Forms); `lib/app/jobs/README.md`; `lib/kixx/jobs/job-registry.js`; `lib/kixx/jobs/job-queue-interface.js` (`enqueue`)

**Objective**

The domain side of the Registered jobs page and of Run now exists and is tested, with no HTTP code. `listRegisteredJobs` projects the app registry with the defaults the queue actually uses. `runJobNow` enforces the rules: the job must be registered, the dedupe key is `admin-run:<name>`, and an oversize payload is the only expected enqueue error. `RunJobNowForm` parses and validates the operator's payload text. T4 and T6 only wire these in.

**Scope**

- In:
  - `lib/app/transaction-scripts/jobs/list-registered-jobs.js` and `run-job-now.js`
  - `lib/app/presentation/forms/jobs/run-job-now-form.js`
  - Unit tests for all of them
- Out: handlers, routes, and templates (T4, T6); any change to `lib/app/jobs/mod.js` or `lib/kixx/jobs/`.

**Design and invariants**

- `listRegisteredJobs(context)`: calls `validateJobRegistry(jobs)` on each use (cheap, and test fixtures added to the `jobs` Map are seen) and returns, in registry order, `[{ name, description, maxAttempts, timeoutSeconds, cron }]`. `cron` is `entry.schedule ? entry.schedule.cron : null`. It never exposes `handler` or the parsed cron. With the shipped registry it returns `[]`. It is async for signature consistency and takes `context` first.
- `runJobNow(context, { name, payload })`:
  - When `!jobs.has(name)` (this also covers a missing or non-string name), it throws `NotFoundError('Job "<name>" is not registered', { code: 'JobNotRegistered' })` without calling the queue. The message never reaches a notice.
  - Otherwise it calls `context.getService('JobQueue').enqueue(context, name, payload, { key: \`admin-run:${ name }\` })`. There is no `runAt` or `delaySeconds`, so the job is due now.
  - On a caught error, it rethrows `PayloadTooLargeError` (by `error.name`) unchanged; document this with `@throws`. Every other error is wrapped in `AssertionError('Unexpected error while enqueueing job from admin panel', { cause })`, as the scripts README requires for paths the script does not account for.
  - It returns the `JobEnqueueResult` as a plain object: `{ id, name, key, status, runAt, created }`.
- `RunJobNowForm`: implement the design in Routine choices. Also:
  - The constructor defaults `payload` to `'{}'` when it is `undefined`, so `new RunJobNowForm({ name })` renders the default.
  - `getFormContext` is inherited. With the route not yet registered in T2, test it only in T6, through the handler, or stub `context.getHttpTarget` in the form test.
  - Add a JSDoc class comment explaining why the payload is kept verbatim and why the name is not validated here.
- Tests:
  - Script tests use a `withRegisteredJobs(entries, fn)` helper that adds raw entries to the exported `jobs` Map from `lib/app/jobs/mod.js` and deletes them in `finally`.
  - Use one entry with no optional fields (defaults 5 and 60, `cron: null`), one with `maxAttempts: 2, timeoutSeconds: 10`, and the scheduled entry from `createRecurringTestRegistry()` in `lib/test/fixtures/jobs/example-noop-heartbeat.js`.
  - The stub `JobQueue` records `enqueue` calls and returns a configurable result or rejection.

**Expected touch points**

- `lib/app/transaction-scripts/jobs/list-registered-jobs.js` — new.
- `lib/app/transaction-scripts/jobs/run-job-now.js` — new.
- `lib/app/presentation/forms/jobs/run-job-now-form.js` — new.
- `lib/test/app/transaction-scripts/jobs/list-registered-jobs.test.js` — new.
- `lib/test/app/transaction-scripts/jobs/run-job-now.test.js` — new.
- `lib/test/app/presentation/forms/jobs/run-job-now-form.test.js` — new. Check first for an existing forms test directory and mirror its layout.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `listRegisteredJobs` returns `[]` for the shipped registry. With fixtures, it returns registry order with resolved defaults (5 and 60), explicit values, `cron` for the scheduled entry and `null` otherwise, and no `handler` key.
- [ ] `runJobNow` for a registered name calls `enqueue` once with that name, the given payload (including `null` and an array), and `{ key: 'admin-run:<name>' }`. It returns the result, including `created: false` when the stub returns it.
- [ ] `runJobNow` for an unregistered, empty, or non-string name throws `NotFoundError` with `code` `JobNotRegistered`, and the stub records zero enqueue calls.
- [ ] A stub rejection with `{ name: 'PayloadTooLargeError' }` is rethrown unchanged. A plain `Error` becomes an `AssertionError` whose `cause` is the original.
- [ ] `RunJobNowForm`:
  - `'{"a":1}'` validates, with `payloadValue.a === 1`.
  - `'  [1, 2]\n'` validates, and `payload` stays the exact submitted string.
  - `'null'` validates to `null`.
  - Blank, whitespace-only, `'{'`, and a non-string (`new Blob(['x'])`) each throw `ValidationError` with a `payload` source and the fixed messages.
  - The parser's message never appears in the error.
- [ ] After the tests, the `jobs` Map is empty again (`lib/test/app/jobs/mod.test.js` still passes in the same run).

**Validation**

- `node lib/run-tests.js lib/test/app/transaction-scripts/jobs lib/test/app/presentation/forms/jobs lib/test/app/jobs` — script, form, and registry tests pass together.
- `node lib/run-linter.js lib/app/transaction-scripts/jobs lib/app/presentation/forms/jobs lib/test/app/transaction-scripts/jobs lib/test/app/presentation/forms/jobs` — no lint errors.
- `git diff --stat -- lib/app/jobs/mod.js lib/kixx/jobs lib/plugins` — prints nothing.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: Add the jobs list and detail pages with the nav link and shared partials

**Status:** Not started
**Depends on:** None
**Documentation:** `lib/app/presentation/README.md` (Route Patterns; Reverse Routing; Rendering with HyperviewPageHandler; Page recipe; Admin Sidebar); `lib/templates/README.md` (`#each`, `ifEqual`, `with`, `formatDate`, HTML Escaping, Partials); `lib/pages/admin/style-guide/table-lists/body.html` and `callouts/body.html`; `lib/pages/admin/files/page.html` (pagination); `lib/app/presentation/lib/pagination.js`

**Objective**

An admin with the jobs grant can open Developers → Background Jobs. The list is newest first, can be filtered by status and name, and pages through results with the filters kept. Each job opens a read-only detail page with every field, the pretty-printed payload, and the last error with its stack. An unknown or purged id shows a 404 not-found state, and admins without the grant get the standard 403. This task delivers the read-only core, the navigation, and the shared partials that T4–T6 reuse. Retry comes in T5.

**Scope**

- In:
  - The routes `/jobs/:id` and `/jobs`, with `JOB_RESOURCE` and `jobDecision`.
  - `getAdminJobs` and `getAdminJob` in a new `admin-jobs.js` handler module, and its barrel export.
  - The page directories `pages/admin/jobs/` and `pages/admin/jobs/detail/`.
  - The partials `admin/notice.html` (renamed from `admin/migration-notice.html`, with the migration templates updated), `admin/job-status-badge.html`, and `admin/job-queue-disabled.html`.
  - The private notice table and allow-lists (all seven codes).
  - The nav link and the directory card.
  - Route and handler tests.
- Out: Schedules and Registered jobs pages (T4); Retry (T5); Run now (T6); docs (T7).

**Design and invariants**

- **Routes** (`lib/routes/admin-panel.js`): insert after the migration routes and before `{/}`, with `/jobs/:id` before `/jobs`. T4 and T5 insert theirs above `/jobs/:id`.
  - `{ pattern: '/jobs/:id', name: 'job-detail' }`, target `render-detail` (`GET, HEAD`). Handlers: `authorize(jobDecision('get'))`, `AdminPanel.getAdminJob`, `HyperviewPageHandler({ baseTemplateId: 'admin.html', pathname: '/admin/jobs/detail', usePageCache: false })`.
  - `{ pattern: '/jobs', name: 'jobs' }`, target `render-list` (`GET, HEAD`). Handlers: `authorize(jobDecision('list'))`, `AdminPanel.getAdminJobs`, `HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false })`.
- **Shared private helpers** in `admin-jobs.js` (T4–T6 extend them):
  - `getPathname(context, target, params)`
  - `getNoticeLocation(context, target, params, code)`
  - `isQueueDisabled(context)`, which is `context.config.env.JOB_QUEUE.enabled === false`
  - The private notice table, per-page allow-list `Set`s, and `getNotice(raw, allowed)` from Routine choices (Notice text). T3 defines all seven codes; T5 and T6 only use them.
- **`getAdminJobs`:**
  1. Read the filters from `request.queryParams`:
     - `status`: absent or `''` means none. An array throws `BadRequestError`. Any other value is passed to the queue, which validates it.
     - `name`: absent, or blank after trimming, means none. An array throws `BadRequestError`.
  2. `pagination = getCursorPaginationQueryParams(request.queryParams)`.
  3. Call `queue.list(context, { status, name, limit: PAGE_SIZE, cursor })`, passing only the defined keys. A caught `error.name === 'ValidationError'` (bad status or cursor) becomes `BadRequestError(cause.message, { cause })`; anything else is rethrown.
  4. `filterBase` = the compiled list pathname plus `URLSearchParams` of the active filters. `links = Object.assign({ jobs: <list pathname> }, createCursorPaginationLinks({ pathname: filterBase, cursor, history, nextCursor }))`.
  5. Props:
     - `jobs`: rows of `{ id, name, status, attempt, maxAttempts, createdAt, runAt, finishedAt, links: { detail } }`
     - `filters`: `{ name, statusOptions: [{ value, label, selected }], isFiltered }`
     - `showPagination`, `links`, `jobsView: 'list'`, `queueDisabled`
     - `notice`: `getNotice(request.queryParams.notice, LIST_NOTICES)`
- **`getAdminJob`:**
  - `job = await queue.get(context, request.pathnameParams.id)`.
  - When it is `null`: `response.status = 404`, and props `{ missing: true, links: { jobs }, jobsView: 'list', queueDisabled }`. Do not parse the notice.
  - Otherwise, the props come from a private `getJobDetailProps(context, request, response, job, notice)`. T5 makes it mint CSRF and add the retry link. They are:
    - `job`: every `JobRecord` field, plus `payloadJson` and `canRetry`
    - `links`: `jobs`, plus `detail`, plus `schedules` when `job.scheduleName` is set
    - `notice`: `getNotice(raw, DETAIL_NOTICES)`
    - `jobsView: 'list'` and `queueDisabled`
- **List template** (`pages/admin/jobs/page.json`: `{ "template": "page.html", "subpage": { "title": "Background Jobs", "section": "jobs" } }`; `page.html`):
  - A header with the h1 "Background Jobs" and a one-line lede: "Inspect queued, running, and finished jobs. Completed jobs are kept 7 days and failed jobs 30 in the shipped config."
  - Then `{{> admin/job-queue-disabled.html }}` and `{{> admin/notice.html }}`. T4 adds the subnav above them.
  - A filter form: `method="GET"` to `links.jobs`, in a `.cluster`.
    - A status `<select class="field__select" name="status">` built from `filters.statusOptions`, with "Any status" first (`value=""`).
    - A name `<input class="field__input" name="name" value="{{ filters.name }}">`.
    - A "Filter" `button--secondary`, and, when `filters.isFiltered`, a "Clear filters" link to `links.jobs`.
    - Labels are visible `field__label`s.
  - A `.table-list` captioned "Jobs":
    - Columns: Job (`<th scope="row"><a href="{{ job.links.detail }}">{{ job.name }}</a><div class="type-caption">{{ job.id }}</div></th>`), Status (badge), Attempts (`attempt / maxAttempts`), Created, Run at, and Finished.
    - Dates use `formatDate ... format="DATETIME_MED"` inside `{{#if}}`.
  - Empty states: "No jobs match these filters." when `filters.isFiltered`, and otherwise "No jobs have been recorded yet."
  - Pagination outside the `{{#if jobs}}` block, as in `pages/admin/files/page.html`.
- **Detail template** (`pages/admin/jobs/detail/page.json`: `{ "template": "page.html", "subpage": { "title": "Background Job" } }`, which inherits `section`; `page.html`):
  - **When `missing`:**
    - A back link "← Background Jobs" and the h1 "Job not found".
    - A fixed error callout: "No job has this id. Finished jobs are purged after their retention period."
    - No id echo.
  - **Otherwise:**
    - A back link, the h1 `{{ job.name }}`, and the id as a `type-caption`.
    - The queue-disabled callout and the notice (T4 adds the subnav).
    - A `.table-list` captioned "Job" (`job-caption`), with row headers:
      - Status (badge)
      - Attempts (`attempt` of `maxAttempts`)
      - Dedupe key (or "None")
      - Schedule (linked to `links.schedules` when set, or "None")
      - Scheduled for
      - Run at
      - Created
      - Updated
      - Finished
    - A "Payload" h2 and `<pre class="code-block"><code>{{ job.payloadJson }}</code></pre>`.
    - A "Last error" h2. Without an error: "No failed attempts." With one: a `.table-list` (`last-error-caption`) of Name, Message, and Type (Expected or Unexpected), then the stack in a `code-block` when present, or "No stack trace recorded."
    - Leave an actions slot for T5 with a template comment.
- **Partials:**
  - Create `templates/partials/admin/notice.html` by `git mv` of `migration-notice.html`, generalizing its header comment.
  - Update the references in `pages/admin/migrations/page.html`, `detail/page.html` (two), and any others found by `grep -rn "migration-notice" lib`.
  - Create `job-status-badge.html` and `job-queue-disabled.html` per Routine choices. `jobs-subnav.html` is T4's.
- **Nav** (`templates/partials/admin-nav.html`, Developers list): add `<li><a class="admin-nav__link"{{#ifEqual subpage.section "jobs"}} aria-current="page"{{/ifEqual}} href="/admin/jobs">Background Jobs</a></li>` after Data Migrations.
- **Directory card** (`pages/admin/page.html`): after Data Migrations, add a "Background Jobs" card with the lede "Inspect, retry, and run the background jobs registered in this build." and the link "Manage Background Jobs".
- **Tests** (`admin-jobs.test.js`): a stub `JobQueue` with `list`, `get`, `retry`, `listSchedules`, and `enqueue`, each recording its arguments and returning configurable results.
  - List: the filters are passed through, blank values are omitted, repeated params give `BadRequestError`, a stub queue `ValidationError` gives `BadRequestError` with its message, `nextPage` keeps `status` and `name` and adds `cursor` and `history`, and `previousPage` on page two keeps the filters with no cursor.
  - Notices: each page's allow-list is applied, and unknown, disallowed, and non-string codes give `null`. Every notice has a valid tone, a matching role, and non-empty text.
  - `queueDisabled` is true only for `enabled: false`.
  - Detail: every field, `payloadJson` pretty-printed, the null → 404 `missing` state, and the notice allow-list.

**Expected touch points**

- `lib/routes/admin-panel.js` — two routes, `JOB_RESOURCE`, `jobDecision`.
- `lib/app/presentation/request-handlers/admin-panel/admin-jobs.js` — new.
- `lib/app/presentation/request-handlers/admin-panel/mod.js` — `export * from './admin-jobs.js';`.
- `lib/pages/admin/jobs/page.json`, `page.html` — new.
- `lib/pages/admin/jobs/detail/page.json`, `page.html` — new.
- `lib/templates/partials/admin/notice.html` (renamed), `job-status-badge.html`, `job-queue-disabled.html` — new.
- `lib/pages/admin/migrations/page.html`, `lib/pages/admin/migrations/detail/page.html` — partial rename only.
- `lib/templates/partials/admin-nav.html`, `lib/pages/admin/page.html`.
- `lib/test/routes/admin-panel.test.js` — ordering and decisions.
- `lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Both routes precede `{/}` and `*`, and `/jobs/:id` precedes `/jobs`. The list target's first handler authorizes `urn:kixx:list` on `urn:kixx:admin:jobs`, and the detail target's authorizes `urn:kixx:get`. Both targets allow `GET, HEAD`.
- [ ] The list handler implements every filter, validation, and paging behavior above. The paging links are relative URLs on `/admin/jobs` carrying the filters.
- [ ] The detail handler returns all `JobRecord` fields plus `payloadJson` and `canRetry`. An unknown id gives status 404 and `missing: true`.
- [ ] The migration pages render exactly as before, now through `admin/notice.html`. The migration handler and route tests pass unchanged, and `grep -rn "migration-notice" lib` prints nothing.
- [ ] The templates render the structure above. A payload or stack containing `<script>` renders escaped. There is no `style="`.
- [ ] The sidebar shows Developers → Background Jobs for every admin and highlights it on the list and detail pages. The directory has the card.

**Validation**

- `node lib/run-tests.js lib/test/routes/admin-panel.test.js lib/test/app/presentation/request-handlers/admin-panel` — the route, jobs handler, and migrations handler tests pass.
- `node lib/run-linter.js lib/routes lib/app/presentation/request-handlers/admin-panel lib/test/routes lib/test/app/presentation/request-handlers/admin-panel` — no lint errors.
- `grep -rn 'style="' lib/pages/admin/jobs lib/templates/partials/admin` — prints nothing.
- `grep -rn "migration-notice" lib` — prints nothing.
- `grep -n 'subpage.section "jobs"' lib/templates/partials/admin-nav.html` — prints one line.
- `node -e "for (const f of ['lib/pages/admin/jobs/page.json','lib/pages/admin/jobs/detail/page.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))"` — the page.json files parse.
- Render the list (rows, filtered empty, unfiltered empty, paging), detail (failed with stack, pending at attempt 1, an escaped `<script>` payload), missing, queue-disabled, and a migrations page through the new partial from a scratch script in `tmp/` with the vendored templating engine and `formatDate`.
- `node lib/run-tests.js` — the full unit suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: Add the Schedules and Registered jobs pages

**Status:** Not started
**Depends on:** T2, T3
**Documentation:** `lib/app/jobs/README.md` (Registering a job; Schedules); `lib/kixx/jobs/job-queue-interface.js` (`JobScheduleRecord`); T3's helpers and partials

**Objective**

An admin can see the declared recurring schedules (cron in UTC, next run, last enqueue, a link to the last job) and every registered job with its resolved settings. Both pages are read-only here. With the shipped empty registry, both show clear empty states. T6 adds the Run now forms to the Registered jobs page. The two pages are one task because they share the section subnav and are both thin projections.

**Scope**

- In:
  - The routes `/jobs/registered` (the GET/HEAD target only) and `/jobs/schedules`.
  - The handlers `getAdminJobSchedules` and `getAdminJobRegistry`.
  - The pages `pages/admin/jobs/schedules/` and `pages/admin/jobs/registered/`.
  - The `jobs-subnav.html` partial and a private `getSectionLinks(context)` returning `{ jobs, schedules, registered }`, merged into the `links` of all four pages (the list, detail, and missing states from T3 included), with the subnav included on each.
  - Route and handler tests.
- Out: the Run now POST target, the form, and the handler (T6).

**Design and invariants**

- **Routes**, inserted above `/jobs/:id`, in this order:
  - `{ pattern: '/jobs/registered', name: 'job-registry' }`, target `render-list` (`GET, HEAD`). Handlers: `authorize(jobDecision('list'))`, `AdminPanel.getAdminJobRegistry`, `HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false })`.
  - `{ pattern: '/jobs/schedules', name: 'job-schedules' }`, target `render-list` (`GET, HEAD`). Handlers: `authorize(jobDecision('list'))`, `AdminPanel.getAdminJobSchedules`, the same `HyperviewPageHandler`.
- **`getAdminJobSchedules`:** `queue.listSchedules(context)` maps to rows of:
  - `{ name, cron, nextRunAt, lastEnqueuedAt, lastJobId, links: { runs, lastJob } }`
  - `runs` is the list filtered by name.
  - `lastJob` is the detail URL when `lastJobId` is set, and `null` otherwise.

  The props are `{ schedules, links, jobsView: 'schedules', queueDisabled }`.
- **`getAdminJobRegistry`:** `listRegisteredJobs(context)` (T2) maps to rows of `{ name, description, maxAttempts, timeoutSeconds, cron, links: { runs } }`. The props are:
  - `{ jobs, links, jobsView: 'registered', queueDisabled }`
  - `notice: getNotice(raw, REGISTERED_NOTICES)`

  Build the props in a private `getRegistryPageProps(context, request, response, { notice, runNowForm, runNowError })` helper that T6 extends with CSRF and per-job forms.
- **Schedules template** (`page.json` `{ "template": "page.html", "subpage": { "title": "Job Schedules" } }`):
  - The header h1 "Schedules", with a lede: "Recurring jobs declared in code. Cron runs in UTC. A schedule that falls behind runs once to catch up."
  - The subnav and the queue-disabled callout.
  - A `.table-list` captioned "Schedules", with the columns Job (row header, linking to `links.runs`), Cron (UTC) (`<code>`), Next run, Last enqueued ("Never" when null), and Last job (a link with the text "View job", or "None").
  - The empty state: "No recurring schedules are declared in this build."
- **Registered jobs template** (`page.json` `{ "template": "page.html", "subpage": { "title": "Registered Jobs" } }`):
  - The header h1 "Registered jobs", with a lede: "Jobs registered in `app/jobs/mod.js`, with defaults resolved."
  - The subnav, the queue-disabled callout, and the notice.
  - A `.table-list` captioned "Registered jobs", with the columns Job (row header, linking to `links.runs`), Description, Max attempts, Timeout (`{{ timeoutSeconds }}s`), and Schedule (UTC) (`<code>` cron, or "None").
  - The empty state: "No jobs are registered in this build. Register one in `app/jobs/mod.js`."
  - Leave a template comment marking where T6 adds the per-job Run now cards.
- **Tests:**
  - Schedule rows have links, and `lastJob` is `null` when no job ran.
  - The registry page is empty for the shipped registry. With `withRegisteredJobs`, rows come in order with defaults and cron.
  - The registered notice allow-list is applied.
  - The routes come before `/jobs/:id`, and both authorize `urn:kixx:list`.

**Expected touch points**

- `lib/routes/admin-panel.js` — two routes.
- `lib/app/presentation/request-handlers/admin-panel/admin-jobs.js` — two handlers; `getSectionLinks`.
- `lib/templates/partials/admin/jobs-subnav.html` — new.
- `lib/pages/admin/jobs/page.html`, `lib/pages/admin/jobs/detail/page.html` — include the subnav.
- `lib/pages/admin/jobs/schedules/page.json`, `page.html` — new.
- `lib/pages/admin/jobs/registered/page.json`, `page.html` — new.
- `lib/test/routes/admin-panel.test.js`, `lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `/jobs/registered` and `/jobs/schedules` precede `/jobs/:id`, which precedes `/jobs`. Both new targets authorize `urn:kixx:list` on `urn:kixx:admin:jobs` and allow `GET, HEAD`.
- [ ] The schedules handler maps every `JobScheduleRecord` field and builds the run and last-job links.
- [ ] The registry handler shows resolved defaults and returns `[]` for the shipped registry. It never exposes handlers.
- [ ] The subnav on all four pages links Jobs, Schedules, and Registered jobs, and marks the current one with `aria-current="page"`. The sidebar highlights Background Jobs on both new pages.
- [ ] The templates render rows and empty states with no `style="`.

**Validation**

- `node lib/run-tests.js lib/test/routes/admin-panel.test.js lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js lib/test/app/jobs` — the tests pass, and the registry is still empty afterwards.
- `node lib/run-linter.js lib/routes lib/app/presentation/request-handlers/admin-panel lib/test/routes lib/test/app/presentation/request-handlers/admin-panel` — no lint errors.
- `grep -rn 'style="' lib/pages/admin/jobs` — prints nothing.
- Render both pages, with rows and empty, through the scratch render script.
- `node lib/run-tests.js` — the full unit suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Retry a failed job from the detail page

**Status:** Not started
**Depends on:** T3
**Documentation:** `lib/docs/cross-site-request-forgery.md`; `lib/app/presentation/README.md` (Request Handlers; Error Handling; CSRF Protection); `lib/kixx/jobs/job-queue-interface.js` (`retry`)

**Objective**

On a failed job's detail page, an operator presses Retry and lands back on the same page with a "retry queued" notice and the job `pending` at attempt 0. A crafted or stale Retry on a job that is not failed, or whose key or schedule is held, shows the conflict notice. An unknown id lands on the list with "job not found", and an expired form shows "page expired". All of these use post/redirect/get.

**Scope**

- In: the route `/jobs/:id/retry`, the `postJobRetry` handler, the CSRF token and retry link on the detail props, the Actions card on the detail page, and tests.
- Out: Run now (T6); docs (T7).

**Design and invariants**

- **Route**, inserted above `/jobs/:id` and below `/jobs/schedules`: `{ pattern: '/jobs/:id/retry', name: 'job-retry' }`, target `retry` (`POST`). Handlers: `authorize(jobDecision('update'))`, `AdminPanel.postJobRetry`. There is no trailing Hyperview handler, so there is no `skip()`.
- **`postJobRetry`:**
  1. `id = request.pathnameParams.id`.
  2. Read the form data and verify CSRF with a private `readVerifiedFormData` (as in `admin-migrations.js`). It returns `null` for `INVALID_CSRF_TOKEN_CODE` and rethrows everything else. On `null`, redirect 303 to `<detail>?notice=form_expired`.
  3. Wrap **only** `await queue.retry(context, id)` in `try`. In the `catch`: `error.name === 'NotFoundError'` redirects 303 to `<list>?notice=job_not_found`; `error.name === 'ConflictError'` redirects to `<detail>?notice=retry_conflict`; anything else is rethrown. Branch inline; there is no classifier function.
  4. On success, redirect 303 to `<detail>?notice=retry_queued`.
- **Detail props:** `getJobDetailProps` becomes async. It adds `csrf: await getCsrfToken(context, request, response)` and `links.retry`.
- **Detail template (actions slot):** `{{#if job.canRetry}}` a `card flow` "Actions" card, containing:
  - the lede "Retry resets this job to attempt 0 and runs it as soon as possible. Handlers must be idempotent."
  - a POST form to `links.retry` with the CSRF hidden field and a `button button--primary` "Retry"

  Jobs that are not failed show no actions card.
- **Concurrency:** a double-click sends two POSTs. The second gets `ConflictError` (the job is no longer failed) and shows `retry_conflict`, which is correct.

**Expected touch points**

- `lib/routes/admin-panel.js`
- `lib/app/presentation/request-handlers/admin-panel/admin-jobs.js`
- `lib/pages/admin/jobs/detail/page.html`
- `lib/test/routes/admin-panel.test.js`, `lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The route precedes `/jobs/:id`, allows `POST` only, and authorizes `urn:kixx:update` on `urn:kixx:admin:jobs`.
- [ ] Success: the stub `retry` is called once with the id, and the response is `303 /admin/jobs/<id>?notice=retry_queued`.
- [ ] A `ConflictError` (a real class, and a plain `{ name: 'ConflictError' }`) → `?notice=retry_conflict`. A `NotFoundError` → `303 /admin/jobs?notice=job_not_found`.
- [ ] A CSRF `verify` that returns false → `?notice=form_expired`, with zero `retry` calls. A plain `Error` from `retry` is rethrown.
- [ ] The detail props include `csrf` and `links.retry`. The template shows Retry only for `failed`.

**Validation**

- `node lib/run-tests.js lib/test/routes/admin-panel.test.js lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js` — the tests pass.
- `node lib/run-linter.js lib/routes lib/app/presentation/request-handlers/admin-panel lib/test/routes lib/test/app/presentation/request-handlers/admin-panel` — no lint errors.
- Render the detail page for a failed and a completed job through the scratch render script.
- `node lib/run-tests.js` — the full unit suite passes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T6: Run a registered job now from the Registered jobs page

**Status:** Not started
**Depends on:** T2, T4 (run it after T5, since both edit the same handler and test files)
**Documentation:** `lib/docs/cross-site-request-forgery.md`; `lib/app/presentation/README.md` (Forms; Request Handlers; `skip()`; CSRF Protection); `lib/app/presentation/request-handlers/admin-panel/admin-invites.js` (`postCreateAdminInvite`, the re-render pattern); `lib/app/jobs/README.md` (Enqueueing)

**Objective**

Each registered job has a Run now form with a JSON payload textarea (default `{}`). A valid submission enqueues the job under the `admin-run:<name>` dedupe key and lands on the job's detail page with an "enqueued" notice. If a manual run is already active, it lands on that existing job with an "already queued" notice. Invalid JSON, a blank payload, or a payload over 128 KB re-renders the Registered jobs page with the error under that job's textarea and the submitted text kept. An unregistered name or an expired form redirects with a notice. This task completes the operator's write path.

**Scope**

- In:
  - The `run-now` POST target on the `/jobs/registered` route.
  - The `postJobRunNow` handler.
  - The per-job Run now cards on the Registered jobs page.
  - The registry props helper extended with CSRF and per-job form contexts.
  - Tests.
- Out: docs (T7); any Admin API or devkit equivalent (Decision 3).

**Design and invariants**

- **Route:** add a second target to `job-registry`: `{ name: 'run-now', methods: [ 'POST' ], requestHandlers: [ authorize(jobDecision('create')), AdminPanel.postJobRunNow, HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }) ] }`. Add a short comment: the page re-renders on a rejected submission, as on `/invites`.
- **Registry props helper** (`getRegistryPageProps`, extended):
  - Mint one `csrf` with `getCsrfToken`.
  - For each job row, set `row.form = new RunJobNowForm({ name: row.name }).getFormContext(context)`. For the row whose `name === runNowForm.name`, use `runNowForm.getFormContext(context, runNowError)` instead, so it carries the submitted text and the field error.
  - Return `matched: boolean`, which says whether any row matched the submitted name.
  - `getAdminJobRegistry` uses the helper with no form.
- **`postJobRunNow(context, request, response, skip)`:**
  1. Read and verify CSRF with `readVerifiedFormData`. On `null`: `skip()`, then redirect 303 to `/admin/jobs/registered?notice=form_expired`.
  2. `form = RunJobNowForm.fromFormData(formData)`.
  3. `try { form.validate() }`. Catch only `error.name === 'ValidationError'` and call `renderRunNowError(form, error, error.httpStatusCode || 422)`; rethrow anything else.
  4. Wrap **only** `result = await runJobNow(context, { name: form.name, payload: form.payloadValue })` in `try`:
     - `error.code === 'JobNotRegistered'`: `skip()`, then redirect 303 to `/admin/jobs/registered?notice=job_not_registered`.
     - `error.name === 'PayloadTooLargeError'`: build `fieldError = new ValidationError('The payload is too large')`, call `fieldError.push('The payload is larger than 128 KB when serialized.', 'payload')`, and call `renderRunNowError(form, fieldError, 413)`.
     - Otherwise, rethrow.
  5. On success: `skip()`, then redirect 303 to `<detail of result.id>?notice=run_now_enqueued` when `result.created`, and `?notice=run_now_already_queued` otherwise.
  - `renderRunNowError(form, error, status)` (private):
    - It builds the registry props with the submitted form.
    - When `matched` is false, the submitted name is not registered, and the error would have nowhere to show. It calls `skip()` and redirects to `?notice=job_not_registered` instead.
    - Otherwise it sets `response.status = status` and `response.updateProps(props)`, and lets the trailing Hyperview handler render.
- **Registered jobs template:** after the table, `{{#each jobs as |job|}}` one `card flow` per job with `id="run-{{ job.name }}"`. Names are lowercase kebab-case, so the id is safe. Each card has:
  - An h2 "Run {{ job.name }} now".
  - A `type-body-sm` lede: "Queues one run due now, outside any schedule (the handler sees `scheduledFor: null`). Only one manual run of a job can be pending or running at a time."
  - A form with `method="POST"` and `action="{{ job.form.url }}"`, containing:
    - The CSRF hidden field (the page-level `csrf`).
    - `<input type="hidden" name="name" value="{{ job.form.fields.name.value }}">`.
    - A `.field` with a textarea: `id="run-{{ job.name }}-payload"`, `name="payload"`, `rows="6"`, `class="field__input"`, label "Payload (JSON)", a hint "Any JSON value, up to 128 KB. Use {} for an empty payload.", and `aria-describedby` / `aria-invalid` with a `field__error` (`role="alert"`) when `job.form.fields.payload.error` is set. The textarea's content is `{{ job.form.fields.payload.value }}`, which is escaped.
    - A `button button--primary` "Run now".
- **Tests:**
  - Use `withRegisteredJobs` with one plain entry.
  - Use a POST request helper with FormData (`csrf_token`, `name`, `payload`).
  - Use a stub `enqueue` returning `{ id: 'job-9', created: true }` or `created: false`, or rejecting.
  - Use a `skip` stub that records calls.

**Expected touch points**

- `lib/routes/admin-panel.js` — the `run-now` target.
- `lib/app/presentation/request-handlers/admin-panel/admin-jobs.js` — the handler and the extended props helper.
- `lib/pages/admin/jobs/registered/page.html` — the Run now cards.
- `lib/test/routes/admin-panel.test.js`, `lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The `job-registry` route has `render-list` (`GET, HEAD`, `urn:kixx:list`) and `run-now` (`POST`, `urn:kixx:create`), and still precedes `/jobs/:id`.
- [ ] A valid `{"a":1}` → `enqueue` is called with the name, `{ a: 1 }`, and `{ key: 'admin-run:<name>' }`. `skip` is called, and the response is `303 /admin/jobs/job-9?notice=run_now_enqueued`. `created: false` → `?notice=run_now_already_queued` on the returned id.
- [ ] Invalid JSON, or a blank payload → status 422, the page props carry that job's form with `fields.payload.error` set and `fields.payload.value` equal to the exact submitted text, `enqueue` is not called, and `skip` is not called. The other rows' forms default to `{}` with no error.
- [ ] `PayloadTooLargeError` from `enqueue` → status 413 with the size field error and the submitted text kept.
- [ ] An unregistered or missing name, with valid JSON → `303 /admin/jobs/registered?notice=job_not_registered`, with zero enqueue calls. The same applies with invalid JSON and an unregistered name, because there is no row to show the error on.
- [ ] A CSRF failure → `skip`, then `?notice=form_expired`, with zero enqueue calls. An unexpected enqueue failure (the `AssertionError` from T2) is rethrown.
- [ ] The rendered page escapes a submitted `</textarea><script>` payload. There is no `style="`.
- [ ] The `jobs` Map is empty after the tests.

**Validation**

- `node lib/run-tests.js lib/test/routes/admin-panel.test.js lib/test/app/presentation/request-handlers/admin-panel/admin-jobs.test.js lib/test/app/jobs` — the tests pass, and the registry is still empty.
- `node lib/run-linter.js lib/routes lib/app/presentation lib/test/routes lib/test/app/presentation` — no lint errors.
- `grep -rn 'style="' lib/pages/admin/jobs` — prints nothing.
- Render the Registered jobs page (no error, a JSON error with escaped text, and empty) through the scratch render script.
- `node lib/run-tests.js` and `deno run -A lib/run-tests.js` — the full suites pass.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T7: Document the admin panel jobs section

**Status:** Not started
**Depends on:** T3, T4, T5, T6
**Documentation:** `lib/app/jobs/README.md`; `lib/app/migrations/README.md` ("Running from the Admin Panel", the precedent); `lib/docs/doc-index.md`; `lib/app/presentation/README.md` (Admin Sidebar); `usage-docs/kixx-app/admin-api.md` (Jobs; the migrations "Admin panel" note)

**Objective**

Every document that describes operating background jobs, or how the admin sidebar is organized, matches the shipped panel. A developer or operator learns that `/admin/jobs` exists, what its four pages and two actions do, who can use them, and how Run now differs from the API. This is one documentation pass after the behavior is final.

**Scope**

- In: the four documents below, edited concisely in each one's voice.
- Out: `devkit/README.md` and `usage-docs/kixx-devkit/` (the CLI is unchanged); a new usage-doc file.

**Design and invariants**

- `lib/app/jobs/README.md`: add a short "Running from the Admin Panel" section before "Operating" (or within it, if that reads better). It covers:
  - **Access.** Developers → Background Jobs (`/admin/jobs`). Viewing needs `urn:kixx:list`/`urn:kixx:get` on `urn:kixx:admin:jobs`, Retry needs `urn:kixx:update`, and Run now needs `urn:kixx:create` (Developer and Root Admin).
  - **Pages.** The jobs list with status and name filters and paging; job detail with the payload and last error (stack included); Schedules (UTC); Registered jobs with resolved defaults.
  - **Retry.** Failed jobs only, the same as the API.
  - **Run now.** It is panel-only. Its JSON payload defaults to `{}`. It uses the dedupe key `admin-run:<name>`: a second Run now while one is active returns the existing job, and the key frees when that job finishes. It runs outside any schedule (`scheduledFor: null`). Handlers must still be idempotent.
  - **Queue disabled.** With `JOB_QUEUE.enabled: false`, the panel warns that jobs are recorded but not run. Actions still record jobs.
- `lib/docs/doc-index.md`, the Background Jobs summary: mention operating jobs from the admin panel.
- `usage-docs/kixx-app/admin-api.md`: add a `### Admin panel` subsection at the end of the Jobs section (after "List job schedules"), mirroring the migrations note.
  - The panel at `/admin/jobs` (Developers → Background Jobs) uses the same queue and permissions, with cookie sign-in and CSRF instead of HTTP Basic.
  - It adds Run now, which has no API equivalent.
  - Do not restate the job behavior.
- `lib/app/presentation/README.md`, Admin Sidebar: update the Developers group to "(Data Migrations, Background Jobs)". Add one sentence noting that the jobs section has an in-page subnav (Jobs, Schedules, Registered jobs) and that all four pages share `section: "jobs"`.
- If any doc lists the admin partials, add `admin/notice.html` and the job partials, and fix any reference to `migration-notice.html`. Use `grep -rn "migration-notice" lib usage-docs` to find them.

**Expected touch points**

- `lib/app/jobs/README.md`
- `lib/docs/doc-index.md`
- `usage-docs/kixx-app/admin-api.md`
- `lib/app/presentation/README.md`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Each document mentions the panel accurately and briefly. Nothing contradicts T3–T6: the permissions per action, Retry for failed jobs only, the Run now dedupe key and that it is panel-only, and the queue-disabled warning.
- [ ] No doc claims the panel changes the API, the CLI, the queue port, or the roles.

**Validation**

- `grep -n "admin/jobs" lib/app/jobs/README.md lib/docs/doc-index.md usage-docs/kixx-app/admin-api.md` — each file mentions the panel.
- `grep -n "Background Jobs" lib/app/presentation/README.md` — the sidebar note exists.
- `grep -rn "migration-notice" lib usage-docs` — prints nothing.
- `node lib/run-tests.js` — still passes (this task changes docs only).

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

Operator Runbook
----------------

Run these after all tasks are complete. Agents do not perform these steps.

- [ ] Run the full suites from the repo root: `node lib/run-tests.js`, `deno run -A lib/run-tests.js`, and `node lib/run-linter.js lib`.
- [ ] Start the app from `lib/` with `node node-server.js` (port 2026). Sign in at `/login/admin/new` as a **Developer** or **Root Admin**. If no admin exists yet, create one with `kixx admin` (see `usage-docs/kixx-devkit/admin.md`).
- [ ] Navigation:
  - Developers → Background Jobs appears below Data Migrations, and is highlighted on the list, a detail page, Schedules, and Registered jobs.
  - The subnav marks the current page.
  - The directory shows the Background Jobs card.
  - Sign in as an **Admin**-role account: the link shows, and following it returns the standard 403.
- [ ] Empty states with the shipped registry:
  - The list says "No jobs have been recorded yet".
  - Schedules and Registered jobs show their empty states.
  - `/admin/jobs/does-not-exist` shows the in-section "Job not found" state with status 404.
  - `/admin/jobs?status=bogus` shows the 400 page with the status message.
- [ ] Data migrations still show their notices (the partial was renamed). For example, run the no-op migration and see the "applied" notice.
- [ ] Register a scratch job locally to exercise the actions. Add it to `lib/app/jobs/mod.js` and **do not commit it**. For example, define a handler inline:
  - It throws an expected error, `new ConflictError('Scratch failure')` (import it from `../../kixx/errors/mod.js`), when `job.payload?.fail === true`. Use an expected error: an unexpected one makes the Node server shut down by design.
  - Otherwise it logs `job.payload`.
  - It awaits a 20-second delay when `job.payload?.slow === true`, so the dedupe can be seen.
  - The registry entry is `[ 'scratch-job', { name: 'scratch-job', description: 'Scratch job for panel checks.', handler, maxAttempts: 1 } ]`.
  - Optionally add a second entry with `schedule: { cron: '*/2 * * * *' }`.
  - Restart the server.
- [ ] Registered jobs shows `scratch-job` with max attempts 1, timeout 60s (the default), and no schedule. A scheduled entry shows its cron, and Schedules shows its next run.
- [ ] Run now:
  - With `{}` → the detail page with the "queued" notice. After a second or two, a reload shows `completed`.
  - With `{"slow":true}`, then Run now again quickly → the second lands on the same job with "already queued".
  - With `{not json` → the page re-renders with the error under that textarea and the text kept.
  - With a blank payload → the "Enter a JSON payload" error.
  - Paste a payload over 128 KB, for example from `node -e "console.log(JSON.stringify({x:'a'.repeat(140000)}))"` → the size error.
- [ ] Retry:
  - Run now with `{"fail":true}`. With `maxAttempts: 1`, the job fails after one attempt. Its detail page shows `failed`, and `lastError` with name `ConflictError`, the message, "Expected", and the stack in a scrolling block.
  - Press Retry → "retry queued", and the job is pending at attempt 0, then fails again.
  - Re-submit the Retry form from history after the job is no longer failed → the "could not be retried" notice.
  - Delete the `kixx_csrf_session` cookie and press Retry → the "page expired" notice, and nothing is retried.
- [ ] List filters and paging:
  - Filter by status `failed` and name `scratch-job`. The Clear filters link works.
  - Paging is covered by unit tests. To see it in a browser, temporarily set `PAGE_SIZE` to 2 in `admin-jobs.js` (do not commit it), create at least three `scratch-job` runs with Run now (each finishes in about a second, which frees the dedupe key), filter by name, and check that Next and Previous keep the filter in the URL. Then restore `PAGE_SIZE`.
- [ ] Queue disabled: set `JOB_QUEUE.enabled` to `false` in `lib/node-config.jsonc` for the local environment and restart.
  - Every jobs page shows the warning.
  - Run now records a `pending` job that never runs.
  - Restore the setting.
- [ ] Check both themes and about a 360px width. Tables and code blocks scroll inside their wrappers, and the page does not scroll sideways.
- [ ] Remove the scratch job from `lib/app/jobs/mod.js` and confirm `git diff lib/app/jobs/mod.js` is empty.
- [ ] Optional: rebuild and run the e2e suites per `test-app/README.md`, and spot-check the panel on a Cloudflare deployment of the test app (Run now and Retry across the Durable Object RPC).
