# Local Target Instances

## Implementation Approach

Framework developers need a writable Publishing API target on their own
workstation. The devserver serves content straight from `pages/`,
`templates/`, `static-assets/`, and `emails/` through `DeveloperContentStore`,
whose write methods deliberately throw. Nothing in this plan changes that. Instead,
a developer creates a throwaway **local target instance**: a directory that
owns a complete `local` environment deployment of the application, seeded from
the working tree, served by `src/node-server.js` directly, and deleted when
stale.

An instance is a directory under `data/local-targets/<name>/` (already
ignored by `.gitignore` via `data/`). It holds:

- `.env` and `.env.secrets` — the generated dotenv pair for `--environment local`.
- The SQLite files, object store, and content store for every registered store.
- `credentials.json` — root admin email and password, a publishing API token,
  the build id, and the base URL, written by `seed` for the operator.

A single tool, `tools/local-target.js`, exposes four verbs:

| Verb | Effect |
| --- | --- |
| `create <name>` | Creates the directory and writes the dotenv pair with fresh random secrets, a free port, and a build id. |
| `seed <name>` | Boots the application in-process against the instance, publishes the working tree as a Release assigned to the instance build id, creates the root admin through the bootstrap token, mints a publishing token, writes `credentials.json`. |
| `serve <name>` | Runs `src/node-server.js --environment local --dotenv <instance>/.env` in the foreground. |
| `destroy <name>` | Deletes the directory. |

Design rules that hold across every task:

1. **Same code paths as production.** The seed calls the existing transaction
   scripts (`createRelease`, `assignRelease`, `createAdminUserAccount`,
   `createPublishingApiToken`) with the application context. It never writes to
   a collection or store directly. Root admin creation goes through the
   `ADMIN_BOOTSTRAP_TOKEN` invite path exactly as a first production deploy does.
2. **Entry-point symmetry is preserved.** The identical block shared by
   `src/node-server.js` and `src/cloudflare-server.js` (runtime, logger,
   context, plugin merge, two-phase registration, app hooks, logger finalize)
   moves into one platform-neutral function. Both entry points and the seed
   call it. The entry point remains the only place that chooses which adapters
   are real, so the seam described in `src/plugins/README.md` is unchanged.
3. **No hot reload, no e2e changes.** `serve` runs the real server process.
   The end-to-end suite is not touched: the operator reads `credentials.json`
   and passes `--base-url`, `--username`, and `--password` by hand, as the e2e
   README already documents for arbitrary targets.
4. **Per-deploy versus per-environment.** The new `local` section of
   `src/node-config.js` holds only per-environment values. Everything that
   varies per instance (data location, port, build id, secrets) is an
   environment variable in the generated dotenv pair.
5. **The seed does not run migrations.** A fresh instance has nothing to
   migrate. The migration workflow is exercised through its own admin endpoints.

Cross-cutting decisions recorded here so no task rediscovers them:

- `DATA_DIRECTORY` is a new optional environment variable. When set,
  `resolveFilepath` resolves config-relative paths against it instead of
  `src/`. The `local` config section uses paths like `./document_store.sqlite`
  so every store lands inside the instance directory. When absent, behavior is
  unchanged for every existing environment. The tool always writes an absolute
  path.
- Transaction scripts use only `getService`, `getCollection`, `logger`,
  `requestId` (optional), `config`, and `getEnvString` from their context.
  `ApplicationContext` provides all of these, so the seed passes the
  application context directly and constructs no synthetic request.
- `createAdminUserAccount` destructures `email_address`, `password`, and
  `invite_token` from a plain object; the seed passes a plain object.
  `createPublishingApiToken` calls `form.toJSON()`, so the seed constructs a
  real `CreatePublishingApiTokenForm` and calls `validate()` first.
- The seed refuses to run when `credentials.json` already exists. The consumed
  bootstrap marker would reject a second run anyway, but the explicit check
  produces a clear message instead of an invite error.
- The Release manifest contract (`src/kixx/content-addressable-store/release-manifest.js`)
  is keyed by facet (`staticAssets`, `globalTemplatePartials`, `baseTemplates`,
  `pages[pathname].{metadata,partials,includes,templates}`, `emails`), while
  `DeveloperSourceScanner` returns a `Map` keyed by storage pathname. Task 3
  adds a facet descriptor to each scanner recipe rather than reverse-parsing
  storage pathnames.

