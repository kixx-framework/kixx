/** Returns the fixed-size newest-first file-library page. */
export async function listFiles(context, cursor) {
    const result = await context.getCollection('File').listPage(context, cursor);
    return { items: result.items.map((record) => record.toObject()), cursor: result.cursor };
}
