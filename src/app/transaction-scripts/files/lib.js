import { BadRequestError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';

/**
 * Stores one upload attempt's bytes under a fresh generation key.
 * @throws {BadRequestError} `FileContentLengthMismatch` when the body does not match its declared size.
 */
export async function storeContent(context, fileId, form) {
    try {
        return await context.getCollection('FileContent').create(context, fileId, form.body, form);
    } catch (cause) {
        // The declared size is client input, so a body that ends early or runs
        // long is a bad request rather than a storage failure. The adapter
        // stored nothing under the attempt key, so there is nothing to clean up.
        if (cause.code === 'ObjectContentLengthMismatch') {
            throw new BadRequestError('The uploaded bytes do not match the declared file size', {
                cause,
                code: 'FileContentLengthMismatch',
            });
        }
        throw cause;
    }
}

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
