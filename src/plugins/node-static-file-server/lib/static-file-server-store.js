import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

import { getContentType } from '../../../kixx/static-file-server/mime-types.js';
import { assert, assertNonEmptyString } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

/**
 * Node.js filesystem-backed static file server store.
 *
 * The Node.js port of the static file server contract. Where the Cloudflare adapter
 * resolves a Static Assets binding from each request `context`, this adapter owns a
 * long-lived public root `directory` supplied at construction, maps a logical
 * pathname onto a real filesystem path, and ignores the `context` argument
 * entirely.
 *
 * `read()` returns a Web `Response` whose body streams the file from disk, with a
 * `Content-Type` derived from the file extension and a byte-accurate
 * `Content-Length` taken from the file size. Missing files, directories, and any
 * path that resolves outside the public root resolve to `null`.
 *
 * @implements {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileServerStoreInterface}
 * @see StaticFileServerStore in ../../cloudflare-static-file-server/lib/static-file-server-store.js for the Cloudflare Workers implementation
 */
export default class StaticFileServerStore {

    #logger = null;
    #rootDirectory = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a StaticFileServerStore child logger
     * @param {string} options.directory - Filesystem directory that roots the public files
     * @throws {AssertionError} When logger or directory is not provided
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assert(logger, 'StaticFileServerStore requires a logger');
        assertNonEmptyString(directory, 'StaticFileServerStore requires a directory');
        this.#logger = logger.createChild('StaticFileServerStore');
        // Resolve the root to an absolute path once so the per-request traversal
        // guard can compare resolved paths against a stable boundary.
        this.#rootDirectory = path.resolve(directory);
    }

    /**
     * Reads one file by its public-root-relative pathname.
     *
     * @param {RequestContext} _context - Ignored; present for StaticFileServerStoreInterface compatibility
     * @param {string} pathname - File pathname relative to the public root, such as `css/main.css`
     * @returns {Promise<Response|null>} A 200 `Response` with the file body, `Content-Type`, and byte-accurate `Content-Length`, or `null` when no file exists
     */
    async read(_context, pathname) {
        const resolvedPath = path.resolve(this.#rootDirectory, pathname);

        // Defense in depth: even though callers validate the pathname, refuse to
        // serve anything that resolves outside the public root. A path is in-root
        // only if it equals the root or sits beneath it past a separator.
        if (resolvedPath !== this.#rootDirectory
            && !resolvedPath.startsWith(this.#rootDirectory + path.sep)) {
            this.#logger.debug('read() rejected path outside public root', { pathname });
            return null;
        }

        let stats;
        try {
            stats = await fsp.stat(resolvedPath);
        } catch (cause) {
            // A missing file, or a path segment that is not a directory, is an
            // ordinary "not found" — every other stat failure is a real fault and
            // is left to propagate.
            if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') {
                this.#logger.debug('read() file not found', { pathname });
                return null;
            }
            throw cause;
        }

        // Only regular files are served; directories and special files are misses.
        if (!stats.isFile()) {
            this.#logger.debug('read() path is not a file', { pathname });
            return null;
        }

        const contentType = getContentType(pathname);

        // Stream the file rather than buffering it so large assets do not load
        // fully into memory. Readable.toWeb adapts the Node stream to the Web
        // ReadableStream body that a Response requires.
        const body = Readable.toWeb(fs.createReadStream(resolvedPath));

        return new Response(body, {
            status: 200,
            headers: {
                'content-type': contentType,
                // Content-Length is the file's byte size from stat, so the value is
                // exact even for multi-byte file contents.
                'content-length': String(stats.size),
            },
        });
    }
}
