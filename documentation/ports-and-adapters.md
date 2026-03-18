# Ports and Adapters in Kixx

Kixx is structured around the **Ports and Adapters** pattern (also called Hexagonal Architecture). This is the Dependency Inversion Principle applied at the architectural level: the core framework depends only on abstractions (ports), never on concrete implementations (adapters). Adapters are swapped to support different deployment targets without touching any core code.

---

## The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│                         CORE                            │
│  Config  HttpRouter  ApplicationContext  HyperviewService│
│           middleware  request handlers                  │
└───────────────────────┬─────────────────────────────────┘
                        │ depends on
┌───────────────────────▼─────────────────────────────────┐
│                        PORTS                            │
│  ConfigStore  HttpRoutesStore  HyperviewPageStore  ...  │
│           (lib/ports/ — pure JSDoc, no runtime code)    │
└───────────────────────┬─────────────────────────────────┘
                        │ implemented by
┌───────────────────────▼─────────────────────────────────┐
│                      ADAPTERS                           │
│  JSModuleConfigStore  NodeFilesystem  NodeServer  ...   │
│  (lib/*-stores/, lib/node-*/, lib/hyperview/node-local/)│
└─────────────────────────────────────────────────────────┘
```

**Core** — the business logic. It knows about ports but is completely ignorant of platforms.

**Ports** — contracts (interfaces) that separate core from infrastructure. Defined in `lib/ports/` as pure JSDoc typedefs with behavioral invariants. No runtime code.

**Adapters** — concrete implementations of ports for specific platforms or sources. Each adapter is the only place that knows about `node:fs`, HTTP server APIs, or CMS clients.

---

## Directory Map

| Directory | Layer | Role |
|-----------|-------|------|
| `lib/config/` | Core | Config — subscribes to a ConfigStore, merges environment overrides |
| `lib/http/` | Core | ServerResponse — platform-agnostic HTTP response (Web API only) |
| `lib/http-router/` | Core | HttpRouter, HttpRoute, HttpTarget — routing logic |
| `lib/context/` | Core | ApplicationContext, RequestContext — DI container and request state |
| `lib/hyperview/` (top level) | Core | HyperviewService, request/error handlers |
| `lib/logger/` | Core | BaseLogger, DevLogger, ProdLogger — log formatting |
| `lib/ports/` | Ports | One file per port — the authoritative contracts |
| `lib/config-stores/` | Adapters | In-memory config sources for tests and embedded config |
| `lib/node-config-store/` | Adapters | Node.js JSONC config file adapter |
| `lib/http-routes-stores/` | Adapters | Route sources (currently: JS array in memory) |
| `lib/hyperview/node-local-store/` | Adapters | Page, template, and static file stores for local filesystem |
| `lib/node-filesystem/` | Adapters | Node.js `fs`/`fs/promises` implementation of the Filesystem port |
| `lib/node-http-server/` | Adapters | Node.js `http.Server` wrapper; `ServerRequest` (Node.js adapter) |
| `lib/bootstrap/` | Composition Root | NodeBootstrap — wires all adapters and core together for Node.js |

---

## Port Inventory

Each port is defined in `lib/ports/` with its full behavioral contract (not just method signatures).

| Port file | Used by | Current adapter(s) |
|-----------|---------|-------------------|
| `config-store.js` | `Config` | `NodeConfigStore`, `JSModuleConfigStore` |
| `http-routes-store.js` | `HttpRouter` | `JSModuleHttpRoutesStore` |
| `http-server-request.js` | `HttpRouter`, `HttpRoute`, middleware | `node-http-server/ServerRequest` (Node.js) |
| `http-server-response.js` | `HttpRouter`, middleware | `lib/http/ServerResponse` (all platforms — no adapter needed) |
| `hyperview-page-store.js` | `HyperviewService` | `node-local-store/PageStore` |
| `hyperview-template-store.js` | `HyperviewService` | `node-local-store/TemplateStore` |
| `hyperview-template-engine.js` | `HyperviewService` | `TemplateEngine` (Kixx Templating) |
| `hyperview-static-file-server-store.js` | `HyperviewService` | `node-local-store/StaticFileServerStore` |
| `plugin.js` | `NodeBootstrap` | `node-local-store/plugin` |
| `middleware.js` | `HttpTarget`, `HttpRoute` | Application-defined middleware functions |
| `filesystem.js` | `PageStore`, `TemplateStore`, `StaticFileServerStore` | `NodeFilesystem` (`node-filesystem/mod.js`) |

---

## Data Flow: Handling a Request

This traces a request through the layers to show where each boundary is crossed.

```
HTTP request arrives
        │
        ▼
  [ADAPTER] NodeServer (lib/node-http-server/)
  Wraps Node.js IncomingMessage → ServerRequest  (Node.js adapter; implements port)
  Creates ServerResponse                         (lib/http/ — core, no wrapping needed)
        │
        ▼
  [PORT] ServerRequest / ServerResponse (lib/ports/http-server-request.js, http-server-response.js)
  The boundary the router and middleware depend on; adapters are swapped here per platform
        │
        ▼
  [CORE] HttpRouter (lib/http-router/)
  Matches hostname and path to a VirtualHost → Route → Target
  Passes (RequestContext, ServerRequest, ServerResponse) to middleware chain
        │
        ▼
  [CORE] Middleware chain (application code + framework handlers)
  e.g. HyperviewRequestHandler calls HyperviewService
        │
        ▼
  [CORE] HyperviewService (lib/hyperview/)
  Orchestrates page rendering — calls ports to load data, templates, files
        │
        ├──── [PORT] HyperviewPageStore.getPageData()
        │         └── [ADAPTER] node-local-store/PageStore
        │                   └── [PORT] Filesystem.readJSONFile()
        │                           └── [ADAPTER] NodeFilesystem
        │
        ├──── [PORT] HyperviewTemplateStore.getBaseTemplate()
        │         └── [ADAPTER] node-local-store/TemplateStore
        │
        └──── [PORT] HyperviewTemplateEngine.compileTemplate()
                  └── [ADAPTER] TemplateEngine (Kixx Templating)
        │
        ▼
  Rendered HTML returned up the chain
        │
        ▼
  [ADAPTER] NodeServer writes response to Node.js socket
