// Builds a complete Kixx project in a directory: the project skeleton from
// devkit/templates/project/, core as kixx/, optional overlays, the files the
// overlays import, and the generated files.
//
// It copies bytes and substitutes nothing, so every file in the result is the
// one a real project gets. The skeleton and core are always this
// repository's: they are not options.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeProjectFiles } from '../../kixx/tooling/mod.js';
import { OperationalError } from '../../kixx/errors/mod.js';
import { createProjectFileSystem } from '../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { readImportGraph } from './import-graph.js';


const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));
const CORE_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'kixx');
const SKELETON_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'devkit', 'templates', 'project');

// Written at the root of every directory this module builds. A directory
// that holds it may be replaced. Any other directory that isn't empty is
// never touched.
export const MARKER_FILE_NAME = '.kixx-assembled';

const MARKER_TEXT = 'Built by tools/lib/assemble-project.js. The next build replaces this whole directory.\n';


/**
 * Builds a project in targetDirectory, replacing a project built there
 * before.
 *
 * @param {Object} options
 * @param {string} options.targetDirectory - Absolute path. It must not exist, be empty, or hold the marker file of an earlier build.
 * @param {Array<{from: string, to: string}>} [options.overlays] - Files or directories to copy over the skeleton, in order. `from` is an absolute path. `to` is a POSIX path relative to the target. A later file replaces an earlier one.
 * @param {string[]} [options.closureEntries] - Absolute paths of files in this repository to copy with everything they import.
 * @returns {Promise<string[]>} Every file written, as sorted POSIX paths relative to the target
 * @throws {OperationalError} When the target can't be replaced, or an import can't be resolved
 */
export async function assembleProject(options) {
    const { targetDirectory, overlays = [], closureEntries = [] } = options ?? {};

    await prepareTargetDirectory(targetDirectory);

    // The skeleton stores its .gitignore as `gitignore`: a real one would
    // act on this repository, and npm leaves one out of a package.
    await fsp.cp(SKELETON_DIRECTORY, targetDirectory, { recursive: true });
    await fsp.rename(path.join(targetDirectory, 'gitignore'), path.join(targetDirectory, '.gitignore'));

    await fsp.cp(CORE_DIRECTORY, path.join(targetDirectory, 'kixx'), { recursive: true });

    const overlaySourceFiles = [];

    for (const { from, to } of overlays) {
        await fsp.cp(from, path.join(targetDirectory, ...to.split('/')), { recursive: true });
        overlaySourceFiles.push(...listFiles(from).map((name) => path.join(from, name)));
    }

    // An overlay's own files are already in the target, at its `to`. What
    // they import from the rest of the repository is not.
    const entryFiles = [
        ...closureEntries,
        ...overlaySourceFiles.filter((filepath) => filepath.endsWith('.js')),
    ];

    for (const filepath of readImportClosure({ entryFiles })) {
        if (!overlaySourceFiles.includes(filepath)) {
            const destination = path.join(targetDirectory, path.relative(REPOSITORY_DIRECTORY, filepath));

            await fsp.mkdir(path.dirname(destination), { recursive: true });
            await fsp.copyFile(filepath, destination);
        }
    }

    await fsp.writeFile(path.join(targetDirectory, MARKER_FILE_NAME), MARKER_TEXT);

    await writeProjectFiles({ fileSystem: createProjectFileSystem(targetDirectory) });

    // The target was empty, so everything in it now was written here.
    return listFiles(targetDirectory).map((name) => name.split(path.sep).join('/')).sort();
}

/**
 * Follows static relative imports from the entry files and returns every
 * file reached outside core, the entry files included. Core is not read: a
 * built project already holds all of it.
 *
 * @param {Object} options
 * @param {string[]} options.entryFiles - Absolute paths
 * @param {string} [options.rootDirectory] - No import may leave it. Defaults to this repository.
 * @param {string} [options.coreDirectory] - Defaults to this repository's core.
 * @returns {string[]} Absolute paths
 * @throws {OperationalError} When an entry file doesn't exist, or an import leaves the root or names a file that doesn't exist
 */
export function readImportClosure(options) {
    const {
        entryFiles,
        rootDirectory = REPOSITORY_DIRECTORY,
        coreDirectory = CORE_DIRECTORY,
    } = options ?? {};

    for (const entryFile of entryFiles) {
        if (!fs.existsSync(entryFile)) {
            throw new OperationalError(`Can't build the project: ${ entryFile } doesn't exist.`);
        }
    }

    const resolve = (importer, specifier) => {
        const target = path.resolve(path.dirname(importer), specifier);

        if (!isInsideDirectory(rootDirectory, target)) {
            throw new OperationalError(
                `Can't build the project: ${ importer } imports "${ specifier }", which is outside ${ rootDirectory }.`,
            );
        }

        if (!fs.existsSync(target)) {
            throw new OperationalError(
                `Can't build the project: ${ importer } imports "${ specifier }", which doesn't exist.`,
            );
        }

        return target;
    };

    const isInsideCore = (filepath) => isInsideDirectory(coreDirectory, filepath);

    return readImportGraph(entryFiles, isInsideCore, resolve)
        .map(({ file }) => file)
        .filter((filepath) => !isInsideCore(filepath));
}

// Leaves an empty directory at the target. The marker is the whole check: a
// directory without it that holds anything is refused and left as it is.
async function prepareTargetDirectory(targetDirectory) {
    if (typeof targetDirectory !== 'string' || !path.isAbsolute(targetDirectory)) {
        throw new OperationalError('Can\'t build the project: the target directory must be an absolute path.');
    }

    let names;

    try {
        names = await fsp.readdir(targetDirectory);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            await fsp.mkdir(targetDirectory, { recursive: true });
            return;
        }

        if (cause.code === 'ENOTDIR') {
            throw new OperationalError(`Can't build the project: ${ targetDirectory } is not a directory.`, { cause });
        }

        throw cause;
    }

    if (names.length === 0) {
        return;
    }

    if (!names.includes(MARKER_FILE_NAME)) {
        throw new OperationalError(
            `Can't build the project: ${ targetDirectory } isn't empty and wasn't built by this tool `
            + `(it has no ${ MARKER_FILE_NAME } file). Choose another directory, or remove it yourself.`,
        );
    }

    await fsp.rm(targetDirectory, { recursive: true, force: true });
    await fsp.mkdir(targetDirectory, { recursive: true });
}

// Every file under a directory, at any depth, as paths relative to it. A
// path that is a file gives one empty name: the file itself.
function listFiles(directoryOrFile) {
    if (!fs.statSync(directoryOrFile).isDirectory()) {
        return [ '' ];
    }

    return fs.readdirSync(directoryOrFile, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directoryOrFile, path.join(entry.parentPath, entry.name)));
}

function isInsideDirectory(directory, filepath) {
    const relativePath = path.relative(directory, filepath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}
