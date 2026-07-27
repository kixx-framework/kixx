import { UnsupportedMediaTypeError } from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { getWildcardFilepath } from './route-params.js';
import { putTemplate } from '../../../transaction-scripts/publishing/put-template.js';


const TEMPLATE_CONTENT_TYPE = 'text/plain';

const TEMPLATE_FILEPATH_OPTIONS = {
    label: 'Template filepath',
    requiredCode: 'TemplateFilepathRequired',
};


/**
 * Writes a base template's source for a build.
 *
 * The three template kinds share one handler shape, differing only in the store
 * prefix the kind implies. The write is namespaced by the `x-kixx-build-id`
 * request header, so it lands in the pending build rather than the live one. The
 * response filepath is prefix-less, because the URL path already encodes the kind.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request; the body is the template source.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 200 response describing the written template.
 * @throws {UnsupportedMediaTypeError} When the request Content-Type is not `text/plain`.
 * @throws {BadRequestError} When the wildcard filepath is missing, empty-segmented, or contains traversal characters.
 */
export const putBaseTemplate = createPutTemplateHandler('base');

/**
 * Writes a page template's source for a build.
 * @see putBaseTemplate for the shared contract.
 */
export const putPageTemplate = createPutTemplateHandler('page');

/**
 * Writes a partial template's source for a build.
 * @see putBaseTemplate for the shared contract.
 */
export const putPartialTemplate = createPutTemplateHandler('partial');


function createPutTemplateHandler(kind) {
    return async (context, request, response) => {
        assertTemplateContentType(request);

        // Authorization already ran in requireTemplatePermission (route head).

        // buildId is validated downstream by putTemplate(), which is the single
        // authority that enforces it (required, and must differ from the current build).
        const buildId = request.headers.get(BUILD_ID_HEADER);
        const filepath = getWildcardFilepath(request, 'filepath', TEMPLATE_FILEPATH_OPTIONS);

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

