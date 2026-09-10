import { ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';

export async function requireFile(context, id) {
    const record = await context.getCollection('File').getFile(context, id);
    if (!record) {
        throw new NotFoundError(`File "${ id }" was not found`, { code: 'FileNotFound' });
    }
    return record;
}

export function translateMissingFile(cause, id) {
    if (cause.name === 'DocumentNotFoundError') {
        return new NotFoundError(`File "${ id }" was not found`, { cause, code: 'FileNotFound' });
    }
    return cause;
}

export function publishedDeleteError() {
    return new ConflictError('Publish state must be off before deleting the file', {
        code: 'PublishedFileDeleteConflict',
    });
}

export async function cleanupContent(context, key, operation) {
    try {
        await context.getCollection('FileContent').delete(context, key);
    } catch (error) {
        context.logger?.error?.(`File content cleanup failed after ${ operation }`, { key, error });
    }
}
