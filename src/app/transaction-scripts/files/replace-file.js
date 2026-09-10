import { cleanupContent, requireFile, translateMissingFile } from './lib.js';

/** Commits a fresh content reference while preserving every unrelated field. */
export async function replaceFile(context, fileId, form) {
    form.validate();
    const files = context.getCollection('File');
    const contents = context.getCollection('FileContent');
    const existing = await requireFile(context, fileId);
    const content = await contents.create(context, fileId, form.body, form);
    let displacedKey = existing.get('content').key;

    try {
        existing.set('content', content);
        const record = await files.updateWithRetry(context, existing, (latest) => {
            displacedKey = latest.get('content').key;
            return latest.set('content', content);
        });
        await cleanupContent(context, displacedKey, 'file replacement');
        return record.toObject();
    } catch (cause) {
        await cleanupContent(context, content.key, 'failed file replacement');
        throw translateMissingFile(cause, fileId);
    }
}
