/**
 * Reports whether an If-None-Match header value matches an entity tag.
 *
 * The comparison is weak (RFC 9110 section 13.1.2): a `W/` prefix on either
 * side is ignored, because a proxy which compresses a body weakens its ETag.
 * The header value may be a comma-separated list or the `*` wildcard.
 *
 * @param {string|null|undefined} value - The If-None-Match header value.
 * @param {string} etag - The current entity tag, quoted, with or without `W/`.
 * @returns {boolean} True when any listed validator matches.
 */
export default function matchesIfNoneMatch(value, etag) {
    if (!value) {
        return false;
    }

    const opaque = etag.replace(/^W\//u, '');

    return value.split(',').some((candidate) => {
        const normalized = candidate.trim().replace(/^W\//u, '');
        return normalized === '*' || normalized === opaque;
    });
}
