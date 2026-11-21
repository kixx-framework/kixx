# Plugins

This directory holds the **adapters** in Kixx's ports-and-adapters architecture: the layer that runs one application codebase on Node.js and Cloudflare Workers today, and on Deno, Deno Deploy, and AWS Lambda later, with little or no change to `app/`.

**Application code never names a platform.** It asks for a capability by name and gets whatever implements it on the current runtime:

```js
// Identical on Node.js and Cloudflare Workers.
const cache = context.getService('KeyValueStore');
```

## The Three Roles

- **Ports** (`kixx/**/*-interface.js`) are contracts: JSDoc-only modules with no executable code. They live beside the framework component that consumes them, because the consumer owns the contract.
- **Adapters** (`plugins/*/lib/*.js`) implement one port against one platform, tagged `@implements`. `plugins/cloudflare-key-value-store/` implements the key/value port over Cloudflare KV; `plugins/node-key-value-store/` over SQLite. Neither knows the other exists.
- **Composition roots** (`node-server.js`, `cloudflare-server.js`) are the only place that chooses which adapters are real, by importing `plugins/node.js` or `plugins/cloudflare.js` and merging it with `plugins/general.js`.

Both entry points then call `bootApplication({ env, config, LoggerWriter, plugins, app })` (`kixx/context/boot-application.js`). It builds the `AppRuntime`, `Logger`, and `ApplicationContext`, runs every plugin's `register()` before any `initialize()`, then `app.register()` and `app.initialize()`, then finalizes the logger. It imports nothing from `app/`, `plugins/`, or a native module. Router construction, request/response translation, and shutdown stay in each entry point, because they differ per platform.

On Node.js, `node-environment.js` reads the dotenv pair, merges it with `process.env`, and builds the `resolveFilepath` passed to `readConfig()`. It doesn't start a server, so a tool can boot the app in-process with the same logic.

The job queue shows a fuller split. All queue semantics live once in `kixx/jobs/` over a synchronous SQL executor (port: `kixx/jobs/job-queue-interface.js`). `plugins/node-job-queue` supplies a `DatabaseSync` executor and an in-process loop. `plugins/cloudflare-job-queue` supplies a SQLite-backed Durable Object (`JobQueueStore`, run from `alarm()`) and a Worker-side service that calls it over RPC. The runtime, not the app, constructs a Durable Object, so it reads its registry, logger, and job-context factory from a process-local host the plugin fills during `register()`. The plugin never imports `app/`.

### Package layout

Each package is self-contained: `plugin.js` is the lifecycle module, and `lib/` holds the implementation. Only the package's own `plugin.js` imports its `lib/`, except for the two packages below.

**`LoggerWriter` and `ServerRequest` skip the registry.** They have no `plugin.js`; entry points import their `lib/` directly. That's a lifecycle choice:

- The **logger writer** is needed to build the `Logger`, which is needed to build the `ApplicationContext`. It exists before the registry does.
- The **server request** is built per request from the native request, so it's a value, not a long-lived service.

Everything with a process lifetime goes through the registry.

**`ServerRequest` adapters extend `kixx/http-router/base-server-request.js`.** The `Headers`/`URL` half of the contract is the same everywhere and lives in the base class. An adapter supplies only `id`, `ip`, `method` (uppercase), `url`, `headers`, and a body delegate. Never re-implement an inherited member: fix the base class so every platform gets the fix.

### General plugins

Some plugins use the plugin lifecycle without platform-specific logic. `plugins/general.js` registers `contentAddressableStore`, `hyperview`, and `mailer`. The Hyperview content model (the `/pages` and `/templates` namespace, resource reads and writes, manifest validation) is framework-owned and platform-neutral.

## The Plugin Module Contract

A plugin exports up to two optional functions:

```js
// Construct the adapter and register it. Never call context.getService() here:
// other plugins may not be registered yet.
export function register(context) { }

// Wire dependencies between registered services. getService() is safe here.
export function initialize(context) { }
```

All `register()` calls run before any `initialize()`, so plugin order doesn't matter. `app.register()` and `app.initialize()` run after every plugin, so `app/app.js` can rely on all platform services when it registers Collections.

## Where Platform Differences Live

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

**Cloudflare resolves per request, from bindings.** A binding may differ from the module-level `env` captured at startup, so the plugin registers an unconfigured store, and the adapter reads its binding off `context.env` on every call:

```js
export function register(context) {
    context.registerService('KeyValueStore', new KeyValueStore());
}
```

That is why `createRequestContext(env, request)` takes the environment as an argument. `cloudflare-server.js` passes the per-request `requestEnvironment` from `fetch()`; `node-server.js` passes the `env` it merged at startup.

## Writing a Contract

Interface files are the most important documents here.

- **Define the portable floor, not the union.** A contract is the intersection of what every current and plausible backing store can honor. `KeyValueStoreInterface` is scoped to memcached, redis, and Cloudflare KV so no method becomes unimplementable later. Its `delete()` resolves `undefined`, not a boolean, because Cloudflare KV can't report whether the key existed. A Node adapter could; it must not, or callers stop being portable.
- **Promise the weakest guarantee any adapter keeps.** The key/value port promises no read-after-write consistency, because Cloudflare KV is eventually consistent. Node callers get more in practice and must not rely on it.
- **Surface platform limits; don't hide them.** The Cloudflare KV adapter rejects TTLs under 60 seconds and keys over 512 bytes instead of clamping. A hidden limit turns a loud, immediate failure into a production surprise on one runtime. An adapter may enforce its store's limits; it may not fake capabilities.
- **Keep signatures uniform.** Node adapters accept `context` for interface compatibility even though they resolved their path at registration.

## Adding a New Port

1. Write the contract as `kixx/<component>/<name>-interface.js`, beside its consumer. Document the logical model, invariants, the context pass-through rule, construction requirements, and *why* each capability is or isn't included. Add `@see` links to the adapters once they exist.
2. Implement one adapter per platform: `plugins/<platform>-<name>/lib/<name>.js`, tagged `@implements`.
3. Add `plugins/<platform>-<name>/plugin.js` exporting `register()`, plus `initialize()` only if it consumes other services.
4. Add the package to each platform registry (`plugins/node.js`, `plugins/cloudflare.js`).
5. Add its config to `node-config.jsonc` and `cloudflare-config.jsonc`, and assert it in `register()` with a message naming the plugin and the exact config path.
6. If it holds a resource that must be released (a database handle), give it `close()`; `ApplicationContext#close()` calls it on graceful shutdown.

Don't add a port for something the app can do portably. A port needs a real platform difference.

## Adding a New Platform

A new target needs:

1. An adapter per port, plus logger-writer and server-request adapters. Start the server request from the base class and interface, not a copy of a sibling adapter.
2. A `plugins/<platform>.js` registry.
3. A `<platform>-config.jsonc` config file.
4. A `<platform>-server.js` entry point that reads config, merges `generalPlugins` with the platform registry, calls `bootApplication()` to get `{ appContext, logger }`, builds the `HttpRouter`, and translates native requests and responses to `ServerRequest`/`ServerResponse`.

Nothing in `app/`, `kixx/`, `templates/`, or `pages/` should change. If a platform forces a change in `app/`, a port is missing or a contract promised more than the portable floor.
