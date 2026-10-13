# Config Templates

Add Kixx templates that render `lib/node-config.jsonc` and `lib/cloudflare-config.jsonc` from a context object, so future devkit build tooling (outside this repo) can generate those files for new apps. The templates hard-code framework-owned structure, binding names, class names, resource `type` values, and explanatory comments; the context supplies every app or environment choice. Each template ships with an example context that reproduces today's config file, and a unit test renders each template with the Kixx templating API and a `json` helper, parses the output with `parseJsonc`, and proves it equals the current `.jsonc` file. `lib/docs/configuration.md` documents the rendering contract and the context shape.

## Implementation Approach

### Decisions made with the operator

1. **Hybrid granularity.** The template hard-codes framework-owned values: section structure, binding names, Durable Object class names, `type` fields (`d1`, `kv_namespace`, `r2_bucket`), and explanatory comments. The context supplies app and environment choices: app `name`, environment names, Worker name, resource names and IDs, paths, log level, Hyperview cache settings, rate limits, job queue tuning, upload limits, compatibility date and flags, email `from`, and so on. Reason: the template encodes framework knowledge; the data encodes app choices. Do not move framework-owned values into the context, or app choices into the template, as a style preference.
2. **Values are written with a custom `json` helper.** `{{ json value }}` renders `JSON.stringify(value)`. Build tooling must register it. Reason: `{{ }}` HTML-escapes `& < > "`, which corrupts JSON, and raw `{{{ }}}` cannot quote strings or render arrays (for example `compatibility_flags`).
3. **Location.** Templates are `lib/node-config.jsonc.template` and `lib/cloudflare-config.jsonc.template`. Example contexts sit beside them as `lib/node-config.template-context.example.json` and `lib/cloudflare-config.template-context.example.json`. Reason: keep templates next to the files they generate.
4. **Validation by reproduction.** Each example context reproduces today's config exactly. A unit test compiles each template with the Kixx templating API plus a `json` helper, renders the example context, parses with `parseJsonc`, and compares against the parsed current `.jsonc` file. Reason: proves the templates and the context shape before the tooling exists.
5. **Scope exclusions.** Out of scope: the devkit build tooling, any change to the existing `.jsonc` files, the external Cloudflare deployment CLI, and registering `json` in any production code path. The test registers the helper locally.
6. **Value-specific duration comments are dropped.** Generated output omits trailing comments such as `// 1 hour`. Reason: reproducing them needs a value-aware duration helper, which would widen the helper contract beyond `json`. Comments do not affect the parsed-equality test. (Confirmed by the user.)
7. **One-environment comments become generic comments.** Comments that apply to only one named environment (the `local` comments about instance-relative paths and PBKDF2 seeding, the SEND_EMAIL "Placeholder only" note) are replaced by generic framework comments rendered in every environment (see T1 and T2). Reason: a generic template cannot know which environment a comment belongs to. (Confirmed by the user.)
8. **Cloudflare resource IDs are optional.** `DOCUMENT_STORE.databaseId`, `KEY_VALUE_STORE.namespaceId`, and `CONTENT_STORE.kvNamespaceId` may be absent; the template then renders a hint comment. Reason: a freshly generated app has no IDs yet; the deployment CLI resolves or creates the resource by name and stops so the ID can be added (see `lib/docs/configuration.md` "Worker and resource configuration"). (Confirmed by the user.)
9. **Every section is required in every environment.** Each environment must supply every section the template renders; optional sections (for example an app without SEND_EMAIL) are deferred to devkit work. Reason: keeps the template and context contract simple for the first version. (Confirmed by the user.)
10. **The test compares against the live `.jsonc` files.** Any future edit to `lib/node-config.jsonc` or `lib/cloudflare-config.jsonc` must also update the matching template and example context, or `config-templates.test.js` fails. Reason: keeps the templates current with the framework's real configuration. (Confirmed by the user.)

### Plan-level design decisions (recommended defaults, not operator decisions)

These were chosen by the planner from conventions. The orchestrator may confirm or override them; until then, implement them as written.

