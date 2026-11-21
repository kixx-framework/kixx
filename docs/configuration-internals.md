# Configuration Internals

How the framework loads configuration, how the config templates are
rendered, and how to add a new setting. For where a value belongs and what
each setting means, read `../usage-docs/kixx-app/configuration.md` first.

## Parsing: `parseJsonc`

`kixx/config/parse-jsonc.js` (`parseJsonc`) is the framework's own JSONC
parser. It has no dependencies and runs on every platform. It supports JSON
plus `//` and `/* */` comments and trailing commas, not JSON5 extensions like
unquoted keys or single-quoted strings.

## Loading a config: `readConfig`

`kixx/config/read-config.js` turns a source config module and a selected
environment name into the frozen runtime config the application uses:

```js
import { readConfig } from './kixx/config/read-config.js';
import { readSourceConfigFile } from './node-environment.js';

const sourceConfig = readSourceConfigFile(path.join(THIS_DIRECTORY, 'node-config.jsonc'));
const config = readConfig(sourceConfig, environment, { resolveFilepath });
```

On Node.js, `readSourceConfigFile` reads the file and parses it with
`parseJsonc`. The Cloudflare Worker has no filesystem, so it imports
`cloudflare-config.generated.js`, which the deployment CLI writes at build
time.

It throws if `config.environments` is not a plain object, or if
`environment` does not match a key in it. The returned object is deep-frozen
and reshapes the source: the selected section becomes `config.env`, the
environment name becomes `config.environment`, and everything else at the
top level (like `name`) passes through unchanged. Application code reads
settings from `config.env`, never by re-selecting from `config.environments`.

In runtimes with a filesystem, `resolveFilepath` is attached to the frozen
config and turns config-relative store paths into real paths.
`createResolveFilepath` in `node-environment.js` builds it: it joins a
config path's POSIX-style segments against `DATA_DIRECTORY` when set, or
against `lib/` otherwise.

## Environment merging

`node-environment.js` (`readEnvironment`, backed by
`kixx/config/merge-environment-sources.js`) merges the dotenv file, its
`.secrets` sibling, and `process.env`, rejecting duplicate keys.
`kixx/config/secrets-manifest.js` parses `example.env.secrets`, and
`readEnvironment` checks the merged result against it.

## Config templates

`node-config.jsonc` and `cloudflare-config.jsonc` can be rendered from
templates in `lib/`. Today two things render them:
`test/config-templates.test.js`, and `tools/build-test-app.js`
(from the repo root), which renders `test-app`'s configs from its own
context files. No devkit command uses them yet.

| File | Purpose |
| --- | --- |
| `node-config.jsonc.template` | Renders `node-config.jsonc`. |
| `node-config-test-context.json` | Context that reproduces today's `node-config.jsonc`. |
| `cloudflare-config.jsonc.template` | Renders `cloudflare-config.jsonc`. |
| `cloudflare-config-test-context.json` | Context that reproduces today's `cloudflare-config.jsonc`. |

The unit test renders each template with its example context and asserts
the parsed output equals the live `.jsonc` file.

Templates hard-code framework-owned values: section structure, binding names,
Durable Object class names, resource `type` values, and explanatory comments.
The context supplies every app or environment choice.

### Rendering

```javascript
import * as templating from './kixx/vendor/templating/mod.js';

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
| `DOCUMENT_STORE.path`, `KEY_VALUE_STORE.path` | yes | |
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
| `DOCUMENT_STORE.databaseId` | optional | When absent, renders a hint to fill in the ID. |
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

## Adding a new setting

Follow "Adding a new setting" in the usage configuration doc. For a
per-environment setting, also add the key to the matching `.jsonc.template`,
its example context, and the [Config templates](#config-templates) tables,
or `config-templates.test.js` fails. Add it to `test-app`'s context files
too, or `tools/build-test-app.js` fails to render.
