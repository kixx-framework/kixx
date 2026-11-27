const INLINE_TYPES = [
    /^image\/(?:avif|gif|jpeg|png|webp)$/u,
    /^application\/pdf$/u,
    /^audio\//u,
    /^video\//u,
    /^text\/plain$/u,
];

/** Returns a quoted validator tied to the committed file generation. */
export function getFileEtag(file) {
    return `"${ file.content.generation }"`;
}

/** Builds a safe Content-Disposition value for the stored filename. */
export function getContentDisposition(file, forceAttachment = false) {
    // Match the media type essence: the shared extension map emits parameters
    // such as `text/plain; charset=utf-8`, which must still count as plain text.
    const essence = file.content.contentType.split(';')[0].trim().toLowerCase();
    const type = forceAttachment || !INLINE_TYPES.some((pattern) => pattern.test(essence))
        ? 'attachment'
        : 'inline';
    const filename = file.content.filename;
    const fallback = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
    const encoded = encodeURIComponent(filename).replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29');
    return `${ type }; filename="${ fallback }"; filename*=UTF-8''${ encoded }`;
}