- **No shared production `json` helper module.** The helper is about six lines with no in-repo production caller. The test defines it locally; `lib/docs/configuration.md` documents the contract the devkit must implement. Add a shared module only if the devkit needs to import it.
- **R2 bucket binding names come from context.** `OBJECT_STORE.buckets.<bucketKey>.bindingName` (for example `OBJECT_STORE_FILES`) is supplied by the context because buckets are app choices. All other binding and class names are framework-owned literals in the template, per decision 1.
- **Example context file naming.** `<config-name>.template-context.example.json`, placed beside the template so the `node-config.*` and `cloudflare-config.*` files sort together.

### Cross-cutting constraints

- **Path parity.** Every context value sits at the same path it renders to in the output, using the same UPPER_CASE section names and key names (for example context `environments.production.LOGGER.level` renders to output `environments.production.LOGGER.level`). The context omits only framework-owned keys. No renaming layer.
- **Required by default.** Every key the template renders unconditionally is required in the context, even where the runtime has a fallback (HYPERVIEW, RATE_LIMIT, JOB_QUEUE tuning). The `json` helper throws on `undefined`, so a missing required value fails the render with the template line number.
- **Explicit optional keys.** Only the keys listed in the context-shape tables below are optional. An optional key is omitted from the output when its context value is absent, `null`, `false`, or an empty array; some optional keys render a commented hint in its place.
- **Context shape is owned by `lib/docs/configuration.md`.** The "Config templates" section (Task T3) is the single source of truth for the context shape and the `json` helper contract. Template header comments give a short summary and point to that section; do not duplicate full key lists in more than one place.
- **Template-author notes vs. output comments.** Use `{{!-- --}}` for notes to template maintainers (stripped from output). Use JSONC `//` comments for anything that should appear in the generated file.
- **Never place a literal `{` or `}` directly against a mustache tag.** `{` followed by `{{` parses as a triple-mustache `{{{`, and `}}` followed by `}` likewise. Keep at least one space or a newline between JSON braces and tags. Pretty-printed JSON with one brace per line avoids this naturally.
- **Every rendered value goes through `json`.** Including keys that come from context (environment names, bucket names): `{{ json envName }}: {`. Never use `{{ }}` or `{{{ }}}` for values.
- **Trailing commas everywhere.** `parseJsonc` accepts trailing commas, so emit a comma after every member and element. Do not add last-item detection.
- **Output key order matches today's files.** The test compares `JSON.stringify` output, which is key-order sensitive. Template key order must match the current `.jsonc` files, and the example contexts must list environments and buckets in the current order (iteration follows `Object.keys`).
- **Whitespace.** Standalone `{{#each}}`, `{{#if}}`, `{{^x}}`, `{{/x}}`, and comment lines are stripped from output. `{{else}}` is not stripped and leaves a blank line. For an optional key with a commented hint, use an `{{#if x}}...{{/if}}` block followed by an inverted `{{^x}}...{{/x}}` block (both standalone) rather than `{{else}}`. Verified in a prototype: `{{^env.WORKER.tags}}` works with dotted paths.
- **Block parameter names.** `#each environments as |env envName|` exposes `env` and `envName`; nested loops must use distinct names (for example `|bucket bucketName|`) so parent lookups are not shadowed. Root `name` remains reachable inside loops by walking the context stack. There is no `this`, `@key`, or `../`.
- **`json` helper contract.** Signature `(context, options, value)`; returns `JSON.stringify(value)` (compact, single line). Throws an `Error` when `value` is `undefined` or when `JSON.stringify` does not return a string (functions, symbols). The template engine wraps a helper error in a `LineSyntaxError` naming the helper, file, and line; nested inside `#each`, the outer error is for `each` and the `json` error is on its `cause` chain.
- **Rendering API.** `tokenize(null, filename, source)`, `buildSyntaxTree(null, tokens)`, `createRenderFunction(null, helpers, tree)`, then `render(context, new Map())`. The partials Map argument is required. Build the helpers Map as `new Map(templating.helpers)` plus `json`; never mutate the shared `templating.helpers` Map. Reference: `lib/kixx/hyperview/hyperview-service.js` (`#templateHelpers`, `#compileTemplate`).
- **Tests.** One test file, `lib/test/unit-tests/config-templates.test.js`, with one top-level `describe('config templates', ...)`. Use `kixx-test` and `kixx-assert`; kixx-assert has no deep equality, so compare `JSON.stringify` values (an existing repo convention). File-local helpers (`json`, `renderTemplate`, `readJson`, `catchError`). Read files relative to `lib/` the way `lib/test/unit-tests/node-config.test.js` does.
- **Commands run from `lib/`.** Tests and linter only work with cwd `lib/`. No end-to-end tests.
- Follow `lib/docs/code-style-guide.md`, `lib/docs/code-documentation-guide.md`, and `lib/test/unit-tests/README.md`. Commit messages follow `CLAUDE.md`; record work in `agents/journal/YYYY-MM-DD.md` with America/New_York ISO timestamps and commit the journal with the change.

