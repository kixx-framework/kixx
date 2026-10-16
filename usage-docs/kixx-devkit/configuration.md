# Configuration

Settings shared by the `app`, `cloudflare`, and `admin` commands.

## The `.kixx` two-layer merge

Settings live in a `.kixx` directory at two scopes: your home directory and
the project directory. The project is the nearest directory containing
`.kixx/`, found by walking up from the directory argument, or the working
directory when none is given (stopping at home).
The project layer is merged over the home layer, so shared credentials can be
written once in `~/.kixx` and each project records only what differs.

```
~/.kixx/config.json             <- home layer, settings
~/.kixx/secrets.json            <- home layer, secrets
<project>/.kixx/config.json     <- project layer, settings
<project>/.kixx/secrets.json    <- project layer, secrets
```

A missing directory or file is an empty layer. Never commit `secrets.json`.

### Application settings

`app` and `admin` commands read:

- `app.environments.<env>.origin` in `config.json`: the application's origin.
- `app.environments.<env>.publishingToken` in `secrets.json`: the token
  minted by `kixx admin create-publishing-token` (used by `app` commands).

```json
// .kixx/config.json
{
    "app": {
        "environments": {
            "production": { "origin": "https://www.example.com" }
        }
    }
}
```

```json
// .kixx/secrets.json
{
    "app": {
        "environments": {
            "production": { "publishingToken": "kxpat_..." }
        }
    },
    "cloudflare": {
        "accountId": "...",
        "apiToken": "..."
    }
}
```

`--origin` and `--token` override these on the commands that use them. A
missing setting fails with a usage error naming the file and key path.

### Cloudflare credentials

Every `cloudflare` command requires `cloudflare.accountId` and
`cloudflare.apiToken` in `secrets.json`. The token needs permission to read
and edit Workers and Worker versions, and to read D1 databases, KV
namespaces, and R2 buckets. devkit never creates D1, KV, or R2 resources.

An authentication failure prints guidance naming the secrets files instead of
a stack trace.

## `--environment`

Every `admin`, `app`, and `cloudflare` command except `admin gen-secure-token`
requires `--environment` (`-e`). `dev start` defaults it to `development`;
`local` commands do not take it. For `app` and `admin` commands it names a key under `app.environments`. For
`cloudflare` commands it names a key under `environments` in
`cloudflare-config.jsonc`. A missing or unknown environment fails before any
network call.

## `cloudflare-config.jsonc`

Cloudflare commands read `<project>/cloudflare-config.jsonc`. The format is
JSON plus `//` and `/* */` comments and trailing commas; nothing else. The top
level is an object with an `environments` object keyed by environment name:

```jsonc
{
    "environments": {
        "production": {
            "WORKER": { "name": "my-app" },
            "WORKER_VERSION": { "compatibility_date": "2026-01-01" },
            "DOCUMENT_STORE": { "bindingName": "DOCUMENT_STORE", "databaseId": "..." },
            // ...
        },
    },
}
```

A missing file, a parse error, a non-object top level, or a missing
`environments` object fails with a usage error naming the file. See
[cloudflare.md](cloudflare.md) for the blocks each command reads. The file is
data only. Apart from `kixx dev start`, `kixx local seed`, and
`kixx local start`, which run the app's `node-server.js` (see [dev.md](dev.md)
and [local.md](local.md)), devkit does not run project code.

### `cloudflare-config.generated.js`

The Worker cannot read JSONC at runtime, so `cloudflare-server.js` imports
`./cloudflare-config.generated.js`. `kixx cloudflare create-worker-version`
writes it in the project directory after every check passes and just before
bundling. It holds the top-level fields of `cloudflare-config.jsonc` and only
the selected environment, so another environment's edits never change this
environment's bundle. Do not edit or commit it; add it to `.gitignore`.

## `.env.<env>`

Required for `create-worker-version`. Each `NAME=value` line becomes a
`plain_text` Worker binding. The parser is minimal: blank lines and `#`
comment lines are skipped, values may be quoted, and there are no inline
comments, variable expansion, or multi-line values. Duplicate or invalid
names are errors. `ENVIRONMENT` is ignored (the Worker gets it from
`--environment`) and `BUILD_ID` is rejected (devkit generates it).

## `example.env.secrets`

Required for `create-worker-version`. It declares the Worker's secret *names*
for every environment; values are placeholders and are ignored.

- Each active `NAME=` line declares a **required** secret.
- A comment line reading exactly `# @optional` marks the next entry
  **optional**. Only comment lines may sit between the directive and its
  entry.
- `BUILD_ID` and `ENVIRONMENT` are reserved and rejected.

```
# Signs CSRF tokens.
CSRF_TOKEN_SIGNING_SECRET=

# Deleted after the first admin is created.
# @optional
ADMIN_BOOTSTRAP_TOKEN=
```

Builds never read secret values. Each new Worker version inherits secrets
from an exact earlier version, and the names must match this file:

- Every required name must be set on the source version.
- An optional name is inherited when set, and skipped when not.
- Any other secret on the source version fails the build.

See [cloudflare.md](cloudflare.md#secrets) for how the source version is
chosen. Set and change secret values in the Cloudflare dashboard or with
Wrangler.

## State files

`create-worker-version` records the version it created in
`<project>/.kixx/cloudflare-state.<env>.json`: `workerName`, `buildId`,
`versionId`, `createdAt`, `deployed`, and the `modulesHash`, `bindingsHash`,
and `configHash` used to skip unchanged builds. `deploy-version` updates its
`deployed` flag. The file holds no secret values; keep it with the checkout
that deploys the environment.
