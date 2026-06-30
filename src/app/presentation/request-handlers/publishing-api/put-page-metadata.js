import PutPageMetadataForm from '../../forms/pages/put-page-metadata-form.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { assertPublishingPermission } from '../../middleware/publishing-authentication.js';
import { putPageMetadata as putPageMetadataScript } from '../../../transaction-scripts/publishing/put-page-metadata.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


export async function putPageMetadata(context, request, response) {
    assertJsonApiContentType(request);

    const buildId = request.headers.get(BUILD_ID_HEADER);
    const pathname = getWildcardPathname(request, 'pathname');

    // Authorization is scoped per page pathname and is independent of the target
    // build, so it runs before the request body is parsed and validated — an
    // unauthorized token gets a 403 rather than body-parsing or validation errors.
    // A grant may use a '*' pathname (urn:kixx:publishing:page-metadata:*) to
    // authorize writes to any page.
    assertPublishingPermission(context, {
        action: 'urn:kixx:publishing:page-metadata:put',
        resource: `urn:kixx:publishing:page-metadata:${ pathname }`,
    });

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

function getWildcardPathname(request, name) {
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
