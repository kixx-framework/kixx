import { BadRequestError } from '../../../../kixx/errors/mod.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


/**
 * Normalizes the optional wildcard page pathname param shared by the pages
 * authorization resolver and request handler, so the URN that gets
 * authorized always describes the pathname the handler writes.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @returns {string} Normalized, traversal-checked pathname; '/' when absent.
 * @throws {BadRequestError} When the pathname contains traversal or out-of-whitelist characters.
 */
export function getWildcardPathname(request, name) {
    const segments = request.pathnameParams[name];

    // The optional `{/*pathname}` route group omits the param entirely for the
    // site root, so an absent or empty wildcard means the root page ('/') rather
    // than a malformed request.
    if (!Array.isArray(segments) || segments.length === 0) {
        return '/';
    }

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500).
    return validatePathname(`/${ segments.join('/') }`);
}

/**
 * Normalizes the required wildcard include filepath param shared by the
 * includes authorization resolver and request handler, so the URN that gets
 * authorized always describes the filepath the handler writes.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @returns {{filepath: string, pathname: string, filename: string}} The full
 *   filepath, its parent directory pathname ('/' when at the root), and the filename.
 * @throws {BadRequestError} When the filepath is missing.
 * @throws {BadRequestError} When the filepath contains traversal or out-of-whitelist characters.
 */
export function splitIncludeFilepath(request, name) {
    const segments = request.pathnameParams[name];

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError('Include filepath is required.', {
            code: 'IncludeFilepathRequired',
        });
    }

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500).
    const filepath = validatePathname(segments.join('/'));
    const filename = segments[segments.length - 1];
    const pathnameSegments = segments.slice(0, -1);

    return {
        filepath,
        pathname: pathnameSegments.length > 0 ? `/${ pathnameSegments.join('/') }` : '/',
        filename,
    };
}
