/**
 * Loads framework logic from the project's own copy of Kixx, at run time, so
 * one CLI version works across project versions (CLI-3).
 *
 * This is the only module of the devkit with a dynamic `import()`, and the
 * only way the devkit reaches code outside itself. It imports three of the
 * project's core modules and nothing else: never the project's `app/`,
 * `plugins/`, or an entry point. `test/import-hygiene.test.js` pins both.
 *
 * Classes loaded here are the project's, not the devkit's. Never use
 * `instanceof` on an error project code throws; match `error.name`.
 * @module load-project-tooling
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isFunction } from '../vendor/kixx-assert/mod.js';
import { UnsupportedProjectVersionError } from './project-version.js';


// POSIX paths from the project root.
const TOOLING_MODULE = 'kixx/tooling/mod.js';
const PROJECT_FILE_SYSTEM_MODULE = 'kixx/adapters/node/tooling/lib/project-file-system.js';
const CONTENT_SOURCE_MODULE = 'kixx/adapters/node/content-compiler/lib/file-system-content-source.js';

/**
 * Every export of the project's `kixx/tooling/mod.js` the devkit calls. A
 * project whose tooling lacks one is refused before any command runs.
 * @type {ReadonlyArray<string>}
 */
export const REQUIRED_TOOLING_EXPORTS = Object.freeze([
    'writeProjectFiles',
    'parseSecretsManifest',
]);


/**
 * @typedef {Object} ProjectTooling
 * @property {Object} tooling - The project's `kixx/tooling/mod.js` namespace
 * @property {function(string): Object} createProjectFileSystem - File access for the generator, rooted at a project directory
 * @property {function(string): Object} createFileSystemContentSource - Content access for the compiler, rooted at a project directory
 */

/**
 * Imports the project's tooling modules.
 * @param {string} projectDirectory - Absolute path of the project
 * @param {Object} [options]
 * @param {function(string): Promise<Object>} [options.importModule] - Imports a module by file URL; a test passes a fake
 * @returns {Promise<Readonly<ProjectTooling>>}
 * @throws {UnsupportedProjectVersionError} When a module is missing, or lacks an export the devkit calls
 */
export default async function loadProjectTooling(projectDirectory, options) {
    const { importModule = importByUrl } = options ?? {};

    const load = async (modulePath) => {
        const filepath = path.join(projectDirectory, ...modulePath.split('/'));

        // Checked before importing so a missing file is told apart from a
        // module that fails to load, on every runtime.
        if (!await isFile(filepath)) {
            throw new UnsupportedProjectVersionError(
                `The project's Kixx is missing ${ modulePath } (looked for ${ filepath }). `
                + 'This kixx-dev needs it. Restore or upgrade the project\'s kixx/ directory.',
            );
        }

        return await importModule(pathToFileURL(filepath).href);
    };

    const tooling = await load(TOOLING_MODULE);
    const projectFileSystemModule = await load(PROJECT_FILE_SYSTEM_MODULE);
    const contentSourceModule = await load(CONTENT_SOURCE_MODULE);

    for (const name of REQUIRED_TOOLING_EXPORTS) {
        assertExport(tooling, name, TOOLING_MODULE);
    }

    assertExport(projectFileSystemModule, 'createProjectFileSystem', PROJECT_FILE_SYSTEM_MODULE);
    assertExport(contentSourceModule, 'createFileSystemContentSource', CONTENT_SOURCE_MODULE);

    return Object.freeze({
        tooling,
        createProjectFileSystem: projectFileSystemModule.createProjectFileSystem,
        createFileSystemContentSource: contentSourceModule.createFileSystemContentSource,
    });
}

function importByUrl(url) {
    return import(url);
}

function assertExport(mod, name, modulePath) {
    if (!isFunction(mod?.[name])) {
        throw new UnsupportedProjectVersionError(
            `The project's ${ modulePath } does not export ${ name }(), which this kixx-dev needs. `
            + 'Upgrade the project\'s Kixx, or install an older kixx-dev.',
        );
    }
}

async function isFile(filepath) {
    try {
        const stats = await fsp.stat(filepath);
        return stats.isFile();
    } catch {
        return false;
    }
}
