import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../../kixx/errors/mod.js';
import { normalizeIdentifier } from '../../../../kixx/hyperview/canonical-identifiers.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


const TEMPLATE_FILEPATH_OPTIONS = {
    label: 'Template filepath',
    requiredCode: 'TemplateFilepathRequired',
};


/**
 * Normalizes the optional wildcard page pathname param shared by the pages
 * authorization resolver and request handler, so the URN that gets
 * authorized always describes the pathname the handler writes.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @returns {string} Canonical (lower case), traversal-checked pathname; '/' when absent.
 * @throws {BadRequestError} When the pathname contains an empty segment.
 * @throws {BadRequestError} When the pathname contains traversal or out-of-whitelist characters.
 */
export function getWildcardPathname(request, name) {
    const segments = request.pathnameParams[name];

    // The optional `{/*pathname}` route group omits the param entirely for the
    // site root, so an absent or empty wildcard means the root page ('/') rather
    // than a malformed request. Both `/pages` and `/pages/` land here, so the
    // root has no slash variant to reject below.
    if (!Array.isArray(segments) || segments.length === 0) {
        return '/';
    }

    rejectEmptyPathSegments(segments, 'Page pathname');

    // Validate before folding so errors report the client-supplied pathname.
    // The canonical result is shared by authorization and the write handler.
    return normalizeIdentifier(`/${ segments.join('/') }`);
}

/**
 * Normalizes a required wildcard filepath param for resources whose reads
 * resolve the stored key verbatim (static assets), so one resource has exactly
 * one addressable URL on every deploy target.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @param {object} options - Error reporting options.
 * @param {string} options.label - Sentence-leading name of the param, used in error messages.
 * @param {string} options.requiredCode - BadRequestError code used when the param is missing.
 * @returns {string} Traversal-checked, case-preserving filepath.
 * @throws {BadRequestError} When the filepath is missing.
 * @throws {BadRequestError} When the filepath contains an empty segment.
 * @throws {BadRequestError} When the filepath contains traversal or out-of-whitelist characters.
 */
export function getWildcardFilepath(request, name, { label, requiredCode }) {
    const segments = request.pathnameParams[name];

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError(`${ label } is required.`, {
            code: requiredCode,
        });
    }

    // The two file store adapters disagree about empty segments: the Node store's
    // path.join() absorbs one and files the resource correctly, while the
    // Cloudflare store uses the logical key as the KV key verbatim, so
    // `base/site.html/` is written where no read will ever look.
    rejectEmptyPathSegments(segments, label);

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500). Validate the
    // segments as the client sent them so the error message echoes the request.
    //
    // The case is deliberately preserved: unlike page pathnames, static asset
    // reads resolve the key verbatim (StaticFileRequestHandler looks the URL
    // pathname up as sent), so folding here would store the file under a name no
    // read ever asks for. Template writes need the opposite and wrap this
    // function — see getWildcardTemplateFilepath() below.
    return validatePathname(segments.join('/'));
}

/**
 * Normalizes the required wildcard template filepath param shared by all three
 * template kinds, folding it to the lower case key the write actually lands on.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @returns {string} Canonical (lower case), traversal-checked filepath, without the store's kind prefix.
 * @throws {BadRequestError} When the filepath is missing.
 * @throws {BadRequestError} When the filepath contains an empty segment.
 * @throws {BadRequestError} When the filepath contains traversal or out-of-whitelist characters.
 */
export function getWildcardTemplateFilepath(request, name) {
    const filepath = getWildcardFilepath(request, name, TEMPLATE_FILEPATH_OPTIONS);

    // HyperviewService asserts that template identifiers are canonical, so the
    // publishing edge must fold before authorization reports or writes the key.
    return normalizeIdentifier(filepath);
}

/**
 * Normalizes the required wildcard include filepath param shared by the
 * includes authorization resolver and request handler, so the URN that gets
 * authorized always describes the filepath the handler writes.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {string} name - Pathname params key holding the wildcard segments.
 * @returns {{filepath: string, pathname: string, filename: string}} The canonical
 *   filepath, its parent directory pathname ('/' when at the root), and the filename.
 * @throws {BadRequestError} When the filepath is missing.
 * @throws {BadRequestError} When the filepath contains an empty segment.
 * @throws {BadRequestError} When the filepath contains traversal or out-of-whitelist characters.
 */
export function splitIncludeFilepath(request, name) {
    const segments = request.pathnameParams[name];

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError('Include filepath is required.', {
            code: 'IncludeFilepathRequired',
        });
    }

    // A trailing slash would otherwise make the last segment the filename, and
    // an empty filename only fails downstream in HyperviewService, where it is an
    // invariant violation (AssertionError -> 500) rather than the client error it
    // actually is.
    rejectEmptyPathSegments(segments, 'Include filepath');

    const filepath = normalizeIdentifier(segments.join('/'));
    const canonicalSegments = filepath.split('/');
    const filename = canonicalSegments[canonicalSegments.length - 1];
    const pathnameSegments = canonicalSegments.slice(0, -1);

    return {
        filepath,
        pathname: pathnameSegments.length > 0 ? `/${ pathnameSegments.join('/') }` : '/',
        filename,
    };
}

// A wildcard route param splits on '/', so a leading, doubled, or trailing slash
// in the URL surfaces as an empty segment. Those variants address the same
// stored file as the slash-free form, because joinPageFilepath() strips a
// trailing slash — which would let one resource be written under two different
// authorization URNs, and a deny grant naming the canonical URN would not match
// the aliased one. Reject the variant rather than collapsing it, so each
// resource has exactly one addressable URL. validatePathname() already rejects a
// doubled slash on the same reasoning.
function rejectEmptyPathSegments(segments, label) {
    if (segments.some((segment) => !isNonEmptyString(segment))) {
        throw new BadRequestError(`${ label } must not contain empty path segments.`, {
            code: 'EmptyPathSegment',
        });
    }
}