### Context shape reference

Each table lists context paths below `environments.<envName>`, except the root `name` and `environments` keys. Framework-owned keys are rendered as literals by the template and must not appear in the context.

**Node.js (`node-config.jsonc.template`)**

| Context path | Required | Notes |
| --- | --- | --- |
| `name` | yes | Root. App name. |
| `environments` | yes | Root. Object keyed by environment name, in output order. |
| `LOGGER.level` | yes | |
| `HYPERVIEW.useTemplateCache`, `usePageCache`, `allowJsonResponse`, `pageCacheReadTtlSeconds`, `pageCacheExpirationSeconds` | yes | |
| `SECRET_ENCRYPTION.PBKDF2_ITERATIONS` | yes | |
| `RATE_LIMIT.<KEY>.maxFailures`, `windowSeconds`, `cooldownSeconds` | yes | `<KEY>` is each of `ADMIN_LOGIN`, `ADMIN_SIGNUP`, `ADMIN_INVITE`; the three key names are framework-owned and hard-coded. |
| `DOCUMENT_STORE.path`, `KEY_VALUE_STORE.path` | yes | |
| `JOB_QUEUE.enabled`, `path`, `pollIntervalSeconds`, `concurrency`, `drainTimeoutSeconds`, `retention.completedMaxAgeDays`, `retention.failedMaxAgeDays` | yes | |
| `OBJECT_STORE.path` | yes | |
| `OBJECT_STORE.buckets` | yes | Object keyed by bucket name; each value is rendered whole with `json` (`{}` or options such as `{ "directory": ... }`). |
| `FILES.maxUploadBytes`, `FILES.bucket` | yes | |
| `CONTENT_STORE.developerMode` | optional | When truthy, the template renders the literal `"developerMode": true` and the directory keys below; otherwise it renders `rootDirectory`. Only valid in an environment named `development` (enforced at runtime by `lib/plugins/node-content-store/plugin.js`, not by the template). |
| `CONTENT_STORE.pagesDirectory`, `templatesDirectory`, `staticAssetsDirectory`, `emailsDirectory` | optional | Developer mode only. Each rendered only when present. |
| `CONTENT_STORE.rootDirectory` | yes, unless developer mode | |

**Cloudflare (`cloudflare-config.jsonc.template`)**

