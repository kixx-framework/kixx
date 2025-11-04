import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BadRequestError } from '../errors/mod.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';

import { isValidDate } from '../assertions/mod.js';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;

const NAMESPACE = 'Kixx.StaticFileServer';


/**
 * StaticFileServer
 * ================
 *
 * Returns a request handler function that serves static files from a public directory.
 *
 * @function StaticFileServer
 * @param {Object} [options={}] - Optional settings.
 * @param {string} [options.publicDirectory] - The directory to serve static files from.
 *   If not provided, defaults to the value of `context.paths.public_directory` at runtime.
 * @param {string} [options.cacheControl] - The Cache-Control header value to use.
 *   If not provided, defaults to the value of `config.cacheControl` (from the "Kixx.StaticFileServer" config namespace)
 *   or falls back to `'no-cache'` if not set in config.
 * @returns {Function} An async request handler function for serving static files.
 *
 * @example
 * // Uses defaults from context and config:
 * StaticFileServer();
 *
 * // Custom public directory and cache control:
 * StaticFileServer({
 *   publicDirectory: '/custom/public/path',
 *   cacheControl: 'public, max-age=3600'
 * });
 *
 * // Default config usage:
 * // - publicDirectory: context.paths.public_directory
 * // - cacheControl: config.cacheControl (from "Kixx.StaticFileServer" namespace) or 'no-cache'
 */
export default function StaticFileServer(options) {
    options = options || {};

    /**
     * Serves static files from a public directory.
     *
     * This handler validates the request path, checks for file existence, and serves the file
     * with appropriate headers. It supports conditional requests via the If-Modified-Since header
     * and sets cache-control and content-type headers. If the file is not found or is not a file,
     * the handler returns the response unchanged, allowing the next handler to process the request.
     *
     * @function staticFileServer
     * @async
     * @param {Object} context - The application context, containing config, logger, and paths.
     * @param {Object} request - The HTTP request object.
     * @param {Object} response - The HTTP response object.
     * @param {Function} skip - Function to skip remaining handlers after serving the file.
     * @returns {Promise<Object>} The HTTP response, possibly with a file stream.
     * @throws {BadRequestError} If the request path is invalid.
     */
    return async function staticFileServer(context, request, response, skip) {
        const config = context.config.getNamespace(NAMESPACE);
        const logger = context.logger.createChild(NAMESPACE);

        const { pathname } = request.url;
        const publicDirectory = options.publicDirectory || context.paths.public_directory;
        const cacheControl = options.cacheControl || config.cacheControl || 'no-cache';

        // Two dots or two slashes are always invalid
        if (pathname.includes('..') || pathname.includes('//')) {
            throw new BadRequestError(`Invalid static file path: ${ pathname }`);
        }

        const parts = pathname.split('/');

        for (const part of parts) {
            // In addition to the pattern list, a single dot at the start of
            // a path part is invalid.
            if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
                throw new BadRequestError(`Invalid static file path: ${ pathname }`);
            }
        }

        // The call to path.join() normalizes the directory strings, so we
        // don't need to remove slashes "/" from the baseDirectory.
        const filepath = path.join(publicDirectory, ...parts);

        let stat;
        try {
            stat = await fsp.stat(filepath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn('stat file failed', { filepath }, error);
            }
            return response;
        }

        if (!stat.isFile()) {
            logger.warn('expected file resource is not a file', { filepath });
            return response;
        }

        // At this point we know we will serve a static file instead of moving on
        // to the next handler.
        skip();

        const modifiedDate = stat.mtime;

        response.headers.set('last-modified', modifiedDate.toUTCString());

        if (cacheControl) {
            response.headers.set('cache-control', cacheControl);
        }

        // Check for a conditional request.
        const ifModifiedSince = request.headers.get('if-modified-since');

        if (ifModifiedSince) {
            const ifModifiedSinceDate = new Date(ifModifiedSince);

            if (isValidDate(ifModifiedSinceDate) && modifiedDate > ifModifiedSinceDate) {
                return response.respondNotModified();
            }
        }

        const extname = path.extname(filepath).replace(/^./, '');
        const contentType = getContentTypeForFileExtension(extname) || 'application/octet-stream';

        response.headers.set('content-type', contentType);

        if (request.isHeadRequest()) {
            return response.respondWithStream(200, stat.size, null);
        }

        const readStream = fs.createReadStream(filepath);
        return response.respondWithStream(200, stat.size, readStream);
    };
};
