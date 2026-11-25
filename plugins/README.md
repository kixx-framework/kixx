# Plugins

A plugin is a directory, `plugins/<name>/`, that holds a manifest (`plugin.json`) and the modules the manifest names. The manifest is static data: tooling reads it without running any project code. From the installed manifests a generator writes the registries that wire plugins into a project, so adding or removing a plugin never edits an entry point.

Core is described the same way, by `kixx/plugin.json`. An app describes its own secrets in `app/app.json`.

Plugins are first-party only. Nothing is discovered or loaded at runtime: every registry is a list of static imports.

Paths in this guide are from a project's root. In this repository core is `kixx/`, as it is in a project.

## Plugin Layout

```
plugins/visits/
├── plugin.json                     the manifest
├── plugin.js                       platform-neutral lifecycle module
├── routes.js                       a routes module
├── lib/                            platform-neutral implementation
├── adapters/node/plugin.js         Node.js lifecycle module
├── adapters/node/lib/              Node.js implementation
├── adapters/cloudflare/plugin.js   Cloudflare lifecycle module
├── adapters/cloudflare/lib/        Cloudflare implementation, Durable Object classes
└── pages/, templates/, static-assets/
```

Only `plugin.json` is required, and it must sit directly in the plugin's directory. Every other file is found through the manifest; the names above are the convention. A directory under `plugins/` with no `plugin.json` is not a plugin and is ignored.

Code outside `adapters/` imports no `node:*` or `cloudflare:*` module and no adapter.

## The Manifest

`plugin.json` is strict JSON. An unknown key is an error.

```json
{
    "name": "visits",
    "version": "7.0.0-alpha.0",
    "core": "7.0.0",
    "description": "Counts visits.",
    "dependencies": [ "admin" ],
    "services": [ "Visits" ],
    "lifecycle": [ "./plugin.js" ],
    "adapters": {
        "node": { "lifecycle": [ "./adapters/node/plugin.js" ] },
        "cloudflare": { "lifecycle": [ "./adapters/cloudflare/plugin.js" ] }
    },
    "config": {
        "keys": [ "VISITS" ],
        "defaults": {
            "all": { "VISITS": { "greeting": "hello" } },
            "node": { "VISITS": { "store": "sqlite" } },
            "cloudflare": {
                "VISITS": {
                    "kvNamespace": { "bindingName": "VISITS_KV" },
                    "durableObject": { "bindingName": "VISITS_DURABLE_OBJECT" }
                }
            }
        }
    },
    "secrets": [
        { "name": "VISITS_SIGNING_SECRET", "required": true, "description": "Signs visit tokens." }
    ],
    "cloudflare": {
        "kvNamespaces": [ { "config": "VISITS.kvNamespace" } ],
        "durableObjects": [
            {
                "className": "VisitsStore",
                "module": "./adapters/cloudflare/lib/visits-store.js",
                "config": "VISITS.durableObject"
            }
        ]
    },
    "routes": [
        { "module": "./routes.js", "mount": "/visits", "name": "visits" }
    ],
    "content": {
        "pagesDirectory": "./pages",
        "templatesDirectory": "./templates",
        "staticAssetsDirectory": "./static-assets"
    },
    "whenInstalled": {
        "admin": {
            "routes": [ { "module": "./admin-routes.js", "mount": "/admin/visits", "name": "admin-visits" } ]
        }
    }
}
```

`name`, `version`, `core`, and `description` are required. Every other key is optional.

| Key | Rule |
|---|---|
| `name` | Lowercase letters, digits, and hyphens, starting with a letter. Equals the directory name. `kixx` and `app` are reserved. |
| `version` | `1.2.3`, with an optional prerelease tag (`1.2.3-alpha.0`). |
| `core` | `1.2.3`: the oldest core version the plugin works with. The plugin is compatible with that version and every later one of the same major version. |
| `description` | One line. |
| `dependencies` | Names of plugins that must be installed. A dependency's lifecycle modules run before this plugin's. |
| `services` | The names the plugin registers with `registerService()`, the same on every target. Letters, digits, and dots. |
| `lifecycle` | Module paths of platform-neutral lifecycle modules, in the order they run. |
| `adapters` | Only `node` and `cloudflare`. Each holds `lifecycle`: module paths of that target's lifecycle modules, run after the top-level list. |
| `config.keys` | The top-level sections of the environment config the plugin owns, such as `VISITS`. Uppercase letters, digits, and underscores. |
| `config.defaults` | Only `all`, `node`, and `cloudflare`. Each is an object whose top-level keys are all in `config.keys`. See "Config". |
| `secrets` | Objects with `name`, `description` (one line), and `required` (a boolean, default `true`). `BUILD_ID` and `ENVIRONMENT` are not secret names. See "Secrets". |
| `cloudflare.kvNamespaces` | Objects with only `config`: a config path. See "Cloudflare Resources". |
| `cloudflare.durableObjects` | Objects with `className`, `module` (a module path), and `config` (a config path). |
| `routes` | Objects with `module` (a module path) and, to mount it, `mount` and `name`. `mount` starts with `/`. `name` is lowercase letters, digits, and hyphens. Give both or neither. See "Routes". |
| `content` | `pagesDirectory`, `templatesDirectory`, and `staticAssetsDirectory`: at least one, each a directory path. Recorded in the registries as `contentRoots`. Nothing reads them yet. |
| `whenInstalled` | An object keyed by another plugin's name. Each value holds `lifecycle`, `routes`, or `content`, at least one, under the rules above. See "Contributing Only When Another Plugin Is Installed". |

