import { isNonEmptyString } from '../assertions/mod.js';
import { BadRequestError, NotFoundError } from '../errors/mod.js';

import validatePathname from '../utils/validate-pathname.js';
import { NO_BUILD_ID_SEGMENT } from '../utils/build-id.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../http-router/server-request-interface.js').ServerRequestInterface} ServerRequestInterface
 */

/**
 * @typedef {import('../http-router/server-response.js').default} ServerResponse
 */


// Default validator policy: cache, but force the browser to revalidate freshness
// (via ETag/If-None-Match) before reusing the asset. Callers override per route
// for long-lived, fingerprinted assets.
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';


/**
 * Creates a request handler that serves files from the registered
 * `'StaticFileStore'` service.
 *
 * The handler derives the file key from the request URL pathname (query string and
 * hash excluded, leading slash stripped) and the namespace from the deployment
 * Build ID, reads the file through the store, and maps the resulting parts onto the
 * application `ServerResponse`. It applies `Cache-Control`, sets `ETag` when one is
 * available, answers `If-None-Match` with `304 Not Modified`, and returns a HEAD
 * response with headers only.
 *
 * @param {Object} [options]
 * @param {string} [options.contentType] - Force the `Content-Type` header instead
 *   of using the store's value. Takes precedence over the store and extension.
 * @param {string} [options.cacheControl] - Force the `Cache-Control` header.
 *   Defaults to `public, max-age=0, must-revalidate`.
 * @param {boolean} [options.computeEtag=true] - When the store has no precomputed
 *   ETag, compute one (Node.js hashes the file). Set `false` to skip ETag work.
 * @param {boolean} [options.throwNotFound=true] - Throw `NotFoundError` when the
 *   file is absent. Set `false` to defer to the next request handler instead.
 * @param {boolean} [options.skipWhenFound=false] - Skip the remaining request
 *   handlers on this route when a file is served.
 * @param {string} [options.pathname] - Override the URL pathname for every request,
 *   rewriting which file key is read from the store.
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse, function): Promise<ServerResponse>}
 *   Async request handler for the router pipeline.
 */
export function StaticFileRequestHandler(options) {
    options = options ?? {};

    const {
        contentType: contentTypeOverride,
        cacheControl = DEFAULT_CACHE_CONTROL,
        computeEtag = true,
        throwNotFound = true,
        skipWhenFound = false,
        pathname: pathnameOverride,
    } = options;

    return async function staticFileRequestHandler(context, request, response, skip) {
        const key = resolveKey(request, pathnameOverride);

        // An empty key (a request for "/") names no file. Treat it as a miss so the
        // root path can fall through to a page renderer in a catch-all route.
        if (!isNonEmptyString(key)) {
            return handleMiss(throwNotFound, request, response);
        }

        // Reject traversal and unsafe characters before the key reaches the store.
        // The store adapters guard their own roots too, but failing fast here keeps
        // a malformed request from ever touching the filesystem or KV binding.
        validatePathname(key);

        // Build ID namespaces the lookup so Atomic Deployments swap assets at once;
        // it is null for out-of-band deploys, which the store serves from its flat
        // root.
        const namespace = context.runtime.build?.id ?? null;

        const store = context.getService('StaticFileStore');
        const result = await store.read(context, { key, namespace, computeEtag });

        if (!result) {
            return handleMiss(throwNotFound, request, response);
        }

        // The file was found and is being served; stop later handlers when asked.
        if (skipWhenFound) {
            skip();
        }

        return respondWithStaticFile(request, response, result, {
            cacheControl,
            contentTypeOverride,
        });
    };
}

/**
 * Creates a request handler for immutable Build-ID-namespaced static assets.
 *
 * The handler reads both the namespace and file key from route pathname params,
 * so an asset URL can reach any Build ID that remains in the store rather than
 * only the runtime's current build. Its default cache policy permits browsers
 * and CDNs to keep a build asset for one year without revalidation.
 *
 * @param {Object} [options]
 * @param {string} [options.contentType] - Force the `Content-Type` header instead
 *   of using the store's value.
 * @param {string} [options.cacheControl] - Force the `Cache-Control` header.
 *   Defaults to `public, max-age=31536000, immutable`.
 * @param {boolean} [options.computeEtag=true] - When the store has no precomputed
 *   ETag, compute one. Set `false` to skip ETag work.
 * @param {string} [options.buildIdParam='build_id'] - Name of the pathname param
 *   carrying the Build ID namespace.
 * @param {string} [options.pathnameParam='pathname'] - Name of the wildcard
 *   pathname param carrying the file key segments.
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse): Promise<ServerResponse>}
 *   Async request handler for a dedicated static-asset route.
 * @throws {BadRequestError} When a required pathname param is absent or unsafe.
 * @throws {NotFoundError} When the requested asset is absent from the store.
 */
