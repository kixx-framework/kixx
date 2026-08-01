/**
 * TemplateFileStoreInterface — the contract for the shared Hyperview template
 * store. The implementation will change based on the platform (Cloudflare KV,
 * Node.js filesystem, Deno, AWS Lambda object storage, etc.) but the interface
 * should remain consistent so that `HyperviewService` and deploy tooling stay
 * runtime-agnostic.
 *
 * The store persists template source files under three logical prefixes and
 * exposes a read path (consumed by the runtime serving requests) and a write
 * path (consumed by deploy tooling that publishes a build's templates).
 *
 * ## Logical addressing
 *
 * The contract is defined in terms of *logical* addresses, not a storage
 * encoding. An adapter maps these onto whatever its backing store uses — KV
 * keys, filesystem paths, object-store keys — but callers only ever see logical
 * filepaths.
 *
 * - Files live under one of three prefixes, selected by the method:
 *   `base/` (base templates), `pages/` (page templates), and `partials/`
 *   (shared partials).
 * - A page template `filepath` may be nested several segments deep, delimited
 *   by `/` (e.g. `pages/blog/posts/welcome.html`).
 * - An optional `namespace` isolates a whole build: when present, files are
 *   addressed as `{namespace}/{prefix}{filepath}`; when absent, files are
 *   addressed at the flat, unprefixed `{prefix}{filepath}`. The namespace lets
 *   multiple build versions coexist in one backing store and keeps deployments
 *   idempotent; omitting it supports callers who overwrite previous builds in
 *   place rather than versioning them.
 * - Callers always pass and receive logical filepaths (e.g.
 *   `base/home.html`). The `namespace` prefix is applied on write and
 *   stripped on read by the adapter; it never appears in a returned filepath.
 *
 * ## Namespace contract
 * - `namespace` is positioned as the second argument (after `context`) on
 *   every read and write method.
 * - `getBaseTemplate()`, `putBaseTemplate()`, `getPageTemplate()`,
 *   `putPageTemplate()`, and `getPartials()` treat `namespace` as optional:
 *   callers pass `null` to opt out, and a `null`, `undefined`, or
 *   empty-string `namespace` MUST be treated as "no namespace" — the flat,
 *   unprefixed addressing.
 * - `putPartials()` requires a non-empty `namespace`. There is no flat,
 *   unprefixed form of a partial-set write; every batch publishes to one
 *   build's namespace.
 * - When a non-empty `namespace` is provided (required or optional) it MUST
 *   be validated: a non-string value MUST be rejected, and a value
 *   containing `..` path segments MUST be rejected so a caller cannot escape
 *   the namespace.
 * - Read and write namespace symmetry is the caller's responsibility: a file
 *   written under one `namespace` is only visible to reads using the same
 *   `namespace`.
 *
 * ## Invariants
 * - Construction MUST accept an options object containing a `logger` and MUST
 *   throw when the logger is missing. Implementations create a child logger for
 *   their own diagnostics.
 * - Caller-supplied template filepaths arrive already validated and canonical
 *   (lower case). Adapters MUST NOT apply case folding or other identifier
 *   normalization; they only apply the namespace, fixed prefix, and
 *   leading-slash address mappings defined by this contract.
 * - A write `filepath` MUST be a non-empty string and MUST be rejected when it
 *   contains `..` path segments, so a client cannot escape its prefix.
 * - A write `source` MUST be a non-empty string.
 * - A leading slash on a `filepath` MUST be ignored when resolving the address,
 *   so `'/home.html'` and `'home.html'` address the same file.
 * - `getBaseTemplate()` and `getPageTemplate()` MUST resolve to `null` when the
 *   template does not exist, and otherwise to a `{ filepath, source }` whose
 *   `filepath` is the logical path with the `namespace` prefix stripped.
 * - The `putBaseTemplate()` and `putPageTemplate()` methods MUST create or
 *   overwrite the file and resolve with the logical `{ filepath }` that was
 *   written (namespace prefix stripped).
 * - `putPartials(context, namespace, partials)` MUST replace the complete
 *   partial set for `namespace` in one call: every logical file present under
 *   `partials/` for that namespace after a successful call MUST be exactly
 *   the submitted set, and files previously published under that namespace
 *   but omitted from the submitted set MUST NOT remain readable. It MUST
 *   resolve to `{ filepath }[]` — logical, `partials/`-prefixed paths with the
 *   namespace prefix stripped — in the same order as the submitted `partials`
 *   array. An empty `partials` array is a valid input and MUST resolve to
 *   `[]`, and MUST still replace (clear) any previously published set for
 *   that namespace.
 * - `putPartials()` promises the exact replacement set only after successful
 *   resolution. It MUST NOT promise recovery of the previous set, or any
 *   particular intermediate state, after a failed or partial write; a caller
 *   whose write fails must retry or abandon the namespace. Concurrent
 *   `putPartials()` calls for the same `namespace` are outside this contract
 *   — implementations are not required to order them, and callers MUST
 *   serialize their own writes to one namespace.
 * - `getPartials()` MUST resolve to an array of `{ filepath, source }` for the
 *   files present under the `partials/` prefix for the given `namespace`, with
 *   logical filepaths (namespace prefix stripped). Listing order follows the
 *   backing store's natural listing order and is not otherwise guaranteed.
 *   With a non-empty `namespace`, a partial set that was never published by
 *   `putPartials()` for that namespace is an invariant failure (the namespace
 *   is expected to have been staged before it is read), while a namespace
 *   whose published set is explicitly empty MUST resolve to `[]`. With no
 *   `namespace`, an absent flat partial set MUST resolve to `[]`.
 *
 * ## Context pass-through
 * Every read and write method receives a request or execution `context` as its
 * first argument. Runtime adapters use that context according to their platform:
 * - Cloudflare adapters resolve their request-scoped KV binding from
 *   `context.env` on every call.
 * - Node.js adapters resolve the local filesystem root from
 *   `context.config.env.HYPERVIEW_TEMPLATE_FILE_STORE` via `context.config.resolveFilepath()`
 *   on first use, unless an explicit constructor override was supplied, then
 *   hold it fixed for the store's lifetime.
 *
 * Implementations MUST accept the argument so callers can stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see TemplateFileStore in ../../plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js for the Cloudflare KV implementation
 * @see TemplateFileStore in ../../plugins/node-hyperview-template-file-store/lib/template-file-store.js for the Node.js filesystem implementation
 */

