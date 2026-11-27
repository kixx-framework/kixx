import {
    assert,
    assertArray,
    isFunction,
    isNonEmptyString,
    isObjectNotNull,
    isString,
    isUndefined,
} from '../assertions/mod.js';
import { ValidationError } from '../errors/mod.js';
import { canonicalize } from '../content-addressable-store/addressing.js';
import {
    MAX_MANIFEST_ENTRIES,
    MAX_OBJECT_BYTES,
} from '../content-addressable-store/content-limits.js';
import {
    validateReleaseManifest,
    validateStructuredContent,
} from '../content-addressable-store/release-manifest.js';
import { checkTemplates } from './check-templates.js';
import { createReleaseManifest } from './create-release-manifest.js';
import scanContentSources from './scan-content-sources.js';

/**
 * @typedef {import('./content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

/**
 * @typedef {Object} PluginContentRoot - One entry of a generated registry's `contentRoots`
 * @property {string} plugin - The plugin's name
 * @property {string} [pagesDirectory] - Path from the project root
 * @property {string} [templatesDirectory] - Path from the project root
 * @property {string} [staticAssetsDirectory] - Path from the project root
 */

const CONTENT_ROOT_KEYS = [ 'pagesDirectory', 'templatesDirectory', 'staticAssetsDirectory' ];

// The content kind validateStructuredContent() knows each structured object
// type by.
const STRUCTURED_CONTENT_KINDS = {
    GlobalTemplatePartials: 'globalTemplatePartials',
    BaseTemplates: 'baseTemplates',
    PageMetadata: 'pageMetadata',
    PagePartials: 'pagePartials',
    PageIncludes: 'pageIncludes',
};

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
 * @property {string} filepath - Path from the project root. Empty when no one file is at fault.
 * @property {string} [page] - The page's pathname, when the problem is in a page's own files
 */

/**
 * @typedef {Object} ContentReport
 * @property {ContentProblem[]} problems - Every problem, once, in a deterministic order
 * @property {Array<{ pathname: string, problems: ContentProblem[] }>} pages - Each page with at least one problem, sorted by pathname:
 *     the problems in its own files, then those of every global partial it reaches. The problems are the same objects as in `problems`.
 * @property {string[]} unmatchedFiles - Files under a content directory that no convention matched, as sorted paths from the project root. Information only: they never refuse a Release.
 */

/**
 * @typedef {import('./check-templates.js').ContentGraph} ContentGraph
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
 * `public` directories at the source's root. Each plugin's content
 * directories merge into the same namespaces, and two owners supplying the
 * same page, global partial, base template, or static asset is a collision
 * problem: the first keeps it, the project before any plugin.
 *
 * Every template is compiled against the declared helper names, and every
 * partial a template references must exist. Nothing is rendered.
 *
 * A problem in the content is reported as data, and any problem refuses the
 * Release: `release` is null, so a caller that publishes can't publish a
 * refused tree by accident. The objects that could be built, the report, and
 * the dependency graph are returned either way.
 *
 * @param {Object} options
 * @param {ContentSourceInterface} options.source - Rooted at the project
 * @param {PluginContentRoot[]} [options.pluginContentRoots=[]] - The installed plugins' content directories, in installation order. A plugin may appear more than once.
 * @param {string[]} options.templateHelpers - Every declared template helper name
 * @returns {Promise<ContentCompilation>}
 * @throws {AssertionError} When an option is missing or malformed
 * @throws {ValidationError} When a plugin content directory isn't a path inside the project. Nothing has been read by then.
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
    validatePluginContentRoots(pluginContentRoots);
    assertArray(templateHelpers, 'compileContent: options.templateHelpers');
    assert(
        templateHelpers.every(isString),
        'compileContent: options.templateHelpers must hold only strings',
    );

    const {
        resources,
        unmatchedFiles,
        problems,
        templates,
    } = await scanContentSources(source, { pluginContentRoots });

    const templateCheck = checkTemplates({ templates, templateHelpers, problems });

    problems.push(...templateCheck.problems);
    problems.push(...checkContentLimits(resources));

    let release = null;

    // The validators assume well-formed content, so they run only on a tree
    // with no problem of its own.
    if (problems.length === 0) {
        const validation = validateRelease(resources);
        problems.push(...validation.problems);

        if (problems.length === 0) {
            release = { manifest: validation.manifest };
        }
    }

    return {
        objects: resources,
        release,
        report: {
            problems,
            pages: templateCheck.pages,
            unmatchedFiles,
        },
        graph: templateCheck.graph,
    };
}

/**
 * Checks content objects against the content store's limits.
 *
 * @param {ContentObject[]} objects
 * @returns {ContentProblem[]} One `object-too-large` for each object over the size limit, and one `too-many-objects` when a manifest couldn't name them all
 */