Three kinds of path appear:

- **A module path** is relative to the manifest's directory, starts with `./`, ends in `.js`, and can't leave the directory: `./adapters/node/plugin.js`.
- **A directory path** is the same without a file name: `./pages`.
- **A config path** names a block in the environment config: a key from `config.keys`, then property names joined by dots (`VISITS.kvNamespace`).

**Core's manifest** (`kixx/plugin.json`) uses the same keys, with three differences. It has no `core`, `dependencies`, or `whenInstalled`. Each of its adapters must also name `loggerWriter` and `serverRequest`: a module path whose default export is the class. A plugin's manifest can't hold either.

**The app manifest** (`app/app.json`) holds only `secrets`. A project without the file declares none.

**Across manifests**, the generator rejects: a dependency that isn't installed, a dependency cycle, a plugin whose `core` is newer than core or of another major version, and a service, config key, secret, Durable Object class, route mount, or route name declared twice. It reports every such problem in one error.

The validator is `validatePluginManifest()` in `kixx/tooling/plugin-manifest.js`. A new manifest key goes into the validator, the resolver (`kixx/tooling/resolve-installation.js`), and this guide in one change.

## Lifecycle Modules

A lifecycle module exports up to four functions. Each is optional.

```js
// Construct services and register them. Never call context.getService() here:
// other modules may not be registered yet.
export function register(context) { }

// Wire dependencies between registered services. getService() is safe here.
export function initialize(context) { }

// Begin long-running work, such as a job loop. Call
// options.onUnexpectedError(error) for an error the work can't recover from.
export async function start(context, options) { }

// End that work. Must be safe when start() never ran, or failed.
export async function stop(context) { }
```

`context` is the `ApplicationContext`. `app/app.js` may export the same four.

**Order.** Core's modules run first, then each plugin's, then the app's. A plugin runs after every plugin it depends on; ties are broken by name. Within one manifest: `lifecycle`, then lifecycle modules contributed through `whenInstalled`, then `adapters.<target>.lifecycle`.

**Boot** is the same on every platform (`bootApplication()` in `kixx/context/boot-application.js`): check the declared secrets, call `register()` on every module, then `initialize()` on every module. Because every `register()` runs before any `initialize()`, `initialize()` may ask for any service.

**`start()` and `stop()` run on Node.js and Deno only.**

- `start()` runs once the server is listening, in lifecycle order. A `start()` that throws shuts the server down with exit code 1. So does an error passed to `onUnexpectedError`.
- `stop()` runs during shutdown, in reverse order: after the server has stopped taking requests, and before services are closed. A `stop()` that throws is logged and the rest still run. It runs whether or not `start()` did, and must finish within the server's 10-second shutdown timeout.
- A Cloudflare Worker calls neither. It has no process lifetime: an isolate starts and ends without notice.

A service that holds a resource (a database handle) gets a `close()` method. `ApplicationContext#close()` calls it at shutdown, after every `stop()`.

## Generated Files

The generator reads `kixx/plugin.json`, each `plugins/<name>/plugin.json`, and `app/app.json`, and writes five files at the project root:

| File | Holds |
|---|---|
| `node-registry.generated.js` | For Node.js and Deno: `LoggerWriter`, `ServerRequest`, `plugins`, `configDefaults`, `secrets`, `contentRoots`. |
| `cloudflare-registry.generated.js` | The same exports for Cloudflare. It imports no Durable Object class. |
| `cloudflare-durable-objects.generated.js` | One export per Durable Object class. Only Cloudflare can load it. |
| `routes.generated.js` | `pluginRoutes`: every route the plugins contribute. For both targets. |
| `example.env.secrets` | Every declared secret, with its owner and description. |

