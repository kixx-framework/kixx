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
