import { assert, isObjectNotNull, isString } from '../assertions/mod.js';
import { ValidationError } from '../errors/mod.js';
import ContentAddressableIndex from '../content-addressable-store/content-addressable-index.js';
import { validateReleaseManifest } from '../content-addressable-store/release-manifest.js';
import { createInvalidReleaseProblems, serializeContentObject } from './compile-content.js';
import { createReleaseManifest } from './create-release-manifest.js';

/**
 * @typedef {import('../content-addressable-store/content-addressable-store.js').SuppliedContent} SuppliedContent
 */

/**
 * @typedef {import('./compile-content.js').ContentProblem} ContentProblem
 */


/**
 * Turns a compilation into content a content store can serve a request from
 * in place of a Release.
 *
 * It works for any compilation, with or without problems, because it is built
 * from the objects and never from the Release. The objects are indexed with
 * the functions a publish uses, so a request served from the result sees what
 * a publish of the same tree would produce.
 *
 * When the objects can't form an index at all, the result has an empty index
 * and reports every problem for every page.
 *
 * @param {Object} compilation - What compileContent() resolved
 * @param {Object[]} compilation.objects - The content objects
 * @param {Object} compilation.report - The compilation's report
 * @param {Object} compilation.graph - The dependency graph
 * @returns {Promise<SuppliedContent & { report: Object, problems: ContentProblem[] }>}
 *   Supplied content, with the compilation's report and every problem that should be logged
 * @throws {AssertionError} When compilation is not what compileContent() resolves
 */
export async function createCompiledContent(compilation) {
    assert(isObjectNotNull(compilation), 'createCompiledContent: compilation must be an object');

    const { objects, report, graph } = compilation;

    assert(Array.isArray(objects), 'createCompiledContent: compilation.objects must be an Array');
    assert(isObjectNotNull(report), 'createCompiledContent: compilation.report must be an object');
    assert(isObjectNotNull(graph), 'createCompiledContent: compilation.graph must be an object');

    let entries;
    let problems = report.problems;
    let isServable = true;

    try {
        // The same two steps index a published Release.
        const files = validateReleaseManifest(createReleaseManifest(objects));
        entries = await ContentAddressableIndex.buildIndex(files);
    } catch (error) {
        if (!(error instanceof ValidationError)) {
            throw error;
        }

        // No index can hold these objects, so no page can be trusted.
        isServable = false;
        entries = await ContentAddressableIndex.buildIndex([]);

        // The compiler runs the same validator, but only on a tree with no
        // other problem. Add what it didn't already report.
        const reported = new Set(report.problems.map(({ code, message }) => `${ code }#${ message }`));
        const unreported = createInvalidReleaseProblems(error, '').filter(({ code, message }) => {
            return !reported.has(`${ code }#${ message }`);
        });

        problems = [ ...report.problems, ...unreported ];
    }

    const pageProblems = new Map(report.pages.map((page) => [ page.pathname, page.problems ]));
    const baseTemplateProblems = collectBaseTemplateProblems(report, graph);

    return {
        index: new ContentAddressableIndex(entries),
        objects: createObjectReader(objects),
        report,
        problems,

        getPageProblems(pathname) {
            if (!isServable) {
                return problems;
            }

            return pageProblems.get(pathname) ?? [];
        },

        getBaseTemplateProblems(id) {
            return baseTemplateProblems.get(id) ?? [];
        },
    };
}

// A base template has no link to pages, so its problems are found by file:
// its own, and those of every global partial it reaches.
function collectBaseTemplateProblems(report, graph) {
    const byId = new Map();

    if (report.problems.length === 0) {
        return byId;
    }

    const partialFiles = new Map(graph.globalPartials.map(({ id, file }) => [ id, file ]));

    for (const baseTemplate of graph.baseTemplates) {
        const files = new Set([ baseTemplate.file ]);

        for (const id of baseTemplate.globalPartials) {
            files.add(partialFiles.get(id));
        }

        const problems = report.problems.filter(({ filepath }) => files.has(filepath));

        if (problems.length > 0) {
            byId.set(baseTemplate.id, [ ...(byId.get(baseTemplate.id) ?? []), ...problems ]);
        }
    }

    return byId;
}

// Reads objects from memory by hash, as a content store's getFile() and
// getFiles() do. The pathname is ignored: a hash names its bytes.
function createObjectReader(objects) {
    const values = new Map();

    for (const object of objects) {
        values.set(object.hash, serializeContentObject(object));
    }

    function read(type, hash) {
        const value = values.get(hash);

        if (value === undefined) {
            return null;
        }

        switch (type) {
            case 'text':
                return isString(value) ? value : new TextDecoder().decode(value);
            case 'arrayBuffer':
                return toArrayBuffer(value);
            case 'stream':
                return createStream(value);
            default:
                assert(false, `Compiled content can't be read as "${ type }"`);
        }

        return null;
    }

    return {
        async getFile(_context, type, _pathname, hash) {
            return read(type, hash);
        },

        async getFiles(_context, type, files) {
            return files.map(({ hash }) => read(type, hash));
        },
    };
}

// Always a copy, so a caller can't change or detach the stored bytes.
function toArrayBuffer(value) {
    if (isString(value)) {
        const bytes = new TextEncoder().encode(value);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    return value.slice(0);
}

function createStream(value) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(toArrayBuffer(value)));
            controller.close();
        },
    });
}
