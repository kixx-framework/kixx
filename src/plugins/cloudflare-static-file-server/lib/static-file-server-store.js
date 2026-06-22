import { assert } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

// Synthetic origin for the Request handed to the ASSETS binding. The binding
// matches assets by URL pathname only, so the host is irrelevant; a reserved
// `.invalid` host makes clear the origin is never dialed.
const SYNTHETIC_ORIGIN = 'https://assets.invalid';

/**
 * Cloudflare Workers Static Assets-backed static file server store.
 *
 * The Cloudflare port of the static file server contract. Where the Node.js adapter
 * owns a filesystem directory, this adapter resolves the request-scoped Static
 * Assets binding from `context.env.ASSETS` on each call and delegates to it.
 * Cloudflare uploads Static Assets at deploy time and serves them immutably, which
 * is why the contract has no write methods.
 *
 * `read()` asks the binding for the asset and returns its `Response` unchanged —
 * Cloudflare already sets `Content-Type` and `Content-Length` — except that a
 * binding `404` is normalized to `null` so callers handle a miss through the
 * framework's own not-found path.
 *
 * @implements {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileServerStoreInterface}
 * @see StaticFileServerStore in ../../node-static-file-server/lib/static-file-server-store.js for the Node.js filesystem implementation
 */
export default class StaticFileServerStore {

    #logger = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a StaticFileServerStore child logger
     * @throws {AssertionError} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'StaticFileServerStore requires a logger');
        this.#logger = logger.createChild('StaticFileServerStore');
    }

    /**
     * Reads one file by its public-root-relative pathname via the Static Assets binding.
     *
     * @param {RequestContext} context - Request context exposing the `ASSETS` binding at `context.env.ASSETS`
     * @param {string} pathname - File pathname relative to the public root, such as `css/main.css`
     * @returns {Promise<Response|null>} The Static Assets `Response` for the file, or `null` when the binding reports a 404
     */
    async read(context, pathname) {
        // The binding resolves an asset by the request URL pathname, so map the
        // root-relative pathname to an absolute-path Request against a synthetic
        // origin. Validated pathnames contain only filename-safe characters, so no
        // additional encoding is required.
        const request = new Request(new URL(`/${ pathname }`, SYNTHETIC_ORIGIN));

        const response = await context.env.ASSETS.fetch(request);

        // A 404 from the binding means the asset does not exist. Normalize it to
        // null so the caller renders the miss through the framework, rather than
        // forwarding Cloudflare's asset-404 body.
        if (response.status === 404) {
            this.#logger.debug('read() file not found', { pathname });
            return null;
        }

        return response;
    }
}