| Context path | Required | Notes |
| --- | --- | --- |
| `name` | yes | Root. App name. |
| `environments` | yes | Root. Object keyed by environment name, in output order. |
| `WORKER.name`, `WORKER.logpush` | yes | |
| `WORKER.tags`, `WORKER.tail_consumers` | optional | Arrays. When absent or empty, renders the commented hint (`// "tags": [],`, `// "tail_consumers": [],`). |
| `WORKER.observability.enabled`, `head_sampling_rate`, `redact_query_string`, `logs.enabled`, `logs.invocation_logs`, `logs.persist`, `logs.head_sampling_rate`, `traces.enabled`, `traces.persist`, `traces.head_sampling_rate` | yes | Spelled out key by key for readable output. |
| `WORKER.subdomain.enabled`, `WORKER.subdomain.previews_enabled` | yes | |
| `WORKER_VERSION.compatibility_date`, `compatibility_flags` | yes | Flags is an array, rendered whole. |
| `WORKER_VERSION.cache_options.enabled`, `cache_options.cross_version_cache` | yes | |
| `WORKER_VERSION.limits` | optional | Rendered whole. When absent, renders today's commented `limits` hint and the CPU-budget comment. |
| `WORKER_VERSION.placement` | optional | Rendered whole. No hint. |
| `DURABLE_OBJECT_MIGRATIONS` | optional | Rendered whole (shape owned by the deployment CLI). No hint. |
| `LOGGER.level` | yes | |
| `SEND_EMAIL.from` | yes | `bindingName` (`"EMAIL"`) is framework-owned. |
| `HYPERVIEW.*`, `SECRET_ENCRYPTION.*`, `RATE_LIMIT.*` | yes | Same as Node.js. |
| `DOCUMENT_STORE.databaseName` | yes | `type` `"d1"` and `bindingName` `"DOCUMENT_STORE"` are framework-owned. |
| `DOCUMENT_STORE.databaseId` | optional | When absent, renders a hint comment that the deployment CLI supplies the ID. |
| `KEY_VALUE_STORE.namespaceName` | yes | `type` `"kv_namespace"` and `bindingName` `"KEY_VALUE_STORE"` are framework-owned. |
| `KEY_VALUE_STORE.namespaceId` | optional | As `databaseId`. |
| `OBJECT_STORE.buckets.<bucketKey>.bucketName`, `.bindingName` | yes | `type` `"r2_bucket"` is framework-owned. Buckets are app choices, so their binding names come from context. Each key spelled out. |
| `FILES.maxUploadBytes`, `FILES.bucket` | yes | |
| `JOB_QUEUE.enabled`, `concurrency`, `softDeadlineSeconds`, `retention.completedMaxAgeDays`, `retention.failedMaxAgeDays` | yes | `durableObjectBindingName` `"JOB_QUEUE_DURABLE_OBJECT"` and `durableObjectClassName` `"JobQueueStore"` are framework-owned. |
| `CONTENT_STORE.blobReadCacheTtlSeconds`, `indexCacheTtlSeconds`, `kvNamespaceName` | yes | `kvBindingName` `"CA_STORE_KV_STORE"`, `durableObjectBindingName` `"CA_STORE_DURABLE_OBJECT"`, `durableObjectClassName` `"ContentAddressableIndexStore"` are framework-owned. |
| `CONTENT_STORE.kvNamespaceId` | optional | As `databaseId`. |

## Tasks

### Task T1: Node.js config template reproduces node-config.jsonc

**Status:** Complete
**Depends on:** None
**Documentation:** `lib/kixx/templating/docs/README.md`; `lib/docs/configuration.md` "Configuration modules" and "`DATA_DIRECTORY` and config-relative paths"; this plan's "Context shape reference" (Node.js table)

**Objective**

`lib/node-config.jsonc.template` and `lib/node-config.template-context.example.json` exist, and a unit test proves that rendering the template with the example context produces JSONC that parses to exactly the current `lib/node-config.jsonc`. This task also creates the shared test file and its file-local rendering helpers, which T2 extends.

**Scope**

- In: the Node.js template, its example context, `lib/test/unit-tests/config-templates.test.js` (helpers plus the Node.js tests), a short `{{!-- --}}` header in the template.
- Out: the Cloudflare template and tests (T2); `lib/docs/configuration.md` (T3); any change to `lib/node-config.jsonc`.

**Design and invariants**

