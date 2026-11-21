import { ConflictError } from '../../../kixx/errors/mod.js';
import { cleanupContent, publishedDeleteError, requireFile, translateMissingFile } from './lib.js';

const DELETE_RETRY_LIMIT = 3;

/** Deletes an unpublished identity conditionally, then removes its active bytes. */
export async function deleteFile(context, form) {
    form.validate();
    const files = context.getCollection('File');
    let record = await requireFile(context, form.fileId);

    for (let attempt = 0; attempt <= DELETE_RETRY_LIMIT; attempt += 1) {
        if (record.get('isPublished')) {
            throw publishedDeleteError();
        }
        try {
            await files.deleteStrict(context, record);
            await cleanupContent(context, record.get('content').key, 'file deletion');
            return record.toObject();
        } catch (cause) {
            if (cause.name !== 'VersionConflictError') {
                throw translateMissingFile(cause, form.fileId);
            }
            record = await requireFile(context, form.fileId);
        }
    }

    throw new ConflictError('File changed too many times while deletion was attempted', {
        code: 'FileDeleteRetryLimit',
    });
}
