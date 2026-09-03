import { assert } from '../../../kixx/assertions/mod.js';
import { getDeveloperBlob } from './developer-blobs.js';


/**
 * Builds a Release manifest from a developer source tree by scanning it,
 * materializing each storage pathname's bytes, handing them to putObject, and
 * placing the returned content reference in the manifest facet the scanner
 * recipe names.
 *
 * The result is deterministic for a given tree: facets are emitted in scanner
 * order (storage pathnames sorted ascending), and `createRelease` canonicalizes
 * the manifest afterward, so key order here does not affect the release id.
 *
 * @param {Object} options
 * @param {import('./developer-source-scanner.js').default} options.scanner - Scans the developer source tree into storage recipes
 * @param {Function} options.putObject - `(bytes: ArrayBuffer, pathname: string) => Promise<{objectId: string, size: number}>`
 * @param {Object} [options.fileSystem] - Promise-based filesystem API forwarded to getDeveloperBlob, used by tests
 * @returns {Promise<Object>} A manifest object accepted by validateReleaseManifest
 */
export async function buildReleaseManifest(options) {
    const { scanner, putObject, fileSystem } = options ?? {};

    const recipes = await scanner.scan();
    const manifest = {};

    for (const [ pathname, recipe ] of recipes) {
        const bytes = await getDeveloperBlob(recipes, pathname, 'arrayBuffer', fileSystem);
        const reference = await putObject(bytes, pathname);
        placeReference(manifest, recipe.facet, reference);
    }

    return manifest;
}

function placeReference(manifest, facet, reference) {
    if (facet.name === 'staticAssets') {
        manifest.staticAssets = manifest.staticAssets ?? {};
        manifest.staticAssets[facet.pathname] = reference;
    } else if (facet.name === 'globalTemplatePartials') {
        manifest.globalTemplatePartials = reference;
    } else if (facet.name === 'baseTemplates') {
        manifest.baseTemplates = reference;
    } else if (facet.name === 'emails') {
        manifest.emails = manifest.emails ?? {};
        manifest.emails[facet.pathname] = reference;
    } else if (facet.name === 'page') {
        manifest.pages = manifest.pages ?? {};
        const page = manifest.pages[facet.pathname] ?? {};
        manifest.pages[facet.pathname] = page;

        if (facet.field === 'templates') {
            page.templates = page.templates ?? {};
            page.templates[facet.filename] = reference;
        } else {
            page[facet.field] = reference;
        }
    } else {
        assert(false, `buildReleaseManifest: unknown facet name "${ facet.name }"`);
    }
}