/**
 * A template source file with its logical filepath.
 *
 * @typedef {Object} TemplateFile
 * @property {string} filepath - Logical filepath within the prefix, with the
 *   namespace prefix stripped (e.g. `base/home.html`).
 * @property {string} source - The file's source text.
 */

/**
 * A reference to a written template file.
 *
 * @typedef {Object} TemplateFileRef
 * @property {string} filepath - Logical filepath that was written, with the
 *   namespace prefix stripped.
 */

/**
 * Shared Hyperview template store.
 *
 * @typedef {Object} TemplateFileStoreInterface
 *
 * @property {function(Object, (string|null), string): Promise<TemplateFile|null>} getBaseTemplate
 *   Retrieves a base template source file from the `base/` prefix.
 *   Resolves to a `TemplateFile`, or `null` when the template does not exist.
 *
 * @property {function(Object, (string|null), string, string): Promise<TemplateFileRef>} putBaseTemplate
 *   Creates or overwrites a base template source file under the `base/`
 *   prefix. Resolves with the logical filepath that was written.
 *
 * @property {function(Object, (string|null), string): Promise<TemplateFile|null>} getPageTemplate
 *   Retrieves a page template source file from the `pages/` prefix. The
 *   `filepath` may be nested several segments deep, delimited by `/`. Resolves
 *   to a `TemplateFile`, or `null` when the template does not exist.
 *
 * @property {function(Object, (string|null), string, string): Promise<TemplateFileRef>} putPageTemplate
 *   Creates or overwrites a page template source file under the `pages/` prefix.
 *   The `filepath` may be nested several segments deep, delimited by `/`.
 *   Resolves with the logical filepath that was written.
 *
 * @property {function(Object, string, PartialInput[]): Promise<TemplateFileRef[]>} putPartials
 *   Replaces the complete partial template set under the `partials/` prefix
 *   for the required, non-empty `namespace`. Resolves with the logical,
 *   `partials/`-prefixed filepaths that were written, in submitted order. An
 *   empty input replaces the set with an empty set and resolves to `[]`.
 *
 * @property {function(Object, (string|null)): Promise<TemplateFile[]>} getPartials
 *   Retrieves all available partial templates from the `partials/` prefix for
 *   the given namespace. With a namespace, resolves to `[]` only when that
 *   namespace's set was explicitly published empty; an unpublished namespace
 *   is an invariant failure. Without a namespace, resolves to `[]` when none
 *   exist.
 */

/**
 * A partial template source file submitted for batch publication.
 *
 * @typedef {Object} PartialInput
 * @property {string} filepath - Logical filepath relative to `partials/`
 *   (e.g. `nav.html` or `shared/nav.html`).
 * @property {string} source - The file's source text.
 */
