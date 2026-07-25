import { UnsupportedMediaTypeError } from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { splitIncludeFilepath } from './route-params.js';
import { putInclude as putIncludeScript } from '../../../transaction-scripts/publishing/put-include.js';


export async function putPageInclude(context, request, response) {
    assertTextContentType(request);

    const buildId = request.headers.get(BUILD_ID_HEADER);
    // Authorization already ran in requireIncludePermission (route head)
    // using this same helper, so the URN that was authorized describes this
    // filepath.
    const { filepath, pathname, filename } = splitIncludeFilepath(request, 'filepath');

    const source = await request.text();
    const written = await putIncludeScript(context, {
        pathname,
        filename,
        source,
        buildId,
    });

    // This target's chain has no Hyperview handler after it, so the committed
    // JSON response is terminal without skip(). Returning normally lets any
    // route outbound middleware (e.g. response formatting) still run.
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
