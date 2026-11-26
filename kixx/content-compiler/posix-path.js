/**
 * The few path operations the content compiler needs, for POSIX paths as a
 * content source and a content object write them. The compiler imports no
 * platform module, so it can't use `node:path`.
 * @module content-compiler/posix-path
 */

/**
 * @param {string} filepath
 * @returns {string} The last segment, ignoring a trailing slash; empty when there is none
 */
export function basename(filepath) {
    return filepath.split('/').filter((segment) => segment).pop() ?? '';
}

/**
 * @param {string} filepath
 * @returns {string} Everything before the last slash; empty when the path has no slash or only a leading one
 */
export function dirname(filepath) {
    const index = filepath.lastIndexOf('/');
    return index === -1 ? '' : filepath.slice(0, index);
}

/**
 * @param {string} filepath
 * @returns {string} The last segment's extension with its dot; empty for a name with no dot or only a leading one
 */
export function extname(filepath) {
    const name = basename(filepath);
    const index = name.lastIndexOf('.');
    return index <= 0 ? '' : name.slice(index);
}
