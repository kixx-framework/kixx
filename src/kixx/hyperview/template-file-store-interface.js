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
 * - `namespace` is optional on every read and write method, positioned as the
 *   second argument (after `context`). Callers pass `null` to opt out.
 * - A `null`, `undefined`, or empty-string `namespace` MUST be treated as "no
 *   namespace" — the flat, unprefixed addressing.
 * - When a non-empty `namespace` is provided it MUST be validated: a non-string
 *   value MUST be rejected, and a value containing `..` path segments MUST be
 *   rejected so a caller cannot escape the namespace.
 * - Read and write namespace symmetry is the caller's responsibility: a file
 *   written under one `namespace` is only visible to reads using the same
 *   `namespace`.
 *
 * ## Invariants
 * - Construction MUST accept an options object containing a `logger` and MUST
 *   throw when the logger is missing. Implementations create a child logger for
 *   their own diagnostics.
 * - A write `filepath` MUST be a non-empty string and MUST be rejected when it
 *   contains `..` path segments, so a client cannot escape its prefix.
 * - A write `source` MUST be a non-empty string.
 * - A leading slash on a `filepath` MUST be ignored when resolving the address,
 *   so `'/home.html'` and `'home.html'` address the same file.
 * - `getBaseTemplate()` and `getPageTemplate()` MUST resolve to `null` when the
 *   template does not exist, and otherwise to a `{ filepath, source }` whose
 *   `filepath` is the logical path with the `namespace` prefix stripped.
 * - The `put*()` methods MUST create or overwrite the file and resolve with the
 *   logical `{ filepath }` that was written (namespace prefix stripped).
 * - `getPartials()` MUST resolve to an array of `{ filepath, source }` for the
 *   files present under the `partials/` prefix for the given `namespace`, with
 *   logical filepaths (namespace prefix stripped). It MUST resolve to an empty
 *   array when none exist, MUST NOT return files from another prefix, and MUST
 *   NOT return files written under a different `namespace`. Listing order
 *   follows the backing store's natural listing order and is not otherwise
 *   guaranteed.
 *
 * ## Context pass-through
 * Every read and write method receives a request or execution `context` as its
 * first argument. The contract does not dictate how an implementation uses it:
 * the Cloudflare adapter resolves its KV binding from
 * `context.env.TEMPLATE_FILE_STORE` (a request-scoped binding), while a Node.js
 * or Deno adapter owns a long-lived filesystem handle and ignores `context`
 * entirely. Implementations MUST accept the argument regardless so callers can
 * stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see TemplateFileStore in ../../plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js for the Cloudflare KV implementation
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
 * @property {function(Object, (string|null), string, string): Promise<TemplateFileRef>} putPartial
 *   Creates or overwrites a partial template source file under the `partials/`
 *   prefix. Resolves with the logical filepath that was written.
 *
 * @property {function(Object, (string|null)): Promise<TemplateFile[]>} getPartials
 *   Retrieves all available partial templates from the `partials/` prefix for
 *   the given namespace. Resolves to an empty array when none exist.
 */