export function StaticAssetRequestHandler(options) {
    options = options ?? {};

    const {
        contentType: contentTypeOverride,
        cacheControl = IMMUTABLE_CACHE_CONTROL,
        computeEtag = true,
        buildIdParam = 'build_id',
        pathnameParam = 'pathname',
    } = options;

    return async function staticAssetRequestHandler(context, request, response) {
        const { namespace, key } = resolveAssetLocation(request, {
            buildIdParam,
            pathnameParam,
        });
        const store = context.getService('StaticFileStore');
        const result = await store.read(context, { key, namespace, computeEtag });

        if (!result) {
            throw new NotFoundError(`Static asset not found: ${ request.url.pathname }`);
        }

        return respondWithStaticFile(request, response, result, {
            cacheControl,
            contentTypeOverride,
        });
    };
}

function resolveKey(request, pathnameOverride) {
    const pathname = isNonEmptyString(pathnameOverride)
        ? pathnameOverride
        : request.url.pathname;

    // Keys are relative to the store root, so drop the leading slash (e.g.
    // "/css/main.css" -> "css/main.css"; "/" -> "").
    return pathname.replace(/^\//, '');
}

function handleMiss(throwNotFound, request, response) {
    if (throwNotFound) {
        throw new NotFoundError(`Static file not found: ${ request.url.pathname }`);
    }
    // Defer to the next request handler in the target chain.
    return response;
}

function resolveAssetLocation(request, options) {
    const { buildIdParam, pathnameParam } = options;
    const pathnameParams = request.pathnameParams;
    const buildId = pathnameParams?.[buildIdParam];
    const pathname = pathnameParams?.[pathnameParam];

    if (!isNonEmptyString(buildId)) {
        throw new BadRequestError(`Missing Build ID pathname param: ${ buildIdParam }`);
    }
    validatePathname(buildId);

    if (!Array.isArray(pathname) || pathname.length === 0) {
        throw new BadRequestError(`Missing asset pathname param: ${ pathnameParam }`);
    }

    const key = pathname.join('/');
    if (!isNonEmptyString(key)) {
        throw new BadRequestError(`Missing asset pathname param: ${ pathnameParam }`);
    }
    validatePathname(key);

    return {
        key,
        namespace: buildId === NO_BUILD_ID_SEGMENT ? null : buildId,
    };
}

async function respondWithStaticFile(request, response, result, options) {
    const { cacheControl, contentTypeOverride } = options;
    const contentType = isNonEmptyString(contentTypeOverride)
        ? contentTypeOverride
        : result.contentType;

    // Cache-Control and the validators apply to both the 200 and the 304 below.
    response.setHeader('cache-control', cacheControl);
    if (result.etag) {
        response.setHeader('etag', result.etag);
    }
    if (result.lastModified) {
        response.setHeader('last-modified', result.lastModified.toUTCString());
    }

    if (isNotModified(request, result)) {
        await cancelBody(result.body);
        // 304 carries validators but no body or body-describing headers.
        return response.respondWithStream(304, null);
    }

    // A HEAD response carries the same headers (including Content-Length) as the
    // GET, but no body. Cancel the file body so the opened stream/binding does
    // not leak, then respond with headers only.
    if (request.isHeadRequest()) {
        await cancelBody(result.body);
        return response.respondWithStream(200, null, { contentType, contentLength: result.contentLength });
    }

    return response.respondWithStream(200, result.body, {
        contentType,
        contentLength: result.contentLength,
    });
}

function isNotModified(request, result) {
    // Per RFC 9110 §13.2.2, If-None-Match takes precedence: when the client sends
    // it, If-Modified-Since is ignored entirely — even if the ETag does not match
    // (in which case we serve a fresh 200, not a date comparison).
    if (request.ifNoneMatch) {
        // request.ifNoneMatch arrives with surrounding quotes stripped, so compare
        // it against the unquoted form of our strong ETag.
        return Boolean(result.etag) && request.ifNoneMatch === unquoteEtag(result.etag);
    }

    if (result.lastModified && request.ifModifiedSince) {
        // HTTP dates are second-resolution; the Last-Modified we sent was truncated
        // to whole seconds by toUTCString(), so the echoed If-Modified-Since must be
        // compared at second granularity or a sub-second mtime would never match.
        return toEpochSeconds(result.lastModified) <= toEpochSeconds(request.ifModifiedSince);
    }

    return false;
}

function toEpochSeconds(date) {
    return Math.floor(date.getTime() / 1000);
}

function unquoteEtag(etag) {
    return etag.replace(/^"/, '').replace(/"$/, '');
}

async function cancelBody(body) {
    // A 304 or HEAD response sends no body; cancel the source stream so the
    // underlying file handle or KV binding stream is not left open.
    if (body) {
        await body.cancel();
    }
}