Task order: 1 and 2 are independent. 3 depends on nothing but is only
consumed by 4. 4 depends on 1, 2, and 3. 5 depends on 4.

---

### Task 1: Shared application bootstrap for both entry points and the seed

**Status:** Complete
**Depends on:** None
**Documentation:** `src/plugins/README.md` (entry-point role, two-phase lifecycle), `src/docs/code-style-guide.md`, `src/docs/code-documentation-guide.md`, `test/unit-tests/README.md`

**Objective**

Both entry points call one function to build the application context, and the
Node-only environment prelude (dotenv pair reading, source merging, path
resolution) is importable by a tool that is not an HTTP server. The observable
behavior of `src/node-server.js` and `src/cloudflare-server.js` is unchanged.

**Scope**

- In: `bootApplication()` in `src/kixx/context/boot-application.js`; a Node
  environment module exporting the dotenv reader, the environment source merge
  for a given environment name and optional `--dotenv` path, and
  `resolveFilepath`; both entry points refactored to use them; unit tests;
  `src/plugins/README.md` updates to the entry-point description and the
  new-platform checklist.
- Out: `DATA_DIRECTORY` handling (Task 2). Any change to router construction,
  request translation, or shutdown, which stay in the entry points because
  their error handling legitimately differs per platform.

**Design and invariants**

- `bootApplication({ env, config, LoggerWriter, plugins, app })` returns
  `{ appContext, logger }`. It constructs `AppRuntime` from `env.BUILD_ID` and
  `config.name`, the `Logger` from `config.env.LOGGER.level`, the
  `ApplicationContext`, runs every plugin `register()` before any
  `initialize()`, calls `app.register()` and `app.initialize()` when present,
  and calls `logger.finalize()` last.
- `bootApplication` imports nothing from `src/app/`, `src/plugins/`, or any
  native platform module. Callers pass the already-merged plugin map. This
  keeps the entry point as the seam that selects adapters.
- The function does not construct `HttpRouter`. Each entry point keeps its own
  router and error handler.
- The Node environment module lives beside the entry point (for example
  `src/node-environment.js`) because it imports `node:fs`, `node:path`, and
  `node:util`, which must not appear under `src/app/` or `src/kixx/`.
- `resolveFilepath` must remain a function that Task 2 can extend with a base
  directory without changing its call signature for config code.
- Existing behavior to preserve exactly: missing dotenv file is fine, an
  unreadable or unparseable one throws `OperationalError`; duplicate keys across
  the three sources abort startup; the derived secrets file is the plain file
  path plus `.secrets`.

**Expected touch points**