- Follow the Node.js table in "Context shape reference" exactly: path parity, required-by-default, and the listed optional keys only.
- Structure: `"name": {{ json name }},`, then `"environments": {`, then `{{#each environments as |env envName|}}` emitting `{{ json envName }}: {` and every section in the current file's order (LOGGER, HYPERVIEW, SECRET_ENCRYPTION, RATE_LIMIT, DOCUMENT_STORE, KEY_VALUE_STORE, JOB_QUEUE, OBJECT_STORE, FILES, CONTENT_STORE).
- RATE_LIMIT renders the three framework-owned keys literally (`"ADMIN_LOGIN": {` and so on) with values from `env.RATE_LIMIT.ADMIN_LOGIN.maxFailures` etc. Do not iterate RATE_LIMIT.
- OBJECT_STORE buckets: `{{#each env.OBJECT_STORE.buckets as |bucket bucketName|}}` emitting `{{ json bucketName }}: {{ json bucket }},`.
- CONTENT_STORE: `{{#if env.CONTENT_STORE.developerMode}}` renders the literal `"developerMode": true,` plus each directory key inside its own `{{#if}}`; a following `{{^env.CONTENT_STORE.developerMode}}` block renders `"rootDirectory": {{ json env.CONTENT_STORE.rootDirectory }},`.
- Output comments (JSONC `//`, rendered in every environment):
  - Keep the existing JOB_QUEUE comment ("Background jobs run in-process. drainTimeoutSeconds must stay below SHUTDOWN_TIMEOUT_MS in node-server.js.").
  - Add one comment above DOCUMENT_STORE: relative store paths resolve against `DATA_DIRECTORY` when it is set, otherwise against `lib/`. This replaces the `local`-only instance-relative comment.
  - Add one comment above CONTENT_STORE: developer mode reads source directories directly and is allowed only in the `development` environment; other environments use `rootDirectory`.
  - Drop the `local`-only SECRET_ENCRYPTION comment and the trailing duration comments (`// 5 minutes` etc.); see operator decisions 6 and 7.
- Template header (`{{!-- --}}`, stripped from output): what the file renders, that callers must register the `json` helper, and a pointer to the "Config templates" section of `lib/docs/configuration.md` and the example context. Keep it short; T3 writes the full contract.
- Example context: a JSON file (no comments) with `name: "kixx-app"` and environments `development`, `local`, `production` in that order, holding exactly today's values. Framework-owned keys must not appear.
- Test helpers (file-local in `config-templates.test.js`):
  - `json(_context, _options, value)` per the contract in "Cross-cutting constraints".
  - `renderTemplate(filename, context)`: reads `lib/<filename>`, compiles with a `new Map(helpers)` copy plus `json`, renders with `new Map()` partials, returns the string.
  - `readJson(filename)` and reading the `.jsonc` with `parseJsonc` (`lib/kixx/config/parse-jsonc.js`).
  - A comparison that asserts equal root `name`, equal `JSON.stringify(Object.keys(environments))`, and, per environment, `assertEqual(JSON.stringify(expected.environments[envName]), JSON.stringify(actual.environments[envName]), envName)` so a failure names the environment.
  - Use `structuredClone` of the example context when a test mutates it.

**Expected touch points**

- `lib/node-config.jsonc.template` — new template.
- `lib/node-config.template-context.example.json` — new example context.
- `lib/test/unit-tests/config-templates.test.js` — new test file with helpers and a nested `describe('node-config.jsonc.template', ...)`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Rendering the Node.js template with the example context yields text that `parseJsonc` accepts and that equals the parsed `lib/node-config.jsonc` (root `name`, environment order, and every environment by `JSON.stringify`).
- [x] The rendered text contains no HTML entities (`&amp;`, `&quot;`, `&lt;`, `&gt;`).
- [x] A test proves values containing `& < > "` round-trip: set such a string on a cloned context (for example `FILES.bucket` or an `OBJECT_STORE.path`), render, parse, and assert the parsed value equals the input.
- [x] A test proves a missing required value fails: delete `LOGGER.level` from one environment of a cloned context; rendering throws, and the error or one of its `cause`s has a message naming the `json` helper.
- [x] A test proves developer mode without directory keys renders only `"developerMode": true` in CONTENT_STORE (parsed CONTENT_STORE equals `{ developerMode: true }`).
- [x] The example context contains no framework-owned keys and only the keys in the Node.js table.
- [x] `lib/node-config.jsonc` is unchanged.

