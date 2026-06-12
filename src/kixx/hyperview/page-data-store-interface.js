/**
 * PageDataStoreInterface — the contract for the Hyperview page data store. The
 * implementation will change based on the platform (Cloudflare KV, Node.js
 * filesystem, Deno, AWS Lambda object storage, etc.) but the interface should
 * remain consistent so that `HyperviewService` and deploy tooling stay
 * runtime-agnostic.
 *
 * The store persists a page's assets — `page.json` data files and the text
 * files those pages include (HTML, Markdown, page templates) — and exposes a
 * read path (consumed by the runtime serving requests) and a write path
 * (consumed by deploy tooling that publishes a build's page assets).
 *
 * ## Logical addressing
 *
 * The contract is defined in terms of *logical* addresses, not a storage
 * encoding. An adapter maps these onto whatever its backing store uses — KV
 * keys, filesystem paths, object-store keys — but callers only ever see logical
 * filepaths.
 *
 * - Unlike the template store, page data files are *not* grouped under fixed
 *   logical prefixes. A filepath is the page-relative path of the asset (e.g.
 *   `blog/2026/post/page.json`, `blog/2026/post/body.md`).
 * - An optional `namespace` isolates a whole build: when present, files are
 *   addressed as `{namespace}/{filepath}`; when absent, files are addressed at
 *   the flat, unprefixed `{filepath}`. The namespace lets multiple build
 *   versions coexist in one backing store and keeps deployments idempotent;
 *   omitting it supports callers who overwrite previous builds in place rather
 *   than versioning them.
 * - Callers always pass and receive logical filepaths. The `namespace` prefix is
 *   applied on write and stripped on read by the adapter; it never appears in a
 *   returned filepath.
 * - A returned filepath is the logical key with any leading slash removed (see
 *   Invariants), so `'/page.json'` is returned as `'page.json'`.
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
 * ## JSON vs. text
 * The store distinguishes JSON assets from plain text assets:
 * - The `*JSONFile*` methods own (de)serialization. `putJSONFile()` accepts a
 *   JSON-serializable value and persists its serialized text; `getJSONFiles()`
 *   resolves to the parsed value under the `json` property.
 * - The `*TextFile*` methods read and write raw source text under the `source`
 *   property without interpreting it.
 *
 * ## Batch reads and positional alignment
 * `getJSONFiles()` and `getTextFiles()` accept an array of filepaths and MUST
 * resolve to an array of the same length, aligned by index with the input: each
 * present file appears at its input position and each missing file is `null` at
 * its position. An empty input array MUST resolve to an empty array. This
 * positional alignment is the load-bearing invariant — callers rely on it to
 * match results back to the filepaths they requested.
 *
 * The contract places no limit on the number of filepaths, but a specific
 * adapter's backing store may cap a single batch (for example, Cloudflare KV's
 * bulk get supports at most 100 keys per call). Callers that may exceed an
 * adapter's cap are responsible for splitting the request.
 *
 * ## Invariants
 * - Construction MUST accept an options object containing a `logger` and MUST
 *   throw when the logger is missing. Implementations create a child logger for
 *   their own diagnostics.
 * - A write `filepath` MUST be a non-empty string and MUST be rejected when it
 *   contains `..` path segments, so a client cannot escape the namespace.
 * - `putJSONFile()` `json` MUST be a non-null object.
 * - `putTextFile()` `source` MUST be a non-empty string.
 * - A leading slash on a `filepath` MUST be ignored when resolving the address,
 *   so `'/page.json'` and `'page.json'` address the same file.
 * - `getJSONFiles()` MUST resolve to a positional array of `{ filepath, json }`
 *   (or `null` per missing index), where `filepath` is the logical path with the
 *   `namespace` prefix stripped and `json` is the parsed value.
 * - `getTextFiles()` MUST resolve to a positional array of `{ filepath, source }`
 *   (or `null` per missing index), where `filepath` is the logical path with the
 *   `namespace` prefix stripped.
 * - `getTextFile()` MUST resolve to the raw `source` *string* when the file
 *   exists, and to `null` when it does not. Note the deliberate asymmetry with
 *   the batch readers: the single-file reader returns a bare string, not a
 *   `{ filepath, source }` object.
 * - The `put*()` methods MUST create or overwrite the file and resolve with the
 *   logical `{ filepath }` that was written (namespace prefix stripped).
 *
 * ## Context pass-through
 * Every read and write method receives a request or execution `context` as its
 * first argument. The contract does not dictate how an implementation uses it:
 * the Cloudflare adapter resolves its KV binding from
 * `context.env.PAGE_DATA_STORE` (a request-scoped binding), while a Node.js or
 * Deno adapter owns a long-lived filesystem handle and ignores `context`
 * entirely. Implementations MUST accept the argument regardless so callers can
 * stay runtime-agnostic.
 *
 * ## Runtime adapters
 * Runtime adapters are implemented separately by design, because their backing
 * stores and access models differ.
 * @see PageDataStore in ../../plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js for the Cloudflare KV implementation
 */

/**
 * A parsed JSON data file with its logical filepath.
 *
 * @typedef {Object} JSONDataFile
 * @property {string} filepath - Logical filepath, with the namespace prefix and
 *   any leading slash stripped (e.g. `blog/2026/post/page.json`).
 * @property {Object} json - The parsed JSON value.
 */

/**
 * A text source file with its logical filepath.
 *
 * @typedef {Object} TextDataFile
 * @property {string} filepath - Logical filepath, with the namespace prefix and
 *   any leading slash stripped (e.g. `blog/2026/post/body.md`).
 * @property {string} source - The file's source text.
 */

/**
 * A reference to a written page data file.
 *
 * @typedef {Object} PageDataFileRef
 * @property {string} filepath - Logical filepath that was written, with the
 *   namespace prefix and any leading slash stripped.
 */

/**
 * Hyperview page data store.
 *
 * @typedef {Object} PageDataStoreInterface
 *
 * @property {function(Object, (string|null), string[]): Promise<(JSONDataFile|null)[]>} getJSONFiles
 *   Fetches JSON files by filepath, returning a positional array aligned with the
 *   input filepaths. Each missing file is `null` at its index. Resolves to an
 *   empty array for empty input.
 *
 * @property {function(Object, (string|null), string[]): Promise<(TextDataFile|null)[]>} getTextFiles
 *   Fetches text files by filepath, returning a positional array aligned with the
 *   input filepaths. Each missing file is `null` at its index. Resolves to an
 *   empty array for empty input.
 *
 * @property {function(Object, (string|null), string): Promise<(string|null)>} getTextFile
 *   Fetches a single text file by filepath. Resolves to the raw source string, or
 *   `null` when the file does not exist.
 *
 * @property {function(Object, (string|null), string, Object): Promise<PageDataFileRef>} putJSONFile
 *   Creates or overwrites a JSON data file, serializing the non-null `json`
 *   object to text for storage. Resolves with the logical filepath that was
 *   written.
 *
 * @property {function(Object, (string|null), string, string): Promise<PageDataFileRef>} putTextFile
 *   Creates or overwrites a text data file from the non-empty `source` string.
 *   Resolves with the logical filepath that was written.
 */