A target registry's exports:

- `LoggerWriter`, `ServerRequest`: core's classes for the target.
- `plugins`: a `Map` of lifecycle modules in the order they run, keyed `<owner>:<module path>` (`visits:./plugin.js`).
- `configDefaults`: the config defaults for the target.
- `secrets`: `{ required, optional }`, each a sorted list of names.
- `contentRoots`: where plugin content lives, as paths from the project root.

Rules:

- **Commit them.** A fresh clone boots with no generate step, and a plugin change shows up as a diff.
- **Never edit one.** Change a manifest and regenerate.
- **A test catches drift.** `test/fixtures/project.test.js` fails while the fixture's committed files differ from what the generator writes.
- **Generated JavaScript is not linted.** Each file turns lint off for itself with `/* eslint-disable */`.

In this repository, regenerate a project with:

```
node tools/generate-registries.js <project-directory> [--core <path>]
```

`--core` is where core lives, relative to the project (default `kixx`). The only project here is the test fixture:

```
node tools/generate-registries.js test/fixtures/project --core ../../../kixx
```

The generator is `writeProjectFiles()` in `kixx/tooling/mod.js`. It is pure: it reads and writes through the file-system port in `kixx/tooling/project-file-system-interface.js`, which `kixx/adapters/node/tooling/lib/project-file-system.js` implements.

## Routes

A routes module's default export is an array of route specifications:

```js
export default [
    {
        pattern: '/visits/:id',
        name: 'visit',
        targets: [ { name: 'show', methods: [ 'GET' ], requestHandlers: [ showVisit ] } ],
    },
];
```

With a `mount` in the manifest, the routes are nested under it: each pattern is appended to the mount path, and each name becomes `<mount name>/<name>`. A mounted module may instead export an object, to put middleware and error handlers on the mount itself:

```js
export default {
    inboundMiddleware: [ requireSignIn ],
    outboundMiddleware: [],
    errorHandlers: [],
    routes: [
        // The mount path itself, with or without a trailing slash.
        { pattern: '{/}', name: 'home', targets: [ /* ... */ ] },
    ],
};
```

A child pattern of `/` matches `<mount>/` only. Use `{/}` for the mount path itself.

`routes.generated.js` exports every plugin's routes as one list, `pluginRoutes`. Its order is the plugins' lifecycle order; within a plugin, the manifest's own routes, then the routes it contributes through `whenInstalled`. The project decides where the list goes, in its own `virtual-hosts.js`:

```js
import { pluginRoutes } from './routes.generated.js';

export default [
    {
        name: 'my-site',
        hostname: 'localhost',
        routes: [ ...myRoutes, ...pluginRoutes, catchAllRoute ],
    },
];
```

The first matching route wins, so the project's own routes go first and its catch-all last.

## Config

A plugin owns the config sections it lists in `config.keys`, and gives them defaults per target:

- `config.defaults.all` applies to every target.
- `config.defaults.node` and `config.defaults.cloudflare` are laid over `all` for that target.
- The project's config (`node-config.jsonc`, `cloudflare-config.jsonc`) is laid over the result.

Objects merge key by key. An array or any other value replaces the default whole.

So a project's config holds only what has no default, or what it wants to change. The manifest is the single source of a default: a lifecycle module reads the merged value from `context.config.env` and asserts it, with a message naming the config path. It keeps no fallback of its own.

## Secrets

Declare every secret the code reads: a plugin in its manifest, an app in `app/app.json`.

```json
{
    "secrets": [
        { "name": "SUPPORT_TOKEN", "required": false, "description": "Lets support staff sign in." }
    ]
}
```

Boot checks the declared secrets on every platform, before anything is built. Each required name must be a non-empty string in the environment. If any is missing, boot fails with one error naming all of them, and never a value:

```
Missing required environment secrets: A_SECRET, B_SECRET. Every declared secret is listed in example.env.secrets.
```

An optional secret may be absent. Read a secret with `context.getEnvString(name)`. Never log one.

`example.env.secrets` is generated from the declarations. It is the template for `.env.<environment>.secrets`, and the list of secret names every deployment must provide.

## Cloudflare Resources

A manifest declares each Cloudflare resource as a pointer to the config block that describes it:

| Resource | Manifest entry | Config block |
|---|---|---|
| KV namespace | `{ "config": "VISITS.kvNamespace" }` | `{ bindingName, namespaceName, namespaceId }` |
| Durable Object | `{ "className", "module", "config": "VISITS.durableObject" }` | `{ bindingName }` |