**Validation**

- `cd lib && node run-tests.js test/unit-tests/config-templates.test.js` — template reproduces the current config; edge-case tests pass.
- `cd lib && node run-linter.js test/unit-tests/config-templates.test.js` — test file lints clean.
- `cd lib && node run-tests.js` — full unit suite still passes (1777 tests before this plan, plus the new ones).

**Progress and handoff**

- Completed: Template, example context, and test file with helpers (`json`, `renderTemplate`, `readText`, `readJson`, `assertSameConfig`, `errorChainMessages`, `catchError`) and five Node.js tests.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: Example context was generated from the parsed `node-config.jsonc` (it has no framework-owned keys to strip; RATE_LIMIT key names are nesting paths). A missing value produces a chain `each` LineSyntaxError -> `json` LineSyntaxError (`Error in helper "json" in "<file>" on line N`) -> helper Error; the test matches `helper "json"` across the chain.
- Actual files changed: `lib/node-config.jsonc.template`, `lib/node-config.template-context.example.json`, `lib/test/unit-tests/config-templates.test.js`.
- Validation run: config-templates tests 5/5 pass; linter clean on the test file; full suite 1782 passing.
- Blockers: None.

### Task T2: Cloudflare config template reproduces cloudflare-config.jsonc

**Status:** Complete
**Depends on:** T1
**Documentation:** `lib/kixx/templating/docs/README.md`; `lib/docs/configuration.md` "Cloudflare specifics" (especially "Worker and resource configuration"); this plan's "Context shape reference" (Cloudflare table)

**Objective**

`lib/cloudflare-config.jsonc.template` and `lib/cloudflare-config.template-context.example.json` exist, and the shared test file proves the rendered template parses to exactly the current `lib/cloudflare-config.jsonc`, including correct handling of every optional key. This is the first test that reads `cloudflare-config.jsonc`.

**Scope**

- In: the Cloudflare template, its example context, a nested `describe('cloudflare-config.jsonc.template', ...)` in `lib/test/unit-tests/config-templates.test.js` reusing T1's helpers, a short `{{!-- --}}` header in the template.
- Out: `lib/docs/configuration.md` (T3); any change to `lib/cloudflare-config.jsonc`; the deployment CLI.

**Design and invariants**

