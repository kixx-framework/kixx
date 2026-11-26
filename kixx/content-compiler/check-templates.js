import { isNonEmptyString } from '../assertions/mod.js';
import { compareStrings } from '../content-addressable-store/addressing.js';
import {
    buildSyntaxTree,
    createRenderFunction,
    tokenize,
} from '../vendor/templating/mod.js';

/**
 * The pre-publish template checks, and the dependency graph they build.
 *
 * Every template is compiled against the declared helper names and never
 * rendered, so the checks need no request, no data, and no application code.
 * Each template is compiled once, however many pages reach it.
 * @module content-compiler/check-templates
 */

/**
 * @typedef {import('./scan-content-sources.js').ScannedTemplates} ScannedTemplates
 * @typedef {import('./compile-content.js').ContentProblem} ContentProblem
 */

/**
 * @typedef {Object} ContentGraphPage
 * @property {string} pathname
 * @property {string} owner - `app`, or the plugin's name
 * @property {string[]} metadataFiles - The page's page.json, then each ancestor page's that exists, nearest first. A page inherits its ancestors' metadata when it renders.
 * @property {string|null} templateFile
 * @property {string[]} partialFiles
 * @property {string[]} includeFiles
 * @property {string[]} globalPartials - The id of every global partial the page's template and partials reach, through other global partials too
 */

/**
 * Which files each page, global partial, and base template is made from.
 * Plain data. No link is recorded from a page to a base template (the code
 * that renders a page chooses it) or to a static asset.
 * @typedef {Object} ContentGraph
 * @property {ContentGraphPage[]} pages - Sorted by pathname
 * @property {Array<{ id: string, owner: string, file: string, partials: string[] }>} globalPartials - Sorted by id. partials: the global partials it references directly.
 * @property {Array<{ id: string, owner: string, file: string, globalPartials: string[] }>} baseTemplates - Sorted by id. globalPartials: every one it reaches.
 */

const HELPER_MESSAGE_PATTERN = /^No helper named "([^"]+)"/;

// The engine consults only a helper's name when it compiles a template.
function placeholderHelper() {
    return '';
}

/**
 * Compiles every scanned template and resolves every partial reference.
 *
 * A reference in a page's template or page partial resolves against that
 * page's partials first and then the global partials, as a page renders. A
 * reference in a global partial or a base template resolves against the
 * global partials only, so whether it is a problem never depends on which
 * pages exist.
 *
 * @param {Object} options
 * @param {ScannedTemplates} options.templates - What the scan read
 * @param {string[]} options.templateHelpers - Every declared helper name
 * @param {ContentProblem[]} options.problems - The scan's problems, read for the per-page report
 * @returns {{ problems: ContentProblem[], pages: Array<{ pathname: string, problems: ContentProblem[] }>, graph: ContentGraph }}
 *     problems: the template problems alone, pages first, then global partials, then base templates.
 *     pages: each page with a problem, sorted by pathname: its own problems, then those of the global partials it reaches.
 */
