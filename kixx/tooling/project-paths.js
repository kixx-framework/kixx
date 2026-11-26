import { assert, isPlainObject, isString, isUndefined } from '../assertions/mod.js';


const DEFAULT_CORE_DIRECTORY = 'kixx';

// A POSIX path relative to the project root. It is written into import
// specifiers, so each segment holds only characters that are safe there.
const CORE_DIRECTORY_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export const CORE_OWNER = 'kixx';

const CONTENT_DIRECTORY_KEYS = [ 'pagesDirectory', 'templatesDirectory', 'staticAssetsDirectory' ];


/**
 * @typedef {import('./resolve-installation.js').Installation} Installation
 */

/**
 * @typedef {Object} PluginContentRoot - One owner's content directories, as paths from the project root
 * @property {string} plugin - The owner's name: a plugin's, or `kixx` for core
 * @property {string} [pagesDirectory]
 * @property {string} [templatesDirectory]
 * @property {string} [staticAssetsDirectory]
 */


/**
 * Reads the `coreDirectory` option: where core lives, as a POSIX path relative
 * to the project root. It may begin with `../`.
 * @param {Object} [options]
 * @param {string} [options.coreDirectory='kixx']
 * @returns {string} The checked path
 * @throws {AssertionError} When the path is absolute, empty, or holds a character an import specifier can't safely carry
 */
export function readCoreDirectoryOption(options) {
    const { coreDirectory = DEFAULT_CORE_DIRECTORY } = options ?? {};

    assert(
        isString(coreDirectory) && CORE_DIRECTORY_PATTERN.test(coreDirectory),
        'options.coreDirectory must be a relative POSIX path with segments of letters, digits, ".", "_", and "-"',
    );

    return coreDirectory;
}

/**
 * Turns a path its manifest wrote, relative to the owner's directory, into a
 * path from the project root.
 * @param {string} coreDirectory - As readCoreDirectoryOption() returned it
 * @param {string} owner - `kixx` for core, or a plugin's name
 * @param {string} path - Begins with `./`
 * @returns {string}
 */
export function toProjectPath(coreDirectory, owner, path) {
    const directory = owner === CORE_OWNER ? coreDirectory : `plugins/${ owner }`;
    return `${ directory }/${ path.slice(2) }`;
}

/**
 * Lists where the installed plugins' content lives, as paths from the project
 * root, in installation order. This is the `contentRoots` export of a
 * generated registry, and what the content compiler takes as
 * `pluginContentRoots`.
 *
 * It only translates paths. Core's own content, with core outside the
 * project, gives a path that begins with `../`, and the content compiler is
 * what refuses it.
 *
 * @param {Installation} installation - The model resolveInstallation() returned
 * @param {Object} [options]
 * @param {string} [options.coreDirectory='kixx'] - Where core lives, as a POSIX path relative to the project root
 * @returns {PluginContentRoot[]} One record per content root. A plugin may have more than one. Only the directories a root declares are present.
 * @throws {AssertionError} When `coreDirectory` is not a safe relative path
 */
export function listPluginContentRoots(installation, options) {
    assert(isPlainObject(installation), 'listPluginContentRoots: installation must be a resolved installation');

    const coreDirectory = readCoreDirectoryOption(options);

    return installation.contentRoots.map((root) => {
        const record = { plugin: root.owner };

        for (const key of CONTENT_DIRECTORY_KEYS) {
            if (!isUndefined(root[key])) {
                record[key] = toProjectPath(coreDirectory, root.owner, root[key]);
            }
        }

        return record;
    });
}
