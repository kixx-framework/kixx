import path from 'node:path';

/**
 * Classifies an import specifier for a module bundle.
 * @param {Object} args - Resolution inputs.
 * @param {string} args.specifier - Specifier text from an import expression.
 * @param {string} args.importer - Bundle key of the importing module.
 * @param {string} args.importerFilepath - Absolute logical path of the importing module.
 * @param {string} args.baseDirectory - Absolute root of the bundle namespace.
 * @param {number} args.line - One-based source line of the specifier.
 * @param {number} args.column - Zero-based source column of the specifier.
 * @param {string[]} [args.externals=[]] - Permitted bare specifiers or prefixes.
 * @param {import('../file-system.js').FileSystem} args.fileSystem - Filesystem adapter.
 * @returns {Promise<Object>} External, internal, or error resolution result.
 */
export default async function resolveSpecifier(args) {
    const {
        specifier,
        importer,
        importerFilepath,
        baseDirectory,
        line,
        column,
        externals = [],
        fileSystem,
    } = args ?? {};

    if (!isRelativeSpecifier(specifier)) {
        if (isExternalSpecifier(specifier, externals)) {
            return { type: 'external' };
        }

        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: `Bare specifier "${ specifier }" is not declared external.`,
        });
    }

    const filepath = path.resolve(path.dirname(importerFilepath), specifier);
    const extension = path.extname(filepath);

    if (extension === '.cjs') {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: 'CommonJS modules are not supported.',
        });
    }

    if (extension !== '.js' && extension !== '.mjs') {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: `Unsupported module type "${ extension || '(none)' }"; use .js or .mjs.`,
        });
    }

    if (!isInsideDirectory(filepath, baseDirectory)) {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: 'Resolved module is outside the bundle base directory.',
        });
    }

    if (hasNodeModulesSegment(filepath)) {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: 'Modules inside node_modules cannot be bundled.',
        });
    }

    if (!await fileSystem.isFile(filepath)) {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: 'Resolved module is not an existing file.',
        });
    }

    const realpath = await fileSystem.realpath(filepath);

    if (hasNodeModulesSegment(realpath)) {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: 'Resolved module points into node_modules.',
        });
    }

    if (filepath !== realpath && filepath.toLowerCase() === realpath.toLowerCase()) {
        return errorResult({
            importer,
            specifier,
            line,
            column,
            message: `Module path casing differs from the on-disk path "${ realpath }".`,
        });
    }

    return {
        type: 'internal',
        filepath,
        name: makeModuleName(filepath, baseDirectory),
    };
}

function isRelativeSpecifier(specifier) {
    return specifier.startsWith('./') || specifier.startsWith('../');
}

function isExternalSpecifier(specifier, externals) {
    return externals.some(external => external.endsWith(':') ?
        specifier.startsWith(external) : specifier === external);
}

function isInsideDirectory(filepath, directory) {
    const relativePath = path.relative(path.resolve(directory), filepath);

    return relativePath !== '' && !relativePath.startsWith(`..${ path.sep }`) &&
        relativePath !== '..' && !path.isAbsolute(relativePath);
}

function hasNodeModulesSegment(filepath) {
    return filepath.split(path.sep).includes('node_modules');
}

function makeModuleName(filepath, baseDirectory) {
    const relativePath = path.relative(path.resolve(baseDirectory), filepath);
    return `./${ relativePath.split(path.sep).join('/') }`;
}

function errorResult(diagnostic) {
    return {
        type: 'error',
        diagnostic,
    };
}
