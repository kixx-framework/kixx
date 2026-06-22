import { isNonEmptyString } from '../assertions/mod.js';

import validatePathname from './validate-pathname.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../http-router/server-request-interface.js').ServerRequestInterface} ServerRequestInterface
 */

/**
 * @typedef {import('../http-router/server-response.js').default} ServerResponse
 */


/**
 * Creates a request handler that serves files from the registered
 * `'StaticFileServerStore'` service.
 *
 * The handler derives the file pathname from the request URL pathname (with its
 * leading slash stripped, since the store adapters resolve paths relative to the
 * public root), validates it, reads the file through the store, and maps the
 * resulting Web `Response` onto the application `ServerResponse`. A `HEAD` request
 * returns the same headers with no body. A missing file raises `NotFoundError` so
 * the framework's not-found path renders the 404.
 *
 * @param {Object} [options]
 * @param {string} [options.pathname] - Override the pathname derived from the
 *   request URL, relative to the public root (no leading slash).
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse): Promise<ServerResponse>}
 *   Async request handler for the router pipeline.
 */
export function StaticFileServerHandler(options) {
    options = options ?? {};

    return async function staticFileServerHandler(context, request, response, skip) {
        const pathname = resolvePathname(request, options);

        // Reject traversal and unsafe characters before the path reaches the store.
        // The store adapters guard their own roots too, but failing fast here keeps
        // a malformed request from ever touching the filesystem or asset binding.
        validatePathname(pathname);

        const store = context.getService('StaticFileServerStore');
        const fileResponse = await store.read(context, pathname);

        if (!fileResponse) {
            // If the file does not exist, we defer the request to the next request handler.
            return response;
        }

        // Skip remaining handlers and middleware if the file was found.
        skip();

        const contentType = fileResponse.headers.get('content-type') ?? undefined;
        const contentLengthHeader = fileResponse.headers.get('content-length');
        const contentLength = contentLengthHeader === null
            ? undefined
            : Number(contentLengthHeader);

        // A HEAD response carries the same headers (including Content-Length) as the
        // GET, but no body. Cancel the file body so the opened stream/binding does
        // not leak, then respond with headers only.
        if (request.isHeadRequest()) {
            if (fileResponse.body) {
                await fileResponse.body.cancel();
            }
            return response.respondWithStream(fileResponse.status, null, { contentType, contentLength });
        }

        return response.respondWithStream(fileResponse.status, fileResponse.body, {
            contentType,
            contentLength,
        });
    };
}

function resolvePathname(request, options) {
    if (isNonEmptyString(options.pathname)) {
        return options.pathname;
    }

    // Strip the leading slash so the pathname is relative to the public root,
    // matching what the store adapters expect (e.g. "css/main.css"). The root
    // pathname "/" resolves to an empty string, which the store treats as no
    // file found.
    return request.url.pathname.replace(/^\//, '');
}
