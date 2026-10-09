import { assert } from '../../../kixx/assertions/mod.js';
import { canonicalize, hashString } from '../../../kixx/content-addressable-store/addressing.js';
import ContentAddressableIndex from '../../../kixx/content-addressable-store/content-addressable-index.js';


/**
 * Builds an encoded content index from developer source recipes.
 *
 * Hashes describe source-file identity rather than bytes so indexing never
 * opens content files. The developer adapter therefore uses them only as
 * change tokens, not as content addresses.
 *
 * @param {Map<string, Object>} manifest - Storage pathnames and source recipes
 * @returns {Promise<Object>} Encoded content-addressable index table
 */
export async function buildDeveloperIndex(manifest) {
    assert(manifest instanceof Map, 'buildDeveloperIndex: manifest must be a Map');

    const files = [];
    for (const [ pathname, recipe ] of manifest) {
        const identities = [ ...recipe.sources, ...recipe.manifests ].map((identity) => {
            return {
                filepath: identity.filepath,
                mtimeMs: identity.mtimeMs,
                size: identity.size,
            };
        });
        const size = recipe.kind === 'file'
            ? recipe.sources[0].size
            : recipe.sources.reduce((total, source) => total + source.size, 0);

        files.push({
            pathname,
            hash: await hashString(canonicalize(identities)),
            size,
        });
    }

    return await ContentAddressableIndex.buildIndex(files);
}
