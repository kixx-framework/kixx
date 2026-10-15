import path from 'node:path';
import BundleError from './bundle-error.js';
import fileSystemAdapter from '../file-system.js';
import resolveSpecifier from './resolve-specifier.js';
import stripComments from './strip-comments.js';

/**
 * Crawls static ES module dependencies and returns comment-stripped module data.
 * @param {Object} args - Bundle options.
 * @param {string} args.entryFilepath - Absolute path of the root module.
 * @param {string[]} [args.externals=[]] - Permitted bare import specifiers.
 * @param {import('../file-system.js').FileSystem} [args.fileSystem] - Filesystem adapter.
 * @returns {Promise<{ entry: string, modules: Map<string, { name: string, source: string }> }>} Bundle data.
 * @throws {BundleError} When any reachable module cannot be bundled.
 */
export default async function bundleModules(args) {
    const {
        entryFilepath,
        externals = [],
        fileSystem = fileSystemAdapter,
    } = args ?? {};
    const baseDirectory = path.dirname(entryFilepath);
    const entry = `./${ path.basename(entryFilepath) }`;
    const modules = new Map();
    const visited = new Set();
    const diagnostics = [];

    if (!isJavaScriptModule(entryFilepath)) {
        diagnostics.push(makeEntryDiagnostic('Entry module must use a .js or .mjs extension.'));
    } else if (!await fileSystem.isFile(entryFilepath)) {
        diagnostics.push(makeEntryDiagnostic('Entry module is not an existing file.'));
    } else {
        await crawlModule({
            name: entry,
            filepath: entryFilepath,
            baseDirectory,
            externals,
            fileSystem,
            modules,
            visited,
            diagnostics,
        });
    }

    if (diagnostics.length > 0) {
        throw new BundleError(diagnostics);
    }

    return { entry, modules };
}

async function crawlModule(args) {
    const {
        name,
        filepath,
        baseDirectory,
        externals,
        fileSystem,
        modules,
        visited,
        diagnostics,
    } = args;

    if (visited.has(filepath)) {
        return;
    }

    visited.add(filepath);

    const originalSource = await fileSystem.readFile(filepath);
    let parsed;

    try {
        parsed = stripComments(originalSource);
    } catch (cause) {
        diagnostics.push({
            importer: name,
            specifier: null,
            line: cause.lineNumber ?? 1,
            column: cause.column ?? 0,
            message: `Unable to parse module: ${ cause.message }`,
        });
        return;
    }

    modules.set(name, { name, source: parsed.source });

    for (const dependency of collectDependencies(parsed.ast)) {
        if (dependency.specifier === null) {
            diagnostics.push({
                importer: name,
                specifier: null,
                line: dependency.line,
                column: dependency.column,
                message: 'Dynamic import() requires a string literal specifier.',
            });
            continue;
        }

        const resolved = await resolveSpecifier({
            specifier: dependency.specifier,
            importer: name,
            importerFilepath: filepath,
            baseDirectory,
            line: dependency.line,
            column: dependency.column,
            externals,
            fileSystem,
        });

        if (resolved.type === 'error') {
            diagnostics.push(resolved.diagnostic);
        } else if (resolved.type === 'internal') {
            await crawlModule({
                name: resolved.name,
                filepath: resolved.filepath,
                baseDirectory,
                externals,
                fileSystem,
                modules,
                visited,
                diagnostics,
            });
        }
    }
}

function isJavaScriptModule(filepath) {
    const extension = path.extname(filepath);
    return extension === '.js' || extension === '.mjs';
}

function makeEntryDiagnostic(message) {
    return {
        importer: null,
        specifier: null,
        line: 1,
        column: 0,
        message,
    };
}

function collectDependencies(ast) {
    const dependencies = [];

    walk(ast, (node) => {
        if (node.type === 'ImportDeclaration' ||
            (node.type === 'ExportNamedDeclaration' && node.source) ||
            node.type === 'ExportAllDeclaration') {
            dependencies.push(makeDependency(node.source));
        } else if (node.type === 'ImportExpression') {
            dependencies.push(makeDynamicDependency(node));
        }
    });

    return dependencies;
}

function makeDependency(source) {
    return {
        specifier: source.value,
        line: source.loc.start.line,
        column: source.loc.start.column,
    };
}

function makeDynamicDependency(node) {
    if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        return makeDependency(node.source);
    }

    return {
        specifier: null,
        line: node.loc.start.line,
        column: node.loc.start.column,
    };
}

function walk(value, visit) {
    if (!value || typeof value !== 'object') {
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            walk(item, visit);
        }

        return;
    }

    if (typeof value.type === 'string') {
        visit(value);
    }

    for (const child of Object.values(value)) {
        walk(child, visit);
    }
}
