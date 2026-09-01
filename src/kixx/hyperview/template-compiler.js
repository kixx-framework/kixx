import * as templating from '../templating/mod.js';
import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';
import assetUrl from './helpers/asset-url.js';

/**
 * Compiles template source with the helpers available to runtime Hyperview renders.
 * @param {string} templateId - Source identity used in syntax diagnostics
 * @param {string} source - Template source
 * @returns {{render: Function, partialIds: Set<string>}} Render function and referenced partial ids
 */
export function compileHyperviewTemplate(templateId, source) {
    const helpers = new Map([
        ...templating.helpers,
        [ 'formatDate', formatDate ],
        [ 'markup', markup ],
        [ 'truncate', truncate ],
        [ 'assetUrl', assetUrl ],
    ]);
    const tokens = templating.tokenize(null, templateId, source);
    const tree = templating.buildSyntaxTree(null, tokens);
    const partialIds = new Set();
    collectPartialIds(tree, partialIds);
    return {
        render: templating.createRenderFunction(null, helpers, tree),
        partialIds,
    };
}

function collectPartialIds(nodes, partialIds) {
    for (const node of nodes) {
        if (node.type === 'PARTIAL') {
            partialIds.add(node.exp);
        }
        if (Array.isArray(node.children)) {
            collectPartialIds(node.children, partialIds);
        }
    }
}