export function checkContentLimits(objects) {
    const problems = [];

    for (const object of objects) {
        if (object.size > MAX_OBJECT_BYTES) {
            problems.push({
                code: 'object-too-large',
                filepath: object.sourceFiles[0] ?? '',
                message: `${ object.type } "${ object.pathname }" is ${ object.size } bytes, over the limit of ${ MAX_OBJECT_BYTES }`,
                type: object.type,
                pathname: object.pathname,
                size: object.size,
                limit: MAX_OBJECT_BYTES,
            });
        }
    }

    if (objects.length > MAX_MANIFEST_ENTRIES) {
        problems.push({
            code: 'too-many-objects',
            filepath: '',
            message: `The content compiles to ${ objects.length } objects, over the limit of ${ MAX_MANIFEST_ENTRIES }`,
            count: objects.length,
            limit: MAX_MANIFEST_ENTRIES,
        });
    }

    return problems;
}

/**
 * Builds the Release manifest for content objects and checks it, and each
 * structured object, with the validators a content store applies. A compile
 * with no problems is then a Release a store accepts.
 *
 * @param {ContentObject[]} objects
 * @returns {{ manifest: Object, problems: ContentProblem[] }} One `invalid-release` problem for each thing a validator rejects
 */
export function validateRelease(objects) {
    const manifest = createReleaseManifest(objects);
    const problems = [];

    collectValidationProblems(problems, '', () => validateReleaseManifest(manifest));

    for (const object of objects) {
        const kind = STRUCTURED_CONTENT_KINDS[object.type];

        if (kind) {
            collectValidationProblems(problems, object.sourceFiles[0] ?? '', () => {
                validateStructuredContent(kind, object.payload, `/${ kind }`);
            });
        }
    }

    return { manifest, problems };
}

function collectValidationProblems(problems, filepath, validate) {
    try {
        validate();
    } catch (error) {
        if (!(error instanceof ValidationError)) {
            throw error;
        }

        problems.push(...createInvalidReleaseProblems(error, filepath));
    }
}

/**
 * Shapes a content store validator's failure as `invalid-release` problems,
 * one for each thing it rejected.
 *
 * @param {ValidationError} error - What the validator threw
 * @param {string} filepath - The file at fault, or an empty string when no one file is
 * @returns {ContentProblem[]}
 */
export function createInvalidReleaseProblems(error, filepath) {
    return error.errors.map((item) => {
        return {
            code: 'invalid-release',
            filepath,
            message: `${ item.message } (${ item.source })`,
            source: item.source,
        };
    });
}

function validatePluginContentRoots(pluginContentRoots) {
    // Every root is checked before any is listed. A root outside the
    // project is a broken installation, not broken content, so it throws.
    const failures = [];

    for (const [ index, root ] of pluginContentRoots.entries()) {
        const name = `compileContent: options.pluginContentRoots[${ index }]`;

        assert(isObjectNotNull(root), `${ name } must be an object`);
        assert(isNonEmptyString(root.plugin), `${ name }.plugin must be a non-empty string`);

        const keys = CONTENT_ROOT_KEYS.filter((key) => !isUndefined(root[key]));
        assert(keys.length > 0, `${ name } must name at least one content directory`);

        for (const key of keys) {
            const directory = root[key];
            assert(isString(directory), `${ name }.${ key } must be a string`);

            const segments = directory.split('/');

            if (directory.startsWith('/') || segments.includes('..')) {
                failures.push({
                    message: `Content root "${ key }" of "${ root.plugin }" is outside the project: ${ directory }`,
                    source: `/${ index }/${ key }`,
                });
            } else if (segments.includes('') || segments.includes('.')) {
                failures.push({
                    message: `Content root "${ key }" of "${ root.plugin }" is not a plain path from the project root: ${ directory }`,
                    source: `/${ index }/${ key }`,
                });
            }
        }
    }

    if (failures.length > 0) {
        // The error's own message is the first failure's, so it names an
        // owner and a path wherever it is logged.
        const error = new ValidationError(failures[0].message);

        for (const { message, source } of failures) {
            error.push(message, source);
        }

        throw error;
    }
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