- Follow the Cloudflare table in "Context shape reference" exactly.
- Section order matches today's file: WORKER, WORKER_VERSION, (optional DURABLE_OBJECT_MIGRATIONS directly after WORKER_VERSION), LOGGER, SEND_EMAIL, HYPERVIEW, SECRET_ENCRYPTION, RATE_LIMIT, DOCUMENT_STORE, KEY_VALUE_STORE, OBJECT_STORE, FILES, JOB_QUEUE, CONTENT_STORE. Key order within each section matches today's file, with optional keys in today's positions (`tags` after `name`, `tail_consumers` after `logpush`, `limits` after `cache_options`; place `placement` after `limits`).
- Framework-owned literals (exact strings from today's file): DOCUMENT_STORE `"type": "d1"`, `"bindingName": "DOCUMENT_STORE"`; KEY_VALUE_STORE `"type": "kv_namespace"`, `"bindingName": "KEY_VALUE_STORE"`; OBJECT_STORE `"type": "r2_bucket"`; SEND_EMAIL `"bindingName": "SEND_EMAIL"` (changed from `"EMAIL"` after review to match the adapter default; the user chose this); JOB_QUEUE `"durableObjectBindingName": "JOB_QUEUE_DURABLE_OBJECT"`, `"durableObjectClassName": "JobQueueStore"`; CONTENT_STORE `"kvBindingName": "CA_STORE_KV_STORE"`, `"durableObjectBindingName": "CA_STORE_DURABLE_OBJECT"`, `"durableObjectClassName": "ContentAddressableIndexStore"`. RATE_LIMIT key names as in T1.
- Optional keys use `{{#if x}}...{{/if}}` followed by `{{^x}}...{{/x}}` when a hint is rendered; a bare `{{#if x}}...{{/if}}` when not.
  - `tags`, `tail_consumers`: hint lines exactly as today (`// "tags": [],`, `// "tail_consumers": [],`).
  - `limits`: keep today's CPU-budget comment unconditionally above the limits slot; when absent, render today's commented `limits` block hint.
  - `databaseId`, `namespaceId`, `kvNamespaceId`: when absent, a one-line `//` hint that the deployment CLI resolves or creates the resource by name and prints the ID to add here.
  - `placement`, `DURABLE_OBJECT_MIGRATIONS`: no hint.
- OBJECT_STORE buckets: `{{#each env.OBJECT_STORE.buckets as |bucket bucketKey|}}` emitting `{{ json bucketKey }}: {` with `bucketName` and `bindingName` spelled out.
- Output comments (rendered in every environment): keep today's JOB_QUEUE comment (Durable Object alarm, `softDeadlineSeconds`) and CPU-budget comment. Replace the SEND_EMAIL "Placeholder only" comment with a generic one: `from` must be an address on an onboarded, verified sender domain. Drop trailing duration comments.
- Template header as in T1, adapted.
- Example context: `name: "kixx-test-app"`, one environment `production`, today's values including all three resource IDs; no `tags`, `tail_consumers`, `limits`, `placement`, or `DURABLE_OBJECT_MIGRATIONS` keys (today's file only has them commented out).

**Expected touch points**

- `lib/cloudflare-config.jsonc.template` — new template.
- `lib/cloudflare-config.template-context.example.json` — new example context.
- `lib/test/unit-tests/config-templates.test.js` — add the Cloudflare nested describe.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Rendering the Cloudflare template with the example context yields text that `parseJsonc` accepts and that equals the parsed `lib/cloudflare-config.jsonc`, using T1's comparison helper.
- [x] A test proves optional IDs: with `databaseId`, `namespaceId`, and `kvNamespaceId` deleted from a cloned context, the output parses and those three keys are absent while every other key is unchanged.
- [x] A test proves optional present values: with `tags`, `tail_consumers`, `limits`, `placement`, and `DURABLE_OBJECT_MIGRATIONS` set on a cloned context, the parsed output contains each at its path with an equal value (compare by `JSON.stringify`).
- [x] A test proves non-empty `compatibility_flags` render as an array (for example `["nodejs_compat"]`).
- [x] A test proves `SEND_EMAIL.from` containing `& < > "` round-trips unchanged.
- [x] A test proves a missing required value (for example `WORKER.name`) fails with an error chain naming the `json` helper.
- [x] The example context contains no framework-owned keys.
- [x] `lib/cloudflare-config.jsonc` is unchanged.

**Validation**

- `cd lib && node run-tests.js test/unit-tests/config-templates.test.js` — both templates reproduce their configs; optional-key tests pass.
- `cd lib && node run-linter.js test/unit-tests/config-templates.test.js` — test file lints clean.
- `cd lib && node run-tests.js` — full unit suite passes.

**Progress and handoff**

- Completed: Template, example context, and seven Cloudflare tests in the shared test file.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: Example context was generated from the parsed `cloudflare-config.jsonc` with framework-owned keys removed. A text diff of the rendered output against `cloudflare-config.jsonc` differs only in the intended comment changes (SEND_EMAIL comment, dropped duration comments). ID hint wording: `// "<key>": The deployment CLI resolves or creates the <database|namespace> by name and prints the ID to add here.` `{{^x}}` renders for absent values and empty arrays, as the plan expected.
- Actual files changed: `lib/cloudflare-config.jsonc.template`, `lib/cloudflare-config.template-context.example.json`, `lib/test/unit-tests/config-templates.test.js`.
- Validation run: config-templates tests 12/12 pass; linter clean on the test file; full suite 1789 passing.
- Blockers: None.

