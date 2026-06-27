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
import { putInclude as putIncludeScript } from '../../../transaction-scripts/publishing/put-include.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


export async function putPageInclude(context, request, response, skip) {
    assertTextContentType(request);

    const buildId = request.headers.get(BUILD_ID_HEADER);
    const { filepath, pathname, filename } = splitIncludeFilepath(request, 'filepath');

    assertPublishingPermission(context, {
        action: 'urn:kixx:publishing:include:put',
        resource: `urn:kixx:publishing:include:${ buildId ?? 'current' }:${ filepath }`,
    });

    const source = await request.text();
    const written = await putIncludeScript(context, {
        pathname,
        filename,
        source,
        buildId,
    });

    skip();
    return response.respondWithJSON(
        200,
        jsonApiResource({
            type: 'Include',
            id: filepath,
            attributes: {
                pathname,
                filename,
                buildId: written.buildId,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}

function assertTextContentType(request) {
    const contentType = request.getContentMediaType();

    if (!contentType.startsWith('text/')) {
        throw new UnsupportedMediaTypeError(
            'Include writes require a text/* Content-Type.',
            { accept: [ 'text/*' ] },
        );
    }
}

function splitIncludeFilepath(request, name) {
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
