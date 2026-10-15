# `kixx cloudflare` — Worker Deployment

Commands that create a Cloudflare Worker, upload Worker versions, and deploy
them. Every command requires `--environment` (`-e`), which selects
`environments.<env>` in `cloudflare-config.jsonc`, and the
`cloudflare.accountId` and `cloudflare.apiToken` secrets. See
[configuration.md](configuration.md).

devkit does not create D1 databases, KV namespaces, or R2 buckets, and does
not set Worker secrets. Do those in the Cloudflare dashboard or with Wrangler.

## `create-worker`

Creates the Worker described by `environments.<env>.WORKER`. It uploads no
version and deploys nothing.

```sh
kixx cloudflare create-worker -e <env>
```

`WORKER.name` is required. The rest of the block is sent to Cloudflare as the
Worker's settings (for example `observability`, `logpush`, `tags`,
`subdomain`).

## `update-worker`

Replaces an existing Worker's settings with `environments.<env>.WORKER`. It
creates no version and does not touch local state.

```sh
kixx cloudflare update-worker -e <env>
```

`WORKER.name` identifies the Worker; this command cannot rename one.

**This is a full replacement, not a patch.** Cloudflare resets any optional
setting missing from `WORKER` to its default, so keep the complete desired
configuration there.

## `create-worker-version`

Bundles the project and uploads a new Worker version when its inputs changed.

```sh
kixx cloudflare create-worker-version -e <env> [--force] [--deploy]
```

| Option | Description |
| --- | --- |
| `--force` | Upload even when nothing changed |
| `--deploy` | Upload and deploy to 100% of traffic in one request. Required, and only allowed, when the version binds an unprovisioned Durable Object class |

Project inputs:

```text
cloudflare-config.jsonc
cloudflare-server.js
.env.<env>
example.env.secrets
.kixx/cloudflare-state.<env>.json   (optional)
```

### Configuration

`WORKER.name` names an existing Worker. `WORKER_VERSION` holds version
settings and accepts exactly `compatibility_date`, `compatibility_flags`,
`limits`, `placement`, and `cache_options`. Any other key, including
`annotations`, is an error naming its path; the command writes the version
annotations itself.

Resource blocks produce bindings:

| Configuration | Binding |
| --- | --- |
| `DOCUMENT_STORE` (`bindingName`, `databaseId`) | D1 database |
| `KEY_VALUE_STORE` (`bindingName`, `namespaceId`) | KV namespace |
| `CONTENT_STORE` (`kvBindingName`, `kvNamespaceId`, `durableObjectBindingName`, `durableObjectClassName`) | KV namespace and Durable Object namespace |
| `JOB_QUEUE` (`durableObjectBindingName`, `durableObjectClassName`) | Durable Object namespace; other keys are application config |
| `OBJECT_STORE.buckets.<key>` (`bindingName`, `bucketName`, optional `jurisdiction`) | R2 bucket |
| `SEND_EMAIL` (`bindingName`) | `send_email`; other keys are application config |
| `IMAGES` (`bindingName`) | `images`; other keys are application config |

`jurisdiction` is `default`, `eu`, or `fedramp`; `default` equals omitting
it. `locationHint` and `storageClass` are accepted and ignored, since devkit
does not create buckets.

Binding names are a letter or underscore followed by letters, digits, or
underscores. `ENVIRONMENT` and `BUILD_ID` are reserved: `ENVIRONMENT` is bound
from `--environment`, and `BUILD_ID` is generated per upload. Duplicate names
across sources are errors.

`DURABLE_OBJECT_MIGRATIONS` declares Durable Object lifecycle changes. Classes
from `CONTENT_STORE` and `JOB_QUEUE` are live SQLite-backed exports; these
entries add tombstones and transfers to the version's declarative `exports`
map:

```jsonc
"DURABLE_OBJECT_MIGRATIONS": [
    { "action": "rename", "from": "OldName", "to": "NewName" },
    { "action": "delete", "className": "DeadName" },
    { "action": "transfer", "from": "Name", "fromScript": "old-worker", "to": "Name" },
    { "action": "transfer-away", "className": "Name", "toScript": "new-worker" },
],
```

### What it does

Nothing is written, locally or remotely, until every check passes.

1. **Local config.** Validate the environment block and `WORKER_VERSION`.
   Read the state file, `example.env.secrets`, and `.env.<env>`.
2. **Worker.** Read the Worker. If it does not exist, run
   `kixx cloudflare create-worker -e <env>` first.
