# Configuration

## The one question that decides where a value goes

> Does the value change **per deploy**, or only **per environment**?

An **environment** (`development`, `local`, `production`, ...) is a class of
deploy that shares behavior. A **deploy** is one specific running instance —
one Node.js process, one Cloudflare Worker version. Two deploys of the same
environment share configuration but not environment variables.

- Per-environment values are **configuration**: `node-config.jsonc` or
  `cloudflare-config.jsonc`, under the `environments` map.
- Per-deploy values are **environment variables**: dotenv files (Node.js) or
  Cloudflare bindings, split again by secrecy (see below).

There is no third place. A value that seems to need both is a sign it should
be split into a config default and a per-deploy override, not a reason to
duplicate it.

## Configuration modules

`node-config.jsonc` and `cloudflare-config.jsonc` are JSONC files:
JSON plus `//` and `/* */` comments and trailing commas. Keeping them as data
rather than JavaScript lets build tooling read and rewrite them without
executing code.

```jsonc
{
    "name": "kixx-app",
    "environments": {
        "development": { /* ... */ },
        "production": { /* ... */ },
    },
}
```

Values must be literals, so durations are written out in seconds with a
comment (`"pageCacheReadTtlSeconds": 3600, // 1 hour`) instead of as
arithmetic.

`kixx/config/parse-jsonc.js` (`parseJsonc`) is the framework's own JSONC
parser. It has no dependencies and runs on every platform. It supports only
the syntax above, not JSON5 extensions like unquoted keys or single-quoted
strings.

Top-level settings like `name` are rare. Everything else lives under
`environments`, keyed by environment name: every store, cache, logger, and
rate-limit setting that environment's deploys share — for example
`LOGGER.level`, `HYPERVIEW.useTemplateCache`, and
`DOCUMENT_STORE`.

The two platform specific configuration files are independent: an environment
name in one has no obligation to exist in, or match the shape of, the same
name in the other.

### Loading a config: `readConfig`

`kixx/config/read-config.js` turns a source config module and a selected
environment name into the frozen runtime config the application actually
uses:

```js
import { readConfig } from './kixx/config/read-config.js';
import { readSourceConfigFile } from './node-environment.js';

const sourceConfig = readSourceConfigFile(path.join(THIS_DIRECTORY, 'node-config.jsonc'));
const config = readConfig(sourceConfig, environment, { resolveFilepath });
```

