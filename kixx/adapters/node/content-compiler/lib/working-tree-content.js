import fsp from 'node:fs/promises';
import path from 'node:path';
import {
    assert,
    assertArray,
    assertNonEmptyString,
    isFunction,
    isObjectNotNull,
} from '../../../../assertions/mod.js';
import { OperationalError } from '../../../../errors/mod.js';
import { compileContent, createCompiledContent, listContentDirectories } from '../../../../content-compiler/mod.js';
import { createFileSystemContentSource } from './file-system-content-source.js';


/**
 * @typedef {import('../../../../content-addressable-store/content-addressable-store.js').SuppliedContent} SuppliedContent
 */


// What the file system answers when a path, or a directory on the way to it,
// doesn't exist.
const MISSING_CODES = [ 'ENOENT', 'ENOTDIR' ];


/**
 * Creates the supplier of a project's working tree as compiled content, for
 * a development server.
 *
 * Every getContent() call checks the modified time and size of every content
 * file, and reads none of them. While nothing has changed, the last
 * compilation is handed out again. When anything has, the whole tree is
 * compiled again.
 *
 * Known limit: an edit that keeps a file's size and lands within the file
 * system's modified-time granularity isn't seen until the next change.
 *
 * @param {Object} options
 * @param {string} options.projectDirectory - The project root
 * @param {Object[]} [options.contentRoots=[]] - The installed plugins' content directories, as compileContent() takes them
 * @param {string[]} options.templateHelpers - Every declared template helper name, as compileContent() takes them
 * @param {Object} options.logger - Logs each new compilation. It is used as given: an application's logger can't make a child once boot is over.
 * @returns {{ getContent: function(): Promise<SuppliedContent> }}
 * @throws {AssertionError} When an option is missing or malformed
 */
export function createWorkingTreeContent(options) {
    assert(isObjectNotNull(options), 'createWorkingTreeContent: options must be an object');

    const { projectDirectory, contentRoots = [], templateHelpers, logger } = options;

    assertNonEmptyString(projectDirectory, 'createWorkingTreeContent: options.projectDirectory');
    assertArray(contentRoots, 'createWorkingTreeContent: options.contentRoots');
    assert(
        isObjectNotNull(logger) && isFunction(logger.info) && isFunction(logger.warn),
        'createWorkingTreeContent: options.logger must be a Logger',
    );

    const root = path.resolve(projectDirectory);
    const source = createFileSystemContentSource(root);
    const directories = listContentDirectories(contentRoots);

    // The last compilation: { signature, promise }.
    let cached = null;

    async function compile() {
        const start = Date.now();
        const compilation = await compileContent({ source, pluginContentRoots: contentRoots, templateHelpers });
        const content = await createCompiledContent(compilation);

        logger.info('working tree content compiled', {
            objects: compilation.objects.length,
            problems: content.problems.length,
            milliseconds: Date.now() - start,
        });

        for (const { code, message, filepath } of content.problems) {
            logger.warn('working tree content problem', { code, message, filepath });
        }

        return content;
    }

    return {
        /**
         * Resolves the working tree's compiled content as it is now.
         *
         * @returns {Promise<SuppliedContent>}
         * @throws {OperationalError} When the file system fails
         * @throws {ValidationError} When a plugin content directory isn't a path inside the project
         */
        async getContent() {
            const signature = await readContentSignature(root, source, directories);

            if (cached && cached.signature === signature) {
                return cached.promise;
            }

            const promise = compile();
            const entry = { signature, promise };
            cached = entry;

            // A failed compile is not remembered: the next call tries again.
            promise.catch(() => {
                if (cached === entry) {
                    cached = null;
                }
            });

            return promise;
        },
    };
}

// Describes the state of every content file in one string: the kind of each
// content directory, then the path, type, modified time, and size of each
// file and symbolic link beneath it. No file is opened and no link followed.
async function readContentSignature(root, source, directories) {
    const lines = await Promise.all(directories.map(async (directory) => {
        let listing;

        try {
            listing = await source.listFiles(directory);
        } catch (error) {
            if (error.name !== 'AssertionError') {
                throw error;
            }

            // The source refuses a path that could leave the project. The
            // compile refuses it too, and says so with a better message.
            return [ `${ directory }\trefused` ];
        }

        const entries = await Promise.all(listing.entries.map((entry) => {
            return describeEntry(root, `${ directory }/${ entry.path }`);
        }));

        return [ `${ directory }\t${ listing.kind }`, ...entries.filter((line) => line !== null) ];
    }));

    return lines.flat().sort().join('\n');
}

async function describeEntry(root, entryPath) {
    const filepath = path.join(root, ...entryPath.split('/'));
    let stats;

    try {
        stats = await fsp.lstat(filepath);
    } catch (cause) {
        // Removed since it was listed.
        if (MISSING_CODES.includes(cause.code)) {
            return null;
        }

        throw new OperationalError(`Unable to read file status ${ filepath } (${ cause.code })`, { cause });
    }

    let type = 'other';

    if (stats.isSymbolicLink()) {
        type = 'symlink';
    } else if (stats.isFile()) {
        type = 'file';
    }

    return `${ entryPath }\t${ type }\t${ stats.mtimeMs }\t${ stats.size }`;
}
