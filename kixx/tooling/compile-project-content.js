import { compileContent } from '../content-compiler/mod.js';
import { readInstallation } from './generate-project-files.js';
import { listPluginContentRoots } from './project-paths.js';


/**
 * @typedef {import('./project-file-system-interface.js').ProjectFileSystemInterface} ProjectFileSystemInterface
 */

/**
 * @typedef {import('../content-compiler/content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

/**
 * @typedef {import('../content-compiler/compile-content.js').ContentCompilation} ContentCompilation
 */


/**
 * Compiles a project's content from what its manifests declare: the content
 * directories of every installed plugin, and every template helper name core,
 * the plugins, and the app declare.
 *
 * The manifests are read and validated first, so an invalid one rejects
 * before any content is read. Both ports are rooted at the project, and the
 * caller supplies them, so this runs wherever they do.
 *
 * @param {Object} options
 * @param {ProjectFileSystemInterface} options.fileSystem - Reads the manifests
 * @param {ContentSourceInterface} options.source - Reads the content
 * @param {string} [options.coreDirectory='kixx'] - Where core lives, as a POSIX path relative to the project root
 * @returns {Promise<ContentCompilation>} What compileContent() resolves, unchanged
 * @throws {OperationalError} When core's manifest is missing, or a manifest file is not valid JSON
 * @throws {ValidationError} When a manifest is invalid, the manifests don't fit together, or a content directory lies outside the project
 */
export async function compileProjectContent(options) {
    const { source, coreDirectory } = options ?? {};

    const installation = await readInstallation(options);

    return await compileContent({
        source,
        pluginContentRoots: listPluginContentRoots(installation, { coreDirectory }),
        templateHelpers: installation.templateHelpers,
    });
}
