/**
 * Streams a static file descriptor through a ServerResponse.
 *
 * Centralizing this behavior keeps the request handler focused on lookup and
 * fallback logic while one place owns ETag, caching, and conditional request
 * handling for static assets.
 *
 * @param {Object} options
 * @param {Object} options.file - Static file descriptor returned by HyperviewStaticFileServerStore#getFile()
 * @param {Object} options.request - Server request object with conditional request helpers
 * @param {Object} options.response - Server response object to populate
 * @param {Object} options.logger - Logger used for debug/info messages
 * @param {string} [options.pathname] - Request pathname used for logging
 * @param {boolean} [options.useEtag=false] - Whether to compute and emit an ETag
 * @param {string} [options.cacheControl] - Cache-Control header value to emit when present
 * @returns {Promise<*>} Response returned by the configured response method
 */
export async function respondWithStaticFile({ file, request, response, logger, pathname, useEtag = false, cacheControl }) {
    let etag;
    if (useEtag) {
        etag = await file.computeHash();
        response.headers.set('etag', `"${ etag }"`);
    }

    response.headers.set('last-modified', file.modifiedDate.toUTCString());

    if (cacheControl) {
        response.headers.set('cache-control', cacheControl);
    }

    const { ifNoneMatch, ifModifiedSince } = request;

    if (useEtag && ifNoneMatch && ifNoneMatch === etag) {
        logger.debug('resource not modified; etag match', { etag });
        return response.respond(304);
    }

    if (ifModifiedSince && file.modifiedDate <= ifModifiedSince) {
        logger.debug('resource not modified; not modified since', { ifModifiedSince });
        return response.respond(304);
    }

    logger.info('stream static file', { pathname, sizeBytes: file.sizeBytes });

    const contentType = file.contentType || 'application/octet-stream';
    response.headers.set('content-type', contentType);

    let bodyStream = null;
    if (!request.isHeadRequest()) {
        bodyStream = file.createReadStream();
    }

    return response.respondWithStream(200, bodyStream, {
        contentLength: file.sizeBytes,
    });
}
