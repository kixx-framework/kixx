import { assert, isFunction, isUndefined } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import { validatePluginManifest, validateAppManifest } from './plugin-manifest.js';
import { resolveInstallation } from './resolve-installation.js';
import { renderRegistryFiles, readCoreDirectoryOption } from './render-registries.js';


const PLUGINS_DIRECTORY = 'plugins';
const PLUGIN_MANIFEST_FILE_NAME = 'plugin.json';
const APP_MANIFEST_FILE = 'app/app.json';


/**
 * @typedef {import('./project-file-system-interface.js').ProjectFileSystemInterface} ProjectFileSystemInterface
 */

/**
 * @typedef {import('./resolve-installation.js').Installation} Installation
 */


/**
 * Reads and validates every manifest in a project, and resolves them into one
 * installation: core's manifest (`<coreDirectory>/plugin.json`), the manifest
 * of each installed plugin, and the app manifest (`app/app.json`).
 *
 * A plugin is installed when a directory directly under `plugins/` holds a
 * `plugin.json`. A directory without one is skipped. A project without an app
 * manifest declares nothing.
 *
 * Manifests are validated as they are read: core first, then the plugins by
 * name, then the app. The first invalid one throws its own error, which names
 * its file and lists every problem in it.
 *
 * @param {Object} options
 * @param {ProjectFileSystemInterface} options.fileSystem - File access, rooted at the project
 * @param {string} [options.coreDirectory='kixx'] - Where core lives, as a POSIX path relative to the project root
 * @returns {Promise<Installation>} The resolved installation, deeply frozen
 * @throws {OperationalError} When core's manifest is missing, or a manifest file is not valid JSON
 * @throws {ValidationError} When a manifest is invalid, or the manifests don't fit together
 */
export async function readInstallation(options) {
    const { fileSystem } = options ?? {};

    assert(
        isFunction(fileSystem?.readTextFile) && isFunction(fileSystem?.listDirectories),
        'readInstallation: options.fileSystem must implement ProjectFileSystemInterface',
    );

    const coreDirectory = readCoreDirectoryOption(options);
    const coreFile = `${ coreDirectory }/${ PLUGIN_MANIFEST_FILE_NAME }`;
    const coreManifest = await readManifestFile(fileSystem, coreFile);

    if (isUndefined(coreManifest)) {
        throw new OperationalError(`Missing core manifest: ${ coreFile }`, {}, readInstallation);
    }

    const core = validatePluginManifest(coreManifest, { file: coreFile, isCore: true });
    const plugins = [];

    for (const directoryName of await fileSystem.listDirectories(PLUGINS_DIRECTORY)) {
        const file = `${ PLUGINS_DIRECTORY }/${ directoryName }/${ PLUGIN_MANIFEST_FILE_NAME }`;
        const manifest = await readManifestFile(fileSystem, file);

        // A directory with no manifest is not a plugin.
        if (isUndefined(manifest)) {
            continue;
        }

        // The name must equal the directory name, which is what keeps two
        // manifests from sharing one.
        plugins.push(validatePluginManifest(manifest, { file, directoryName }));
    }

    const appManifest = await readManifestFile(fileSystem, APP_MANIFEST_FILE);
    let app;

    // A project without an app manifest declares nothing.
    if (!isUndefined(appManifest)) {
        app = validateAppManifest(appManifest, { file: APP_MANIFEST_FILE });
    }

    return resolveInstallation({ core, plugins, app });
}

/**
 * Renders the text of a project's five generated files from the manifests it
 * holds. Nothing is written.
 *
 * @param {Object} options
 * @param {ProjectFileSystemInterface} options.fileSystem - File access, rooted at the project
 * @param {string} [options.coreDirectory='kixx'] - Where core lives, as a POSIX path relative to the project root
 * @returns {Promise<Map<string, string>>} File text by file name, as renderRegistryFiles() returns it
 * @throws {OperationalError} When core's manifest is missing, or a manifest file is not valid JSON
 * @throws {ValidationError} When a manifest is invalid, or the manifests don't fit together
 */
export async function renderProjectFiles(options) {
    return renderRegistryFiles(await readInstallation(options), options);
}

/**
 * Generates a project's five files and writes them at the project root,
 * replacing what is there. Every file is rendered before any is written, so
 * an invalid manifest writes nothing.
 *
 * @param {Object} options
 * @param {ProjectFileSystemInterface} options.fileSystem - File access, rooted at the project
 * @param {string} [options.coreDirectory='kixx'] - Where core lives, as a POSIX path relative to the project root
 * @returns {Promise<string[]>} The names of the files written, in the order renderRegistryFiles() gives them
 * @throws {OperationalError} When core's manifest is missing, or a manifest file is not valid JSON
 * @throws {ValidationError} When a manifest is invalid, or the manifests don't fit together
 */
export async function writeProjectFiles(options) {
    const { fileSystem } = options ?? {};

    assert(
        isFunction(fileSystem?.writeTextFile),
        'writeProjectFiles: options.fileSystem must implement ProjectFileSystemInterface',
    );

    const files = await renderProjectFiles(options);

    for (const [ fileName, text ] of files) {
        await fileSystem.writeTextFile(fileName, text);
    }

    return Array.from(files.keys());
}

// Resolves the parsed manifest, or undefined when there is no such file.
// JSON.parse never returns undefined, so it can't be mistaken for a manifest.
async function readManifestFile(fileSystem, file) {
    const text = await fileSystem.readTextFile(file);

    if (text === null) {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch (cause) {
        throw new OperationalError(`Invalid JSON in ${ file }: ${ cause.message }`, { cause }, readManifestFile);
    }
}
