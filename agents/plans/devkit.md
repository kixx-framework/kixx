Devkit Package
==============

Create `devkit/`, the build and deployment CLI (`kixx` command) for Kixx apps, as the new source of the existing `kixx-devkit` (npm) and `@kixx/devkit` (JSR) packages. It ships exactly 11 sub-commands in three families: `admin` (gen-secure-token, accept-invite, create-publishing-token, list-migrations, run-migration), `app` (publish, assign-build), and `cloudflare` (create-worker, update-worker, create-worker-version, deploy-version). The old devkit at `tmp/kixx-devkit/` is the reference, but this is not a clone. Code is ported where it fits and rewritten to this repo's conventions. The behavior changes are: `run-migration --force` runs without confirmation; `deploy-version` has no Publishing API guard; `create-worker-version` reads `cloudflare-config.jsonc`, writes `cloudflare-config.generated.js`, never creates resources, enforces secret-name parity with the source version (required names present, optional names inherited when present, no undeclared remote secrets), can adopt the latest version when there is no state file, and requires an explicit `--deploy` for unprovisioned Durable Objects. The package runs from source on Node.js >= 24 and Deno >= 2.8, is stand-alone publishable, and never imports the repo's `lib/` at runtime.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Same package names.** npm `kixx-devkit` and JSR `@kixx/devkit`, `kixx` bin. `devkit/` replaces `kixx-framework/kixx-devkit` as the source. Reason: take over the existing distribution.
2. **`admin run-migration --force` runs immediately**, with no typed-id confirmation. The `--yes` option is removed. Reason: trust the operator. Commands should be explicit, not nagging.
3. **`cloudflare deploy-version` has no BUILD_ID / Publishing API guard and no `--force` option.** It routes 100% of traffic to the given or state-recorded version and updates state. Reason: trust the operator.
4. **`create-worker-version` never creates D1, KV, or R2 resources.** It verifies that every configured resource exists. If any are missing (no ID configured, or not found remotely), it reports all of them and fails. Reason: resource creation is a separate, later phase.
5. **Secret names must match the source version, in both directions, or the build fails.** `example.env.secrets` declares *required* names and `# @optional` names (lib's `parseSecretsManifest` returns `{ required, optional }`). Every required name must be a `secret_text`/`secret_key` binding on the source version. An optional name is inherited when present and not bound when absent. Any secret on the source version that is neither required nor optional fails the build; the old devkit only warned on undeclared names. All comparisons go through one function (`compareDeclaredSecrets`, T8). Reason: deploying a version that silently drops a secret is a production surprise, so fail at build time. Optional names are exempt from presence because `ADMIN_BOOTSTRAP_TOKEN` is deleted after the first admin is created, and exact matching would break every later build.
6. **Secrets are inherited from the exact version recorded in `.kixx/cloudflare-state.<env>.json`.** The old devkit's rule stays: that version must exist and be Cloudflare's latest. When no state file exists, the latest version is adopted as the secret source only if its secret names match the declared set. After upload, state pins the exact version. A Worker with zero versions fails if secrets are declared; the message tells the operator to set them first in the dashboard or with Wrangler. Zero versions and no declared secrets proceeds. Reason: an exact version prevents inheriting from another checkout's untracked version, and adoption handles a first deploy without porting `bootstrap`.
7. **Secrets management (set-secret(s), delete-secret, recover-secret-version) is a later phase.** Until then, operators set secrets in the Cloudflare dashboard or with Wrangler.
8. **`--deploy` on `create-worker-version` is required, and only allowed, when the version binds an unprovisioned Durable Object class.** Without the flag in that case, the command fails before upload and names the classes and the flag. With the flag when no class needs it, it fails with a usage error. With it, the version is uploaded and deployed to 100% in one request, and state records `deployed: true`. Reason: the operator wants commands more explicit than the old devkit's implicit forced deployment, and Cloudflare cannot accept such a version undeployed. Note: lib binds the `CONTENT_STORE` and `JOB_QUEUE` Durable Objects, so every new environment's first version needs `--deploy`.
9. **Command set includes** `update-worker`, `assign-build`, `accept-invite`, and `create-publishing-token`. Excluded: resource creation, secrets commands, `bootstrap`, `release`, `create-release`, `rollback`, release CI workflow, actually publishing to registries, devserver, publishing repo `lib/` as a package.
10. **Tests live in `devkit/test/`**, not `devkit/test/unit-tests/`.
11. **Keep the two-layer `.kixx` config:** `~/.kixx/{config,secrets}.json` merged under `<project>/.kixx/{config,secrets}.json`, project layer last. The keys are `app.environments.<env>.origin` (config), `app.environments.<env>.publishingToken` (secrets), and `cloudflare.accountId` / `cloudflare.apiToken` (secrets). `lib/.kixx/example.config.json` and `example.secrets.json` already use the `app` shape.
12. **Config file is `cloudflare-config.jsonc`** (this repo's JSONC format, see `lib/cloudflare-config.jsonc`), not an executable `cloudflare-config.js`. `create-worker-version` writes `cloudflare-config.generated.js` in the project directory before bundling, because `lib/cloudflare-server.js:3` imports it. The file is gitignored in `lib/.gitignore`.
13. **Dependencies:** no new runtime dependencies. acorn and kixx-assert are vendored under `devkit/lib/vendor/` (copied from `tmp/kixx-devkit/lib/vendor/`). Dev dependencies follow repo `lib/`'s pattern (`package.json` devDependencies, `npm install`). Installing them is an operator step (Runbook R1).
14. **Do not modify `lib/` or `docs/`.** Docs-vs-server disagreements found by the audit are reported to the orchestrator, not fixed.

15. **No flag for stale state after outside secret changes.** Changing a secret in the dashboard or with Wrangler creates a newer Worker version, so the state-recorded version is no longer the latest and the freshness check fails. The stale-state error and the docs tell the operator to either restore the state file from the checkout that made the latest version, or delete `.kixx/cloudflare-state.<env>.json` so the next run adopts the latest version under Decision 6. Reason: keep the command surface small.
16. **`cloudflare deploy-version` never sends Cloudflare's `?force=` deployment parameter.** When Cloudflare refuses a deployment (for example a rollback to a version created before a secret change), devkit surfaces Cloudflare's error. Reason: keep `deploy-version` simple; the operator decides.
17. **Accept the `--deploy` content gap.** A `--deploy` upload serves a fresh `BUILD_ID` that has no Release assigned, so content routes return 503 until `kixx app publish -e <env> --build-id <id>` runs. This matters most when an existing production environment adds a Durable Object class. `create-worker-version` prints that exact command after deploying, and the docs describe the gap. Pre-staging content before a `--deploy` upload is a possible later phase. Reason: acceptable for now.
18. **Package version `0.2.0`** in both manifests. npm and JSR both have `0.1.0` published (checked 2026-10-13 during planning).
19. **Secrets on a version-less Worker is an operator-verified risk.** Decision 6 makes the first deploy depend on setting secrets on a Worker with zero versions through the dashboard or Wrangler. This is unverified; the operator checks it in Runbook R3. If it proves impossible, that is a new decision for the operator, not a blocker for T1 to T10.

### Cross-cutting constraints

- **Reference source.** `tmp/kixx-devkit/` is local and untracked (`tmp/` is gitignored). Read the matching old module before writing each new one. If the reference is missing, record a blocker. Do not copy out-of-scope modules: `commands/cloudflare/{bootstrap,release,set-secret,set-secrets,delete-secret,recover-secret-version}.js`, `commands/app/{create-release,rollback}.js`, `lib/release/`, `lib/cloudflare/{manage-worker-secrets,provision-resources,prepare-worker-version}.js`, `lib/publishing/{create-application-release,publish-application-content}.js`, `docs/kixx-publishing-api.md` (stale), `PUBLISHING.md`, `.github/`.
- **Stand-alone package.** Nothing under `devkit/` except `devkit/test/conformance/` may import from outside `devkit/`. Conformance tests may import repo `lib/` modules (read-only) to prove wire compatibility. They are dev-only and excluded from both published file lists.
- **Runtime portability.** Use only `node:` built-ins supported by both Node.js 24 and Deno 2.8 (`node:fs/promises`, `node:path`, `node:os`, `node:url`, `node:util` `parseArgs`, `node:crypto`, `node:process`, `node:readline`, `node:tty`), plus web globals (`fetch`, `URL`, `TextEncoder`). Use `fsp.stat` rather than `fsp.access` (Deno's `access` needs `sys=uid`). Never spawn subprocesses.
- **Code style.** Follow `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md`: 4-space indent, private `#` members, argument objects, `isX` type checks from the vendored kixx-assert, JSDoc only on exported contracts, blank lines between logical blocks, and short comments that explain why.
- **Command contract** (ported from `tmp/kixx-devkit/commands/README.md`): each sub-command is a default-exported class with static `description`, `options` (passed to `parseArgs`), `positionals`, `requiredConfig`, and `requiredSecrets`, plus `run(options, ...positionals)` returning an exit code. Each class is registered by static import in its family's `index.js`. Shared logic belongs in `devkit/lib/`, and commands are thin wiring. Commands accept injectable collaborators (`output`, client factories, `fileSystem`, `now`) for tests. Throw `UsageError` for anything the operator can fix. The `requiredCloudflareConfig` static from the old devkit is dropped because no command used it.
- **Tests.** Use kixx-test (`describe`/`it`) with the vendored kixx-assert imported by relative path. Use mocked `fetch` or fake clients and in-memory or temp-directory file systems. No network and no live Cloudflare. Test files are named `*.test.js` and mirror the source tree under `devkit/test/` (`devkit/test/lib/...`, `devkit/test/commands/...`). Shared helpers go in `devkit/test/helpers/` and fixtures in `devkit/test/fixtures/`.
- **Validation commands run from the repo root.** `node devkit/run-tests.js [paths...]` and `node devkit/run-linter.js [paths...]` resolve path arguments from the caller's directory, the same way `lib/run-tests.js` and `lib/run-linter.js` do. Every task must leave `node devkit/run-linter.js devkit` clean and `node devkit/run-tests.js` passing.
- **Never print or persist secret values.** That covers API tokens, publishing tokens, passwords, and invite tokens. Redact them from errors (the old clients' `redact` option). Secret *names* are fine.
- **Output.** Human-readable output goes through `wrapText()` (80 columns) to the injected `output` stream. Machine-readable output (JSON, bare tokens) is written unwrapped.

### API Contract Audit

Seeded during planning, with citations. There is no separate audit task: before writing its client, each consuming task re-checks its own rows against the server and docs, corrects them in place, adds rows for any endpoint it calls that is missing, and lists any server/docs disagreement as **"REPORT TO ORCHESTRATOR"** in its handoff Blockers line (not a devkit blocker unless devkit cannot follow the server). Rows: T3 owns A1, A2, A8, A9; T4 owns A3 to A7 and A12; T5 owns A10. **Authoritative source:** the running server code (repo `lib/`) is authoritative for wire behavior. `docs/admin-api.md` and `docs/publishing-api.md` are authoritative for intent. When docs and server disagree, devkit follows the server and the disagreement is reported to the orchestrator (no `lib/` or `docs/` edits).

| ID | Finding | Server | Docs | Old devkit | Devkit action |
| --- | --- | --- | --- | --- | --- |
| A1 | Invite password length | 12–256 (`lib/app/presentation/forms/admin-users/new-admin-user-form.js:55-56`) | 12–256 (`docs/admin-api.md:479`) | 16–256 (`commands/admin/accept-invite.js:9`) | Confirmed by T3. Validated 12–256 locally (`devkit/commands/admin/accept-invite.js`) |
| A2 | `NewUserConflictError` (409, invite not consumed) and `InviteSpentInEmailRace` (409, invite consumed) | present (`lib/app/transaction-scripts/admin-users/create-admin-user-account.js:43-46,79-82`; `ConflictError` is 409, `lib/kixx/errors/lib/conflict-error.js:25`) | documented (`docs/admin-api.md:514-522`) | unmapped | Confirmed by T3. Mapped to `NewUserConflictError` / `InviteSpentInEmailRaceError` and distinct operator messages |
| A3 | `PublishingApiTokenInactive` (403, expired/revoked token) | present (`lib/app/transaction-scripts/publishing-api-tokens/authenticate-publishing-token.js:42-45`) | documented (`docs/publishing-api.md:83,162`) | unmapped | Confirmed by T4. `createPublishingApiError` returns `PublishingApiTokenInactiveError` (a `UsageError`) naming `kixx admin create-publishing-token` |
| A4 | Discovery: `contentContractVersion: 1`, `addressingFormat: 4`, `buildAssignmentProtocolVersion: 2`, `limits.{maxObjectBytes,maxObjectStatusIds,maxManifestEntries}` | `lib/app/presentation/request-handlers/publishing-api/discovery.js:20-35`, `constants.js:1-4`, `lib/kixx/content-addressable-store/addressing.js:53` | matches (`docs/publishing-api.md:181-218`) | negotiates the same | Confirmed by T4. Negotiation kept; refuses older servers, listing every mismatch |
| A5 | Blob addressing: lib `hashBlob` is async WebCrypto; old devkit is sync `node:crypto` | `lib/kixx/content-addressable-store/addressing.js:235-243` | — | `lib/publishing/addressing.js` | Confirmed by T4. `devkit/test/conformance/addressing.test.js` proves identical digests, canonical JSON, and string order |
| A6 | JSON writes require `Content-Type: application/vnd.api+json`; object `PUT` is raw bytes and needs `Content-Length` (411 without) | `lib/app/presentation/request-handlers/publishing-api/objects.js:55-60` | matches (`docs/publishing-api.md:107,168,274-275`) | sends bytes | Confirmed by T4. `uploadObject` converts the body to a `Uint8Array` (never a stream) |
| A7 | Build `PUT` precondition goes in JSON `attributes.expectedAssignmentId`; `If-Match`/`If-None-Match` is rejected with 400 | `lib/app/presentation/request-handlers/publishing-api/builds.js:86-96`; 412 `BuildPointerConflict` at `:108-112` | matches (`docs/publishing-api.md:563-570`) | protocol 2 body precondition | Confirmed by T4. Kept; build `PUT` is attempted once |
| A8 | Migration codes `MigrationAlreadyAppliedError`, `MigrationConcurrencyError`, `MigrationCursorConflictError` (409) | `transaction-scripts/migrations/run-migration.js:172,219,245` | matches (`docs/admin-api.md:303-310`) | mapped | Confirmed by T3. Mappings kept; `--force` confirmation and `--yes` removed |
| A9 | `InvalidInvite` (403), `InvalidCredentials` (401) | `lib/app/presentation/request-handlers/admin-api/accept-invite.js:15,49`, `lib/app/transaction-scripts/admin-invites/consume-admin-invite.js:10,32`; `lib/app/transaction-scripts/admin-users/verify-admin-credentials.js:12,73` | matches (`docs/admin-api.md:105,481-483`) | mapped | Confirmed by T3. Kept |
| A10 | Content directories: `pages/`, `templates/{base,partials}/`, `static-assets/`, `public/`, `emails/` | lib's tree has exactly these (`lib/pages/`, `lib/templates/{base,partials}/`, `lib/static-assets/`, `lib/public/`, `lib/emails/`); manifest facets `lib/kixx/content-addressable-store/release-manifest.js:33-39` | — | scans the same (`lib/publishing/scan-content-sources.js:64-68`) | Confirmed by T5. `devkit/test/conformance/scan-lib-content.test.js` scans repo `lib/` with no problems, validates every structured payload with lib's `validateStructuredContent`, and the manifest with `validateReleaseManifest`. `templates/README.md` is reported unmatched, not a problem |
| A11 | Old devkit docs say `deploy-version` updates state; the old code never wrote state | — | — | `lib/cloudflare/deploy-worker-version.js` | Implement the state update (T6) |
| A12 | `POST /releases/validation` expects resource type `Release` | `releases.js:136` | "same body as POST /releases" | sends `Release` | Moot after T4: devkit no longer calls this endpoint (`validateRelease` was only used by out-of-scope commands and was not ported) |
| A13 | Endpoints devkit calls: `GET /publishing-api/v1/` (discovery), `POST /objects/status`, `PUT /objects/:objectId`, `POST /releases`, `GET /builds/:buildId`, `PUT /builds/:buildId`; build `reason` ∈ `publish`, `rollback`, `carry-forward`, `restore` | `lib/routes/publishing-api-v1.js:27-44`; reasons `lib/app/collections/activation-record.js:8-13` | matches (`docs/publishing-api.md:50-68,558`) | — | Added by T4. `assign-build --reason` validated locally against the four reasons |

---

### Task T1: Package scaffold, CLI runner, config loading, test and lint runners

**Status:** Complete
**Depends on:** None (validation needs Runbook R1)
**Documentation:** `tmp/kixx-devkit/README.md`, `tmp/kixx-devkit/commands/README.md`, `tmp/kixx-devkit/test/README.md`, `tmp/kixx-devkit/docs/configuration.md`; `lib/run-tests.js`, `lib/run-linter.js`, `lib/eslint.config.js`, `lib/package.json`, `lib/deno.json`

**Objective**

`devkit/` is a runnable, testable, lintable package. `node devkit/kixx.js` lists command families. `--help` and `--version` work. Config layers and `cloudflare-config.jsonc` load with clear errors. One real command (`admin gen-secure-token`) runs end to end. Every later task plugs into this skeleton without touching the runner again, except for the Cloudflare auth-guidance hook in T6.

**Scope**

- In: `devkit/package.json`, `devkit/deno.json`, `devkit/LICENSE` (copy of repo `LICENSE`), `devkit/.gitignore`, `devkit/eslint.config.js`, `devkit/run-tests.js`, `devkit/run-linter.js`, `devkit/kixx.js`, `devkit/commands/index.js`, family `index.js` files (`admin` with `gen-secure-token`; `app` and `cloudflare` with empty maps), `devkit/commands/README.md` (adapted authoring guide), `devkit/test/README.md` (adapted testing guide), `devkit/lib/{command-registry,usage-error,text-wrap,config-loader,cloudflare-config-loader,parse-jsonc,file-system,crypto}.js`, `devkit/lib/vendor/{acorn,kixx-assert}/` (copied verbatim with licenses), and tests for all of the above, including a manifests test and a command-registry test.
- Out: all other commands. The Cloudflare auth-guidance hook in the runner (T6). `devkit/README.md` and `devkit/docs/` (T10).

**Design and invariants**

- **Write `devkit/package.json` first**, so the operator can run R1 while the rest is built. If `devkit/node_modules/` is absent when validation is reached, record a blocker naming R1 and stop.
- `package.json`: name `kixx-devkit`, `"type": "module"`, `bin: { "kixx": "./kixx.js" }`, `engines.node: ">=24"`, MIT, author as in `lib/package.json`, and `repository: { type: git, url: https://github.com/kixx-framework/kixx.git, directory: devkit }`. `files` lists `kixx.js`, `commands/`, `!commands/README.md`, `lib/`, `deno.json`, `README.md`, `docs/`, and `LICENSE` (excludes `test/`, runners, and eslint config). `devDependencies`: `kixx-test` `3.0.0`, `kixx-linting` `1.1.2` (operator installs, R1). No `dependencies`. Version `0.2.0` (Decision 18), identical in `deno.json`.
- `deno.json`: name `@kixx/devkit`, same version, `exports: { "./kixx": "./kixx.js" }`, `publish.include` = `kixx.js`, `commands/`, `lib/`, `docs/`, `README.md`, `LICENSE`, and `publish.exclude` = `commands/README.md`, `test/`. No `imports` (Deno resolves dev tools from `package.json` + `node_modules`). Optional `tasks` for `test`/`lint`/`kixx` mirroring the commands in this plan.
- `.gitignore`: `node_modules/`, `package-lock.json` (as lib does), `*.tgz`.
- `run-tests.js`: model on `lib/run-tests.js` without the e2e machinery. The test root is `devkit/test`. Positional and `--skip` paths resolve from `process.cwd()`, are checked against the root, and then the runner `chdir`s to `devkit/`. Use the deterministic sort/dedupe. The file pattern is `/\.test\.js$/`; the old `/test.js$/` also matched e.g. `latest.js`.
- `run-linter.js`: copy `lib/run-linter.js` (targets resolved from cwd, `cwd: ROOT_DIR`).
- `eslint.config.js`: lib's server rule set. Use `ecmaVersion: 2025`, because `kixx.js` uses `import ... with { type: 'json' }`. Ignore `node_modules/`, `lib/vendor/`, and `test/fixtures/`.
- `kixx.js`: port `tmp/kixx-devkit/kixx.js` and drop `requiredCloudflareConfig`. For the `cloudflare` family only, it loads the project's `cloudflare-config.jsonc` after argument parsing and before construction, and passes the parsed object as `cloudflareConfig`. Help and unknown-command output must still work in a directory with broken config. `--version` reads `deno.json`.
- `cloudflare-config-loader.js`: exports `CLOUDFLARE_CONFIG_FILE_NAME = 'cloudflare-config.jsonc'` and `loadCloudflareConfig(projectDirectory, { fileSystem })`. A missing file, a parse failure, a top level that is not a plain object, or `environments` that is not a plain object each throws `UsageError` naming the absolute path. Parse errors include the JSONC parser message.
- `parse-jsonc.js`: vendored port of `lib/kixx/config/parse-jsonc.js`. Same dialect (comments + trailing commas, nothing else), throwing plain `Error`/`UsageError` instead of lib's `OperationalError`. A conformance test (`devkit/test/conformance/parse-jsonc.test.js`) parses `lib/cloudflare-config.jsonc` and `lib/node-config.jsonc` with both parsers and asserts deep equality.
- `config-loader.js`: port the old loader unchanged in behavior. It finds the project by walking up from cwd to the nearest `.kixx/` directory, bounded by home; merges home then project; deep-freezes; and missing files count as empty layers.
- `gen-secure-token`: port as-is (256-bit lowercase hex, optional `--prefix`).
- `commands/README.md` / `test/README.md`: adapt paths (`devkit/...`), the test root (`devkit/test/`), validation commands (this plan's forms), the removed `requiredCloudflareConfig`, and the conformance-test exception.

**Expected touch points**

- `devkit/{package.json,deno.json,LICENSE,.gitignore,eslint.config.js,run-tests.js,run-linter.js,kixx.js}`
- `devkit/commands/{README.md,index.js}`, `devkit/commands/{admin,app,cloudflare}/index.js`, `devkit/commands/admin/gen-secure-token.js`
- `devkit/lib/*.js` listed above, `devkit/lib/vendor/`
- `devkit/test/{README.md,manifests.test.js,kixx.test.js}`, `devkit/test/commands/index.test.js`, `devkit/test/commands/admin/gen-secure-token.test.js`, `devkit/test/lib/*.test.js`, `devkit/test/conformance/parse-jsonc.test.js`, `devkit/test/helpers/`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `node devkit/kixx.js` lists `admin`, `app`, and `cloudflare`. `node devkit/kixx.js admin --help` lists `gen-secure-token`. `node devkit/kixx.js --version` prints the manifest version.
- [x] `node devkit/kixx.js admin gen-secure-token --prefix x_` prints `x_` + 64 hex characters.
- [x] The manifest test asserts the same version in both manifests, `bin.kixx` / `exports["./kixx"]` equal `./kixx.js`, no `dependencies`, no `deno.json` `imports`, and that `test/` is in neither published file list.
- [x] The registry test fails when a command file is missing from its family map or a family is missing from `commands/index.js`, and when a sub-command declares `help`/`version`/`-h`/`-v`.
- [x] Config loader tests cover the merge order, missing layers, invalid JSON, and non-object files. Cloudflare config loader tests cover a missing file, invalid JSONC, a non-object, and missing `environments`.
- [x] The JSONC conformance test passes against `lib/cloudflare-config.jsonc` and `lib/node-config.jsonc`.
- [x] `node devkit/run-tests.js devkit/test/lib` runs only that subtree. A path outside `devkit/test` fails with a usage message.

**Validation**

- `node devkit/run-tests.js` — the full devkit suite passes.
- `node devkit/run-linter.js devkit` — lint clean.
- `node devkit/kixx.js --help` and `node devkit/kixx.js admin gen-secure-token` — the CLI runs from the repo root.
- `deno run -RWNE --allow-sys=homedir devkit/kixx.js --version` — runs on Deno with the documented permissions.

**Progress and handoff**

- Completed: All T1 code and tests written and validated after Runbook R1.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - `kixx.js` converts `parseArgs` failures (unknown/malformed sub-command flags) into a `UsageError` ending `Run "kixx <cmd> <sub> --help" for usage.` The old runner printed a crash. T3's "`--yes` rejected as unknown" relies on this path.
  - Dropped `findMissingNonEmptyStringKeys` from `config-loader.js` (only `requiredCloudflareConfig` used it). `findMissingKeys` stays.
  - `parse-jsonc.js` throws `TypeError` for non-string input and `SyntaxError` for bad JSONC (lib throws `OperationalError`).
  - `loadCloudflareConfig(projectDirectory, { fileSystem })` reads via `fileSystem.readFile`; `ENOENT` → "Missing required Cloudflare configuration file: <path>", other read errors → "Unable to read <path>".
  - Added `test/helpers/memory-file-system.js` (text `readFile`/`writeFile`/`isFile`, ENOENT on miss) for later tasks.
  - `deno.json` tasks: `test` (`deno run -A run-tests.js`), `lint`, `kixx` (`-RWNE --allow-sys=homedir`).
  - `eslint.config.js` is lib's rule set (with `no-invalid-this`) applied to all files; ignores `node_modules/`, `lib/vendor/`, `test/fixtures/`.
  - `crypto.js` keeps `generateShortId` (candidate `BUILD_ID` suffix for T9).
- Actual files changed: `devkit/{package.json,deno.json,LICENSE,.gitignore,eslint.config.js,run-tests.js,run-linter.js,kixx.js}`; `devkit/commands/{README.md,index.js}`, `devkit/commands/{admin,app,cloudflare}/index.js`, `devkit/commands/admin/gen-secure-token.js`; `devkit/lib/{command-registry,usage-error,text-wrap,config-loader,cloudflare-config-loader,parse-jsonc,file-system,crypto}.js`; `devkit/lib/vendor/{acorn,kixx-assert}/` (verbatim copies); `devkit/test/{README.md,manifests.test.js,kixx.test.js,run-tests.test.js}`, `devkit/test/commands/index.test.js`, `devkit/test/commands/admin/gen-secure-token.test.js`, `devkit/test/lib/{cloudflare-config-loader,command-registry,config-loader,crypto,file-system,parse-jsonc,text-wrap}.test.js`, `devkit/test/conformance/parse-jsonc.test.js`, `devkit/test/helpers/{capture-output,memory-file-system}.js`.
- Validation run (2026-10-14, after R1):
  - `node devkit/run-tests.js`: 77 tests pass. `deno run -A devkit/run-tests.js`: 77 pass (orchestrator run).
  - `node devkit/run-linter.js devkit`: exit 0.
  - `node devkit/run-tests.js devkit/test/lib`: 52 tests (subtree only). `node devkit/run-tests.js lib/test`: usage message, non-zero exit.
  - `node devkit/kixx.js --help` lists admin, app, cloudflare. `admin --help` lists `gen-secure-token`. `admin gen-secure-token --prefix x_` prints `x_` + 64 hex.
  - `deno run -RWNE --allow-sys=homedir devkit/kixx.js --version` prints `0.2.0`.
- Blockers: None.

---

### Task T3: Admin API client and admin commands

**Status:** Complete
**Depends on:** T1
**Documentation:** `tmp/kixx-devkit/docs/admin.md`, `docs/admin-api.md`, plan audit rows A1, A2, A8, A9

**Objective**

`kixx admin accept-invite`, `create-publishing-token`, `list-migrations`, and `run-migration` work against this repo's Admin API. Each changed behavior (password length, conflict messages, `--force` without confirmation, no `--yes`) is covered by tests. The admin family is complete.

**Scope**

- In: `devkit/lib/admin/{admin-api-client,admin-api-error,resolve-admin-environment}.js`, `devkit/lib/{prompt,resolve-environment-origin}.js`, the four commands, and their tests.
- Out: Publishing API client (T4). Docs (T10).

**Design and invariants**

- Port the old client: base `new URL('/admin-api/v1/', origin)`, HTTP Basic for admin endpoints, Bearer for invite, JSON:API bodies with `content-type: application/vnd.api+json`, read-only retries only, redaction of the token and password, and typed errors by `errors[].code`. Add `NewUserConflictError` and `InviteSpentInEmailRace` classes (A2).
- `accept-invite`: resolve the environment and origin **before** prompting, so a bad `-e` fails without asking for secrets. Local password check is 12 to 256 characters (A1). Messages:
  - `InvalidInvite`: the token is unknown, expired, revoked, or used.
  - `NewUserConflictError`: an admin with that email exists; the invite was not consumed, so retry with another email.
  - `InviteSpentInEmailRace`: the invite was consumed by a concurrent signup; a new invite is required.
- `run-migration`: options are `--environment/-e`, `--origin`, `--dry-run`, `--force`, and `--cursor`. **No `--yes`, no confirmation prompt, and no `promptForConfirmation` in `prompt.js`.** `--dry-run` together with `--force` is a usage error. `--cursor` without `--dry-run` is a usage error. Before a real batch it still echoes `Running on <env> (<origin>)` (informational, not a prompt). Keep the three conflict messages and the `Next:` command line.
- Credentials come only from prompts or the env vars `KIXX_ADMIN_EMAIL`, `KIXX_ADMIN_PASSWORD`, `KIXX_ADMIN_INVITE_TOKEN`. When stdin is not a TTY and the var is unset, fail naming the var. Never accept credentials via argv or files.
- `create-publishing-token`: same options as the old command (`--roles`, `--ttl`, `--description`, `--origin`). Print the one-time token block naming `app.environments.<env>.publishingToken` in `.kixx/secrets.json`. Write it nowhere.

**Expected touch points**

- `devkit/lib/admin/`, `devkit/lib/prompt.js`, `devkit/lib/resolve-environment-origin.js`
- `devkit/commands/admin/{accept-invite,create-publishing-token,list-migrations,run-migration}.js`, `devkit/commands/admin/index.js`
- `devkit/test/lib/admin/`, `devkit/test/lib/prompt.test.js`, `devkit/test/commands/admin/`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Client tests (mocked `fetch`) assert URLs, methods, auth headers, media types, request bodies, error-code-to-class mapping, and that the password and tokens never appear in error messages.
- [x] `run-migration --force` sends `force: true` with no prompt call. `--yes` is rejected by `parseArgs` as an unknown option.
- [x] `accept-invite` rejects 11-character and 257-character passwords locally, accepts 12, and maps all three invite/conflict codes to distinct messages.
- [x] `node devkit/kixx.js admin --help` lists the five admin sub-commands in declaration order.
- [x] Audit rows A1, A2, A8, A9 are confirmed or corrected with server and docs `file:line` citations; disagreements are listed under Blockers, or "None found".

**Validation**

- `node devkit/run-tests.js devkit/test/lib/admin devkit/test/commands/admin devkit/test/lib/prompt.test.js` — admin behavior.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Admin API client with typed errors (adds `NewUserConflictError`, `InviteSpentInEmailRaceError`), environment resolver, prompts, and the four admin commands, with tests. Audit rows A1, A2, A8, A9 confirmed with citations.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - `resolveAdminEnvironment({ environment, config, origin, createClient })` returns `{ environment, origin, connect({ email, password }) }`. All four commands resolve the environment before prompting (the plan required it only for `accept-invite`), so a bad `-e` never asks for secrets.
  - Shared `lib/admin/prompt-admin-credentials.js` reads `KIXX_ADMIN_EMAIL` / `KIXX_ADMIN_PASSWORD` (password masked).
  - `prompt.js` exports only `promptForValue` and `promptForValueTwice`, each taking an injectable `env` (default `process.env`). Dropped `promptForConfirmation` and `readSecretValue` (secrets commands are out of scope). `promptForValueTwice` returns an env value once instead of reading it twice.
  - The client builds Basic auth with `btoa` over UTF-8 bytes (no `node:buffer`) and also redacts the base64 credential string.
  - `create-publishing-token --ttl` must be a positive whole number (usage error before prompting). The old command sent `NaN`.
  - `run-migration` prints its `Next:` command unwrapped so it stays copyable; the rest of the output is wrapped.
  - `list-migrations` prints "No migrations are registered." for an empty list.
  - For T10: command help lists long flags only (`--environment`, not `-e`); that is T1 runner behavior.
- Actual files changed: `devkit/lib/admin/{admin-api-client,admin-api-error,resolve-admin-environment,prompt-admin-credentials}.js`, `devkit/lib/{prompt,resolve-environment-origin}.js`, `devkit/commands/admin/{index,accept-invite,create-publishing-token,list-migrations,run-migration}.js`; tests `devkit/test/lib/admin/{admin-api-client,admin-api-error,resolve-admin-environment,prompt-admin-credentials}.test.js`, `devkit/test/lib/{prompt,resolve-environment-origin}.test.js`, `devkit/test/commands/admin/{accept-invite,create-publishing-token,list-migrations,run-migration}.test.js`, `devkit/test/kixx.test.js` (admin help order, `--yes` rejection, non-TTY credential message).
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/admin devkit/test/commands/admin devkit/test/lib/prompt.test.js`: 61 tests pass.
  - `node devkit/run-tests.js`: 143 tests pass. `deno run -A devkit/run-tests.js`: 143 pass.
  - `node devkit/run-linter.js devkit`: exit 0.
  - `node devkit/kixx.js admin --help` lists gen-secure-token, accept-invite, create-publishing-token, list-migrations, run-migration in that order.
- Blockers: None. Server/docs disagreements for A1, A2, A8, A9: None found.

---

### Task T4: Publishing API client, capability negotiation, and `app assign-build`

**Status:** Complete
**Depends on:** T1
**Documentation:** `tmp/kixx-devkit/docs/app.md` (`assign-build`, Pointer conflicts, Server requirement), `docs/publishing-api.md`, plan audit rows A3 to A7, A12

**Objective**

The Publishing API protocol layer is in place and proven wire-compatible with repo `lib/`. That layer covers the client, typed errors, discovery negotiation, addressing, pathname rules, and conditional build assignment. `kixx app assign-build` works on top of it. T5 builds content publishing on top of it.

**Scope**

- In: `devkit/lib/publishing/{publishing-api-client,publishing-api-error,negotiate-capabilities,addressing,content-layout,assign-release,resolve-publishing-environment}.js`, `devkit/commands/app/assign-build.js`, tests, and conformance tests for addressing and pathname rules.
- Out: Content scanning, CSS bundling, and `publish` (T5).

**Design and invariants**

- Port the old modules. Negotiation refuses any server that is not `contentContractVersion 1`, `addressingFormat 4`, and `buildAssignmentProtocolVersion 2`, listing every mismatch, before any write (A4).
- `assign-release`: read the build. Send its `assignmentId` verbatim as `expectedAssignmentId`, or `null` on 404 `BuildNotFound`. Never retry a `412 BuildPointerConflict`; report intended, expected, and current. `--reason` accepts `publish|rollback|carry-forward|restore`.
- Map `PublishingApiTokenInactive` to a `UsageError` saying the token is expired or revoked and to mint one with `kixx admin create-publishing-token` (A3).
- Object upload sends a byte buffer (`Uint8Array`/`ArrayBuffer`) so `fetch` sets `Content-Length` (A6). Test that the mocked `fetch` receives a non-stream body.
- `addressing.js` may stay synchronous (`node:crypto`), but its digests must equal lib's. `devkit/test/conformance/addressing.test.js` imports `lib/kixx/content-addressable-store/addressing.js` and compares `hashBlob`, `canonicalize`, and `compareStrings` on text, binary, JSON, unicode, and empty inputs. `content-layout.test.js` in the same folder compares `isValidPathname`, `normalizePathname`, `isValidTemplateFilepath`, and `RESERVED_PAGE_FILENAMES` membership against lib's.
- `assign-build` options: `-e`, `--build-id` (required), `--release-id` (required), `--reason`, `--origin`, `--token`. The output reports the resulting `assignmentId`.

**Expected touch points**

- `devkit/lib/publishing/` (modules listed above)
- `devkit/commands/app/{index,assign-build}.js`
- `devkit/test/lib/publishing/`, `devkit/test/commands/app/assign-build.test.js`, `devkit/test/conformance/{addressing,content-layout}.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Client tests cover every endpoint devkit calls: URL, method, Bearer header, media type, envelope, `status`-string error parsing, read-only retries, and token redaction.
- [x] Negotiation tests: each single mismatch and a multi-mismatch report. No write is attempted after a refusal.
- [x] `assign-build` tests: first assignment (`null` precondition), conditional reassignment, and a 412 conflict that is reported and not retried.
- [x] Conformance tests pass against repo `lib/`.
- [x] Audit rows A3 to A7 and A12 are confirmed or corrected with citations, plus a row for any called endpoint not yet listed; disagreements are listed under Blockers, or "None found".

**Validation**

- `node devkit/run-tests.js devkit/test/lib/publishing devkit/test/commands/app devkit/test/conformance` — protocol behavior and lib compatibility.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Publishing API client, typed errors, negotiation, addressing, content layout, `assign-release`, environment resolver, and `app assign-build`, with unit and conformance tests. Audit rows A3 to A7 and A12 checked; A13 added.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - Client keeps only the methods devkit calls: `discover`, `getObjectStatus`, `uploadObject`, `createRelease`, `getBuild`, `assignBuild`. Dropped `validateRelease`, `listReleases`, `getRelease`, `getReleaseManifest`, `listBuilds`, `getBuildActivations` (only out-of-scope `create-release`/`rollback`/`release` used them). Dropped `assignReleaseToNewBuild` (only `lib/release/` used it).
  - Retries: the client retries 429/5xx/network failures on every idempotent request (GETs, `objects/status`, content-addressed object `PUT`, content-addressed `POST /releases`), as the old client did. The build `PUT` is never retried. Interpreted the plan's "read-only retries" this way; T5 relies on idempotent upload retries. Orchestrator accepted 2026-10-14: `docs/publishing-api.md` says re-creating identical Release content returns the original record, so these retries are safe.
  - `PublishingApiTokenInactiveError extends UsageError` (in `publishing-api-error.js`) so `kixx.js` prints it as operator guidance. Its message uses `<environment>` placeholders because the client does not know the environment name.
  - `uploadObject` accepts `string | ArrayBuffer` (hashing contract unchanged) and sends a `Uint8Array`.
  - `assign-build` validates `--build-id`, `--release-id`, and `--reason` before resolving the environment or making any request.
  - `devkit/lib/publishing/addressing.js` and `content-layout.js` doc comments now point at repo `lib/` instead of the old `tmp/sample-app/` path.
  - For T5: `publish` should reuse `negotiateCapabilities(client)` and `assignRelease({ client, buildId, releaseId, reason })`; `resolvePublishingEnvironment` returns `{ environment, origin, client }`.
- Actual files changed: `devkit/lib/publishing/{publishing-api-client,publishing-api-error,negotiate-capabilities,addressing,content-layout,assign-release,resolve-publishing-environment}.js`, `devkit/commands/app/{index,assign-build}.js`; tests `devkit/test/lib/publishing/{publishing-api-client,negotiate-capabilities,addressing,content-layout,assign-release,resolve-publishing-environment}.test.js`, `devkit/test/commands/app/assign-build.test.js`, `devkit/test/conformance/{addressing,content-layout}.test.js`.
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/publishing devkit/test/commands/app devkit/test/conformance`: 79 tests pass.
  - `node devkit/run-tests.js`: 219 tests pass. `deno run -A devkit/run-tests.js`: 219 pass.
  - `node devkit/run-linter.js devkit`: exit 0.
- Blockers: None. Server/docs disagreements for A3 to A7, A12, A13: None found.

---

### Task T5: Content scanning, stylesheet bundling, and `app publish`

**Status:** Complete
**Depends on:** T4
**Documentation:** `tmp/kixx-devkit/docs/app.md` (`publish`, Stylesheet bundling), `docs/publishing-api.md` (Create a Release, Workflows), plan audit row A10

**Objective**

`kixx app publish -e <env> [--build-id id]` does the following: scans `pages/`, `templates/`, `static-assets/`, `public/`, and `emails/`; validates the tree; bundles CSS entry points; uploads only missing objects; creates a Release; and assigns it to the running build or `--build-id`. If assignment fails after the Release exists, it reports a ready-to-run `kixx app assign-build` command. A conformance test proves devkit's manifest for repo `lib/` content is accepted by lib's validator.

**Scope**

- In: `devkit/lib/publishing/{scan-content-sources,bundle-stylesheet,parse-stylesheet,strip-asset-comments,content-source-report,publish-content}.js`, `devkit/commands/app/publish.js` (with `ReleaseAssignmentError`), tests, and `devkit/test/conformance/scan-lib-content.test.js`.
- Out: `create-release` and `rollback` commands (out of scope). Changes to repo `lib/` content.

**Design and invariants**

- Port behavior as documented in the old `docs/app.md`: problem codes, unmatched-file reporting, the dry-run preview (no writes), verbose listing, and provenance `{ client: 'kixx-devkit', intendedForBuildId }`.
- `publish` options: `-e`, `--build-id`, `--dry-run`, `--verbose`, `--origin`, `--token`. When discovery has no `runningBuildId` and no `--build-id` is given, fail with a usage error. Resolve the build id inside `commands/app/publish.js` (the old `lib/publishing/resolve-running-build.js` logic, ~15 lines); do not port it as a module, since `publish` is now its only caller (`assign-build` requires `--build-id`).
- On assignment failure after Release creation, throw `ReleaseAssignmentError` carrying `releaseId` and `buildId`. The message includes `kixx app assign-build -e <env> --build-id <id> --release-id <id>`.
- Conformance test: run devkit's scanner over repo `lib/` (read-only). Assert no blocking problems, and that every structured payload parses. Build the manifest exactly as `publish-content` would, and validate it with `lib/kixx/content-addressable-store/release-manifest.js`'s exported validator. Assert `lib/templates/README.md` appears as unmatched, not as a problem. If lib's content fails devkit validation, record it as a finding for the orchestrator rather than loosening devkit rules.

**Expected touch points**

- `devkit/lib/publishing/` (modules listed above)
- `devkit/commands/app/{index,publish}.js`
- `devkit/test/lib/publishing/`, `devkit/test/commands/app/publish.test.js`, `devkit/test/conformance/scan-lib-content.test.js`, `devkit/test/fixtures/content/` (small sample trees)

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Scanner and stylesheet tests cover each documented problem code, import inlining, `url()` rewriting, cycles, and charset handling.
- [x] `publish` tests: the happy path uploads only missing objects. Dry-run performs no writes. Missing running build is a usage error. Assignment failure yields the recovery command.
- [x] The conformance scan of repo `lib/` passes.
- [x] Audit row A10 is confirmed or corrected with citations.
- [x] `node devkit/kixx.js app --help` lists `publish` and `assign-build`.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/publishing devkit/test/commands/app devkit/test/conformance` — publishing behavior and lib compatibility.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Scanner, stylesheet parser and bundler, asset comment stripping, content-source report, `publish-content`, and `app publish`, with unit tests and a conformance scan of repo `lib/`. Audit row A10 confirmed.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - `scan-content-sources`, `bundle-stylesheet`, `parse-stylesheet`, `strip-asset-comments`, `content-source-report`, and `publish-content` are verbatim ports with their old tests (import paths adjusted). The old tests already cover every documented problem code (scanner and `css-*`), import inlining, `url()` rewriting, cycles, and charset handling.
  - `publish-content.js` now exports `makeReleaseManifest(resources)` (was private `makeManifest`) so the conformance test validates exactly the manifest `publish` sends.
  - `commands/app/publish.js`: build resolution is an inline `resolveBuildId` (explicit `--build-id` wins; empty is a usage error; otherwise discovery's `runningBuildId`, else a usage error naming `--build-id`). Order kept from the old command: resolve environment, resolve build, scan, publish, assign. Dropped the old `resolveRunningBuild` injection and merged `renderReleaseResult` into `renderPublishResult` (`create-release` is out of scope).
  - `ReleaseAssignmentError` stays a plain `Error` (not `UsageError`) so the runner prints the recovery command unwrapped: `kixx app assign-build -e <env> --build-id <id> --release-id <id>`. `UnsupportedServerError` from assignment passes through.
  - Publishing makes two discovery calls when `--build-id` is absent (build resolution, then negotiation inside `publishContent`). Harmless; left as in the old devkit.
  - No `devkit/test/fixtures/content/` tree was needed; scanner tests build temp trees.
- Actual files changed: `devkit/lib/publishing/{scan-content-sources,bundle-stylesheet,parse-stylesheet,strip-asset-comments,content-source-report,publish-content}.js`, `devkit/commands/app/{index,publish}.js`; tests `devkit/test/lib/publishing/{scan-content-sources,bundle-stylesheet,parse-stylesheet,strip-asset-comments,content-source-report,publish-content}.test.js`, `devkit/test/commands/app/publish.test.js`, `devkit/test/conformance/scan-lib-content.test.js`, `devkit/test/kixx.test.js` (app help order).
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/publishing devkit/test/commands/app devkit/test/conformance`: 155 tests pass.
  - `node devkit/run-tests.js`: 535 pass. `deno run -A devkit/run-tests.js`: 535 pass.
  - `node devkit/run-linter.js devkit`: exit 0. `git status --short lib`: empty.
  - `node devkit/kixx.js app --help` lists `publish`, `assign-build`.
- Blockers: None. Server/docs disagreements for A10: None found.

---

### Task T6: Cloudflare API client, state file, and `create-worker` / `update-worker` / `deploy-version`

**Status:** Complete
**Depends on:** T1
**Documentation:** `tmp/kixx-devkit/docs/cloudflare.md` (`create-worker`, `update-worker`, `deploy-version`), `tmp/kixx-devkit/docs/configuration.md` (Cloudflare settings)

**Objective**

The Cloudflare transport and the three simple Cloudflare commands work. Cloudflare authentication failures print operator guidance instead of a stack trace. The state file module that T9 also uses exists. `deploy-version` follows Decision 3.

**Scope**

- In: `devkit/lib/cloudflare/{cloudflare-api-client,cloudflare-api-error,cloudflare-auth-guidance,worker-version-state,deploy-worker-version}.js`; the runner hook in `devkit/kixx.js` that converts auth failures into `UsageError`; the commands `create-worker`, `update-worker`, `deploy-version`; tests.
- Out: `create-worker-version` and its modules (T7 to T9).

**Design and invariants**

- **Client methods kept:** `verifyToken`, `createWorker`, `getWorker`, `updateWorker`, `listWorkerVersions`, `getWorkerVersion`, `createWorkerVersion` (`deploy`, `strictBindingsInheritance` → `bindings_inherit=strict`), `createDeployment`, `getKVNamespace`, `getD1Database`, `getR2Bucket` (jurisdiction header).
- **Not ported:** every create/list/find of KV, D1, or R2; `createWorkerSecretVersion`; `queryD1Database`. The client takes an injectable `fetch`.
- `create-worker`/`update-worker`: port as-is. They send `environments.<env>.WORKER` only (no bindings or secrets). `update-worker` is a full-replacement `PUT` keyed by `WORKER.name`.
- `deploy-version [version-id]`: options are `-e` only (**no `--force`**). Requires `cloudflare.accountId`/`apiToken`. Steps:
  1. Resolve the version from the positional, or else from `state.versionId`.
  2. `getWorkerVersion`; a 404 is a usage error.
  3. `createDeployment` with `{ strategy: 'percentage', versions: [{ version_id, percentage: 100 }] }`, **without** a `force` query parameter (Decision 16).
  4. Update state.
  5. Print environment, Worker, version, and `BUILD_ID` (read from the version's `plain_text` binding; print `(none)` if absent, never fail on it).
- No Publishing API client and no `config.app` lookup in this command.
- **State update after deploy:** if a state file exists, rewrite it with `deployed: versionId === state.versionId`, keeping every other field. Deploying an older version marks the recorded version undeployed. If no state file exists, write none. If Cloudflare fails, state is untouched.
- `worker-version-state.js`: port unchanged. The path is `<project>/.kixx/cloudflare-state.<env>.json`. Field validation is not a whitelist. Writes are complete records.

**Expected touch points**

- `devkit/lib/cloudflare/` (modules listed above)
- `devkit/kixx.js` (auth-guidance catch)
- `devkit/commands/cloudflare/{index,create-worker,update-worker,deploy-version}.js`
- `devkit/test/lib/cloudflare/`, `devkit/test/commands/cloudflare/`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Client tests cover each kept method's URL, method, query, headers, envelope unwrapping, error envelope parsing, token verification on 401/403, and token redaction.
- [x] `deploy-version` tests: explicit id; state id; no id and no state is a usage error; 404 version; no Publishing API calls; `--force` rejected as unknown; state `deployed` true for the recorded version and false for another; no state file created when absent; state untouched when the deployment fails.
- [x] Auth-failure guidance prints as a usage message naming the secrets files.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/cloudflare devkit/test/commands/cloudflare` — Cloudflare client and commands.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Cloudflare client (kept methods only), `CloudflareApiError`, auth guidance with runner hook, state module, `deployWorkerVersion`, and `create-worker`, `update-worker`, `deploy-version`, with tests.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - Client takes injectable `fetch` (defaults to `globalThis.fetch`) and always redacts `apiToken` from error messages and error arrays. `getWorkerVersion` dropped the old `include: 'modules'` option (only `recover-secret-version` used it). `createDeployment(workerName, deployment)` takes no options, so `force` cannot be sent (Decision 16).
  - New `lib/cloudflare/read-worker-config.js` (`readWorkerConfig(cloudflareConfig, environment)`): requires `--environment`, `environments.<env>.WORKER`, and a non-empty `WORKER.name`; shared by the three commands. T9 may reuse it or T8's `worker-version-config.js`.
  - `cloudflare-auth-guidance.js` adds `toCloudflareAuthUsageError(error, secretsFilepaths)`; `kixx.js` wraps `command.run` with it. The hook is unit-tested; no end-to-end runner test because it would need live Cloudflare or a runtime-specific fetch preload.
  - `deployWorkerVersion` returns `{ environment, workerName, versionId, buildId|null, stateFilepath|null, deployment }`. It reads state before any request, so a corrupt state file fails without moving traffic. If the state write fails after a deployment, it throws a plain `Error` saying traffic moved, naming the path and the `deployed` value to set.
  - Commands take `createClient` (Cloudflare client factory) and `output`; `deploy-version` also `fileSystem`.
  - `worker-version-state.js` and `cloudflare-api-error.js` ported verbatim.
  - `test/commands/cloudflare/create-worker.test.js` also covers `update-worker` (same shape).
- Actual files changed: `devkit/kixx.js`; `devkit/lib/cloudflare/{cloudflare-api-client,cloudflare-api-error,cloudflare-auth-guidance,worker-version-state,deploy-worker-version,read-worker-config}.js`; `devkit/commands/cloudflare/{index,create-worker,update-worker,deploy-version}.js`; tests `devkit/test/lib/cloudflare/{cloudflare-api-client,cloudflare-auth-guidance,worker-version-state,deploy-worker-version}.test.js`, `devkit/test/commands/cloudflare/{create-worker,deploy-version}.test.js`, `devkit/test/kixx.test.js` (cloudflare help order, `deploy-version --force` rejected).
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/cloudflare devkit/test/commands/cloudflare`: 52 tests pass.
  - `node devkit/run-tests.js`: 273 tests pass. `deno run -A devkit/run-tests.js`: 273 pass.
  - `node devkit/run-linter.js devkit`: exit 0.
- Blockers: None.

---

### Task T7: Worker module bundler, generated config file, and hashing

**Status:** Complete
**Depends on:** T1
**Documentation:** `tmp/kixx-devkit/docs/cloudflare.md` (§5 Package the module graph, §6 hashes), `lib/kixx/config/read-config.js`, `lib/cloudflare-server.js`

**Objective**

Given a project directory, an environment, and the parsed `cloudflare-config.jsonc`, devkit writes `cloudflare-config.generated.js` in the shape `lib/kixx/config/read-config.js` expects. It then packages the static import graph from `cloudflare-server.js` into Cloudflare modules and computes `modulesHash` deterministically. A conformance test bundles repo `lib/` successfully without writing into it.

**Scope**

- In: `devkit/lib/bundler/{bundle-modules,resolve-specifier,strip-comments,bundle-error}.js`, `devkit/lib/cloudflare/{worker-modules,build-id,generated-config}.js`, `devkit/lib/canonical-hash.js`, tests, and `devkit/test/conformance/bundle-lib.test.js`.
- Out: Bindings, secrets, exports, and the version payload (T8). Remote calls and orchestration (T9).

**Design and invariants**

- Port the bundler unchanged in behavior:
  - Entry `cloudflare-server.js`; externals `node:` and `cloudflare:`; comments stripped with line positions preserved.
  - Rejects: bare imports, modules outside the entry directory, extensions other than `.js`/`.mjs`, CommonJS, missing files or casing mistakes, and non-literal dynamic `import()`.
  - Output: project-relative POSIX names, with the main module marked.
- **Generated config shape.** `readConfig(sourceConfig, environment)` requires a plain object with an `environments` plain object containing the selected environment. It copies other top-level fields through. Write:

  ```js
  // Generated from cloudflare-config.jsonc by `kixx cloudflare create-worker-version`. Do not edit or commit.
  export default <JSON>;
  ```

  `<JSON>` is `JSON.stringify({ ...topLevelFieldsExceptEnvironments, environments: { [environment]: environmentConfig } }, null, 4)`. Only the selected environment is included, so another environment's edits cannot change this environment's `modulesHash` or leak into its bundle. Output is deterministic (source key order, LF endings, trailing newline). Write it with the injected `fileSystem` to `<project>/cloudflare-config.generated.js`.
- `writeGeneratedConfig({ projectDirectory, environment, cloudflareConfig, fileSystem })` is a separate exported function, so T9 controls *when* it runs: after remote preflight, immediately before bundling.
- `modulesHash` is independent of module order. `formatBuildId(date, uniqueId)` produces a readable UTC timestamp plus a unique suffix. `BUILD_ID` never enters any hash.
- Conformance: bundle `lib/cloudflare-server.js` through an overlay `fileSystem` that serves a virtual `cloudflare-config.generated.js` (built from `lib/cloudflare-config.jsonc` for `production`) and delegates everything else to the real file system. Do **not** write into `lib/`. Assert success, that `cloudflare-server.js` is the main module, that the generated module is included, and that no module is outside `lib/`.

**Expected touch points**

- `devkit/lib/bundler/`, `devkit/lib/cloudflare/{worker-modules,build-id,generated-config}.js`, `devkit/lib/canonical-hash.js`
- `devkit/test/lib/bundler/`, `devkit/test/lib/cloudflare/{worker-modules,build-id,generated-config}.test.js`, `devkit/test/lib/canonical-hash.test.js`, `devkit/test/conformance/bundle-lib.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Each bundler rejection has a test with a clear error naming the importing file.
- [x] Generated-config tests: only the selected environment is present, top-level fields are preserved, and output is byte-stable across runs. A conformance assertion runs the generated object through lib's `readConfig` (`lib/kixx/config/read-config.js`); do not reimplement `readConfig`'s preconditions in devkit tests.
- [x] The conformance bundle of repo `lib/` passes, and `git status lib/` shows no changes afterward.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/bundler devkit/test/lib/cloudflare devkit/test/conformance` — bundler, generated config, and lib compatibility.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Bundler (`bundle-modules`, `resolve-specifier`, `strip-comments`, `bundle-error`), `canonical-hash`, `build-id`, `worker-modules`, and `generated-config`, with unit tests and a conformance test that bundles repo `lib/`.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - Bundler, `canonical-hash.js`, `build-id.js`, and `toWorkerModules`/`hashWorkerModules` ported verbatim with their old tests (import paths adjusted). Added a `bundle-modules` test that drives every rejection through `bundleModules` and asserts the message names `./importer.js:<line>`.
  - For T9: `worker-modules.js` adds `packageWorkerModules({ projectDirectory, fileSystem, bundleModules })` → `{ mainModule, modules, modulesHash }`, with entry `cloudflare-server.js` (`WORKER_ENTRY_FILE_NAME`) and externals `node:`/`cloudflare:`. Use it instead of re-wiring the bundler.
  - `generated-config.js` exports `GENERATED_CONFIG_FILE_NAME`, `renderGeneratedConfig({ environment, cloudflareConfig })`, and `writeGeneratedConfig({ projectDirectory, environment, cloudflareConfig, fileSystem })` (returns the path). A missing or non-object environment (own property only) is a `UsageError` naming `environments.<env>`.
  - The bundler strips the generated file's header comment (line kept), so the packaged module text is the rendered text minus line 1's content.
  - `crypto.js` `generateShortId()` is the intended `formatBuildId` suffix.
  - Conformance (`test/conformance/bundle-lib.test.js`) imports the rendered module through a `data:` URL and passes it to lib's `readConfig`; the bundle uses an overlay file system whose `writeFile` records instead of writing. `git status lib/` is clean afterward.
- Actual files changed: `devkit/lib/bundler/{bundle-error,bundle-modules,resolve-specifier,strip-comments}.js`, `devkit/lib/cloudflare/{worker-modules,build-id,generated-config}.js`, `devkit/lib/canonical-hash.js`; tests `devkit/test/lib/bundler/{bundle-error,bundle-modules,resolve-specifier,strip-comments}.test.js`, `devkit/test/lib/cloudflare/{worker-modules,build-id,generated-config}.test.js`, `devkit/test/lib/canonical-hash.test.js`, `devkit/test/conformance/bundle-lib.test.js`.
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/bundler devkit/test/lib/cloudflare devkit/test/conformance`: 107 tests pass.
  - `node devkit/run-tests.js`: 332 pass. `deno run -A devkit/run-tests.js`: 332 pass.
  - `node devkit/run-linter.js devkit`: exit 0. `git status --short lib`: empty.
- Blockers: None.

---

### Task T8: Worker bindings, secrets manifest, Durable Object exports, and version payload

**Status:** Complete
**Depends on:** T1
**Documentation:** `tmp/kixx-devkit/docs/cloudflare.md` (§Environment files, §4 bindings and exports, resource binding table, `SEND_EMAIL`, `IMAGES`, `OBJECT_STORE`), `lib/kixx/config/secrets-manifest.js`, `lib/example.env.secrets`, `lib/example.env`

**Objective**

Pure, local modules turn the selected environment's config, `.env.<env>`, and `example.env.secrets` into a validated, name-sorted binding array, a declarative Durable Object `exports` map, and a Cloudflare version payload. They also decide which declared secrets to inherit from a given remote version. With no I/O beyond reading local files, the most rule-dense code is tested in isolation before orchestration.

**Scope**

- In: `devkit/lib/cloudflare/{worker-bindings,durable-object-exports,object-store-buckets,cloudflare-worker-version,worker-secret-names,secrets-manifest,worker-version-config}.js`, `devkit/lib/env-file.js` (`.env.<env>` reader only), tests, and `devkit/test/conformance/secrets-manifest.test.js`.
- Out: Remote verification, upload, and state (T9).

**Design and invariants**

- `secrets-manifest.js`: a port of lib's `parseSecretsManifest` (`{ required, optional }`, `# @optional` directive, strict line grammar), throwing `UsageError` naming `example.env.secrets` and the line. Conformance: parse `lib/example.env.secrets` and fixtures with both parsers and assert equality. `BUILD_ID` and `ENVIRONMENT` as secret names are errors.
- `worker-secret-names.js`:
  - `readSecretBindingNames(version)`: only `secret_text`/`secret_key` count; a missing bindings list throws.
  - `compareDeclaredSecrets({ manifest, remoteNames })` returns `{ missingRequired, undeclared, inheritedNames }` under the Decision 5 rule: `inheritedNames` = required ∪ (optional ∩ remote). `undeclared` = remote − (required ∪ optional). Both lists are sorted. This is the only place the rule lives.
- `env-file.js`: the old minimal dotenv parser for `.env.<env>`, which is required. It ignores an authored `ENVIRONMENT` and rejects `BUILD_ID`, bad names, and duplicates.
- `worker-bindings.js`: port. The inputs that produce bindings are `DOCUMENT_STORE` (d1), `KEY_VALUE_STORE` (kv), `CONTENT_STORE` (kv + DO), `JOB_QUEUE` (DO only), `OBJECT_STORE.buckets` (r2, with jurisdiction), `SEND_EMAIL` (`send_email`), `IMAGES` (`images`), `ENVIRONMENT` (from `--environment`), `.env` values (`plain_text`), and inherited secrets (`{ type: 'inherit', name, version_id }` for `inheritedNames` only). Collisions are rejected. No `BUILD_ID`. Missing resource IDs throw, but T9 guarantees they are verified first. Move `RESERVED_NAMES` (`BUILD_ID`, `ENVIRONMENT`) here.
- `object-store-buckets.js`: validate entries. `locationHint` and `storageClass` are accepted and ignored, since creation is deferred.
- `durable-object-exports.js`: port (live SQLite exports for the `CONTENT_STORE`/`JOB_QUEUE` classes, plus `DURABLE_OBJECT_MIGRATIONS` lifecycle entries). Return `{ exports, liveClasses }`.
- `worker-version-config.js`: validates `environments.<env>` exists, `WORKER.name` is a non-empty string, and `WORKER_VERSION` keys ⊆ {`compatibility_date`, `compatibility_flags`, `limits`, `placement`, `cache_options`}. Reject `annotations`. Errors name `cloudflare-config.jsonc` paths.
- `cloudflare-worker-version.js`: port the payload builder (modules, bindings, exports, annotations, validation of binding shapes and export states).

**Expected touch points**

- `devkit/lib/cloudflare/` (modules listed above), `devkit/lib/env-file.js`
- `devkit/test/lib/cloudflare/`, `devkit/test/lib/env-file.test.js`, `devkit/test/conformance/secrets-manifest.test.js`

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `compareDeclaredSecrets` tests: exact match; missing required; undeclared remote; optional present (inherited); optional absent (not inherited, no error); `plain_text` with a declared name does not count.
- [x] Bindings built from `lib/cloudflare-config.jsonc` `production` (test fixture copy) contain d1, two kv, two DO namespaces, r2 `OBJECT_STORE_FILES`, `send_email`, `ENVIRONMENT`, and the inherit bindings, sorted by name.
- [x] DO exports for that config contain `ContentAddressableIndexStore` and `JobQueueStore` as live classes.
- [x] Unknown `WORKER_VERSION` keys and `annotations` are rejected with the config path.
- [x] The secrets-manifest conformance test passes.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/cloudflare devkit/test/lib/env-file.test.js devkit/test/conformance` — binding rules and lib compatibility.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: `secrets-manifest`, `worker-secret-names` (`compareDeclaredSecrets`), `env-file`, `worker-bindings`, `object-store-buckets`, `durable-object-exports`, `cloudflare-worker-version`, and `worker-version-config`, with unit tests and a secrets-manifest conformance test.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - **`readWorkerConfig` overlap: folded, not duplicated.** `read-worker-config.js` now also exports `readEnvironmentConfig(cloudflareConfig, environment)` (requires `--environment` and an own-property plain-object `environments.<env>`); `readWorkerConfig` calls it first. `worker-version-config.js` exports `readWorkerVersionConfig(cloudflareConfig, environment)` → `{ environmentConfig, workerConfig, workerVersionConfig }` (`{}` when absent) and adds only the `WORKER_VERSION` checks. Side effect: `create-worker`/`update-worker`/`deploy-version` now report a missing environment as `environments.<env>` instead of `environments.<env>.WORKER` (T6 test expectation updated).
  - `readWorkerVersionConfig` also runs `new CloudflareWorkerVersion(WORKER_VERSION)` and converts its `AssertionError` into a `UsageError` naming the config path, so bad values (e.g. `limits.cpu_ms: 0`) fail as configuration, not at upload. Exports `WORKER_VERSION_KEYS`.
  - All config errors read `Invalid cloudflare-config.jsonc: environments.<env>.<path> ...` (full paths, not the old block-relative paths). `readObjectStoreBuckets({ environmentConfig, environment })` and `buildDurableObjectExports({ environmentConfig, environment })` take the environment for that reason; bucket `configPath` is the full path (T9 `verify-resources` can use it directly). Buckets no longer return `locationHint`/`storageClass` (validated, then ignored).
  - `secrets-manifest.js` exports `SECRETS_MANIFEST_FILE_NAME`, `parseSecretsManifest(text, { filepath })`, and `readSecretsManifest({ projectDirectory, fileSystem })` (missing file is a `UsageError`). Errors read `Invalid <path> on line N: ...`; unlike lib, a malformed line is not echoed (it may hold a pasted value). `BUILD_ID`/`ENVIRONMENT` are rejected with their line.
  - `compareDeclaredSecrets({ manifest, remoteNames })` → `{ missingRequired, undeclared, inheritedNames }`, all sorted and unique. T9 feeds it `readSecretBindingNames(version)` (accepts `version.bindings` or `version.resources.bindings`).
  - `readEnvFile({ projectDirectory, environment, fileSystem })` reads only `.env.<env>` (required), drops `ENVIRONMENT`, and rejects `BUILD_ID` with its line. Returns a null-prototype object.
  - `buildWorkerBindings({ environmentConfig, environment, envars, inheritedSecretNames, secretVersionId })`. `secretVersionId` is required only when `inheritedSecretNames` is non-empty (zero-versions case passes neither). Missing/empty resource IDs throw `UsageError` with the config path (T9 verifies first). The binding-name pattern and the reserved-name check (`RESERVED_NAMES` = `BUILD_ID`, `ENVIRONMENT`, exported here) now apply to every config binding name, not only `SEND_EMAIL`/`IMAGES`. Reserved names in `envars` are rejected.
  - `cloudflare-worker-version.js` and its tests are verbatim ports.
  - Fixture `devkit/test/fixtures/lib-cloudflare-config.jsonc` is a verbatim copy of `lib/cloudflare-config.jsonc`, used by the bindings and DO-exports tests. T9 may reuse it.
- Actual files changed: `devkit/lib/cloudflare/{secrets-manifest,worker-secret-names,worker-bindings,object-store-buckets,durable-object-exports,cloudflare-worker-version,worker-version-config,read-worker-config}.js`, `devkit/lib/env-file.js`; tests `devkit/test/lib/cloudflare/{secrets-manifest,worker-secret-names,worker-bindings,object-store-buckets,durable-object-exports,cloudflare-worker-version,worker-version-config}.test.js`, `devkit/test/lib/env-file.test.js`, `devkit/test/conformance/secrets-manifest.test.js`, `devkit/test/commands/cloudflare/create-worker.test.js` (message expectation); fixture `devkit/test/fixtures/lib-cloudflare-config.jsonc`.
- Validation run (2026-10-14):
  - `node devkit/run-tests.js devkit/test/lib/cloudflare devkit/test/lib/env-file.test.js devkit/test/conformance`: 212 tests pass.
  - `node devkit/run-tests.js`: 463 pass. `deno run -A devkit/run-tests.js`: 463 pass.
  - `node devkit/run-linter.js devkit`: exit 0.
- Blockers: None.

---

### Task T9: `cloudflare create-worker-version` pipeline and command

**Status:** Not started
**Depends on:** T6, T7, T8
**Documentation:** `tmp/kixx-devkit/lib/cloudflare/create-worker-version.js`, `tmp/kixx-devkit/commands/cloudflare/create-worker-version.js`, `tmp/kixx-devkit/docs/cloudflare.md` (§Processing pipeline, §Durable Object deployment policy); Decisions 4 to 8, 12, 15, 17

**Objective**

`kixx cloudflare create-worker-version -e <env> [--force] [--deploy]` produces one of three outcomes. It skips when inputs are unchanged. It uploads an undeployed version and pins state. Or, with `--deploy` where a Durable Object class is unprovisioned, it uploads and deploys in one request. Every precondition failure is reported before anything is written remotely: secrets, resources, freshness, and flag misuse. This task owns the orchestration and the remote invariants.

**Scope**

- In: `devkit/lib/cloudflare/{create-worker-version,verify-resources,worker-record,resolve-secret-source}.js`, `devkit/commands/cloudflare/create-worker-version.js` (with output rendering), and tests.
- Out: Resource creation and secrets commands (later phases). Docs (T10).

**Design and invariants**

Phases, in order. Nothing is written locally or remotely before phase 6.

1. **Local config.** Validate the environment config (T8). Read state. Parse `example.env.secrets` and `.env.<env>`.
2. **Worker.** `getWorker(WORKER.name)`. A 404 is a usage error telling the operator to run `kixx cloudflare create-worker -e <env>`. `readWorkerRecord` provides `provisionedClasses` (port).
3. **Secret source** (`resolve-secret-source.js`).
   - **State present:** it must have `workerName` and `versionId`, and `workerName` must equal `WORKER.name` (no retargeting; the old dead `retargetedFrom` path is dropped). Then `getWorkerVersion(state.versionId)`; a 404 is a usage error. Then the latest version (`listWorkerVersions` with page 1, per_page 1) must equal it. Otherwise it fails as stale, naming the recorded and latest ids, and (Decision 15) saying to either restore state from the checkout that made the latest version or delete the state file to adopt the latest version.
   - **No state:** list the latest version.
     - None exists and a required secret is declared: fail. The message says to set the declared secrets in the Cloudflare dashboard or with Wrangler first, and lists them.
     - None exists and no required secret is declared: proceed with no secret source.
     - Otherwise: adopt the latest version as the source, subject to the comparison below, and report "Adopted latest version <id> as the secret source".
   - Compare with `compareDeclaredSecrets`. Collect `missingRequired` and `undeclared` as problems.
4. **Resources** (`verify-resources.js`). Check every D1 (`DOCUMENT_STORE.databaseId`), KV (`KEY_VALUE_STORE.namespaceId`, `CONTENT_STORE.kvNamespaceId`), and R2 bucket (`OBJECT_STORE.buckets.*`, by name + jurisdiction). A missing ID, an empty ID, or a 404 is a problem. Non-404 errors propagate. **Never call any create endpoint.** Each problem names the config path, the resource name, and the cause (`no ID configured` / `not found in Cloudflare`).
5. **Durable Object policy.** Build the bindings and exports (T8), then `unprovisioned` = bound DO classes that are live in exports and not in `provisionedClasses` (port `findUnprovisionedBoundClasses`).
   - `unprovisioned` non-empty without `--deploy`: a problem naming each class and binding, and saying `--deploy` is required (Cloudflare only provisions a namespace when the declaring version is deployed).
   - `--deploy` with `unprovisioned` empty: a problem saying `--deploy` is only allowed when a version introduces an unprovisioned Durable Object class.
   - **Problems from phases 3 (comparison), 4, and 5 are reported together in one `UsageError`, grouped by category, before any write.** Earlier failures (bad config, missing Worker, stale or missing source version) stop immediately, because later checks depend on them.
6. **Package.** Call `writeGeneratedConfig` (T7), then bundle, then compute `modulesHash`, `bindingsHash = hashValue({ bindings, exports })`, and `configHash = hashValue(WORKER_VERSION ?? {})`.
7. **Decide.** Upload when there is no state, any hash changed, `--force` is set, or `unprovisioned` is non-empty. Otherwise output "Nothing changed since version X (build Y). No version created. Pass --force to upload anyway." and exit 0.
8. **Upload.**
   - Generate `BUILD_ID`.
   - Add the `BUILD_ID` `plain_text` binding.
   - Add annotations `workers/tag` = the build id and `workers/triggered_by` = `kixx cloudflare create-worker-version`.
   - Call `createWorkerVersion(name, payload, { deploy: Boolean(--deploy), strictBindingsInheritance: true })`. Secret values are never sent.
9. **State.** Write the complete record: `workerName`, `buildId`, `versionId`, `createdAt`, `deployed` (true only with `--deploy`), and the three hashes. `bindingsHash` is recomputed with inherit bindings re-pointed at the new version id (port). If the write fails, throw an error containing the full non-secret state JSON, its path, and whether traffic changed (port).
10. **Output.**
    - Environment, Worker, module count, the hash change lines, `BUILD_ID`, version id, and the deployment status.
    - With `--deploy`: "Deployed to 100% of traffic (--deploy); Durable Object namespaces provisioned for: …", plus the reconciliation report (port renderer). Also a warning that content must be assigned to the new `BUILD_ID` (`kixx app publish -e <env> --build-id <id>`) because the version is already serving.
    - Undeployed: next steps `kixx app publish -e <env> --build-id <id>` and then `kixx cloudflare deploy-version -e <env>`.
    - The state file path written.

**Expected touch points**

- `devkit/lib/cloudflare/{create-worker-version,verify-resources,worker-record,resolve-secret-source}.js`
- `devkit/commands/cloudflare/{index,create-worker-version}.js`
- `devkit/test/lib/cloudflare/{create-worker-version,verify-resources,worker-record,resolve-secret-source}.test.js`, `devkit/test/commands/cloudflare/create-worker-version.test.js`, `devkit/test/fixtures/worker-project/` (minimal project: `cloudflare-config.jsonc`, `cloudflare-server.js` importing `./cloudflare-config.generated.js`, `.env.production`, `example.env.secrets`)

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Tests use a fake API client recording calls, and assert **no** call to any create-resource or secret endpoint in every scenario.
- [ ] Secret source: state fresh; state stale (Decision 15 message); state version 404; state names a different Worker; no state + zero versions + required secrets (fail); no state + zero versions + no required (proceed, no inherit bindings); no state + latest matching (adopted, pinned after upload); no state + latest mismatching (fail).
- [ ] Secrets: missing required fails; undeclared remote fails; optional absent passes.
- [ ] Resources: missing ID, empty ID, 404 D1/KV, 404 R2 with jurisdiction; all are reported together. Non-404 errors propagate.
- [ ] Combined report: a secret mismatch, a missing resource, and a missing `--deploy` are all listed in one error, and no upload is attempted.
- [ ] `--deploy`: required when a class is unprovisioned (fails without); refused when none is; when used, it uploads with `deploy=true` and state records `deployed: true`.
- [ ] Skip when unchanged. `--force` uploads. An unprovisioned class forces an upload even when the hashes match (with `--deploy`).
- [ ] A run that skips or uploads writes `cloudflare-config.generated.js` in the project directory (use a temp copy of the fixture project). A run that fails preflight does not write it.
- [ ] A state write failure prints recoverable state JSON.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/cloudflare devkit/test/commands/cloudflare` — pipeline behavior.
- `node devkit/run-tests.js` — no regressions.
- `node devkit/run-linter.js devkit` — lint clean.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T10: Documentation and cross-runtime validation

**Status:** Not started
**Depends on:** T3, T4, T5, T6, T9
**Documentation:** `tmp/kixx-devkit/README.md`, `tmp/kixx-devkit/docs/{configuration,cloudflare,app,admin}.md`; this plan's Decisions and audit table

**Objective**

Operators can install, configure, and use all 11 commands from `devkit/README.md` and `devkit/docs/`. The docs describe the new behavior, not the old devkit's. The full suite passes on both Node.js and Deno.

**Scope**

- In: `devkit/README.md`, `devkit/docs/{configuration,admin,app,cloudflare}.md`, final consistency fixes to `devkit/commands/README.md` and `devkit/test/README.md`, and help-text consistency fixes in command `description`/`options`.
- Out: `PUBLISHING.md`, release workflow, and edits to repo `docs/`, `lib/`, `README.md`, or `CLAUDE.md`.

**Design and invariants**

- **README:** a one-paragraph purpose; installs (`npm install -g kixx-devkit`, `deno install -g -RWNE --allow-sys=homedir jsr:@kixx/devkit/kixx`); and Deno permission rationale:
  - `-R`/`-W`: project files, `.kixx`, state, and the generated config.
  - `-N`: Cloudflare and app origins.
  - `-E`: `KIXX_ADMIN_*` prompt variables.
  - `--allow-sys=homedir`: `~/.kixx`.
  - No `--allow-run` or FFI. The CLI no longer executes project configuration.

  Also: the command list (exactly 11), links to the docs (absolute `https://github.com/kixx-framework/kixx/blob/main/devkit/...` links, so they resolve on npm and JSR), and a Development section with this plan's runner commands. The server requirement is Publishing protocol 2 / addressing format 4.
- **configuration.md:** the `.kixx` two-layer merge and keys, including the `cloudflare` secrets block that `lib/.kixx/example.secrets.json` does not yet show; `--environment`; `cloudflare-config.jsonc` (JSONC dialect, `environments.<env>`); the generated file (what, when, gitignore it); `.env.<env>` (required, plain text); and `example.env.secrets` (required/optional semantics per Decision 5).
- **cloudflare.md:**
  - `create-worker` and `update-worker` (full replacement).
  - `create-worker-version`, with the phase list from T9:
    - No resource creation; how to create resources in the dashboard or with Wrangler and record their IDs.
    - Secrets: exact parity, the exact-version and freshness rules, latest adoption, zero-versions behavior, and setting secrets in the dashboard or with Wrangler.
    - Stale-state recovery (Decision 15).
    - `--deploy` rules.
    - Hashes, `--force`, `BUILD_ID`, and the state record.
  - `deploy-version` (no guard, no `--force`, state update rule).
  - A **Workflows** section:
    - New environment: create-worker → set secrets → `create-worker-version --deploy` → `admin accept-invite` → `admin create-publishing-token` → store the token → `app publish --build-id <BUILD_ID>`. Note that content returns 503 until published.
    - Routine release: create-worker-version → `app publish --build-id` → deploy-version.
    - Content-only: `app publish`.
- **app.md / admin.md:** adapted from the old docs. `run-migration` without `--yes` and without confirmation. Password 12 to 256. The new accept-invite conflict messages. `PublishingApiTokenInactive`. Remove `create-release`/`rollback` except in a short "not in this release" note if needed.
- **Every command's `--help` text matches the docs.**

**Expected touch points**

- `devkit/README.md`, `devkit/docs/*.md`, `devkit/commands/README.md`, `devkit/test/README.md`, and minor `devkit/commands/**` description edits

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] No doc mentions `cloudflare-config.js` (executable), `bootstrap`, `release`, `set-secret(s)`, `delete-secret`, `recover-secret-version`, `--yes`, or a `deploy-version --force`, except the README's explicit out-of-scope note.
- [ ] Every one of the 11 commands is documented with its options, and matches `--help`.
- [ ] The full suite passes on Node.js and Deno. The CLI starts under the documented Deno permissions.

**Validation**

- `node devkit/run-tests.js` — the full suite on Node.js.
- `deno run -A devkit/run-tests.js` — the full suite on Deno.
- `node devkit/run-linter.js devkit` — lint clean.
- `deno run -RWNE --allow-sys=homedir devkit/kixx.js cloudflare create-worker-version --help` — help under the installed permission set.
- Manual: read each `--help` against the docs.

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

These steps are for the operator only. Agents never run them.

- [x] **R1 — Dev dependencies (gates T1 validation).** Approve `kixx-test@3.0.0` and `kixx-linting@1.1.2` (or say which versions to use), then, once `devkit/package.json` exists, run `cd devkit && npm install`.
- [x] **R2 — Answer open questions.** Done: recorded as Decisions 5 and 15 to 18.
- [ ] **R3 — Live smoke test on a disposable Cloudflare Worker and account** (after T9):
  1. `create-worker`.
  2. Set the declared secrets on the version-less Worker in the dashboard or with Wrangler. Confirm this is possible (Decision 19). If it is not, raise it as a new operator decision; it does not block T1 to T10.
  3. `create-worker-version -e <env>` without `--deploy`, expecting a failure naming the DO classes.
  4. `create-worker-version --deploy`, then `admin accept-invite`, then `admin create-publishing-token`, then `app publish --build-id <BUILD_ID>`.
  5. `create-worker-version` again, expecting a skip.
  6. Change code, run `create-worker-version`, then `app publish --build-id`, then `deploy-version`.
  7. Remove a resource ID, expecting a missing-resource report.
  8. Add an undeclared secret in the dashboard, expecting a stale-state failure. Delete the state file, expecting an adoption failure because of the undeclared name.
- [ ] **R4 — Packaging dry runs:** in `devkit/`, run `npm pack --dry-run` (only the runtime files, docs, README, LICENSE, `deno.json`, `package.json`) and `deno publish --dry-run`.
- [ ] **R5 — Before the first real publish (out of scope here):** bump the version above the latest on npm and JSR, repoint the npm trusted publisher and the JSR repository link from `kixx-framework/kixx-devkit` to the monorepo, and add a release workflow.
