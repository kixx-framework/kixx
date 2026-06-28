import { getContentType } from '../../../kixx/static-file-server/mime-types.js';
import { assert, assertNonEmptyString, isNonEmptyString, isNumberNotNaN, isValidDate } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileResult} StaticFileResult
 */

const DEFAULT_BINDING_NAME = 'STATIC_FILE_STORE';

/**
 * Cloudflare Workers KV-backed static file store.
 *
 * The Cloudflare port of the static file store contract. Where the Node.js adapter
 * owns a filesystem directory, this adapter resolves a dedicated, request-scoped KV
 * binding from `context.env` on each call. The binding is separate from the
 * application's general-purpose key/value cache so static assets do not share a
 * keyspace or eviction profile with cache data.
 *
 * Kixx build tooling uploads each build's files to KV under the Build ID namespace,
 * storing the raw bytes as the value and `{ etag, contentType, contentLength }` as
 * KV metadata. Because the bytes and a strong validator are precomputed at deploy
 * time, the Worker never reads or hashes a file to serve it; `read()` returns the
 * stored metadata directly and ignores `computeEtag`. Cloudflare KV values are
 * capped at 25 MiB, which bounds the per-asset size this store can serve.
 *
 * @implements {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileStoreInterface}
 * @see StaticFileStore in ../../node-static-file-server/lib/static-file-server-store.js for the Node.js filesystem implementation
 */
export default class StaticFileStore {

    #logger = null;
    #bindingName = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a StaticFileStore child logger
     * @param {string} [options.bindingName] - Name of the dedicated KV binding on `context.env`; defaults to `STATIC_FILE_STORE`
     * @throws {AssertionError} When logger is not provided
     */
    constructor(options) {
        const { logger, bindingName } = options ?? {};
        assert(logger, 'StaticFileStore requires a logger');
        this.#logger = logger.createChild('StaticFileStore');
        this.#bindingName = isNonEmptyString(bindingName) ? bindingName : DEFAULT_BINDING_NAME;
    }

    /**
     * Reads one file by its key within a Build ID namespace from the KV binding.
     *
     * @param {RequestContext} context - Request context exposing the dedicated KV binding on `context.env`
     * @param {Object} options - Lookup options
     * @param {string} options.key - File key relative to the namespace root, such as `css/main.css`
     * @param {string|null} options.namespace - Build ID namespace the file was deployed under
     * @returns {Promise<StaticFileResult|null>} The file parts, or `null` when the key is absent
     */
    async read(context, options) {
        const { key, namespace } = options ?? {};
        assertNonEmptyString(key, 'StaticFileStore read requires a key');

        const binding = context.env[this.#bindingName];
        assert(binding, `StaticFileStore KV binding "${ this.#bindingName }" is not bound on context.env`);

        // Files are stored under their Build ID namespace so a deployment swaps the
        // whole asset set atomically. A null namespace (no Build ID) reads the bare
        // key, but Cloudflare deployments always namespace by Build ID.
        const kvKey = isNonEmptyString(namespace) ? `${ namespace }/${ key }` : key;

        // Read the bytes as an ArrayBuffer (bounded by KV's 25 MiB value cap) so the
        // exact Content-Length is known even when build tooling omitted it from
        // metadata. Metadata carries the precomputed etag and content type.
        const { value, metadata } = await binding.getWithMetadata(kvKey, { type: 'arrayBuffer' });

        if (value === null || value === undefined) {
            this.#logger.debug('read() file not found', { key, namespace });
            return null;
        }

        const meta = metadata ?? {};
        const contentLength = isNumberNotNaN(meta.contentLength) ? meta.contentLength : value.byteLength;

        return {
            body: bytesToStream(value),
            // Content type is chosen at build time; fall back to extension-based
            // detection only if tooling omitted it.
            contentType: isNonEmptyString(meta.contentType) ? meta.contentType : getContentType(key),
            contentLength,
            etag: isNonEmptyString(meta.etag) ? meta.etag : null,
            lastModified: parseLastModified(meta.lastModified),
        };
    }
}

function parseLastModified(value) {
    // Build tooling stores Last-Modified as an ISO string in KV metadata; KV
    // provides no intrinsic per-value timestamp. Null out anything missing or
    // unparseable so the handler simply omits the header.
    if (!isNonEmptyString(value)) {
        return null;
    }

    const parsed = new Date(value);
    return isValidDate(parsed) ? parsed : null;
}

function bytesToStream(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}