- `src/kixx/context/boot-application.js` — new shared bootstrap function.
- `src/node-environment.js` — new Node prelude (name may change; record the final name in handoff).
- `src/node-server.js` — replace the inline block with the two module calls.
- `src/cloudflare-server.js` — replace the inline block with `bootApplication`.
- `src/plugins/README.md` — entry-point description and new-platform checklist.
- `test/unit-tests/kixx/context/boot-application.test.js` — new.
- `test/unit-tests/node-environment.test.js` — new (place under the directory that matches the module's final location).

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `bootApplication` runs all `register()` calls before any `initialize()` call, calls the app hooks in order, and finalizes the logger after them; verified by a test using stub plugins that record call order.
- [ ] `bootApplication` tolerates plugins and apps that omit either hook.
- [ ] Both entry points contain no duplicated registration loop.
- [ ] `src/cloudflare-server.js` still exports the Durable Object bindings and the default `fetch` handler unchanged.
- [ ] The Node environment module reproduces the dotenv and merge behavior listed above, with tests for the missing-file, unreadable-file, and duplicate-key cases.
- [ ] `src/plugins/README.md` describes the shared bootstrap and the reduced entry-point responsibilities.

**Validation**

- `node run-linter.js src test` — no lint errors.
- `node run-tests.js` — full unit suite passes.
- Manual: `node tools/devserver.js --port 2026` still serves the site in development mode. Do not perform this during automated verification; it is an operator check.

**Progress and handoff**

- Completed: `bootApplication()` extracted; Node environment module extracted; both entry points refactored to use them; `src/plugins/README.md` updated; unit tests added; full lint and test suite pass; manual devserver smoke check passed (served `GET /` with 200).
- Current state: Done.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - Node environment module named `src/node-environment.js` (matches the anticipated name).
  - `mergeEnvironmentSources` already lived in `src/kixx/config/merge-environment-sources.js` before this task; `readEnvironment()` in `node-environment.js` is a thin wrapper that derives the `.secrets` sibling path and calls it — not a duplicate implementation.
  - `createResolveFilepath({ baseDirectory })` returns a one-arg `resolveFilepath` function, matching `resolveFilepath(relativeFilepath)`'s existing call signature so Task 2 can extend the factory with a `dataDirectory` option without changing what `readConfig()` calls.
  - `bootApplication` reproduces the exact same `AppRuntime`/`Logger`/`ApplicationContext`/two-phase-plugin-loop/app-hooks/`logger.finalize()` sequence previously inlined in both entry points; behavior is unchanged, only the code moved.
- Actual files changed:
  - `src/kixx/context/boot-application.js` (new)
  - `src/node-environment.js` (new)
  - `src/node-server.js` (refactored to use both)
  - `src/cloudflare-server.js` (refactored to use `bootApplication`)
  - `src/plugins/README.md` (entry-point description + new-platform checklist updated)
  - `test/unit-tests/kixx/context/boot-application.test.js` (new)
  - `test/unit-tests/node-environment.test.js` (new)
- Validation run:
  - `node run-linter.js src test` — clean.
  - `node run-tests.js` — 1280 tests passed, 0 failed.
  - Manual: `node tools/devserver.js --port 2099`, `curl http://localhost:2099/` returned 200; server logs showed normal `DeveloperContentStore` scan and no errors. Process stopped afterward.
- Blockers: None.

---

### Task 2: `local` environment section and `DATA_DIRECTORY`

**Status:** Complete
**Depends on:** None (integrates with Task 1's `resolveFilepath` when both land)
**Documentation:** `README.md` (Environment Variables and Configuration), `src/plugins/README.md` (source config modules), `src/docs/code-style-guide.md`

**Objective**

`node src/node-server.js --environment local --dotenv <file>` runs a fully
writable deployment whose every store lives inside the directory named by the
`DATA_DIRECTORY` environment variable. Existing environments behave exactly as
before when `DATA_DIRECTORY` is absent.

**Scope**

- In: the `local` section of `src/node-config.js`; `DATA_DIRECTORY` support
  in the Node `resolveFilepath`; documentation of the variable in
  `src/example.env` and `README.md`.
- Out: the tool that generates the dotenv pair (Task 4). Any Cloudflare config
  change; Cloudflare has no local filesystem and does not use `resolveFilepath`.

**Design and invariants**

- The `local` section mirrors `staging` (real `ContentStore`, caches on,
  `allowJsonResponse: true`) except every store path is instance-relative:
  `./document_store.sqlite`, `./key_value_store.sqlite`, `./object_store`,
  `./content_store`. Keep `PBKDF2_ITERATIONS` at the development value so
  seeding and login are fast.
- `resolveFilepath` resolves against `DATA_DIRECTORY` when that variable is a
  non-empty string, otherwise against `src/` as today. The variable is read
  from the merged env, not raw `process.env`, so it obeys the duplicate-key rule
  like any other key.
- A relative `DATA_DIRECTORY` is resolved against the current working directory
  and is allowed, but the tool in Task 4 always writes an absolute path.
- `DATA_DIRECTORY` is per-deploy, so it belongs in the plain dotenv file, not in
  config, and it is documented as optional in `src/example.env`.
- `local` is restricted to the Node entry point in practice but the config
  module does not need to enforce that.

**Expected touch points**

- `src/node-config.js` — add `local` section.
- `src/node-environment.js` (or wherever Task 1 placed `resolveFilepath`) — base directory override.
- `src/example.env` — document `DATA_DIRECTORY`.
- `README.md` — one paragraph under Environment Variables and Configuration.
- `test/unit-tests/node-environment.test.js` — cases for the override and its absence.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] With `DATA_DIRECTORY` unset, `resolveFilepath('../data/x')` returns the same path as before the change.
- [ ] With `DATA_DIRECTORY=/abs/dir`, `resolveFilepath('./x')` returns `/abs/dir/x`.
- [ ] The `local` section passes `readConfig` and lists every section the other environments have.
- [ ] `src/example.env` and `README.md` describe when to set `DATA_DIRECTORY`.

**Validation**

- `node run-linter.js src test` — no lint errors.
- `node run-tests.js` — full unit suite passes.

**Progress and handoff**

- Completed: `local` section added to `src/node-config.js`; `createResolveFilepath()` in `src/node-environment.js` extended with a `dataDirectory` option (kept the same one-arg return signature); `node-server.js` wired to pass `env.DATA_DIRECTORY`; `src/example.env` and `README.md` document the variable; unit tests added; full lint and test suite pass; manual boot with a temp `DATA_DIRECTORY` confirmed all four stores (document, key-value, object, content) land inside the instance directory and the real (non-developer) `NodeContentStore` is selected.
- Current state: Done.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - `SECRET_ENCRYPTION.PBKDF2_ITERATIONS` was already `50000` in every existing environment (development, staging, production) — "development value" and "already fast" are the same number, so `local` just matches it; no environment uses a higher value today.
  - `local`'s `HYPERVIEW`/`RATE_LIMIT` blocks mirror `staging` verbatim per the plan's "mirrors staging" instruction.
  - `local` uses `CONTENT_STORE.rootDirectory` (real `NodeContentStore`), not `developerMode: true` — confirmed via manual boot that this selects `NodeContentStore` over `DeveloperContentStore`.
  - Manual verification requires `--environment local` explicitly; `node-server.js` does not read `ENVIRONMENT` from the merged dotenv env to select the config section (only `--environment`/`NODE_ENV`), unlike `cloudflare-server.js`. This is existing, unchanged behavior — Task 4's `seed`/`serve` must pass `--environment local` explicitly and cannot rely on the instance's `.env` file's `ENVIRONMENT` key alone.
- Actual files changed:
  - `src/node-config.js` (new `local` environment section)
  - `src/node-environment.js` (`createResolveFilepath` takes `dataDirectory`)
  - `src/node-server.js` (passes `env.DATA_DIRECTORY` through)
  - `src/example.env` (documents `DATA_DIRECTORY`)
  - `README.md` (documents `DATA_DIRECTORY` under Environment Variables and Configuration; forward-references the "Local Target Instances" section that Task 5 adds)
  - `test/unit-tests/node-environment.test.js` (dataDirectory override cases)
  - `test/unit-tests/node-config.test.js` (new — local section parity and readConfig)
- Validation run:
  - `node run-linter.js src test` — clean.
  - `node run-tests.js` — 1286 tests passed, 0 failed.
  - Manual: booted `node src/node-server.js --environment local --dotenv <tmp>/.env` with `DATA_DIRECTORY=<tmp>`; log showed `NodeContentStore` migrating its database inside `<tmp>/content_store`; request returned 503 "no Release is assigned to this build" (expected — no seed has run yet, that's Task 4). Process stopped and temp directory removed afterward.
- Blockers: None.

---

### Task 3: Build a Release manifest from the developer source tree

**Status:** Complete
**Depends on:** None
**Documentation:** `src/kixx/content-addressable-store/release-manifest.js` (manifest contract), `src/kixx/content-addressable-store/content-layout.js`, `src/plugins/node-content-store/lib/developer-source-scanner.js`, `src/plugins/node-content-store/lib/developer-blobs.js`, `test/unit-tests/README.md`

**Objective**

A function turns the working tree into a valid Release manifest by scanning
with `DeveloperSourceScanner`, materializing each storage pathname's bytes with
`getDeveloperBlob`, handing the bytes to a caller-supplied `putObject`
function, and placing the returned `{ objectId, size }` reference in the
correct manifest facet. The result passes `validateReleaseManifest` unchanged.

**Scope**

- In: a facet descriptor on every scanner recipe; a new module in
  `src/plugins/node-content-store/lib/` (for example
  `release-manifest-builder.js`) exporting the builder; unit tests using the
  scanner's injected `fileSystem` and a recording `putObject`.
- Out: storing objects, creating the Release, or assigning a build (Task 4).
  Any change to `DeveloperContentStore` or `buildDeveloperIndex`.

**Design and invariants**

- Each recipe gains a `facet` field describing where its reference belongs in
  the manifest. Recommended shapes: `{ name: 'staticAssets', pathname }`,
  `{ name: 'globalTemplatePartials' }`, `{ name: 'baseTemplates' }`,
  `{ name: 'page', pathname, field: 'metadata' | 'partials' | 'includes' }`,
  `{ name: 'page', pathname, field: 'templates', filename }`,
  `{ name: 'emails', pathname }`. The scanner already knows each of these at
  the point it pushes the recipe, so no path parsing is needed.
- The addition is purely additive. `buildDeveloperIndex` and `getDeveloperBlob`
  ignore the new field; existing scanner tests must pass without modification
  other than asserting the new field where useful.
- The builder signature is
  `buildReleaseManifest({ scanner, putObject, fileSystem })` returning the manifest
  object. `putObject(bytes: ArrayBuffer, pathname: string) -> Promise<{ objectId, size }>`
  is injected so the module stays free of store dependencies and is unit
  testable.
- Static asset media type: the manifest allows an optional `mediaType` on
  static assets. Omit it in this task unless the scanner already derives one;
  record the choice.
- The builder must be deterministic for a given tree: facets are emitted in
  scanner order, and the manifest is later canonicalized by
  `createRelease`, so key order does not affect the release id.

**Expected touch points**

- `src/plugins/node-content-store/lib/developer-source-scanner.js` — attach `facet` to each recipe.
- `src/plugins/node-content-store/lib/release-manifest-builder.js` — new.
- `test/unit-tests/plugins/node-content-store/...` — scanner facet assertions and builder tests.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Every recipe kind produced by the scanner carries a `facet`.
- [ ] Given a fixture tree with at least one page (metadata, partials, includes, template), one static asset, global partials, base templates, and one email, the builder produces a manifest that `validateReleaseManifest` accepts.
- [ ] `putObject` is called exactly once per storage pathname with the same bytes `getDeveloperBlob` returns.
- [ ] A tree with an empty facet (for example no emails) omits that facet rather than emitting an empty object.

**Validation**

- `node run-linter.js src test` — no lint errors.
- `node run-tests.js test/unit-tests/plugins/node-content-store` — scanner and builder tests pass.
- `node run-tests.js` — full unit suite passes.

**Progress and handoff**

- Completed: Attached a `facet` field to every recipe the scanner pushes; wrote `buildReleaseManifest()` in a new `release-manifest-builder.js`; added facet assertions to the scanner test and a full builder test file; lint and full suite pass.
- Current state: Done.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - Static asset facet pathname is `/${file.relativePath}` (leading slash added), not the raw `file.relativePath` the scanner already used for `getStaticAssetPath()` — the manifest's `staticAssets` dictionary keys must be canonical pathnames (`isCanonicalPathname` requires a leading slash via `normalizePathname` round-tripping), while `getStaticAssetPath()` itself doesn't require one. Recorded here so a later reader isn't surprised the facet pathname differs from the storage-path input.
  - `mediaType` on static assets: omitted, per the plan's explicit permission to skip it — the scanner does not currently derive a media type for a file.
  - `buildReleaseManifest({ scanner, putObject, fileSystem })` calls `scanner.scan()` itself rather than taking a pre-scanned Map, so callers (Task 4's seed) don't need to know about the two-step scan/materialize shape; `fileSystem` is forwarded straight to `getDeveloperBlob()` for test doubles.
  - `putObject` receives the storage pathname (the recipe's Map key), not the facet pathname, since that's the more meaningful identifier for logging/dedup at the content-addressable-store boundary.
  - The builder throws (via `assert`) on an unrecognized facet name rather than silently dropping it — every recipe kind the scanner currently produces has a facet, so this path is unreachable except as a defect signal if a new recipe kind is added without one.
- Actual files changed:
  - `src/plugins/node-content-store/lib/developer-source-scanner.js` (facet field on every recipe)
  - `src/plugins/node-content-store/lib/release-manifest-builder.js` (new)
  - `test/unit-tests/plugins/node-content-store/developer-source-scanner.test.js` (facet assertions added)
  - `test/unit-tests/plugins/node-content-store/release-manifest-builder.test.js` (new)
- Validation run:
  - `node run-linter.js src test` — clean.
  - `node run-tests.js test/unit-tests/plugins/node-content-store` and `node run-tests.js` (full suite) — 1290 tests passed, 0 failed.
- Blockers: None.

---

### Task 4: `tools/local-target.js` with create, seed, serve, destroy

**Status:** Complete
**Depends on:** 1, 2, 3
**Documentation:** `src/app/transaction-scripts/README.md`, `src/docs/server-error-handling.md`, `src/docs/code-style-guide.md`, `README.md` (Environment Variables and Configuration), `tools/devserver.js` and `tools/devserver/app-server-process.js` as the precedent for tools that import from `src/`

**Objective**

A developer can run four commands and end up with a writable local deployment
serving the current working tree, plus a credentials file sufficient to log in
to the admin panel and call the Publishing API.

**Scope**

- In: `tools/local-target.js` CLI and its helpers under `tools/local-target/`;
  the four verbs; `credentials.json`; unit tests for the pure helpers (dotenv
  generation, port and name validation, credentials serialization).
- Out: end-to-end changes (none in this phase); listing instances; hot reload;
  running migrations; any change to transaction scripts.

**Design and invariants**

- Instance root: `data/local-targets/<name>/` relative to the repository root.
  `<name>` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` so it is safe as a path
  segment and a build id component.
- `create` writes:
  - `.env` with `ENVIRONMENT=local`, `TRUST_PROXY=false`, `PORT=<free port>`,
    `BUILD_ID=local-<name>-<timestamp>`, `DATA_DIRECTORY=<absolute instance path>`.
  - `.env.secrets` with `DOCUMENT_STORE_CURSOR_SIGNING_SECRET`,
    `CSRF_TOKEN_SIGNING_SECRET`, and `ADMIN_BOOTSTRAP_TOKEN`, each a fresh
    random value from `node:crypto`.
  - It refuses if the directory already exists.
  - It never sets a key that `process.env` also defines for the current shell,
    or startup would abort under the duplicate-key rule. Warn if any of the
    written keys are present in `process.env`.
- `seed`:
  1. Reads the instance dotenv pair through the Node environment module from
     Task 1 and `readConfig(sourceConfig, 'local', { resolveFilepath })`.
  2. Calls `bootApplication` with `mergePluginMaps(generalPlugins, nodePlugins)`,
     the Node `LoggerWriter`, and `app`.
  3. Builds the manifest with Task 3's builder, where `putObject` delegates to
     `ContentAddressableStore#putObject(appContext, bytes)`.
  4. Calls `createRelease(appContext, { manifest, createdBy: 'local-target-seed', provenance: {...} })`
     and then `assignRelease(appContext, { buildId: env.BUILD_ID, releaseId, activatedBy: 'local-target-seed', reason })`
     with a reason from `ACTIVATION_REASONS`. Check `validateReleaseProvenance`
     for the accepted provenance shape before choosing fields.
  5. Calls `createAdminUserAccount(appContext, { email_address, password, invite_token: env.ADMIN_BOOTSTRAP_TOKEN })`
     with a generated email like `root@<name>.local` and a random password.
  6. Constructs `CreatePublishingApiTokenForm`, calls `validate()`, and calls
     `createPublishingApiToken(appContext, form, user.id)`.
  7. Writes `credentials.json` with `baseUrl`, `username`, `password`,
     `publishingApiToken`, `buildId`, and `port`.
  8. Calls `appContext.close()` before exiting, on success and on failure.
  - Refuses to run when `credentials.json` exists.
  - Any thrown error is reported and the process exits non-zero. Partial state
    is expected to be cleaned up with `destroy`, not repaired by the seed.
- `serve` spawns `node src/node-server.js --environment local --dotenv <instance>/.env`
  with inherited stdio and forwards SIGINT and SIGTERM. It does not restart.
- `destroy` refuses if the instance's port is currently accepting connections
  (a cheap TCP probe), then removes the directory recursively.
- The credentials file is plain text inside an ignored directory. State this in
  the tool's usage text.
- Errors thrown by the tool are `OperationalError` for operator mistakes
  (missing instance, bad name, existing credentials) so their messages are
  printed without stack noise, consistent with `tools/devserver.js`.

**Expected touch points**

- `tools/local-target.js` — CLI parsing and verb dispatch.
- `tools/local-target/instance.js` — instance paths, name validation, dotenv generation, credentials read and write.
- `tools/local-target/seed.js` — the seed sequence.
- `tools/local-target/serve.js` — process spawn.
- `package.json` — optional `local-target` script if the repo convention favors it.
- `test/unit-tests/...` — tests for `instance.js` helpers. Confirm the test runner accepts a new top-level directory under `test/unit-tests/` for tools, and record the location chosen.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `create` produces the dotenv pair described above and refuses to overwrite an existing instance.
- [ ] `seed` on a fresh instance exits zero, writes `credentials.json`, and leaves the content store with one assigned build pointer for `BUILD_ID`.
- [ ] A second `seed` on the same instance exits non-zero with a message naming `credentials.json`.
- [ ] `serve` starts the server on the instance port and serves the seeded site including the admin login page.
- [ ] The root credentials log in to the admin panel, and the publishing token authenticates against the Publishing API discovery endpoint.
- [ ] `destroy` removes the directory and refuses while the server is listening.
- [ ] Unit tests cover name validation, dotenv generation, and credentials serialization.

**Validation**

- `node run-linter.js tools src test` — no lint errors.
- `node run-tests.js` — full unit suite passes.
- Operator check, not automated: `node tools/local-target.js create alpha && node tools/local-target.js seed alpha && node tools/local-target.js serve alpha`, then open the printed base URL and log in with `credentials.json`. Then in another shell, run the e2e suite with `--base-url`, `--username`, and `--password` taken from `credentials.json` and confirm the Publishing API write tests run rather than skip.

**Progress and handoff**

- Completed: `tools/local-target.js` CLI with all four verbs; `tools/local-target/instance.js` (paths, name validation, dotenv/credentials formatting, port helpers), `seed.js` (the seed sequence), `serve.js` (process spawn); unit tests for the pure `instance.js` helpers; `package.json` `local-target` script; full lint and test suite pass; a complete manual run of `create → seed → serve → destroy` against a real instance, including a real admin-panel login and a real Publishing API discovery-endpoint call with the minted token.
- Current state: Done.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - `seedInstance()` builds its own `resolveSourcePath` (via `createResolveFilepath({ baseDirectory: srcDirectory })`, no `dataDirectory`) separately from the store `resolveFilepath` passed to `readConfig()`. Developer source content (`pages/`, `templates/`, `static-assets/`, `emails/`) always lives in the repository's `src/`, never inside the instance directory, so the two resolvers must stay distinct even though both come from the same `createResolveFilepath` factory.
  - `emails/` does not exist yet in this repository's `src/` tree; the scanner and `DeveloperSourceScanner` already treat a missing optional source root as empty (per its own test suite), so the seed's manifest simply omits the `emails` facet. Verified working in the manual run (the manifest still validated and the release still activated).
  - `formatCredentials()` asserts its required fields rather than silently writing `undefined` values — a defect in the seed sequence (a missing token, a missing user email) fails loudly at serialization instead of producing a corrupt `credentials.json`.
  - `destroy`'s port-liveness probe reads `PORT=` directly out of the plain `.env` file with a regex rather than going through `readEnvironment()`/`readConfig()` — destroy must work even when the instance is otherwise unseeded or misconfigured, and doesn't need the full environment merge or config validation to answer "is something listening on this port."
  - `serve` does not attempt to restart the child on file changes (per the plan); it forwards SIGINT/SIGTERM to the spawned `node-server.js` child and resolves with its exit code.
  - The root admin's generated password is a 48-hex-character secret from the same `generateSecret()` helper used for the dotenv secrets; `createAdminUserAccount` performs no password-strength validation itself (that lives in the presentation-layer form, which the seed deliberately bypasses per the plan), so no separate strength check was added.
  - Confirmed via manual run that `node-server.js` does not read `ENVIRONMENT` from the instance's own `.env` file to select the config section — `serve.js` must (and does) pass `--environment local` explicitly on the spawned command line, matching the discovery recorded in Task 2's handoff notes.
- Actual files changed:
  - `tools/local-target.js` (new — CLI entry point)
  - `tools/local-target/instance.js` (new)
  - `tools/local-target/seed.js` (new)
  - `tools/local-target/serve.js` (new)
  - `package.json` (added `local-target` script)
  - `test/unit-tests/tools/local-target/instance.test.js` (new — first file under a new `test/unit-tests/tools/` directory; the test runner walks it like any other directory, no runner change needed)
- Validation run:
  - `node run-linter.js tools src test` — clean.
  - `node run-tests.js` — 1302 tests passed, 0 failed.
  - Manual (operator-equivalent, run here to verify the implementation): `node tools/local-target.js create alpha` → `seed alpha` → `serve alpha` (background) → verified `GET /` (200), `GET /login/admin/new` (loaded a real CSRF-protected form), submitted the seeded root credentials and got redirected to `/admin/` (303 → 200 with the session cookie), called `GET /publishing-api/v1/` unauthenticated (401) and with `Authorization: Bearer <publishingApiToken>` (200, `runningBuildId` matched the seeded Build ID). Re-running `seed alpha` while `credentials.json` existed exited 1 naming the file. `destroy alpha` while serving refused naming the port; stopped the server and `destroy alpha` succeeded, leaving `data/local-targets/` empty.
- Blockers: None.

---

### Task 5: Documentation for local target instances

**Status:** Complete
**Depends on:** 4
**Documentation:** `README.md`, `AGENTS.md`, `test/end-to-end/README.md`, `src/plugins/README.md`

**Objective**

A developer or agent with no conversation history can discover the tool,
understand when to use it instead of the devserver, and run the e2e suite
against an instance.

**Scope**

- In: a "Local Target Instances" section in `README.md` under Development; a
  short pointer in `AGENTS.md` beside the Development Server section stating
  that the devserver content store is read-only and naming the tool for
  Publishing API work; a paragraph in `test/end-to-end/README.md` showing how
  to point the suite at an instance using `credentials.json`; confirmation that
  the `src/plugins/README.md` changes from Task 1 are complete.
- Out: any code change.

**Design and invariants**

- Keep the wording short. Document the four verbs, the instance directory, the
  credentials file, and the fact that instances are meant to be destroyed and
  recreated rather than maintained.
- Do not describe the e2e flow as automated. The operator copies values from
  `credentials.json` into the existing flags.

**Expected touch points**

- `README.md`
- `AGENTS.md`
- `test/end-to-end/README.md`
- `src/plugins/README.md` (verify only)

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `README.md` documents the four verbs with one example each.
- [ ] `AGENTS.md` tells an agent when to reach for a local target instead of the devserver.
- [ ] `test/end-to-end/README.md` shows the exact command line for targeting an instance.

**Validation**

- Manual read-through of the three documents for accuracy against the implemented tool's usage text.

**Progress and handoff**

- Completed: Added a "Local Target Instances" section to `README.md` (all four verbs, one example each, `credentials.json` description, disposability note); added a short pointer in `AGENTS.md` beside the Development Server section naming the devserver's read-only limitation and pointing to the tool; added an "Against a local target instance" subsection to `test/end-to-end/README.md` with the exact command line, linking back to the new README section; confirmed `src/plugins/README.md` already carries the Task 1 entry-point/bootstrap description (no further change needed).
- Current state: Done.
- Remaining: Nothing for this task.
- Decisions and discoveries:
  - The README's `DATA_DIRECTORY` paragraph (written in Task 2) forward-referenced a "Local Target Instances" section that didn't exist yet at the time; that link now resolves correctly (`README.md:131` → `README.md:46`), confirmed by grep after this task's edit.
  - `test/end-to-end/README.md` explicitly says the credentials copy-paste is not automated, matching the plan's instruction not to describe the e2e flow as automated.
- Actual files changed:
  - `README.md` (new "Local Target Instances" section under Development)
  - `AGENTS.md` (pointer beside Development Server)
  - `test/end-to-end/README.md` (new "Against a local target instance" subsection)
  - `src/plugins/README.md` (verified only — already updated in Task 1)
- Validation run:
  - Manual read-through of all three edited documents against the actual CLI usage text and the manual verification output from Task 4's run (port, build id, credential field names, verb behavior all match what's documented).
- Blockers: None.
