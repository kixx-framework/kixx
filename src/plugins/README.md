# Plugins

This directory holds the **adapters** in the Kixx ports-and-adapters architecture. It is the layer that makes one application codebase run on Node.js, Cloudflare Workers, and — as they are added — Deno, Deno Deploy, and AWS Lambda, with little or no change to the code in `app/`.

The rule this architecture enforces: **application code never names a platform.** It asks for a capability by name and gets back whatever implements that capability on the runtime it happens to be running on.

```js
// This line is identical on Node.js and Cloudflare Workers.
const cache = context.getService('KeyValueStore');
```

## The Three Roles

Cross-platform capability comes from separating three concerns that are commonly tangled together.

**Ports** — `kixx/**/*-interface.js`

A port is a contract, written as a JSDoc-only module with no executable code. It defines what the framework core needs from the outside world without saying how any platform provides it. Ports live next to the framework component that consumes them, not here, because the *consumer* owns the contract. `HyperviewService` owns the shape of the template store it reads from; the Cloudflare KV adapter does not get a vote.

**Adapters** — `plugins/*/lib/*.js`

An adapter is a concrete class implementing one port against one platform's API. `plugins/cloudflare-key-value-store/lib/key-value-store.js` implements the key/value port over a Cloudflare KV binding; `plugins/node-key-value-store/lib/key-value-store.js` implements the same port over SQLite. Neither knows the other exists. Each is marked with `@implements` pointing back at its port.

**Composition root** — `node-server.js`, `cloudflare-server.js`

The entry point is the only place in the system that decides which set of adapters is real. This is the seam. Everything platform-specific collapses into one import:

```js
// node-server.js
import nodePlugins from './plugins/node.js';

// cloudflare-server.js
import cloudflarePlugins from './plugins/cloudflare.js';
```

After that import, both entry points run identical registration logic, hand the same `ApplicationContext` to the same `HttpRouter`, and serve the same `app/`.

Each adapter package is self-contained: `plugin.js` is the lifecycle module the entry point calls, and `lib/` holds the implementation. Nothing outside a package imports its `lib/` directly except its own `plugin.js` and, occasionally, the entry point for direct-construction adapters which are described below.

`Hyperview` is the one service registered by a *general* plugin. It is pure framework logic that reads through the two Hyperview store ports, so it needs no platform variant of its own.

### Adapters That Skip the Registry

`LoggerWriter` and `ServerRequest` have adapter packages but no `plugin.js`, and both entry points import their `lib/` module directly. This is deliberate, and the reason is lifecycle, not inconsistency:

- The **logger writer** is needed to construct the `Logger`, which is needed to construct the `ApplicationContext` — it exists before there is a registry to register into.
- The **server request** is constructed fresh per request from a platform-native request object (`nativeRequest` on Workers, `nodeRequest` on Node), so it is a per-request value, not a long-lived service.

Everything with a process lifetime goes through the registry. Everything that predates or outlives a single registry lookup does not.

## The Plugin Module Contract

A plugin module exports up to two named functions. Both are optional:

```js
/**
 * Construct the adapter and put it in the registry.
 * Must NOT call context.getService() — other plugins may not be registered yet.
 */
export function register(context) { }

/**
 * Wire up dependencies between already-registered services.
 * Safe to call context.getService() here.
 */
export function initialize(context) { }
```

### Why Two Phases

The entry point runs **every** plugin's `register()` before **any** plugin's `initialize()`; this makes registry order irrelevant.

```js
for (const plugin of plugins.values()) {
    if (isFunction(plugin?.register)) {
        plugin.register(appContext);
    }
}

for (const plugin of plugins.values()) {
    if (isFunction(plugin?.initialize)) {
        plugin.initialize(appContext);
    }
}
```

The application's own `app.register()` and `app.initialize()` run after all plugins, so `app/app.js` can rely on every platform service being present when it registers its Collections.

## The Plugin Registries

Three small modules map a plugin name to its module:

```js
// plugins/general.js
const generalPlugins = new Map([
    [ 'hyperview', hyperview ],
]);

// plugins/node.js
const nodePlugins = new Map([
    [ 'nodeKeyValueStore', nodeKeyValueStore ],
    // ...
]);
```

The entry point merges them, and the merge direction is the extension point:

```js
// Merge plugin maps, allowing platform plugins to override general plugins.
const plugins = new Map([ ...generalPlugins, ...nodePlugins ]);
```

This structure allows a platform registry to replace a general plugin by reusing its key. This is helpful to add a capability that is portable in general and needs a special case on one runtime.

## Where Platform Differences Actually Live

Two adapters implementing the same port differ mainly in *when* and *how* they resolve their backing resource. The port's "context pass-through" rule is what accommodates this: every read and write method takes a `context` first argument, whether or not a given adapter needs it.

**Node.js resolves at registration time, from config.** Local resources are filesystem paths, fixed for the process lifetime, so the plugin resolves them once during `register()` and asserts loudly if config is missing:

