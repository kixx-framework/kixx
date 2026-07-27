import PutPageMetadataForm from '../../forms/pages/put-page-metadata-form.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { getWildcardPathname } from './route-params.js';
import { putPageMetadata as putPageMetadataScript } from '../../../transaction-scripts/publishing/put-page-metadata.js';


/**
 * Writes a page's metadata document for a build.
 *
 * The write is namespaced by the `x-kixx-build-id` request header, so it lands in
 * the pending build rather than the live one. The pathname is folded to lower
 * case to match how page reads resolve it.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 200 response carrying the stored metadata.
 * @throws {UnsupportedMediaTypeError} When the request is not JSON:API.
 * @throws {BadRequestError} When the wildcard pathname is empty-segmented or contains traversal characters.
 * @throws {ValidationError} When the submitted metadata attributes are invalid.
 */
export async function putPageMetadata(context, request, response) {
    assertJsonApiContentType(request);

    const buildId = request.headers.get(BUILD_ID_HEADER);
    // Authorization already ran in requirePageMetadataPermission (route head)
    // using this same helper, so the URN that was authorized describes this
    // pathname.
    const pathname = getWildcardPathname(request, 'pathname');

    const resource = await parseJsonApiResource(request, 'PageMetadata');
    const form = PutPageMetadataForm.fromJsonApi(resource);

    form.validate();

    const metadata = form.toJSON();
    const written = await putPageMetadataScript(context, {
        pathname,
        metadata,
        buildId,
    });

    // This target's chain has no Hyperview handler after it, so the committed
    // JSON response is terminal without skip(). Returning normally lets any
    // route outbound middleware (e.g. response formatting) still run.
    return response.respondWithJSON(
        200,
        jsonApiResource({
            type: 'PageMetadata',
            id: pathname,
            attributes: metadata,
            meta: { buildId: written.buildId },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