3. **Secret source.** Choose the version to inherit secrets from (see
   [Secrets](#secrets)) and compare its secret names with
   `example.env.secrets`.
4. **Resources.** Look up every configured D1 database, KV namespace, and R2
   bucket (by name and jurisdiction). A missing or empty ID, or a resource
   Cloudflare cannot find, is a problem naming its config path.
5. **Durable Objects.** Find bound classes Cloudflare has no namespace for
   yet, and apply the [`--deploy` rules](#--deploy).

   Problems from steps 3 (secret names), 4, and 5 are reported together in
   one error, grouped as Secrets, Resources, and Durable Objects. Earlier
   failures (bad config, missing Worker, stale state) stop immediately.
6. **Package.** Write `cloudflare-config.generated.js`, bundle the module
   graph, and compute three hashes:
   - `modulesHash`: the bundled modules.
   - `bindingsHash`: the bindings and Durable Object exports.
   - `configHash`: `WORKER_VERSION`.
7. **Decide.** Upload when there is no state file, a hash changed, `--force`
   is set, or a Durable Object class is unprovisioned. Otherwise print
   `Nothing changed since version <id> (build <id>).` and exit 0.
8. **Upload.** Generate a `BUILD_ID`, bind it as `plain_text`, annotate the
   version (`workers/tag` = `BUILD_ID`, `workers/triggered_by` =
   `kixx cloudflare create-worker-version`), and upload with strict secret
   inheritance. Secret values are never sent.
9. **State.** Write `.kixx/cloudflare-state.<env>.json` with the new version.
   If that write fails, the error prints the full state JSON and its path,
   and says whether traffic changed; save it by hand before running another
   Worker command.

The output lists the hash changes, `BUILD_ID`, the version id, and the next
steps:

```sh
kixx app publish -e <env> --build-id <BUILD_ID>
kixx cloudflare deploy-version -e <env>
```

#### Creating resources

devkit only verifies resources. Create missing ones in the Cloudflare
dashboard or with Wrangler (for example `wrangler d1 create`,
`wrangler kv namespace create`, `wrangler r2 bucket create`), then record
their IDs in `cloudflare-config.jsonc`.

#### Bundling

`cloudflare-server.js` is the entry module. The bundler follows static
imports and includes every reachable `.js` and `.mjs` file as a separate
module, with comments stripped (line numbers kept). It does not transpile,
tree-shake, or minify. `node:` and `cloudflare:` imports stay external.

The build rejects bare imports (including `node_modules` packages), modules
outside the project directory, other extensions, CommonJS, missing files or
path-casing mistakes, and `import()` with a non-literal specifier.

### Secrets

Secret values are never read or sent. A new version inherits each secret from
one exact earlier version:

- **With a state file**, the source is the recorded `versionId`. It must
  still exist and must be the Worker's latest version. The recorded
  `workerName` must match `WORKER.name`.
- **Without a state file**, the latest version is adopted as the source, and
  the output says `Adopted latest version <id> as the secret source`. After
  upload, the state file pins the new version.
- **A Worker with no versions** fails when any required secret is declared:
  set those secrets in the dashboard or with Wrangler first. With no required
  secrets, it proceeds without inheriting anything.

The source version's secret names must match `example.env.secrets` (see
[configuration.md](configuration.md#exampleenvsecrets)): every required name
present, optional names inherited only when present, and no undeclared
secrets.

#### Stale state

Changing a secret in the dashboard or with Wrangler creates a new Worker
version, so the recorded version is no longer the latest and the build fails
as stale. Either:

- restore `.kixx/cloudflare-state.<env>.json` from the checkout that made the
  latest version, or
- delete it, so the next run adopts the latest version (its secret names must
  still match).

### `--deploy`

Cloudflare provisions a Durable Object namespace only when the version
declaring it is deployed, so such a version cannot be uploaded undeployed.

- A version binding an unprovisioned class fails without `--deploy`, naming
  each class and binding.
- `--deploy` when every bound class is provisioned is an error.
- With `--deploy`, the version is uploaded and deployed to 100% of traffic in
  one request, the state records `deployed: true`, and the output lists the
  provisioned classes and Cloudflare's reconciliation report.

A new environment's first version always needs `--deploy`, because the
`CONTENT_STORE` and `JOB_QUEUE` classes are new.

**Content gap.** The deployed version serves a fresh `BUILD_ID` with no
content assigned, so content routes return 503 until you run the printed
command:

```sh
kixx app publish -e <env> --build-id <BUILD_ID>
```

Reconciliation may list stale `DURABLE_OBJECT_MIGRATIONS` entries that are
safe to delete from the config.

## `deploy-version`

Routes 100% of traffic to an existing Worker version.

```sh
kixx cloudflare deploy-version -e <env> [--version-id <id>]
```

`--version-id` defaults to the version recorded in
`.kixx/cloudflare-state.<env>.json`. There is no content check and no
`--force`; you decide what to deploy. If Cloudflare refuses the deployment
(for example a rollback to a version created before a secret change), its
error is shown.

The output prints the environment, Worker, version, and its `BUILD_ID` (or
`(none)`). When a state file exists, its `deployed` flag is set to whether
the deployed version is the recorded one. No state file is created, and state
is untouched if Cloudflare fails.

## Workflows

### New environment

1. Add the environment to `cloudflare-config.jsonc` and create its D1, KV,
   and R2 resources in the dashboard or with Wrangler; record their IDs. Add
   `app.environments.<env>.origin` to `.kixx/config.json`.
2. `kixx cloudflare create-worker -e <env>`
3. Set the required secrets from `example.env.secrets` on the Worker in the
   dashboard or with Wrangler (generate `ADMIN_BOOTSTRAP_TOKEN` with
   `kixx admin gen-secure-token`).
4. `kixx cloudflare create-worker-version -e <env> --deploy`
5. `kixx admin accept-invite -e <env>`
6. `kixx admin create-publishing-token -e <env>`, then store the token in
   `.kixx/secrets.json`.
7. `kixx app publish -e <env> --build-id <BUILD_ID>`

Content routes return 503 between steps 4 and 7.

### Routine deploy

1. `kixx cloudflare create-worker-version -e <env>`
2. `kixx app publish -e <env> --build-id <BUILD_ID>`
3. `kixx cloudflare deploy-version -e <env>`

### Content only

```sh
kixx app publish -e <env>
```
