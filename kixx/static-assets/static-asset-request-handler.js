import { assert, isNonEmptyString } from '../assertions/mod.js';
import { isValidHash } from '../content-addressable-store/addressing.js';
import { BadRequestError, NotFoundError } from '../errors/mod.js';
import { getContentType } from './mime-types.js';

const REVALIDATING_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

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
 * Creates a handler for static assets published through the content-addressable
 * store.
 *
 * Fingerprinted handlers use the hash supplied by `/assets/:hash/*pathname` to
 * read a blob directly. Pathname handlers resolve the request pathname through
 * the current content snapshot, and can therefore defer a miss to a later page
 * handler in a catch-all route.
 * @param {Object} [options]
 * @param {boolean} [options.fingerprinted=false] - Read directly by the route hash
 * @param {string} [options.cacheControl] - Override the mode-specific cache policy
 * @param {string} [options.contentType] - Override extension-derived content type
 * @param {boolean} [options.throwNotFound=true] - Throw for a pathname-mode miss
 * @param {boolean} [options.skipWhenFound=false] - Skip later request handlers after finding an asset
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse, function): Promise<ServerResponse>} Request handler
 */
export default function StaticAssetRequestHandler(options) {
    const {
        fingerprinted = false,
        cacheControl = fingerprinted ? IMMUTABLE_CACHE_CONTROL : REVALIDATING_CACHE_CONTROL,
        contentType: contentTypeOverride,
        throwNotFound = true,
        skipWhenFound = false,
    } = options ?? {};

    return async function staticAssetRequestHandler(context, request, response, skip) {
        const store = context.getService('ContentAddressableStore');

        if (fingerprinted) {
            return await serveFingerprintedAsset({
                store,
                context,
                request,
                response,
                skip,
                cacheControl,
                contentTypeOverride,
                skipWhenFound,
            });
        }

        return await servePathnameAsset({
            store,
            context,
            request,
            response,
            skip,
            cacheControl,
            contentTypeOverride,
            throwNotFound,
            skipWhenFound,
        });
    };
}

async function serveFingerprintedAsset(args) {
    const {
        store,
        context,
        request,
        response,
        skip,
        cacheControl,
        contentTypeOverride,
        skipWhenFound,
    } = args;
    const { hash, pathname } = getFingerprintedLocation(store, request);
    const contentType = getResolvedContentType(pathname, contentTypeOverride);

    applyAssetHeaders(response, hash, cacheControl);

    if (request.ifNoneMatch === hash) {
        if (skipWhenFound) {
            skip();
        }
        return response.respondWithStream(304, null);
    }

    const stream = await store.getStaticAssetByHash(context, pathname, hash);
    if (!stream) {
        throw new NotFoundError(`Static asset not found: ${ request.url.pathname }`);
    }

    if (skipWhenFound) {
        skip();
    }

    if (request.isHeadRequest()) {
        await stream.cancel();
        return response.respondWithStream(200, null, { contentType });
    }

    return response.respondWithStream(200, stream, { contentType });
}

async function servePathnameAsset(args) {
    const {
        store,
        context,
        request,
        response,
        skip,
        cacheControl,
        contentTypeOverride,
        throwNotFound,
        skipWhenFound,
    } = args;
    const pathname = store.normalizePathname(request.url.pathname);

    if (pathname === '/' || !store.isValidPathname(pathname)) {
        return handleMiss(throwNotFound, request, response);
    }

    const snapshot = await store.openSnapshot(context);
    const stat = snapshot.statStaticAsset(pathname);

    if (!stat) {
        return handleMiss(throwNotFound, request, response);
    }

    const contentType = getResolvedContentType(pathname, contentTypeOverride);
    applyAssetHeaders(response, stat.hash, cacheControl);
    if (skipWhenFound) {
        skip();
    }

    if (request.ifNoneMatch === stat.hash) {
        return response.respondWithStream(304, null);
    }

    if (request.isHeadRequest()) {
        return response.respondWithStream(200, null, {
            contentType,
            contentLength: stat.size,
        });
    }

    const asset = await snapshot.getStaticAsset(context, pathname);
    assert(asset, `Static asset stat exists but read failed: ${ pathname }`);

    return response.respondWithStream(200, asset.stream, {
        contentType,
        contentLength: asset.size,
    });
}

function getFingerprintedLocation(store, request) {
    const { hash, pathname: pathnameParts } = request.pathnameParams;
    assert(isNonEmptyString(hash), 'Fingerprinted static asset route requires a hash pathname param');

    if (!isValidHash(hash)) {
        throw new BadRequestError(`Invalid static asset hash: ${ hash }`);
    }

    if (!Array.isArray(pathnameParts) || pathnameParts.length === 0) {
        throw new BadRequestError('Missing static asset pathname');
    }

    const pathname = `/${ pathnameParts.join('/') }`;
    if (!isNonEmptyString(pathname) || !pathnameParts.every(isNonEmptyString) || pathname === '/' || !store.isValidPathname(pathname)) {
        throw new BadRequestError(`Invalid static asset pathname: ${ pathname }`);
    }

    return { hash, pathname };
}

function getResolvedContentType(pathname, contentTypeOverride) {
    return isNonEmptyString(contentTypeOverride)
        ? contentTypeOverride
        : getContentType(pathname);
}

function applyAssetHeaders(response, hash, cacheControl) {
    response.setHeader('cache-control', cacheControl);
    response.setHeader('etag', `"${ hash }"`);
}

function handleMiss(throwNotFound, request, response) {
    if (throwNotFound) {
        throw new NotFoundError(`Static asset not found: ${ request.url.pathname }`);
    }
    return response;
}
