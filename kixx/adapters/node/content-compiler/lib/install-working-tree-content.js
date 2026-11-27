import { assert, assertNonEmptyString, isObjectNotNull } from '../../../../assertions/mod.js';
import { readWorkingTreeSwitch } from '../../../../content-addressable-store/working-tree-switch.js';
import { createWorkingTreeContent } from './working-tree-content.js';


const REGENERATE_HINT = 'Regenerate the project\'s registries.';


/**
 * Makes a booted application render pages and assets from the project's
 * working tree, when `CONTENT_STORE.workingTree` asks for it (the default in
 * development). Otherwise it does nothing.
 *
 * The tree is compiled once here, so a tree that can't be compiled fails
 * boot, and its content problems are logged before the first request.
 *
 * @param {Object} options
 * @param {import('../../../../context/application-context.js').default} options.appContext - The booted application
 * @param {Object} options.registry - The project's Node.js registry module; reads `contentRoots` and `templateHelpers`
 * @param {string} options.baseDirectory - The project root
 * @returns {Promise<boolean>} True when working-tree content was installed
 * @throws {AssertionError} When the registry lacks `contentRoots` or `templateHelpers`
 * @throws {ValidationError} When a plugin content directory isn't a path inside the project
 * @throws {OperationalError} When the file system fails
 */
export async function installWorkingTreeContent(options) {
    const { appContext, registry, baseDirectory } = options ?? {};

    assert(isObjectNotNull(appContext), 'installWorkingTreeContent: options.appContext must be an application context');
    assert(isObjectNotNull(registry), 'installWorkingTreeContent: options.registry must be a registry module');
    assertNonEmptyString(baseDirectory, 'installWorkingTreeContent: options.baseDirectory');

    if (!readWorkingTreeSwitch(appContext.config)) {
        return false;
    }

    assert(
        Array.isArray(registry.contentRoots),
        `Working-tree content needs the registry's contentRoots export. ${ REGENERATE_HINT }`,
    );
    assert(
        Array.isArray(registry.templateHelpers),
        `Working-tree content needs the registry's templateHelpers export. ${ REGENERATE_HINT }`,
    );

    const workingTree = createWorkingTreeContent({
        projectDirectory: baseDirectory,
        contentRoots: registry.contentRoots,
        templateHelpers: registry.templateHelpers,
        logger: appContext.logger,
    });

    await workingTree.getContent();

    appContext.getService('ContentAddressableStore').setContentSupplier(() => workingTree.getContent());

    return true;
}
