import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


/**
 * @typedef {Object} WalkEntry
 * @property {string} path - Full path to the file, directory, or symlink
 */


/**
 * Ensures that the directory exists, creating it and any intermediate directories
 * if they do not already exist. Equivalent to `mkdir -p`.
 *
 * This function is idempotent: if the directory already exists, it succeeds without
 * throwing. If the path already exists but is not a directory, the underlying OS
 * error is propagated.
 *
 * @public
 * @async
 * @param {string|URL} dir - Path to the directory to ensure
 * @returns {Promise<void>} Resolves when the directory exists
 * @throws {Error} When the directory cannot be created (e.g., permission denied, path is an existing non-directory)
 */
export async function ensureDir(dir) {
    // recursive: true creates intermediate directories as needed and does not throw
    // when the directory already exists, making this operation idempotent
    await fsp.mkdir(dir, { recursive: true });
}

/**
 * Ensures that a regular file exists at the given path. If the file does not exist,
 * it is created as an empty file. If the parent directories for the file do not exist,
 * they are created automatically.
 *
 * This function is idempotent: if the file already exists, it succeeds without
 * modifying the file's contents.
 *
 * @public
 * @async
 * @param {string|URL} filePath - Path to the file to ensure
 * @returns {Promise<void>} Resolves when the file exists
 * @throws {Error} When creating the file or its parent directories fails (e.g., permission denied)
 */
export async function ensureFile(filePath) {
    try {
        await fsp.lstat(filePath);
    } catch (cause) {
        if (cause.code !== 'ENOENT') {
            throw cause;
        }

        // File doesn't exist — create the parent directory tree first, then
        // open the file with the 'a' (append) flag. The 'a' flag creates the
        // file if it doesn't exist without truncating it if it was created
        // concurrently between our lstat() and open() calls
        const parentDir = path.dirname(toPathString(filePath));
        await fsp.mkdir(parentDir, { recursive: true });
        const fileHandle = await fsp.open(filePath, 'a');
        await fileHandle.close();
    }
}

/**
 * Recursively walks through a directory tree, yielding a WalkEntry for the root
 * directory followed by every file, directory, and symlink encountered.
 *
 * The root directory itself is always the first entry yielded (when `includeDirs`
 * is true). Traversal order within each directory is determined by the filesystem.
 *
 * Filters (`exts`, `match`, `skip`) are applied to entry paths. Directories are
 * always recursed into even if they don't satisfy `exts` or `match`, since they
 * may contain entries that do. Only `skip` prevents recursion into a directory.
 *
 * @public
 * @param {string|URL} root - Path to the root directory to walk
 * @param {Object} [options={}] - Walk options
 * @param {number} [options.maxDepth=Infinity] - Maximum recursion depth; 0 yields only the root
 * @param {boolean} [options.includeFiles=true] - Whether to yield file entries
 * @param {boolean} [options.includeDirs=true] - Whether to yield directory entries
 * @param {boolean} [options.includeSymlinks=true] - Whether to yield symlink entries when not following them
 * @param {boolean} [options.followSymlinks=false] - Whether to resolve and follow symbolic links
 * @param {boolean} [options.canonicalize=true] - When following symlinks, whether to use the resolved real path
 * @param {string[]} [options.exts] - Only yield entries whose path ends with one of these extensions (e.g. ['.js', '.ts'])
 * @param {RegExp[]} [options.match] - Only yield entries whose path matches at least one of these patterns
 * @param {RegExp[]} [options.skip] - Exclude entries whose path matches any of these patterns; matching directories are not recursed into
 * @returns {AsyncGenerator<WalkEntry>} Async generator yielding WalkEntry objects
 * @throws {Error} When reading a directory fails (e.g., permission denied)
 * @see https://jsr.io/@std/fs/doc/~/walk
 */