The manifest's Cloudflare defaults give each block its `bindingName`. The project's `cloudflare-config.jsonc` supplies what has no default: the resource's own name and id. A Durable Object's class name and module come from the manifest, and its storage is always SQLite.

Core's own resources follow the same model: `KEY_VALUE_STORE`, `CONTENT_STORE.kvNamespace`, and `CONTENT_STORE.durableObject`.

**Durable Object classes.** The module's default export is the class. It is a thin shell: it imports `cloudflare:workers`, hands `ctx` and `env` to a plain class that holds the behavior, and delegates each method in one line (see "Thin Shells" in `test/README.md`). `cloudflare-durable-objects.generated.js` exports every declared class by its `className`, and the Cloudflare entry point re-exports that file. No other generated file imports a shell, so the Cloudflare registry loads in a unit test.

Only KV namespaces and Durable Object classes can be declared today.

## Contributing Only When Another Plugin Is Installed

A `whenInstalled` block is merged into the plugin when the named plugin is installed, and leaves no trace when it isn't:

```json
"whenInstalled": {
    "admin": {
        "lifecycle": [ "./admin-plugin.js" ],
        "routes": [ { "module": "./admin-routes.js", "mount": "/admin/visits", "name": "admin-visits" } ],
        "content": { "pagesDirectory": "./admin-pages" }
    }
}
```

Its lifecycle modules and routes are added after the plugin's own, and its `content` is one more content root. It is not a dependency: the plugin works without the other one. "Installed" means a directory under `plugins/` with a `plugin.json`.

## Entry Points

An entry point is a thin shell. It names no plugin and no service, so installing a plugin never changes it.

```js
// node-server.js
import { startNodeServer } from './kixx/adapters/node/server/lib/node-server.js';
import * as registry from './node-registry.generated.js';
import virtualHosts from './virtual-hosts.js';
import * as app from './app/app.js';

await startNodeServer({ registry, virtualHosts, app, baseDirectory: import.meta.dirname });
```

```js
// cloudflare-server.js
import { env } from 'cloudflare:workers';
import { createWorker } from './kixx/adapters/cloudflare/server/lib/cloudflare-worker.js';
import sourceConfig from './cloudflare-config.generated.js';
import * as registry from './cloudflare-registry.generated.js';
import virtualHosts from './virtual-hosts.js';
import * as app from './app/app.js';

export * from './cloudflare-durable-objects.generated.js';

export default createWorker({ env, sourceConfig, registry, virtualHosts, app });
```

Those are all the imports each may have. `cloudflare-config.generated.js` is written by a deploy and is not committed.

The server logic lives in the two core modules, which take every platform service as an argument and are unit tested:

- `startNodeServer()` parses the command line, reads the dotenv files and `node-config.jsonc`, boots, listens, runs the `start()` hooks, and shuts down on SIGTERM (drain) or SIGINT (at once).
- `createWorker()` boots when the module loads and returns `{ fetch }`. It builds each request's context from that request's environment.

Unit tests never import an entry point. `test/fixtures/project/` holds a small project whose registries the unit suite boots on both targets.

## Ports and Adapters

Plugins and core run one application codebase on every platform through ports and adapters. **Application code never names a platform.** It asks for a capability by name and gets whatever implements it on the current runtime:

```js
// Identical on Node.js and Cloudflare Workers.
const cache = context.getService('KeyValueStore');
```

### The Three Roles

- **Ports** (`*-interface.js`) are contracts: JSDoc-only modules with no executable code. They live beside the component that consumes them, because the consumer owns the contract. `kixx/key-value-store/key-value-store-interface.js` is one.
- **Adapters** (`adapters/<platform>/…/lib/*.js`) implement one port against one platform, tagged `@implements`. `kixx/adapters/cloudflare/key-value-store/` implements the key/value port over Cloudflare KV; `kixx/adapters/node/key-value-store/` over SQLite. Neither knows the other exists.
- **Composition roots** are the generated registries. A target's registry is the only place that chooses which adapters are real. An entry point imports the registry for its platform.

Outside `adapters/`, no module imports an adapter. Adapters are reached only through a registry or an entry point.

**`LoggerWriter` and `ServerRequest` skip the lifecycle.** They have no lifecycle module; core's manifest names their modules and the registry exports the classes.

- The **logger writer** is needed to build the `Logger`, which is needed to build the `ApplicationContext`. It exists before any service is registered.
- The **server request** is built per request from the native request, so it's a value, not a long-lived service.

