import { cleanupContent } from './lib.js';

/** Stores bytes before making a new unpublished file visible. */
export async function createFile(context, form) {
    form.validate();
    const files = context.getCollection('File');
    const contents = context.getCollection('FileContent');
    const id = crypto.randomUUID();
    const content = await contents.create(context, id, form.body, form);

    try {
        const record = await files.createFile(context, {
            id,
            title: null,
            description: null,
            isPublished: false,
            content,
        });
        return record.toObject();
    } catch (cause) {
        await cleanupContent(context, content.key, 'failed file creation');
        throw cause;
    }
}