export async function* walk(root, options = {}) {
    const {
        maxDepth = Infinity,
        includeFiles = true,
        includeDirs = true,
        includeSymlinks = true,
        followSymlinks = false,
        canonicalize = true,
        exts,
        match,
        skip,
    } = options;

    if (maxDepth < 0) {
        return;
    }

    const rootPath = toPathString(root);

    // Yield the root directory as the first entry. This mirrors Deno's walk()
    // behavior where the root is always included before its contents
    if (includeDirs) {
        try {
            await fsp.lstat(rootPath);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return;
            }
            throw cause;
        }

        yield { path: rootPath };
    }

    // Stop here if we've hit the depth limit or this directory is skipped.
    // Depth 0 means "yield the root only, don't read its contents"
    if (maxDepth < 1 || !testCanRecurse(rootPath, skip)) {
        return;
    }

    let entries;
    try {
        entries = await fsp.readdir(rootPath, { withFileTypes: true });
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return;
        }
        throw cause;
    }

    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        let isSymlink = entry.isSymbolicLink();
        let isDirectory = entry.isDirectory();
        // currentPath tracks the path used for recursion, which may diverge from
        // entryPath when followSymlinks + canonicalize are both enabled
        let currentPath = entryPath;

        if (isSymlink) {
            if (!followSymlinks) {
                // Yield the symlink entry without resolving it. Applying the
                // include filters here lets callers skip unwanted symlinks via
                // exts, match, or skip options
                if (includeSymlinks && testInclude(entryPath, exts, match, skip)) {
                    yield { path: entryPath };
                }
                continue;
            }

            // Resolve the symlink to determine the type of its target. We use
            // lstat on the real path rather than stat so that chains of symlinks
            // are handled correctly — lstat on a resolved realpath tells us the
            // type of the final target without following further links
            const realPath = await fsp.realpath(entryPath);
            // Use the canonicalized (real) path for recursion when requested, so
            // that yielded entry paths reflect the actual filesystem location
            if (canonicalize) {
                currentPath = realPath;
            }
            const linkStat = await fsp.lstat(realPath);
            isSymlink = linkStat.isSymbolicLink();
            isDirectory = linkStat.isDirectory();
        }

        if (isDirectory || isSymlink) {
            // Recurse into the directory, reducing maxDepth by one so each level
            // of nesting consumes one unit of the remaining depth budget.
            // Infinity - 1 === Infinity, so an unlimited depth stays unlimited
            yield* walk(currentPath, {
                maxDepth: maxDepth - 1,
                includeFiles,
                includeDirs,
                includeSymlinks,
                followSymlinks,
                canonicalize,
                exts,
                match,
                skip,
            });
        } else if (includeFiles && testInclude(entryPath, exts, match, skip)) {
            // Preserve the original entry flags (isFile, isSymbolicLink) so that
            // followed symlinks to files are reported with isSymlink: true,
            // consistent with Deno's walk() behavior
            yield { path: entryPath };
        }
    }
}

/**
 * Converts a path string or file URL to a filesystem path string.
 * Uses fileURLToPath for URL objects to handle cross-platform path encoding correctly.
 */
function toPathString(input) {
    if (input instanceof URL) {
        return fileURLToPath(input);
    }
    return input;
}

/**
 * Tests whether an entry path satisfies all active walk() include filters.
 *
 * All filters that are provided must pass:
 * - exts: the path must end with at least one of the given extensions
 * - match: the path must match at least one of the given patterns
 * - skip: the path must not match any of the given patterns
 *
 * A filter is inactive (not applied) when its value is undefined.
 */
function testInclude(entryPath, exts, match, skip) {
    if (exts && !exts.some((ext) => entryPath.endsWith(ext))) {
        return false;
    }
    if (match && !match.some((pattern) => pattern.test(entryPath))) {
        return false;
    }
    if (skip && skip.some((pattern) => pattern.test(entryPath))) {
        return false;
    }
    return true;
}

/**
 * Tests whether walk() should recurse into a directory at the given path.
 *
 * Only skip patterns gate recursion — exts and match filters do not, because a
 * directory that doesn't match those filters may still contain entries that do.
 */
function testCanRecurse(dirPath, skip) {
    if (skip && skip.some((pattern) => pattern.test(dirPath))) {
        return false;
    }
    return true;
}
