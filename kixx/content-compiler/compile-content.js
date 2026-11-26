import {
    assert,
    assertArray,
    isFunction,
    isObjectNotNull,
    isString,
} from '../assertions/mod.js';
import { canonicalize } from '../content-addressable-store/addressing.js';
import { createReleaseManifest } from './create-release-manifest.js';
import scanContentSources from './scan-content-sources.js';

/**
 * @typedef {import('./content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

/**
 * @typedef {Object} ContentObject
 * @property {string} type - StaticAsset, GlobalTemplatePartials, BaseTemplates, PageMetadata, PagePartials, PageIncludes, or PageTemplate
 * @property {string} pathname
 * @property {Object|Array<*>|string|ArrayBuffer} payload - A structure is stored as its canonical JSON; see serializeContentObject()
 * @property {string} hash - The object's id
 * @property {number} size - Stored size in bytes
 * @property {string[]} sourceFiles - Paths from the project root
 */

/**
 * @typedef {Object} ContentProblem
 * @property {string} code
 * @property {string} message
 * @property {string} filepath - Path from the project root
 */

/**
 * @typedef {Object} ContentReport
 * @property {ContentProblem[]} problems - Every problem, once, in a deterministic order
 * @property {Array<{ pathname: string, problems: ContentProblem[] }>} pages - Each page with at least one problem, sorted by pathname
 * @property {string[]} unmatchedFiles - Files under a content directory that no convention matched, as sorted paths from the project root. Information only: they never refuse a Release.
 */

/**
 * @typedef {Object} ContentGraph
 * @property {Object[]} pages
 * @property {Object[]} globalPartials
 * @property {Object[]} baseTemplates
 */

/**
 * @typedef {Object} ContentCompilation
 * @property {ContentObject[]} objects - Every object that could be built, sorted by type then pathname
 * @property {{ manifest: Object }|null} release - Null when report.problems is not empty
 * @property {ContentReport} report
 * @property {ContentGraph} graph
 */


/**
 * Compiles a project's content into content objects and a Release manifest.
 *
 * The project's content is the `pages`, `templates`, `static-assets`, and
 * `public` directories at the source's root. A problem in the content is
 * reported as data, and any problem refuses the Release: `release` is null,
 * so a caller that publishes can't publish a refused tree by accident. The
 * objects that could be built are returned either way.
 *
 * @param {Object} options
 * @param {ContentSourceInterface} options.source - Rooted at the project
 * @param {Array<Object>} [options.pluginContentRoots=[]] - Plugin content roots. Not supported yet: must be empty.
 * @param {string[]} options.templateHelpers - Every declared template helper name
 * @returns {Promise<ContentCompilation>}
 * @throws {AssertionError} When an option is missing or malformed
 */
export async function compileContent(options) {
    const {
        source,
        pluginContentRoots = [],
        templateHelpers,
    } = options ?? {};

    assert(
        isObjectNotNull(source) && isFunction(source.listFiles) && isFunction(source.readFile),
        'compileContent: options.source must be a content source',
    );
    assertArray(pluginContentRoots, 'compileContent: options.pluginContentRoots');
    assert(
        pluginContentRoots.length === 0,
        'compileContent: plugin content roots are not supported yet',
    );
    assertArray(templateHelpers, 'compileContent: options.templateHelpers');
    assert(
        templateHelpers.every(isString),
        'compileContent: options.templateHelpers must hold only strings',
    );

    const { resources, unmatchedFiles, problems } = await scanContentSources(source);

    const release = problems.length === 0
        ? { manifest: createReleaseManifest(resources) }
        : null;

    return {
        objects: resources,
        release,
        report: {
            problems,
            pages: [],
            unmatchedFiles,
        },
        graph: {
            pages: [],
            globalPartials: [],
            baseTemplates: [],
        },
    };
}

/**
 * Returns what a content store receives for an object: the payload itself
 * when it is text or bytes, and its canonical JSON when it is a structure.
 * An object's hash and size are those of this value.
 *
 * @param {ContentObject} object
 * @returns {string|ArrayBuffer}
 */
export function serializeContentObject(object) {
    const { payload } = object ?? {};

    if (isString(payload) || payload instanceof ArrayBuffer) {
        return payload;
    }

    return canonicalize(payload);
}
