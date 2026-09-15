# Configuration

This document covers every source of runtime configuration for this project:
what belongs where, how the pieces are merged and validated, and how to add
or change a setting.

## The one question that decides where a value goes

> Does the value change **per deploy**, or only **per environment**?

An **environment** (`development`, `local`, `production`, ...) is a class of
deploy that shares behavior. A **deploy** is one specific running instance —
one Node.js process, one Cloudflare Worker version. Two deploys of the same
environment share configuration but not environment variables.

- Per-environment values are **configuration**: `src/node-config.js` or
  `src/cloudflare-config.js`, under the `environments` map.
- Per-deploy values are **environment variables**: dotenv files (Node.js) or
  Cloudflare bindings, split again by secrecy (see below).

There is no third place. A value that seems to need both is a sign it should
be split into a config default and a per-deploy override, not a reason to
duplicate it.

## Configuration modules

`src/node-config.js` and `src/cloudflare-config.js` are plain JavaScript
modules exporting:

```js
export default {
    name: 'kixx-app',
    environments: {
        development: { /* ... */ },
        production: { /* ... */ },
    },
};
```

Top-level settings like `name` are rare. Everything else lives under
`environments`, keyed by environment name. Each environment section holds every
store, cache, logger, and rate-limit setting that environments deploys will
share — for example `LOGGER.level`, `HYPERVIEW.useTemplateCache`, and
`DOCUMENT_STORE`.

The two platform specific configuration files are independent: an environment
name in one has no obligation to exist in, or match the shape of, the same
name in the other.

### Loading a config: `readConfig`

`src/kixx/config/read-config.js` turns a source config module and a selected
environment name into the frozen runtime config the application actually
uses:

```js
import { readConfig } from './kixx/config/read-config.js';
import sourceConfig from './node-config.js';

const config = readConfig(sourceConfig, environment, { resolveFilepath });
```

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

- The Node.js server (`src/node-server.js`) resolves it as `--environment`,
  else `NODE_ENV`, defaulting to `development` if neither is set.
- The Cloudflare Worker reads its `ENVIRONMENT` binding directly.

## Environment variables

Per-deploy values are environment variables, split by secrecy:

| File | Committed | Holds | Cloudflare deployment use |
| --- | --- | --- | --- |
| `src/.env.<environment>` | yes | `ENVIRONMENT`, `TRUST_PROXY`, `BUILD_ID`, `PORT`, `DATA_DIRECTORY` | Required build input; every value becomes a plain-text binding |
| `src/.env.<environment>.secrets` | no | signing secrets and tokens | Not read by builds; optional input to build tooling |

The secrecy split follows the git boundary. There is no per-key annotation to
keep in sync, and no way for a value to be classified two ways at once.

`src/example.env` and `src/example.env.secrets` are the committed templates
for each half — `example.env` documents every plain key inline, and
`example.env.secrets` doubles as the manifest of required secret names (see
below). Bootstrap a fresh clone with:

```bash
cp src/example.env.secrets src/.env.development.secrets
```

### Node.js - Merging environment variables

`src/node-environment.js` (`readEnvironment`, backed by
`src/kixx/config/merge-environment-sources.js`) merges three sources for the
Node.js server, in this order:

1. `.env.<environment>` (or the file named by `--dotenv`)
2. `.env.<environment>.secrets` (the same path with `.secrets` appended)
3. `process.env`

Each file is independently optional, so deploying with dotenv files and
deploying by setting `process.env` both work, and they can be combined. Only
keys the dotenv files declare participate from `process.env` — unrelated
process environment entries never collide.

**A key defined by more than one source aborts startup**, naming the key and
every source that defined it. There is deliberately no precedence rule: a key
carrying two definitions means one of them is in the wrong place, and
resolving it silently is how a secret ends up bound as plain text.

`--dotenv <path>` names the plain file directly; the secrets file is always
derived by appending `.secrets`, so one flag selects the pair.

### The secrets manifest

`example.env.secrets` is not just a copy-from template — its committed text
*is* the manifest of secret names a deployment must provide.
`src/kixx/config/secrets-manifest.js` parses it: each `NAME=value` line
declares a required secret (the value is a placeholder and is discarded), and
a `# @optional` comment line immediately above an entry marks that one name
optional.

When starting the devserver, or any Node.js server, `readEnvironment` checks
the merged environment against this manifest: every required name must resolve
to a non-empty string, or startup fails before any store is opened, naming
every missing secret at once. Optional names are not checked either way.

Keeping code and manifest in sync is a two-step, ordered process in both
directions:

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
`KEY_VALUE_STORE`, `OBJECT_STORE`, `CONTENT_STORE`) resolve against, in place
of `src/`. `createResolveFilepath` in `src/node-environment.js` builds the
`resolveFilepath` function passed into `readConfig`; it joins a config path's
POSIX-style segments against `DATA_DIRECTORY` when set, or against `src/`
otherwise.

This exists for [local target instances](../README.md#local-target-instances),
where every instance's stores must live inside that instance's own directory
rather than the shared development data. Leave it unset for every other
deployment.

## Cloudflare specifics

The Cloudflare Worker does not read dotenv files. The separate Kixx deployment
CLI, run from `src/`, builds Worker versions from these inputs:

```text
cloudflare-config.js
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

`cloudflare-config.js` also carries CLI-only blocks per environment:

- `WORKER` — the Worker name plus Worker-level settings (observability,
  logpush, subdomain), applied by `create-worker` only.
- `WORKER_VERSION` — exactly `compatibility_date`, `compatibility_flags`,
  `limits`, `placement`, and `cache_options`. Any other key is rejected.
- `DURABLE_OBJECT_MIGRATIONS` — optional rename, delete, and transfer
  declarations for Durable Object classes.

Resource blocks become bindings: `DOCUMENT_STORE` (D1), `KEY_VALUE_STORE` (KV),
`CONTENT_STORE` (KV and a Durable Object namespace), and one R2 binding per
`OBJECT_STORE.buckets` entry. The CLI verifies configured D1 and KV IDs. When
an ID is absent, it resolves the resource by name, adopting or creating it,
prints the ID, and stops so the ID can be added to `cloudflare-config.js`. R2
buckets are neither verified nor created and must exist before deployment.

### Worker packaging

`cloudflare-server.js` is the entry module. The CLI uploads every statically
reachable module as a separate ES module with comments removed; there is no
transpiling, tree shaking, or minification. The build rejects bare package
imports, modules outside `src/`, extensions other than `.js` and `.mjs`,
CommonJS, path-casing mistakes, and `import()` with a non-literal specifier.

## Adding a new setting

1. Decide per-deploy vs. per-environment using the question at the top of
   this document.
2. Per-environment: add the key under the relevant environment section(s) of
   `node-config.js` and, if it applies to Cloudflare too, `cloudflare-config.js`.
   Read it from `config.env` in application code.
3. Per-deploy, non-secret: add the key to `example.env` with an explanatory
   comment, and to each `.env.<environment>` file that needs a non-default
   value. Do not author `ENVIRONMENT` or `BUILD_ID` for Cloudflare; the
   deployment CLI owns them.
4. Per-deploy, secret: add the key to `example.env.secrets` (mark it
   `# @optional` if a Node.js deployment may legitimately omit it). On
   Cloudflare, `set-secret` the value before building. Then deploy the code
   that reads it before removing any old fallback.