export function checkTemplates(options) {
    const { templates, templateHelpers, problems: scanProblems } = options;

    const helpers = new Map(templateHelpers.map((name) => [ name, placeholderHelper ]));
    const globalIds = new Set(templates.globalPartials.map(({ id }) => id));

    // Global partials and base templates are checked once for the Release.
    const globalPartials = new Map();

    for (const template of templates.globalPartials) {
        globalPartials.set(template.id, checkGlobalTemplate(template, helpers, globalIds));
    }

    const baseTemplates = templates.baseTemplates.map((template) => {
        return { template, check: checkGlobalTemplate(template, helpers, globalIds) };
    });

    const metadataFiles = new Map(templates.pages.map((page) => [ page.pathname, page.metadataFile ]));
    const pageProblems = [];
    const graphPages = [];

    for (const page of templates.pages) {
        const check = checkPage(page, helpers, globalIds);
        pageProblems.push(...check.problems);

        graphPages.push({
            pathname: page.pathname,
            owner: page.owner,
            metadataFiles: listMetadataFiles(page.pathname, metadataFiles),
            templateFile: page.templateFile,
            partialFiles: page.partials.filter(({ file }) => file !== null).map(({ file }) => file),
            includeFiles: page.includeFiles.slice(),
            globalPartials: reachGlobalPartials(check.globalReferences, globalPartials),
        });
    }

    graphPages.sort((left, right) => compareStrings(left.pathname, right.pathname));

    const problems = [
        ...pageProblems,
        ...Array.from(globalPartials.values()).flatMap((check) => check.problems),
        ...baseTemplates.flatMap(({ check }) => check.problems),
    ];

    const graph = {
        pages: graphPages,
        globalPartials: templates.globalPartials.map(({ id, owner, file }) => {
            return { id, owner, file, partials: globalPartials.get(id).globalReferences };
        }).sort(compareIds),
        baseTemplates: baseTemplates.map(({ template, check }) => {
            return {
                id: template.id,
                owner: template.owner,
                file: template.file,
                globalPartials: reachGlobalPartials(check.globalReferences, globalPartials),
            };
        }).sort(compareIds),
    };

    return {
        problems,
        pages: reportPages(graphPages, [ ...scanProblems, ...pageProblems ], globalPartials),
        graph,
    };
}

function compareIds(left, right) {
    return compareStrings(left.id, right.id);
}

// Checks a global partial or a base template. Its references may name only
// global partials.
function checkGlobalTemplate(template, helpers, globalIds) {
    const { problems, references } = checkTemplate(template.file, template.source, helpers, {});
    const globalReferences = new Set();

    for (const reference of references) {
        if (globalIds.has(reference.partial)) {
            globalReferences.add(reference.partial);
        } else {
            problems.push(createMissingPartialProblem(template.file, reference, {}));
        }
    }

    return {
        problems,
        globalReferences: Array.from(globalReferences).sort(compareStrings),
    };
}

// Checks a page's own templates: the title and description templates in its
// page.json, its template, and each of its partials.
function checkPage(page, helpers, globalIds) {
    const fields = { page: page.pathname };
    const problems = [];
    const globalReferences = new Set();

    // Every declared partial counts as present, so a partial whose file is
    // already a problem isn't reported again where it is referenced.
    const pagePartialIds = new Set(page.partials.map(({ id }) => id));

    for (const name of [ 'title', 'description' ]) {
        const source = page.metadata?.page?.[name]?.template;

        // These render with no partials at all, so their references aren't
        // resolved.
        if (isNonEmptyString(source)) {
            const failure = compileTemplate(page.metadataFile, source, helpers).failure;

            if (failure) {
                problems.push(createCompileProblem(page.metadataFile, failure, {
                    field: `page.${ name }.template`,
                    ...fields,
                }));
            }
        }
    }

    const pageTemplates = [];

    if (page.templateSource !== null) {
        pageTemplates.push({ file: page.templateFile, source: page.templateSource });
    }

    for (const partial of page.partials) {
        if (partial.source !== null) {
            pageTemplates.push({ file: partial.file, source: partial.source });
        }
    }

    for (const template of pageTemplates) {
        const check = checkTemplate(template.file, template.source, helpers, fields);
        problems.push(...check.problems);

        for (const reference of check.references) {
            if (pagePartialIds.has(reference.partial)) {
                continue;
            }

            if (globalIds.has(reference.partial)) {
                globalReferences.add(reference.partial);
            } else {
                problems.push(createMissingPartialProblem(template.file, reference, fields));
            }
        }
    }

    return {
        problems,
        globalReferences: Array.from(globalReferences),
    };
}

// Compiles one partial or template. Returns its compile problem, if it has
// one, and the partial references that could be read from it.
function checkTemplate(file, source, helpers, fields) {
    if (source.length === 0) {
        return {
            problems: [ {
                code: 'empty-template',
                filepath: file,
                message: `Template "${ file }" is empty`,
                ...fields,
            } ],
            references: [],
        };
    }

    const { failure, references } = compileTemplate(file, source, helpers);

    return {
        problems: failure ? [ createCompileProblem(file, failure, fields) ] : [],
        references,
    };
}

