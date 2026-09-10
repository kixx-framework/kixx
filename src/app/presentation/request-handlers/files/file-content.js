import { NotFoundError, OperationalError } from '../../../../kixx/errors/mod.js';
import { getFile } from '../../../transaction-scripts/files/get-file.js';
import {
    getContentDisposition,
    getFileEtag,
    matchesIfNoneMatch,
} from '../../lib/file-response.js';

const READ_RETRY_LIMIT = 3;

/** Serves published file bytes from the stable public pathname. */
export async function getPublicFile(context, request, response) {
    const fileId = request.pathnameParams.fileId;
    let file = await getFile(context, fileId);

    if (!file?.isPublished) {
        return respondNotFound(response);
    }

    const etag = getFileEtag(file);
    if (matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
        return respondFile(response, request, file, null, 304, false);
    }

    for (let attempt = 0; attempt <= READ_RETRY_LIMIT; attempt += 1) {
        const object = await context.getCollection('FileContent').get(context, file.content.key);
        if (object) {
            return respondFile(response, request, file, object.body, 200, false);
        }

        const latest = await getFile(context, fileId);
        if (!latest?.isPublished) {
            return respondNotFound(response);
        }
        if (latest.content.key === file.content.key) {
            break;
        }
        file = latest;
    }

    throw new OperationalError(`Published file content is unavailable for "${ fileId }"`, {
        code: 'FileContentUnavailable',
    });
}

/** Serves authenticated admin downloads as private attachments. */
export async function getAdminFileDownload(context, request, response) {
    const file = await getFile(context, request.pathnameParams.fileId);
    if (!file) {
        throw new NotFoundError('File was not found', { code: 'FileNotFound' });
    }
    const object = await context.getCollection('FileContent').get(context, file.content.key);
    if (!object) {
        throw new OperationalError(`File content is unavailable for "${ file.id }"`, {
            code: 'FileContentUnavailable',
        });
    }
    return respondFile(response, request, file, object.body, 200, true);
}

function respondFile(response, request, file, body, status, forceAttachment) {
    const headers = {
        'cache-control': forceAttachment ? 'private, no-store' : 'public, no-cache',
        'content-disposition': getContentDisposition(file, forceAttachment),
        etag: getFileEtag(file),
        'x-content-type-options': 'nosniff',
    };
    const stream = request.isHeadRequest || status === 304 ? null : body;
    if (stream === null && body?.cancel) {
        void body.cancel();
    }
    return response.respondWithStream(status, stream, {
        contentType: file.content.contentType,
        contentLength: status === 304 ? undefined : file.content.length,
        headers,
    });
}

function respondNotFound(response) {
    return response.respondWithUtf8(404, 'Not Found', {
        headers: { 'cache-control': 'no-store' },
    });
}
