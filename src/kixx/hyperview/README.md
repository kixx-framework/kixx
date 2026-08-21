# Hyperview

This directory owns the complete Hyperview content model and the renderer built on top of it: the `/pages` and `/templates` pathname namespace, resource reads and writes, manifest validation and translation, request-scoped content snapshots, and page/JSON rendering. No platform vocabulary (Cloudflare, KV bindings, Durable Objects) appears anywhere here — see [Port and Adapter Ownership](#port-and-adapter-ownership) below for where that lives instead.

For the page-authoring model (what goes in `pages/**/page.json`, how metadata inherits, how base and page templates are selected), see [`src/app/presentation/README.md`](../../app/presentation/README.md#hyperview-file-layout). For the template syntax Hyperview compiles and renders, see [`src/templates/README.md`](../../templates/README.md).

## Two Services

Hyperview's framework surface is two services, registered and wired together by the general `hyperview` plugin ([`src/plugins/hyperview/plugin.js`](../../plugins/hyperview/plugin.js) — see also [`src/plugins/README.md`](../../plugins/README.md#general-plugins)):

- **`HyperviewContentService`** (registered as `HyperviewContent`) — owns the content model: pathname layout, resource stats and writes, request-scoped snapshots, and manifest validation/translation. Implemented entirely over the generic `ContentAddressableStoreInterface` port (see [Port and Adapter Ownership](#port-and-adapter-ownership)).
- **`HyperviewService`** (registered as `Hyperview`) — the renderer. Loads pages and templates through a `HyperviewContentService`-supplied snapshot, compiles and caches templates, assembles page context, and serves rendered HTML, rendered partials, or assembled JSON page context. Also owns the rendered-page cache, backed by a separate `KeyValueStore` service.

`HyperviewService` depends on `HyperviewContentService`; the dependency does not run the other way. Presentation code that only needs to read or write Hyperview content directly — the Publishing API, for example — depends on `HyperviewContentService` alone and never touches the renderer.

## Content Layout Vocabulary

[`content-layout.js`](content-layout.js) is the single owner of the Hyperview pathname namespace: the `/templates` and `/pages` roots, the reserved bundle filenames within them (`__base-templates-bundle`, `__template-partials-bundle`, `__page-partials-bundle`, `__page-includes-bundle`), the canonical pathname rule, and the stricter template-filepath rule.

Two related but different validity rules exist because they answer different
questions:

- **`isValidPathname(value)`** — the canonical page-path rule. Lowercase, slash-separated, no `..` or `//` segments, no segment starting with a dot, no character outside the filename-safe set. The empty string and the root page pathname `/` both satisfy this rule, because the root page is a real, addressable page.
- **`isValidTemplateFilepath(value)`** — everything `isValidPathname()` requires, plus: the value must name a non-root file. A page template can never resolve to the `/pages` namespace root, so `/` is valid as a page pathname but invalid as a template filepath. Reusing the page-path rule for template filepaths would let a client-supplied `/` map onto the `/pages` root node instead of a real file — see [`hyperview-content-service.js`](hyperview-content-service.js)'s manifest validation and [`src/app/presentation/request-handlers/publishing-api/mod.js`](../../app/presentation/request-handlers/publishing-api/mod.js)'s `template-filepath` path kind for where this distinction is load-bearing.

`content-layout.js` exposes only focused path constructors (`getBaseTemplatesPath()`, `getTemplatePartialsPath()`, `getPageMetadataPath(pathname)`, `getPagePartialsPath(pathname)`, `getPageIncludesPath(pathname)`, `getPageTemplatePath(filepath)`) rather than a generic "join under a namespace" helper, so no caller can assemble an arbitrary internal storage path — each constructor asserts its own path-kind precondition before returning a pathname.

## Snapshot Lifetime

**One snapshot per rendered response.** `HyperviewService#respondWithHypertext()` opens exactly one snapshot (`HyperviewContentService#openSnapshot(context)`) per call and threads it through every page, template, partial, and cache-etag read for that response. Do not retain a snapshot beyond the request that opened it, and do not open a second snapshot mid-render — doing so would let a page render against metadata from one build while its templates come from another.

`HyperviewContentService`'s six one-off `stat*(context, ...)` reads (used by the Publishing API, not the renderer) each open their own snapshot internally, since a single stat call has no cross-read consistency requirement to preserve.

## Publication Flow

Writes happen in two phases, matching how the generic content-addressable store separates blob storage from build visibility:

1. **Upload** — `HyperviewContentService`'s six `put*(context, args)` methods (`putTemplatePartials`, `putBaseTemplates`, `putPageMetadata`, `putPagePartials`, `putPageIncludes`, `putPageTemplate`) each persist one immutable blob and return a `{ hash, size, metadata }` descriptor. An uploaded blob is not yet visible to any build. A publishing client supplies `x-checksum` during this phase; its normative derivation is documented in the [`ContentAddressableStoreInterface`](../content-store/content-addressable-store-interface.js) external upload checksum wire format. JSON resources use canonical UTF-8 JSON, while page templates use their raw UTF-8 source.
2. **Commit** — `commitChanges(context, { buildId, manifest })` validates a complete manifest of previously uploaded descriptors, translates it into the flat pathname/hash/size file list the generic store's `commitChanges()` expects, and points a build at the resulting immutable closure. Resource groups omitted from the manifest are absent from the new closure entirely — they are not inherited from the previous one. `buildId` defaults to `context.runtime.build.id` only when omitted or `undefined`; an explicit `null` or otherwise invalid value is left for validation rather than silently falling back.

## Public Service Boundary

`HyperviewContentService`'s public contract — pathname helpers (`normalizePathname`, `isValidPathname`, `isValidTemplateFilepath`, `hashValue`), `openSnapshot`, the six `stat*`/`put*` pairs, and `commitChanges` — is documented in full JSDoc on the class itself ([`hyperview-content-service.js`](hyperview-content-service.js)). It accepts and returns only Hyperview vocabulary: pathnames, filepaths, bundles, and the manifest shape above. No generic JSON:API resource-type string, HTTP concept, or platform type crosses this boundary in either direction — that translation is presentation-layer work.

`HyperviewService`'s public surface (`respondWithHypertext` and the loader methods it composes) is documented on that class ([`hyperview-service.js`](hyperview-service.js)) and in [`src/app/presentation/README.md`](../../app/presentation/README.md).

## Port and Adapter Ownership

Everything under `src/kixx/hyperview/` is framework code and imports nothing from `src/plugins/`. It depends on one port, [`ContentAddressableStoreInterface`](../content-store/content-addressable-store-interface.js), for immutable blob storage, an immutable index, and content hashing — nothing about pages, templates, or bundles appears in that contract.