```js
export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.KEY_VALUE_STORE;
    assertNonEmptyString(
        storeConfig?.path,
        'node-key-value-store plugin requires context.config.env.KEY_VALUE_STORE.path',
    );

    const storePath = config.resolveFilepath(storeConfig.path);

    context.registerService('KeyValueStore', new KeyValueStore({
        logger,
        path: storePath,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
```

**Cloudflare resolves at request time, from bindings.** A Workers binding is request-scoped and may differ from the module-level `env` captured at startup, so the plugin registers a store that carries nothing but a logger, and the adapter reads its binding off `context.env` on every call:

```js
export function register(context) {
    const { logger } = context;
    context.registerService('KeyValueStore', new KeyValueStore({ logger }));
}
```

This is why `createRequestContext(env, request)` takes the environment as an argument rather than inheriting it: `cloudflare-server.js` passes the per-request `requestEnvironment` from `fetch()`, while `node-server.js` passes the process `env`. Same call, same downstream code, different resolution semantics.

## How the Contracts Are Written

The interface files are the most important documents in this architecture, and they follow a few rules worth understanding before writing a new one.

**Define the portable floor, not the union.** A contract is the *intersection* of what every current and plausible future backing store can honor. `KeyValueStoreInterface` is explicit that it is "deliberately scoped to the portable intersection of memcached, redis, and Cloudflare KV ... so that no method becomes unimplementable on a backing store that a later phase may add."

The clearest example is `delete()`, which resolves `undefined` rather than a boolean:

> The contract cannot report whether the key previously existed because Cloudflare KV's delete does not surface that information; promising a boolean would be a lie on that adapter.

A Node adapter *could* return that boolean. It must not, because the moment application code depends on it, the code stops being portable and the port has failed at its job.

**Promise the weakest guarantee any adapter can keep.** The key/value port makes no read-after-write consistency guarantee, because Cloudflare KV is eventually consistent. Callers on Node get stronger behavior in practice and must not rely on it.

**Surface platform constraints; do not paper over them.** The Cloudflare KV adapter rejects sub-60-second TTLs rather than silently clamping them, and rejects keys over 512 bytes. Hiding a limit converts a loud, immediate startup or request failure into a subtle production surprise on one runtime. An adapter *may* enforce its backing store's limits; it may not fake capabilities it lacks.

**Keep the signature uniform even when an adapter ignores an argument.** Node adapters accept `context` "for interface compatibility" though they resolved their path at registration. A uniform signature is what lets callers stay runtime-agnostic.

**State construction invariants.** Every store contract requires a `logger` at construction and must throw without one. Adapters call `logger.createChild('KeyValueStore')` so diagnostics identify their source.

## Adding a New Port

1. Write the contract as `src/kixx/<component>/<name>-interface.js`, beside the framework code that consumes it. Document the logical model, invariants, the context pass-through rule, construction requirements, and — critically — *why* each capability is or is not in the contract. Include `@see` links to the adapters once they exist.
2. Implement one adapter package per platform: `plugins/<platform>-<name>/lib/<name>.js`, tagged `@implements` with the port's typedef.
3. Add a `plugins/<platform>-<name>/plugin.js` exporting `register()` — and `initialize()` only if it consumes other services.
4. Register the package in each platform registry (`plugins/node.js`, `plugins/cloudflare.js`) under a descriptive key.
5. Add any config the adapter needs to `node-config.js` and `cloudflare-config.js`, and assert its presence in `register()` with a message naming the plugin and the exact config path.
6. If the adapter holds a resource that must be released (a database handle), give it a `close()` method — `ApplicationContext#close()` calls it during graceful shutdown.

Do not add a port for something the application can do portably on its own. A port is justified by a genuine platform difference.

## Adding a New Platform

The matrix above is the checklist. A new target — Deno, Deno Deploy, AWS Lambda — needs:

1. An adapter package per port, plus its logger-writer and server-request adapters.
2. A `plugins/<platform>.js` registry mapping each package.
3. A `<platform>-config.js` source config.
4. A `<platform>-server.js` entry point that reads config, builds the `Logger` with the platform writer, builds the `ApplicationContext`, merges `generalPlugins` with the platform registry, runs the two registration phases, calls `app.register()`/`app.initialize()`, finalizes the logger, constructs the `HttpRouter`, and translates between native requests/responses and `ServerRequest`/`ServerResponse`.

Nothing in `src/app/`, `src/kixx/`, `src/templates/`, or `src/pages/` should need to change. If a new platform forces a change in `app/`, that is the signal that a port is missing or that a contract promised more than the portable floor.

## Rules for Application Code

- Reach for platform capabilities through `context.getService(name)` and `context.getCollection(name)` — never by importing from `plugins/`.
- Never import a native platform module (`node:fs`, `cloudflare:workers`) anywhere under `src/app/`. Those imports belong only in adapter `lib/` modules and entry points.
- Depend on what the *port* promises, not on what your current adapter happens to do. If the contract says `delete()` resolves `undefined`, do not branch on a truthy result because SQLite could tell you more.
- When you need a capability no port covers, add the port — do not reach around the abstraction for the one runtime you are testing on today.
