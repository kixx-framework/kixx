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

/** Reports whether an If-None-Match list weakly matches the current validator. */
export function matchesIfNoneMatch(value, etag) {
    if (!value) {
        return false;
    }
    const opaque = etag.replace(/^W\//u, '');
    return value.split(',').some((candidate) => {
        const normalized = candidate.trim().replace(/^W\//u, '');
        return normalized === '*' || normalized === opaque;
    });
}

/** Builds a safe Content-Disposition value for the stored filename. */
export function getContentDisposition(file, forceAttachment = false) {
    const type = forceAttachment || !INLINE_TYPES.some((pattern) => pattern.test(file.content.contentType))
        ? 'attachment'
        : 'inline';
    const filename = file.content.filename;
    const fallback = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
    const encoded = encodeURIComponent(filename).replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29');
    return `${ type }; filename="${ fallback }"; filename*=UTF-8''${ encoded }`;
}
