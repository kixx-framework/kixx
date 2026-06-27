import { BadRequestError } from '../../../../kixx/errors/mod.js';
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


export async function putPageMetadata(context, request, response, skip) {
    assertJsonApiContentType(request);

    const buildId = request.headers.get(BUILD_ID_HEADER);
    const pathname = getWildcardPathname(request, 'pathname');
    const resource = await parseJsonApiResource(request, 'PageMetadata');
    const form = PutPageMetadataForm.fromJsonApi(resource);

    form.validate();

    assertPublishingPermission(context, {
        action: 'urn:kixx:publishing:page-metadata:put',
        resource: `urn:kixx:publishing:page-metadata:${ buildId ?? 'current' }:${ pathname }`,
    });

    const metadata = form.toJSON();
    const written = await putPageMetadataScript(context, {
        pathname,
        metadata,
        buildId,
    });

    skip();
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

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError('Page pathname is required.', {
            code: 'PagePathnameRequired',
        });
    }

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500).
    return validatePathname(`/${ segments.join('/') }`);
}