On Node.js, `readSourceConfigFile` reads the file and parses it with
`parseJsonc`. The Cloudflare Worker has no filesystem, so it imports a
module generated from the JSONC file at build time instead (see
[Worker packaging](#worker-packaging)).

It throws if `config.environments` is not a plain object, or if
`environment` does not match a key in it. The returned object is deep-frozen
and reshapes the source: the selected section becomes `config.env`, the
environment name becomes `config.environment`, and everything else at the
top level of the config file (like `name`) passes through unchanged.
Application code reads settings from `config.env`, never by
re-selecting from `config.environments` itself.

In runtimes with access to the filesystem, the top level `resolveFilepath`,
is attached to the frozen config and is how config-relative store paths
(`DOCUMENT_STORE.path`, `CONTENT_STORE.rootDirectory`, etc.) turn into
real filesystem paths — see `DATA_DIRECTORY` below.

### Which environment is selected

`ENVIRONMENT` selects the config section to load and cannot itself move into
configuration, because it is what decides which section of the config module
is even read.

- The Node.js server (`node-server.js`) resolves it as `--environment`,
  else `NODE_ENV`, defaulting to `development` if neither is set.
- The Cloudflare Worker reads its `ENVIRONMENT` binding, defaulting to
  `development` if it is unset.

## Config templates

Build tooling generates `node-config.jsonc` and `cloudflare-config.jsonc` for
new apps from Kixx templates in `lib/`:

| File | Purpose |
| --- | --- |
| `node-config.jsonc.template` | Renders `node-config.jsonc`. |
| `node-config-test-context.json` | Context that reproduces today's `node-config.jsonc`. |
| `cloudflare-config.jsonc.template` | Renders `cloudflare-config.jsonc`. |
| `cloudflare-config-test-context.json` | Context that reproduces today's `cloudflare-config.jsonc`. |

`test/unit-tests/config-templates.test.js` renders each template with its
example context and asserts the parsed output equals the live `.jsonc` file.

Templates hard-code framework-owned values: section structure, binding names,
Durable Object class names, resource `type` values, and explanatory comments.
The context supplies every app or environment choice.

### Rendering

```javascript
import * as templating from './kixx/templating/mod.js';

const helpers = new Map(templating.helpers);
helpers.set('json', json);

const tokens = templating.tokenize(null, filename, source);
const tree = templating.buildSyntaxTree(null, tokens);
const render = templating.createRenderFunction(null, helpers, tree);
const jsonc = render(context, new Map());
```

Copy `templating.helpers`; never mutate the shared Map. The empty partials Map
is required.

### The `json` helper

The caller must register it. `{{ json value }}` writes every value.

- Signature `(context, options, value)`.
- Returns `JSON.stringify(value)`: compact, one line.
- Throws an `Error` when `value` is `undefined` or `JSON.stringify` does not
  return a string (functions, symbols). The engine wraps it in a
  `LineSyntaxError` naming the helper, file, and line; inside `#each`, that
  error is on the outer error's `cause` chain.

`{{ }}` HTML-escapes `& < > "`, which corrupts JSON. `{{{ }}}` cannot quote
strings or render arrays.

### Context rules

- **Path parity.** A context value sits at the same path it renders to, with
  the same section and key names: `environments.production.LOGGER.level`
  renders to `environments.production.LOGGER.level`.
- **Required by default.** Every key the template renders unconditionally is
  required, even where the runtime has a fallback. A missing value fails the
  render.
- **Optional keys** are only those marked optional below. An absent, `null`,
  `false`, or empty-array value omits the key; some render a commented hint
  instead.
- **Framework-owned keys never appear in the context.**
- **Order.** `environments` and bucket iteration follow `Object.keys` order.
- **Every section is required in every environment.**

### Node.js context

Paths are below `environments.<envName>` unless marked root.

| Context path | Required | Notes |
| --- | --- | --- |
| `name` | yes | Root. App name. |
| `environments` | yes | Root. Keyed by environment name, in output order. |
| `LOGGER.level` | yes | |
| `HYPERVIEW.useTemplateCache`, `usePageCache`, `allowJsonResponse`, `pageCacheReadTtlSeconds`, `pageCacheExpirationSeconds` | yes | |
| `SECRET_ENCRYPTION.PBKDF2_ITERATIONS` | yes | |
| `RATE_LIMIT.<KEY>.maxFailures`, `windowSeconds`, `cooldownSeconds` | yes | `<KEY>` is each of `ADMIN_LOGIN`, `ADMIN_SIGNUP`, `ADMIN_INVITE`; the key names are framework-owned. |
| `DOCUMENT_STORE.path`, `KEY_VALUE_STORE.path` | yes | See [`DATA_DIRECTORY`](#data_directory-and-config-relative-paths). |
| `JOB_QUEUE.enabled`, `path`, `pollIntervalSeconds`, `concurrency`, `drainTimeoutSeconds`, `retention.completedMaxAgeDays`, `retention.failedMaxAgeDays` | yes | |
| `OBJECT_STORE.path` | yes | |
| `OBJECT_STORE.buckets` | yes | Keyed by bucket name; each value rendered whole (`{}` or options such as `{ "directory": ... }`). |
| `FILES.maxUploadBytes`, `FILES.bucket` | yes | |
| `CONTENT_STORE.developerMode` | optional | When truthy, renders `"developerMode": true` and the directory keys below; otherwise renders `rootDirectory`. Only valid in `development` (enforced at runtime, not by the template). |
| `CONTENT_STORE.pagesDirectory`, `templatesDirectory`, `staticAssetsDirectory`, `emailsDirectory` | optional | Developer mode only. Each rendered only when present. |
| `CONTENT_STORE.rootDirectory` | yes, unless developer mode | |

### Cloudflare context

Paths are below `environments.<envName>` unless marked root.

| Context path | Required | Notes |
| --- | --- | --- |
| `name` | yes | Root. App name. |
| `environments` | yes | Root. Keyed by environment name, in output order. |
| `WORKER.name`, `WORKER.logpush` | yes | |
| `WORKER.tags`, `WORKER.tail_consumers` | optional | Arrays. When absent or empty, renders a commented hint. |
| `WORKER.observability.enabled`, `head_sampling_rate`, `redact_query_string`, `logs.enabled`, `logs.invocation_logs`, `logs.persist`, `logs.head_sampling_rate`, `traces.enabled`, `traces.persist`, `traces.head_sampling_rate` | yes | |
| `WORKER.subdomain.enabled`, `WORKER.subdomain.previews_enabled` | yes | |
| `WORKER_VERSION.compatibility_date`, `compatibility_flags` | yes | Flags is an array, rendered whole. |
| `WORKER_VERSION.cache_options.enabled`, `cache_options.cross_version_cache` | yes | |
| `WORKER_VERSION.limits` | optional | Rendered whole. When absent, renders a commented `limits` hint. |
| `WORKER_VERSION.placement` | optional | Rendered whole. |
| `DURABLE_OBJECT_MIGRATIONS` | optional | Rendered whole; shape owned by the deployment CLI. |
| `LOGGER.level` | yes | |
| `SEND_EMAIL.from` | yes | `bindingName` `"SEND_EMAIL"` is framework-owned. |
| `HYPERVIEW.*`, `SECRET_ENCRYPTION.*`, `RATE_LIMIT.*` | yes | Same as Node.js. |
| `DOCUMENT_STORE.databaseName` | yes | `type` `"d1"` and `bindingName` `"DOCUMENT_STORE"` are framework-owned. |
| `DOCUMENT_STORE.databaseId` | optional | When absent, renders a hint that the deployment CLI supplies the ID (see [Worker and resource configuration](#worker-and-resource-configuration)). |
| `KEY_VALUE_STORE.namespaceName` | yes | `type` `"kv_namespace"` and `bindingName` `"KEY_VALUE_STORE"` are framework-owned. |
| `KEY_VALUE_STORE.namespaceId` | optional | As `databaseId`. |
| `OBJECT_STORE.buckets.<bucketKey>.bucketName`, `.bindingName` | yes | `type` `"r2_bucket"` is framework-owned. Buckets are app choices, so binding names come from the context. |
| `FILES.maxUploadBytes`, `FILES.bucket` | yes | |
| `JOB_QUEUE.enabled`, `concurrency`, `softDeadlineSeconds`, `retention.completedMaxAgeDays`, `retention.failedMaxAgeDays` | yes | `durableObjectBindingName` `"JOB_QUEUE_DURABLE_OBJECT"` and `durableObjectClassName` `"JobQueueStore"` are framework-owned. |
| `CONTENT_STORE.blobReadCacheTtlSeconds`, `indexCacheTtlSeconds`, `kvNamespaceName` | yes | `kvBindingName` `"CA_STORE_KV_STORE"`, `durableObjectBindingName` `"CA_STORE_DURABLE_OBJECT"`, `durableObjectClassName` `"ContentAddressableIndexStore"` are framework-owned. |
| `CONTENT_STORE.kvNamespaceId` | optional | As `databaseId`. |

### Output notes

- Arrays and objects rendered whole are compact, single-line JSON.
- Generated files omit value-specific comments such as `// 1 hour`.
- Comments that applied to one environment in hand-edited files are generic
  framework comments rendered in every environment.

## Environment variables

Per-deploy values are environment variables, split by secrecy:

| File | Committed | Holds | Cloudflare deployment use |
| --- | --- | --- | --- |
| `.env.<environment>` | yes | Plain per-deploy keys, such as `TRUST_PROXY`, `PORT`, `DATA_DIRECTORY` | Required build input; every value becomes a plain-text binding |
| `.env.<environment>.secrets` | no | signing secrets and tokens | Not read by builds; optional input to build tooling |

The secrecy split follows the git boundary. There is no per-key annotation to
keep in sync, and no way for a value to be classified two ways at once.

`example.env` documents every plain key inline; `example.env.secrets` is the
[secrets manifest](#the-secrets-manifest). Bootstrap a fresh clone with:

```bash
cp example.env.secrets .env.development.secrets
```

### Node.js - Merging environment variables

`node-environment.js` (`readEnvironment`, backed by
`kixx/config/merge-environment-sources.js`) merges three sources for the
Node.js server, in this order:

1. `.env.<environment>` (or the file named by `--dotenv`)
2. `.env.<environment>.secrets` (the same path with `.secrets` appended)
3. `process.env`

Each file is optional, so dotenv files, `process.env`, or both work. Only
keys the dotenv files declare participate from `process.env`, so unrelated
process environment entries never collide.

**A key defined by more than one source aborts startup**, naming the key and
every source that defined it. There is deliberately no precedence rule: a key
carrying two definitions means one of them is in the wrong place, and
resolving it silently is how a secret ends up bound as plain text.

`--dotenv <path>` names the plain file directly; the secrets file is always
derived by appending `.secrets`, so one flag selects the pair.

### The secrets manifest

`example.env.secrets` is the manifest of secret names a deployment must
provide. `kixx/config/secrets-manifest.js` parses it: each `NAME=value` line
declares a required secret (the value is a placeholder and is discarded), and
a `# @optional` comment line immediately above an entry marks that one name
optional.

When starting a Node.js server, `readEnvironment` checks
the merged environment against this manifest: every required name must resolve
to a non-empty string, or startup fails before any store is opened, naming
every missing secret at once. Optional names are not checked either way.

Keep code and manifest in sync in this order:

- **Adding a secret:** add the name to `example.env.secrets`, then deploy the
  code that reads it.
- **Removing a secret:** deploy the code that stopped reading it, then remove
  the name from `example.env.secrets` (and delete the value from live
  deployments).

On Cloudflare the manifest is also a deployment input; see
[Worker secrets](#worker-secrets) below.

### `DATA_DIRECTORY` and config-relative paths

`DATA_DIRECTORY` is an optional, Node.js-only per-deploy value. When set, it
overrides the directory that config-relative store paths (`DOCUMENT_STORE`,
`KEY_VALUE_STORE`, `OBJECT_STORE`, `CONTENT_STORE`, `JOB_QUEUE`) resolve against, in place
of `lib/`. `createResolveFilepath` in `node-environment.js` builds the
`resolveFilepath` function passed into `readConfig`; it joins a config path's
POSIX-style segments against `DATA_DIRECTORY` when set, or against `lib/`
otherwise.

The `local` environment uses it so a local instance keeps its own stores
instead of sharing the development data. Leave it unset for every other
deployment.

## Job queue settings

`JOB_QUEUE` is a per-environment block in both config modules.
See `app/jobs/README.md` for behavior.

| Key | Platform | Meaning |
| --- | --- | --- |
| `enabled` | both | `false` records jobs but never runs them. |
| `path` | Node | SQLite file: `../data/nodejs_app/job_queue.sqlite` (development, production), `./job_queue.sqlite` (`local`, instance-relative). |
| `pollIntervalSeconds` | Node | Idle wait between passes (1 in shipped config). |
| `concurrency` | both | Maximum jobs running at once (4). |
| `drainTimeoutSeconds` | Node | Longest shutdown waits for in-flight jobs (8). Keep below `SHUTDOWN_TIMEOUT_MS` in `node-server.js`. |
| `softDeadlineSeconds` | Cloudflare | Stop claiming new jobs after this long in one alarm invocation (20). |
| `durableObjectBindingName`, `durableObjectClassName` | Cloudflare | Required by the deployment CLI to bind and export the `JobQueueStore` class. |
| `retention.completedMaxAgeDays`, `retention.failedMaxAgeDays` | both | Age-based purge (7 and 30). |

Values in parentheses are the shipped config, not code defaults: every key
is required and the job queue plugins assert it at startup.

On Cloudflare, a job must complete within one Durable Object alarm invocation.
For CPU-heavy jobs raise `WORKER_VERSION.limits.cpu_ms`.

## Cloudflare specifics

The Cloudflare Worker does not read dotenv files. The separate Kixx deployment
CLI, run from `lib/`, builds Worker versions from these inputs:

```text
cloudflare-config.jsonc
cloudflare-server.js
.env.<environment>
example.env.secrets
.kixx/cloudflare-state.<environment>.json
```

### Plain bindings

Every value in `.env.<environment>` becomes a plain-text binding. The CLI owns
two names:

- `ENVIRONMENT` comes from `--environment`; a value in the plain file is
  ignored.
- `BUILD_ID` is generated for each uploaded Worker version. Declaring it in
  the plain file, or as a secret name, is an error.

The CLI's dotenv parser supports `NAME=value`, blank lines, whole-line
comments, and matching quotes. It does not expand variables, strip inline
comments, or support multiline values.

### Worker secrets

Secret values are remote Worker-version state, not build input. Normal
`create-worker-version` and `release` builds never open
`.env.<environment>.secrets`. Every active assignment in `example.env.secrets`
becomes an `inherit` binding pointing at the exact `versionId` recorded in
`.kixx/cloudflare-state.<environment>.json`; a missing source value fails the
upload. `example.env.secrets` is shared by every Cloudflare environment.

The CLI's documented declaration rule is "active assignment", with no mention
of `# @optional`. Treat an `@optional` name as required on Cloudflare: to
omit it from a Worker, comment its assignment out.

Change remote values with `kixx.js cloudflare set-secret`, `set-secrets`
(defaults to reading `.env.<environment>.secrets`), or `delete-secret`. Each
creates an undeployed version and updates the state file; promote it with
`deploy-version` or build a later version on top of it.

- **Adding a secret:** add the assignment to `example.env.secrets`, commit,
  `set-secret` it, then `release` the code that reads it.
- **Removing a secret:** deploy code that no longer reads it, comment out or
  remove its assignment in `example.env.secrets` and commit, then
  `delete-secret`. The CLI refuses to delete a name still declared.

Before building, the CLI verifies that the state file names the configured
Worker, that its `versionId` is Cloudflare's latest version, and that every
declared name appears in its `secretNames`. Keep the state file committed with
the project; it cannot be reconstructed from Cloudflare. A fresh environment
starts with every `example.env.secrets` assignment commented out so the first
`create-worker-version` can create a secret-free base version.

### Worker and resource configuration

`cloudflare-config.jsonc` also carries CLI-only blocks per environment:

- `WORKER` — the Worker name plus Worker-level settings (observability,
  logpush, subdomain), applied by `create-worker` only.
- `WORKER_VERSION` — exactly `compatibility_date`, `compatibility_flags`,
  `limits`, `placement`, and `cache_options`. Any other key is rejected.
- `DURABLE_OBJECT_MIGRATIONS` — optional rename, delete, and transfer
  declarations for Durable Object classes.

Resource blocks become bindings: `DOCUMENT_STORE` (D1), `KEY_VALUE_STORE` (KV),
`CONTENT_STORE` (KV and a Durable Object namespace), `JOB_QUEUE` (a Durable Object namespace with a SQLite-backed class), and one R2 binding per
`OBJECT_STORE.buckets` entry. The CLI verifies configured D1 and KV IDs. When
an ID is absent, it resolves the resource by name, adopting or creating it,
prints the ID, and stops so the ID can be added to `cloudflare-config.jsonc`. R2
buckets are neither verified nor created and must exist before deployment.

Cloudflare email sending reads `SEND_EMAIL.from` from the selected environment
in `cloudflare-config.jsonc`. The configured value is a placeholder; replace it
with a verified sender address before enabling a workflow that sends email.
The Worker also needs a `send_email` binding named by `SEND_EMAIL.bindingName`
(the adapter defaults to `SEND_EMAIL` when it is unset), plus an onboarded
sender domain and verified sender address.

### Worker packaging

`cloudflare-server.js` is the entry module. The CLI uploads every statically
reachable module as a separate ES module with comments removed; there is no
transpiling, tree shaking, or minification. The build rejects bare package
imports, modules outside `lib/`, extensions other than `.js` and `.mjs`,
CommonJS, path-casing mistakes, and `import()` with a non-literal specifier.

`cloudflare-config.jsonc` is not a module and is never uploaded. Before
packaging, the CLI parses it and writes the whole source config to
`cloudflare-config.generated.js` as `export default { ... };`.
`cloudflare-server.js` imports that module and passes it to `readConfig`. The
generated module is not committed and must never be edited by hand; change
`cloudflare-config.jsonc` instead.

## Adding a new setting

1. Decide per-deploy vs. per-environment using the question at the top of
   this document.
2. Per-environment: add the key under the relevant environment section(s) of
   `node-config.jsonc` and, if it applies to Cloudflare too, `cloudflare-config.jsonc`.
   Read it from `config.env` in application code.
   Also add it to the matching `.jsonc.template`, its example context, and the
   [Config templates](#config-templates) tables, or `config-templates.test.js`
   fails.
3. Per-deploy, non-secret: add the key to `example.env` with an explanatory
   comment, and to each `.env.<environment>` file that needs a non-default
   value. Do not author `ENVIRONMENT` or `BUILD_ID` for Cloudflare; the
   deployment CLI owns them.
4. Per-deploy, secret: add the key to `example.env.secrets` (mark it
   `# @optional` if a Node.js deployment may legitimately omit it), then follow
   the ordered steps in [the secrets manifest](#the-secrets-manifest) and, for
   Cloudflare, [Worker secrets](#worker-secrets). Deploy the code that reads it
   before removing any old fallback.
