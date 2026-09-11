import { requireFile, translateMissingFile } from './lib.js';

/** Updates title and description without changing content or publication state. */
export async function updateFileMetadata(context, fileId, form) {
    form.validate();
    const files = context.getCollection('File');
    const record = await requireFile(context, fileId);
    try {
        return (await files.patch(context, record, {
            title: form.title,
            description: form.description,
        })).toObject();
    } catch (cause) {
        throw translateMissingFile(cause, fileId);
    }
}
