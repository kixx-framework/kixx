import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    UnsupportedMediaTypeError,
} from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { putTemplate } from '../../../transaction-scripts/publishing/put-template.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


const TEMPLATE_CONTENT_TYPE = 'text/plain';


export const putBaseTemplate = createPutTemplateHandler('base');
export const putPageTemplate = createPutTemplateHandler('page');
export const putPartialTemplate = createPutTemplateHandler('partial');


function createPutTemplateHandler(kind) {
    return async (context, request, response) => {
        assertTemplateContentType(request);

        // Authorization already ran in requireTemplatePermission (route head).

        // buildId is validated downstream by putTemplate(), which is the single
        // authority that enforces it (required, and must differ from the current build).
        const buildId = request.headers.get(BUILD_ID_HEADER);
        const filepath = getWildcardFilepath(request, 'filepath');

        const source = await request.text();
        await putTemplate(context, {
            kind,
            filepath,
            source,
            buildId,
        });

        // Report the kind-relative filepath derived from the URL wildcard, not
        // the store's logical key. The template file store returns a
        // prefix-included key (e.g. `base/website.html`) because that is how
        // Hyperview resolves template names internally, but the publishing API
        // contract already encodes the kind in the URL path, so the response
        // filepath must stay prefix-less (e.g. `website.html`).

        // This target's chain has no Hyperview handler after it, so the committed
        // JSON response is terminal without skip(). Returning normally lets any
        // route outbound middleware (e.g. response formatting) still run.
        return response.respondWithJSON(
            200,
            jsonApiResource({
                type: 'Template',
                id: filepath,
                attributes: {
                    kind,
                    filepath,
                    buildId,
                },
            }),
            { contentType: JSON_API_CONTENT_TYPE },
        );
    };
}

function assertTemplateContentType(request) {
    const contentType = request.getContentMediaType();

    if (contentType !== TEMPLATE_CONTENT_TYPE) {
        throw new UnsupportedMediaTypeError(
            'Template writes require a text/plain Content-Type.',
            { accept: [ TEMPLATE_CONTENT_TYPE ] },
        );
    }
}

function getWildcardFilepath(request, name) {
    const segments = request.pathnameParams[name];

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError('Template filepath is required.', {
            code: 'TemplateFilepathRequired',
        });
    }

    // A wildcard route param splits on '/', so a leading, doubled, or trailing
    // slash in the URL surfaces as an empty segment. The two template file store
    // adapters then disagree: the Node store's path.join() absorbs the empty
    // segment and files the template correctly, while the Cloudflare store uses
    // the logical key as the KV key verbatim, so `base/site.html/` is written
    // where no read will ever look. Reject the variant at the edge instead, so
    // one template has exactly one addressable URL on every deploy target.
    if (segments.some((segment) => !isNonEmptyString(segment))) {
        throw new BadRequestError('Template filepath must not contain empty path segments.', {
            code: 'EmptyPathSegment',
        });
    }

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500). Validate the
    // segments as the client sent them so the error message echoes the request.
    return validatePathname(segments.join('/'));
}
