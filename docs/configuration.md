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

| File | Committed | Cloudflare binding | Holds |
| --- | --- | --- | --- |
| `src/.env.<environment>` | yes | plain text | `ENVIRONMENT`, `TRUST_PROXY`, `BUILD_ID`, `PORT`, `DATA_DIRECTORY` |
| `src/.env.<environment>.secrets` | no | encrypted secret text | signing secrets and tokens |

The secrecy split follows the git boundary: a deployment can derive the
binding type from the filename alone. There is no per-key annotation to keep
in sync, and no way for a value to be classified two ways at once.

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

The Cloudflare Worker has no local dotenv files. `ENVIRONMENT`, `TRUST_PROXY`,
and `BUILD_ID` are plain-text Worker bindings; secret values are written and
rotated with Cloudflare's deployment tooling rather than a `.secrets` file.
The secrets manifest still applies — `example.env.secrets` is the same
authoritative list of required secret names, checked against whatever the
deployment tooling reports as live on the target Worker.

Naming a D1 database, KV namespace, or R2 bucket in `cloudflare-config.js`
does not provision it. The resource must exist and be bound to the Worker
under the configured binding name before a deploy that reads it.

## Adding a new setting

1. Decide per-deploy vs. per-environment using the question at the top of
   this document.
2. Per-environment: add the key under the relevant environment section(s) of
   `node-config.js` and, if it applies to Cloudflare too, `cloudflare-config.js`.
   Read it from `config.env` in application code.
3. Per-deploy, non-secret: add the key to `example.env` with an explanatory
   comment, and to each `.env.<environment>` file that needs a non-default
   value.
4. Per-deploy, secret: add the key to `example.env.secrets` (mark it
   `# @optional` if a deployment may legitimately omit it), then deploy the
   code that reads it before removing any old fallback.
