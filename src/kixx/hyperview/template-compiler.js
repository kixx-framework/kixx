import * as templating from '../templating/mod.js';
import formatDate from './helpers/format-date.js';
import markup from './helpers/markup.js';
import truncate from './helpers/truncate.js';
import assetUrl from './helpers/asset-url.js';

/**
 * Compiles template source with the helpers available to runtime Hyperview renders.
 * @param {string} templateId - Source identity used in syntax diagnostics
 * @param {string} source - Template source
 * @returns {Function} Render function
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
    return templating.createRenderFunction(null, helpers, tree);
}