// Runs the engine's three steps, as rendering does, and discards the render
// function. The engine stops at a template's first error.
function compileTemplate(file, source, helpers) {
    let tree;

    try {
        tree = buildSyntaxTree(null, tokenize(null, file, source));
    } catch (failure) {
        return { failure, references: [] };
    }

    const references = [];
    collectPartialReferences(references, tree);

    try {
        createRenderFunction(null, helpers, tree);
    } catch (failure) {
        return { failure, references };
    }

    return { failure: null, references };
}

// A partial's name is the whole expression, exactly as the engine looks it
// up when it renders.
function collectPartialReferences(references, nodes) {
    for (const node of nodes) {
        if (node.type === 'PARTIAL') {
            references.push({ partial: node.exp, line: node.openToken.lineNumber });
        }

        if (Array.isArray(node.children)) {
            collectPartialReferences(references, node.children);
        }
    }
}

function createCompileProblem(file, failure, fields) {
    // The engine doesn't export its error class.
    if (failure.name !== 'LineSyntaxError') {
        return {
            code: 'template-syntax-error',
            filepath: file,
            message: `Template "${ file }" cannot be compiled: ${ failure.message }`,
            ...fields,
        };
    }

    const match = HELPER_MESSAGE_PATTERN.exec(failure.message);

    if (match) {
        const helper = match[1];

        return {
            code: 'unregistered-helper',
            filepath: file,
            message: `Template helper "${ helper }" is used in "${ file }" on line ${ failure.lineNumber } but is not declared. Declare it under "templateHelpers" in the manifest of the app or plugin that registers it.`,
            helper,
            line: failure.lineNumber,
            ...fields,
        };
    }

    return {
        code: 'template-syntax-error',
        filepath: file,
        message: failure.message,
        line: failure.lineNumber,
        ...fields,
    };
}

function createMissingPartialProblem(file, reference, fields) {
    return {
        code: 'missing-partial',
        filepath: file,
        message: `Partial "${ reference.partial }" referenced in "${ file }" on line ${ reference.line } does not exist`,
        partial: reference.partial,
        line: reference.line,
        ...fields,
    };
}

// Follows references from global partial to global partial. A partial that
// includes itself, directly or through others, is legitimate: the visited
// set ends the walk.
function reachGlobalPartials(ids, globalPartials) {
    const reached = new Set();
    const pending = Array.from(ids);

    while (pending.length > 0) {
        const id = pending.pop();

        if (!reached.has(id)) {
            reached.add(id);
            pending.push(...globalPartials.get(id).globalReferences);
        }
    }

    return Array.from(reached).sort(compareStrings);
}

function listMetadataFiles(pathname, metadataFiles) {
    const files = [ metadataFiles.get(pathname) ];
    let ancestor = pathname;

    while (ancestor !== '/') {
        ancestor = ancestor.slice(0, ancestor.lastIndexOf('/')) || '/';

        if (metadataFiles.has(ancestor)) {
            files.push(metadataFiles.get(ancestor));
        }
    }

    return files;
}

function reportPages(graphPages, problems, globalPartials) {
    const ownProblems = new Map();

    for (const problem of problems) {
        if (problem.page !== undefined) {
            if (!ownProblems.has(problem.page)) {
                ownProblems.set(problem.page, []);
            }

            ownProblems.get(problem.page).push(problem);
        }
    }

    const pages = [];

    for (const page of graphPages) {
        const pageProblems = [
            ...(ownProblems.get(page.pathname) ?? []),
            ...page.globalPartials.flatMap((id) => globalPartials.get(id).problems),
        ];

        if (pageProblems.length > 0) {
            pages.push({ pathname: page.pathname, problems: pageProblems });
        }
    }

    return pages;
}
