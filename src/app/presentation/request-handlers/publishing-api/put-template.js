import {
    BadRequestError,
    UnsupportedMediaTypeError,
} from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { assertPublishingPermission } from '../../middleware/publishing-authentication.js';
import { putTemplate } from '../../../transaction-scripts/publishing/put-template.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


const TEMPLATE_CONTENT_TYPE = 'text/plain';


export const putBaseTemplate = createPutTemplateHandler('base');
export const putPageTemplate = createPutTemplateHandler('page');
export const putPartialTemplate = createPutTemplateHandler('partial');


function createPutTemplateHandler(kind) {
    return async (context, request, response) => {
        assertTemplateContentType(request);

        // buildId is read here to form the authorization resource URN and is
        // passed through to putTemplate(), which is the single authority that
        // validates it (required, and must differ from the current build).
        const buildId = request.headers.get(BUILD_ID_HEADER);
        const filepath = getWildcardFilepath(request, 'filepath');

        assertPublishingPermission(context, {
            action: 'urn:kixx:publishing:template:put',
            resource: `urn:kixx:publishing:template:${ kind }:${ buildId }:${ filepath }`,
        });

        const source = await request.text();
        const written = await putTemplate(context, {
            kind,
            filepath,
            source,
            buildId,
        });

        // This target's chain has no Hyperview handler after it, so the committed
        // JSON response is terminal without skip(). Returning normally lets any
        // route outbound middleware (e.g. response formatting) still run.
        return response.respondWithJSON(
            200,
            jsonApiResource({
                type: 'Template',
                id: written.filepath,
                attributes: {
                    kind,
                    filepath: written.filepath,
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

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500).
    return validatePathname(segments.join('/'));
}
