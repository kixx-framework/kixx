/**
 * Formats a `BUILD_ID` value from a `Date`. Dashes replace the colons of an
 * ISO timestamp so the value is safe in a filename, a URL, and a shell
 * argument.
 * @module build-id
 */

/**
 * @param {Date} date - The moment to format, interpreted in UTC.
 * @param {string} [uniqueId] - Collision-resistant suffix, such as `generateShortId()`.
 * @returns {string} Readable UTC timestamp with an optional unique suffix.
 */
export function formatBuildId(date, uniqueId) {
    const timestamp = date.toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:/g, '-');

    return uniqueId ? `${ timestamp }-${ uniqueId }` : timestamp;
}
