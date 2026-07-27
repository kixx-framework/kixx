import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../../kixx/errors/mod.js';
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

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500). Validate the
    // segments as the client sent them so the error message echoes the request.
    const pathname = validatePathname(`/${ segments.join('/') }`);

    // Page reads fold the URL pathname to lower case (normalizePagePathname() in
    // hyperview-request-handlers.js) so a page resolves to one key whether the
    // deploy target's store is case-sensitive or not. Writes must fold to the
    // same key: without this, a page published with any upper case character is
    // stored where no request can read it (a silent 404 on Cloudflare KV or
    // Linux), while a case-insensitive dev filesystem hides the bug entirely.
    // Folding before the caller builds its URN also keeps case variants from
    // addressing one stored page under several authorization URNs.
    return pathname.toLowerCase();
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

    // HyperviewService.#normalizeTemplateId() folds every template id to lower
    // case on reads *and* writes, so the stored key never carries the case the
    // client sent. Storage is therefore already consistent without this fold; what
    // it fixes is the handler's report. The response id and filepath are built
    // from this return value, so folding here is what keeps them naming the key
    // that was actually written instead of the raw URL wildcard.
    return filepath.toLowerCase();
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

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500). Validate the
    // segments as the client sent them so the error message echoes the request.
    validatePathname(segments.join('/'));

    // Only the directory segments fold to lower case. They become the page
    // pathname, which Hyperview lower-cases on every read, so an unfolded write
    // is unreadable — see getWildcardPathname() above. The filename must keep its
    // case: reads resolve it verbatim from the owning page's
    // `includes[name].filename` metadata value (HyperviewService.getIncludes),
    // so folding it here would store the file under a name the metadata that
    // references it never names.
    const filename = segments[segments.length - 1];
    const pathnameSegments = segments.slice(0, -1).map((segment) => segment.toLowerCase());

    return {
        // Recombine from the folded segments so the authorization URN and the
        // response id both describe the key that actually gets written.
        filepath: pathnameSegments.concat(filename).join('/'),
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