Everything with a process lifetime goes through a lifecycle module.

**`ServerRequest` adapters extend `kixx/http-router/base-server-request.js`.** The `Headers`/`URL` half of the contract is the same everywhere and lives in the base class. An adapter supplies only `id`, `ip`, `method` (uppercase), `url`, `headers`, and a body delegate. Never re-implement an inherited member: fix the base class so every platform gets the fix.

### Where Platform Differences Live

Adapters for one port differ mainly in *when* they resolve their backing resource. Every read and write method takes `context` first, whether or not an adapter needs it, to allow for this.

**Node.js resolves at registration, from config.** Paths are fixed for the process, so `register()` resolves them once and asserts loudly if config is missing:

```js
export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.KEY_VALUE_STORE;
    assertNonEmptyString(
        storeConfig?.path,
        'node-key-value-store plugin requires context.config.env.KEY_VALUE_STORE.path',
    );
    // (resolveFilepath assertions omitted)
    const storePath = config.resolveFilepath(storeConfig.path);

    context.registerService('KeyValueStore', new KeyValueStore({
        logger,
        path: storePath,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
```

**Cloudflare resolves per request, from bindings.** A binding may differ from the module-level `env` captured at startup, so the module registers an unconfigured store, and the adapter reads its binding off `context.env` on every call:

```js
export function register(context) {
    context.registerService('KeyValueStore', new KeyValueStore());
}
```

That is why `createRequestContext(env, request)` takes the environment as an argument. The Worker passes the per-request environment from `fetch()`; the Node.js server passes the `env` it merged at startup.

### Writing a Contract

Interface files are the most important documents here.

- **Define the portable floor, not the union.** A contract is the intersection of what every current and plausible backing store can honor. `KeyValueStoreInterface` is scoped to memcached, redis, and Cloudflare KV so no method becomes unimplementable later. Its `delete()` resolves `undefined`, not a boolean, because Cloudflare KV can't report whether the key existed. A Node adapter could; it must not, or callers stop being portable.
- **Promise the weakest guarantee any adapter keeps.** The key/value port promises no read-after-write consistency, because Cloudflare KV is eventually consistent. Node callers get more in practice and must not rely on it.
- **Surface platform limits; don't hide them.** The Cloudflare KV adapter rejects TTLs under 60 seconds and keys over 512 bytes instead of clamping. A hidden limit turns a loud, immediate failure into a production surprise on one runtime. An adapter may enforce its store's limits; it may not fake capabilities.
- **Keep signatures uniform.** Node adapters accept `context` for interface compatibility even though they resolved their path at registration.

### Adding a New Port

1. Write the contract as `<name>-interface.js`, beside its consumer. Document the logical model, invariants, the context pass-through rule, construction requirements, and *why* each capability is or isn't included. Add `@see` links to the adapters once they exist.
2. Implement one adapter per platform: `adapters/<platform>/<name>/lib/<name>.js`, tagged `@implements`.
3. Add `adapters/<platform>/<name>/plugin.js` exporting `register()`, plus `initialize()` only if it consumes other services.
4. In the manifest, list each lifecycle module under `adapters.<platform>.lifecycle`, the service under `services`, its config section under `config.keys` with defaults per target, and any Cloudflare resource. Then regenerate.
5. Assert the config in `register()` with a message naming the exact config path.
6. If it holds a resource that must be released (a database handle), give it `close()`.
7. Give the port a conformance suite, and run it against every adapter (see "Shared Conformance Suites" in `test/README.md`).

Don't add a port for something the app can do portably. A port needs a real platform difference.

### Adding a New Platform

A new target needs:

1. An adapter per port, plus logger-writer and server-request adapters. Start the server request from the base class and interface, not a copy of a sibling adapter.
2. A core server module under `kixx/adapters/<platform>/server/`, and an entry point that is a thin shell over it.
3. A target in the manifest schema (`adapters.<platform>` and `config.defaults.<platform>`), and a registry for it from the generator.
4. A `<platform>-config.jsonc` config file.

Nothing in `app/`, `templates/`, or `pages/` should change. If a platform forces a change in `app/`, a port is missing or a contract promised more than the portable floor.

## The Legacy Map

Six v6 adapter packages are not plugins yet: the document store engine, the object store, and the job queue, each for Node.js and Cloudflare. They wait in `reference-app/plugins/`, listed by `reference-app/plugins/node.js` and `reference-app/plugins/cloudflare.js`. Nothing loads those two files.

When a package becomes a plugin with a manifest, delete its entry. Delete each file when it is empty.