```

Notice that `HyperviewService` never touches `node:fs` directly. It only calls port methods. The filesystem adapter is two layers away, hidden behind two ports.

---

## How Dependency Injection Works

Kixx does not use a DI framework. Dependencies are injected by the **Composition Root** (`NodeBootstrap`) using plain constructor arguments.

```javascript
// lib/boostrap/node-bootstrap.js (simplified)

const config = new Config(new NodeConfigStore({ configFilepath, secretsFilepath, fileSystem }), env, appDir);

const router = new HttpRouter(new JSModuleHttpRoutesStore(vhostsConfig), appContext);

// Plugins inject their own adapters into the context
plugin.register(applicationContext);  // PageStore, TemplateStore, etc. registered here
plugin.initialize(applicationContext); // async setup
```

The core classes (`Config`, `HttpRouter`, `HyperviewService`) receive their adapters at construction time and never know which concrete class they received — only that it satisfies the port contract.

---

## Adding a New Adapter

To support a different config source, route source, page store, etc.:

1. **Read the port file** in `lib/ports/`. The invariants section documents behavioral requirements beyond the method signatures — pay special attention to these.

2. **Create the adapter** in a new directory (e.g., `lib/cloudflare-kv-config-store/`). Add a `@see` reference to the port in the class JSDoc.

3. **Run the conformance tests** from `test/conformance/`. Each port has a shared helper that verifies the behavioral contract:

   ```javascript
   // In your adapter's test file:
   import { testConfigStoreConformance } from '../../conformance/config-store.js';

   testConfigStoreConformance(() => new CloudflareKVConfigStore({ binding: mockKV }));
   ```

4. **Write adapter-specific tests** for anything the conformance helper doesn't cover (constructor validation, error handling, platform-specific behavior).

---

## Adding a New Platform Target

To support a new runtime (Cloudflare Workers, AWS Lambda, Deno, Bun):

1. **Create a new bootstrap module** (e.g., `lib/cloudflare-bootstrap/cloudflare-bootstrap.js`). It mirrors the shape of `NodeBootstrap` but wires in platform-specific adapters.

2. **Identify which adapters need replacing.** Typically:
   - `Filesystem` → platform-specific or not needed (Workers have no filesystem)
   - `ServerRequest` → replace with a platform-specific adapter (e.g. wrap the native
     Workers `Request` to add `id`, `hostnameParams`, `pathnameParams`, and Kixx helpers)
   - `NodeServer` → replace with the platform's request dispatch mechanism
   - `ServerResponse` → **no replacement needed**; `lib/http/ServerResponse` uses only
     Web APIs and works on all platforms unchanged
   - Config/route stores → replace if the platform needs different loading strategies

3. **Keep all core classes unchanged.** `Config`, `HttpRouter`, `HyperviewService`, etc. are platform-agnostic by design.

4. **Core never needs to change** when adding a platform — if it does, that's a sign the port contract needs updating, not the core logic.

## Public Entry Points

Kixx now exposes separate public module surfaces so applications can choose the
layer they want to depend on:

- `lib/core/mod.js` — framework core and platform-neutral utilities
- `lib/node/mod.js` — Node-specific adapters and bootstrap modules
- `lib/mod.js` — compatibility entry point that re-exports both surfaces

A hypothetical Cloudflare Workers setup would look like:

```
lib/
  cloudflare-bootstrap/          ← new composition root
    cloudflare-bootstrap.js
  cloudflare-http-server/        ← new adapter: wraps native Workers Request
    server-request.js            ← thin wrapper adding id, hostnameParams, etc.
  cloudflare-config-store/       ← new adapter: reads from CF env bindings
    cloudflare-config-store.js
  cloudflare-hyperview-store/    ← new adapter: reads pages from KV or R2
    page-store.js
    template-store.js
    static-file-server-store.js
    plugin.js
  http/
    server-response.js           ← unchanged; no Workers adapter needed
  # node-filesystem/ not needed
  # node-http-server/ not needed
  # Everything in lib/config/, lib/http-router/, lib/hyperview/ unchanged
```

---

## The Role of Conformance Tests

The conformance test helpers in `test/conformance/` are the mechanically-verified form of the port contracts. They are:

- **Not tied to any specific adapter** — the caller provides a factory function
- **Focused on invariants** — they test behavioral requirements (emit before resolve, return `[]` not `null`) not just that methods exist
- **Cheap to run on new adapters** — two lines added to any adapter test file covers the full contract

When you write a new adapter, add a conformance call to its test file. If the conformance tests pass, the adapter is guaranteed to work with the core classes that consume that port.
