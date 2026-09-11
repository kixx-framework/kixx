import { requireFile, translateMissingFile } from './lib.js';

/** Unpublishes a file without changing metadata or content. */
export async function unpublishFile(context, form) {
    form.validate();
    const files = context.getCollection('File');
    const record = await requireFile(context, form.fileId);
    try {
        return (await files.patch(context, record, { isPublished: false })).toObject();
    } catch (cause) {
        throw translateMissingFile(cause, form.fileId);
    }
}
