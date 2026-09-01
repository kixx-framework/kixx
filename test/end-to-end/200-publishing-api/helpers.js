/**
 * Creates a lowercase namespace safe for build IDs and content path segments.
 * @returns {string} Unique run prefix in the form `e2e-<uuid>`.
 */
export function createRunPrefix() {
    return `e2e-${ crypto.randomUUID().toLowerCase() }`;
}

/**
 * Creates a content pathname isolated to one end-to-end test run.
 * @param {string} prefix - Run prefix from createRunPrefix().
 * @param {string} pathname - Test-specific canonical pathname.
 * @returns {string} Namespaced content pathname.
 */
export function createRunScopedPathname(prefix, pathname) {
    return `${ prefix }/${ pathname }`;
}
