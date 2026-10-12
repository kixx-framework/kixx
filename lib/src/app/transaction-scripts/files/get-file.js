/** Returns a file document or null when its identity is absent. */
export async function getFile(context, fileId) {
    const record = await context.getCollection('File').getFile(context, fileId);
    return record ? record.toObject() : null;
}