### Task T3: Document the config template contract

**Status:** Complete
**Depends on:** T1, T2
**Documentation:** `lib/docs/configuration.md`; `lib/kixx/templating/docs/README.md`

**Objective**

`lib/docs/configuration.md` has a "Config templates" section that a devkit author can implement against without reading the templates: which files exist, how to render them, the `json` helper contract, and the full context shape. The template header comments point to it.

**Scope**

- In: a new `## Config templates` section in `lib/docs/configuration.md`; a step in "Adding a new setting" about keeping templates in sync; aligning the T1/T2 template headers with the section's anchor if needed.
- Out: template logic changes (unless the docs reveal a mismatch, which must be fixed in the template and its test, and recorded in handoff notes); devkit documentation outside this repo.

**Design and invariants**

- Place the section after "Configuration modules" (it builds on `parseJsonc` and the file format) and before "Environment variables".
- Content, kept terse per `CLAUDE.md` ("as few words as possible"):
  - The four files and their purpose; the example contexts reproduce today's configs and are checked by `test/unit-tests/config-templates.test.js`.
  - Rendering: the API sequence from "Cross-cutting constraints" (copy `templating.helpers`, add `json`, empty partials Map).
  - The `json` helper contract: signature, `JSON.stringify` output, throws on `undefined` or non-serializable values; why it is required instead of `{{ }}` or `{{{ }}}`.
  - Context rules: path parity, required by default, optional-key semantics (absent, `null`, `false`, or empty array omits the key; some render a commented hint), framework-owned keys never appear in context, `environments` and bucket iteration follow `Object.keys` order.
  - The Node.js and Cloudflare context tables from this plan (as the single authoritative copy; adapt wording, keep content).
  - Output notes: generated files use compact single-line JSON for array and object values rendered whole, and omit value-specific comments such as `// 1 hour`.
- In "Configuration modules", the sentence about durations being written with a comment stays (it describes hand-edited files); the new section notes that generated output omits these comments.
- Add a step to "Adding a new setting": a new per-environment key also goes into the matching template and example context, or `config-templates.test.js` fails.
- Do not restate content owned by other sections (for example `DATA_DIRECTORY`); link to it.

**Expected touch points**

- `lib/docs/configuration.md` — new section and one "Adding a new setting" step.
- `lib/node-config.jsonc.template`, `lib/cloudflare-config.jsonc.template` — header pointer wording only, if needed.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `lib/docs/configuration.md` has a "Config templates" section covering files, rendering, the `json` contract, context rules, both context tables, and output notes.
- [x] Every key in both context tables matches what the templates actually read (verify by reading the templates; every `json` argument path and every `#if`/`^` path appears in a table, and nothing in a table is unused).
- [x] "Adding a new setting" includes the template and example-context step.
- [x] Both template headers point to the new section.

**Validation**

- `cd lib && node run-tests.js test/unit-tests/config-templates.test.js` — templates still reproduce the configs after any header edits.
- `cd lib && node run-tests.js` — full unit suite passes.
- Manual: cross-check the tables against the templates as described in the acceptance criteria.

**Progress and handoff**

- Completed: `## Config templates` section (files, rendering, `json` helper, context rules, Node.js and Cloudflare context tables, output notes) placed after "Configuration modules" and before "Environment variables"; "Adding a new setting" step 2 now requires updating the matching template, example context, and tables.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: Template headers already pointed to `"Config templates" in docs/configuration.md`; no header edits needed. Cross-check: every `json`, `#if`, `^`, and `#each` path in both templates appears in a table and every table entry is read. Pre-existing doc inconsistency outside scope: "Worker and resource configuration" says the `send_email` binding is named `SEND_EMAIL`, while `cloudflare-config.jsonc` uses `bindingName: "EMAIL"`.
- Actual files changed: `lib/docs/configuration.md`.
- Validation run: config-templates tests 12/12 pass; full suite 1789 passing; manual table cross-check done.
- Blockers: None.
