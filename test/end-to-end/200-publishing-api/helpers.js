/**
 * Creates a lowercase namespace safe for build IDs and content path segments.
 * @returns {string} Unique run prefix in the form `e2e-<uuid>`.
 */
export function createRunPrefix() {
    return `e2e-${ crypto.randomUUID().toLowerCase() }`;
}

/**
 * Creates a canonical Release manifest pathname isolated to one end-to-end
 * test run. Release manifest pathnames are rejected, not normalized, so the
 * leading slash matters: it must equal `normalizePathname()`'s output exactly.
 * @param {string} prefix - Run prefix from createRunPrefix().
 * @param {string} pathname - Test-specific pathname, without a leading slash.
 * @returns {string} Namespaced, canonical manifest pathname.
 */
export function createRunScopedPathname(prefix, pathname) {
    return `/${ prefix }/${ pathname }`;
}
