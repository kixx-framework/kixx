import { ValidationError } from '../errors/mod.js';
import { isValidPathname, normalizePathname } from './content-layout.js';
import { FORMAT, hashTree, compareStrings } from './addressing.js';
import {
    assert,
    assertArray,
    isUndefined,
    isPlainObject,
    isNonEmptyString,
} from '../assertions/mod.js';

/**
 * Read-only, in-memory snapshot of a persisted content-addressable index
 * table. Supports point lookups and prefix listings by pathname without
 * re-deriving the underlying directory structure.
 */
export default class ContentAddressableIndex {

    #entries;
    #sortedPaths;

    /**
     * @param {Object<string, IndexEntryTuple>} entries - Encoded index table to validate and copy, typically loaded from durable storage or produced by {@link ContentAddressableIndex.buildIndex}.
     */
    constructor(entries) {
        assert(isPlainObject(entries), 'ContentAddressableIndex: entries must be a plain object');

        for (const [ pathname, tuple ] of Object.entries(entries)) {
            assertValidIndexEntryTuple(pathname, tuple);
        }
        assertValidTreeStructure(entries);

        this.#entries = structuredClone(entries);
    }

    /**
     * Content hash of this immutable index's root directory.
     * @returns {string} Root hash identifying the index closure
     */
    get rootHash() {
        return getRootHash(this.#entries);
    }

    /**
     * Looks up a single node by exact pathname.
     * @param {string} pathname - The pathname for the node, including a leading slash "/".
     * @returns {Promise<IndexEntry|null>} The matching node, or null when no entry exists at that pathname.
     */
    getNode(pathname) {
        const tuple = this.#entries[pathname];
        return tuple ? this.#decodeNode(pathname, tuple) : null;
    }

    /**
     * Lists all the nodes under a given directory (the prefix), optionally recursively.
     * @param {string} prefix - A prefix directory with a leading slash; a trailing slash "/" is added if missing. Pass '' to list from the root.
     * @param {Object} [options]
     * @param {boolean} [options.recursive=true] - When false, only list the prefix's immediate children — nested nodes are skipped.
     * @returns {Promise<IndexEntry[]>} Matching nodes in pathname sort order.
     */
    listNodes(prefix, options) {
        const { recursive = true } = options ?? {};

        // The prefix must end with a slash "/".
        if (prefix !== '' && !prefix.endsWith('/')) {
            prefix = `${ prefix }/`;
        }

        const paths = this.#getSortedPaths();
        const start = lowerBound(paths, prefix);

        const matchingPaths = [];
        for (let i = start; i < paths.length; i += 1) {
            const path = paths[i];
            // Sorted order guarantees every path matching path is contiguous, so the first
            // miss past `start` means there are no more — stop instead of
            // scanning the rest of the index.
            if (prefix !== '' && !path.startsWith(prefix)) {
                break;
            }
            // The root pathname is also its own slash-terminated prefix, unlike
            // every other directory pathname. Listings contain children only.
            if (path === prefix) {
                continue;
            }
            // If a path includes a "/" beyond the scope, then we know it is nested.
            // Paths never end with a slash "/" -- not even directories.
            if (!recursive && path.slice(prefix.length).includes('/')) {
                continue;
            }
            matchingPaths.push(path);
        }

        return matchingPaths.map((path) => {
            return this.#decodeNode(path, this.#entries[path]);
        });
    }

    async #decodeNode(pathname, tuple) {
        const { kind, hash, size, metadata } = decodeIndexEntryTuple(tuple);
        return {
            pathname,
            kind,
            hash,
            size,
            metadata: metadata === null ? null : structuredClone(metadata),
        };
    }

    #getSortedPaths() {
        if (this.#sortedPaths) {
            return this.#sortedPaths;
        }
        this.#sortedPaths = Object.keys(this.#entries).sort(compareStrings);
        return this.#sortedPaths;
    }

    /**
     * Builds an encoded index table from a flat list of files, deriving and
     * hashing the directory tree implied by their pathnames. The result is
     * suitable for storage and can be passed to the
     * {@link ContentAddressableIndex} constructor to rehydrate an index.
     * @param {IndexSourceFile[]} files - Files to include in the index.
     * @returns {Promise<Object<string, IndexEntryTuple>>} Encoded index table keyed by pathname.
     * @throws {AssertionError} When `files` is not an array
     * @throws {ValidationError} When any file entry is malformed or collides with another
     */
    static async buildIndex(files) {
        validateIndexSourceFiles(files);

        const nodeList = buildDirectoryTree(files);
        const treeHashes = new Map();

        // buildDirectoryTree() pushes every directory before the children
        // nested under it, so walking the list in reverse reaches each
        // subdirectory before its parent. Every child hash a directory needs is
        // therefore already memoized when its turn comes, and each subtree is
        // hashed exactly once — hashing top-down instead would re-hash each
        // subtree once per ancestor above it.
        for (let i = nodeList.length - 1; i >= 0; i -= 1) {
            const node = nodeList[i];
            if (node.kind === 'tree') {
                treeHashes.set(node.pathname, await hashDirectory(node, treeHashes));
            }
        }

        // Built in a second pass rather than in the one above so the table is
        // keyed in the tree's own top-down order.
        const entries = {};

        for (const node of nodeList) {
            if (node.kind === 'tree') {
                // The "tree" kind is a directory
                entries[node.pathname] = encodeIndexEntry('tree', { hash: treeHashes.get(node.pathname) });
            } else {
                // The "blob" is the only other kind, and represents a file.
                entries[node.pathname] = encodeIndexEntry('blob', node);
            }
        }

        return entries;
    }
}

function assertValidIndexEntryTuple(pathname, tuple) {
    const messagePrefix = `ContentAddressableIndex: entry "${ pathname }"`;
    assert(
        isValidPathname(pathname) && normalizePathname(pathname) === pathname,
        `${ messagePrefix } pathname must be safe and canonical`,
    );
    assertArray(tuple, `${ messagePrefix } must be a tuple`);

    const [ kind, hash, size, metadata ] = tuple;
    assert(kind === 'tree' || kind === 'blob', `${ messagePrefix } kind must be "tree" or "blob"`);
    assert(isNonEmptyString(hash), `${ messagePrefix } hash must be a non-empty string`);

    if (kind === 'tree') {
        assert(tuple.length === 2, `${ messagePrefix } tree tuple must contain exactly 2 elements`);
        return;
    }

    assert(tuple.length === 4, `${ messagePrefix } blob tuple must contain exactly 4 elements`);
    assert(
        Number.isInteger(size) && size >= 0,
        `${ messagePrefix } blob size must be a non-negative integer`,
    );
    assert(
        metadata === null || isPlainObject(metadata),
        `${ messagePrefix } blob metadata must be a plain object or null`,
    );
}

function assertValidTreeStructure(entries) {
    const root = entries['/'];
    assert(root, 'ContentAddressableIndex: entry "/" must be present');
    assert(root[0] === 'tree', 'ContentAddressableIndex: entry "/" must be a tree');

    const childCounts = new Map();

    for (const pathname of Object.keys(entries)) {
        if (pathname === '/') {
            continue;
        }

        const separatorIndex = pathname.lastIndexOf('/');
        const parentPathname = separatorIndex === 0 ? '/' : pathname.slice(0, separatorIndex);
        const parent = entries[parentPathname];
        const messagePrefix = `ContentAddressableIndex: entry "${ pathname }" parent "${ parentPathname }"`;

        assert(parent, `${ messagePrefix } must be present`);
        assert(parent[0] === 'tree', `${ messagePrefix } must be a tree`);
        childCounts.set(parentPathname, (childCounts.get(parentPathname) ?? 0) + 1);
    }

    for (const [ pathname, tuple ] of Object.entries(entries)) {
        if (pathname !== '/' && tuple[0] === 'tree') {
            assert(
                childCounts.has(pathname),
                `ContentAddressableIndex: entry "${ pathname }" tree must contain at least one child`,
            );
        }
    }
}

/**
 * Reads the root hash — the digest which identifies a whole closure — out of
 * an encoded index table.
 *
 * The write path works in encoded tables rather than ContentAddressableIndex
 * instances, so this is how a committed closure is named without paying to
 * construct and clone an index. Prefer it to reaching into the root tuple at
 * the call site: the tuple layout is this module's business.
 * @param {Object<string, IndexEntryTuple>} entries - Encoded index table, as returned by {@link ContentAddressableIndex.buildIndex}.
 * @returns {string} Root hash identifying the closure.
 * @throws {AssertionError} When the table has no root tree entry
 */
export function getRootHash(entries) {
    const tuple = isPlainObject(entries) ? entries['/'] : null;
    assert(
        Array.isArray(tuple) && tuple[0] === 'tree' && isNonEmptyString(tuple[1]),
        'getRootHash: entries must contain a root tree entry "/"',
    );
    return tuple[1];
}

/**
 * Validates the file list `buildIndex` derives an index from, collecting every
 * failure before throwing.
 *
 * This is the write-side boundary check for the index. `files` originates in
 * client-supplied input (a publishing manifest arriving over HTTP), so a
 * malformed entry is an expected operational failure the caller can correct,
 * reported as a ValidationError. The container itself is a programmer's
 * responsibility rather than the client's, so a non-array `files` still
 * asserts.
 *
 * Passing this check is what lets the write path skip constructing a
 * ContentAddressableIndex: a validated file list can only produce an entry
 * table which already satisfies the constructor's assertions. Those assertions
 * remain the read-side check, where a table is decoded back out of storage and
 * was not produced by this process.
 * @param {IndexSourceFile[]} files - Files to validate.
 * @returns {void}
 * @throws {AssertionError} When `files` is not an array
 * @throws {ValidationError} When any file entry is malformed or collides with another
 */
export function validateIndexSourceFiles(files) {
    assertArray(files, 'ContentAddressableIndex.buildIndex(files)');

    const error = new ValidationError('The index source files contain invalid entries');
    const pathnames = new Set();
    // Every directory implied by an accepted pathname, seeded with the root so
    // a file cannot claim "/" — the pathname the root tree node occupies.
    const directories = new Set([ '/' ]);

    files.forEach((entry, index) => {
        const source = `files[${ index }]`;

        if (!isPlainObject(entry)) {
            error.push(`${ source } must be an object`, source);
            return;
        }

        const { pathname, hash, size, metadata } = entry;
        let hasValidFields = true;

        // Short-circuit before normalizePathname(), which throws on a non-string.
        if (!isNonEmptyString(pathname)
            || !isValidPathname(pathname)
            || normalizePathname(pathname) !== pathname) {
            error.push(
                `${ source }.pathname must be a safe, canonical pathname`,
                `${ source }.pathname`,
            );
            hasValidFields = false;
        }
        if (!isNonEmptyString(hash)) {
            error.push(`${ source }.hash must be a non-empty string`, `${ source }.hash`);
            hasValidFields = false;
        }
        if (!Number.isInteger(size) || size < 0) {
            error.push(`${ source }.size must be a non-negative integer`, `${ source }.size`);
            hasValidFields = false;
        }
        if (!isUndefined(metadata) && metadata !== null && !isPlainObject(metadata)) {
            error.push(`${ source }.metadata must be a plain object or null`, `${ source }.metadata`);
            hasValidFields = false;
        }

        // The collision checks below index by pathname, so they are only
        // meaningful once the pathname itself is known to be well formed.
        if (!hasValidFields) {
            return;
        }

        if (pathnames.has(pathname)) {
            error.push(`${ source } duplicates pathname "${ pathname }"`, source);
            return;
        }
        if (directories.has(pathname)) {
            error.push(
                `${ source } pathname "${ pathname }" is already used as a directory`,
                source,
            );
            return;
        }

        // Walk the ancestors before recording anything, so a rejected entry
        // leaves neither a file nor a partial chain of directories behind.
        const ancestors = [];
        const parts = pathname.split('/').slice(1, -1);
        let ancestor = '';

        for (const part of parts) {
            ancestor += `/${ part }`;
            if (pathnames.has(ancestor)) {
                error.push(
                    `${ source } pathname "${ pathname }" nests under file "${ ancestor }"`,
                    source,
                );
                return;
            }
            ancestors.push(ancestor);
        }

        for (const directory of ancestors) {
            directories.add(directory);
        }

        pathnames.add(pathname);
    });

    if (error.length) {
        throw error;
    }
}

/**
 * Encodes a decoded node's fields into its compact tuple representation.
 * @param {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file.
 * @param {Object} node
 * @param {string} node.hash - Content digest of the blob's bytes, or of the tree's canonicalized child list.
 * @param {number} [node.size] - Byte size of a blob; ignored for a tree.
 * @param {Object|null} [node.metadata] - Caller-supplied metadata for a blob; ignored for a tree.
 * @returns {IndexEntryTuple} The compact tuple representation.
 */
function encodeIndexEntry(kind, node) {
    const { hash } = node;
    if (kind === 'tree') {
        return [ kind, hash ];
    }

    const size = isUndefined(node.size) ? null : node.size;
    const metadata = isUndefined(node.metadata) ? null : node.metadata;
    return [ kind, hash, size, metadata ];
}

/**
 * Decodes a compact index-table tuple into its named fields, without deriving
 * an etag. Use this when only the tuple's own fields are needed.
 * @param {IndexEntryTuple} tuple - The compact tuple representation.
 * @returns {{kind: ('tree'|'blob'), hash: string, size: (number|null), metadata: (Object|null)}}
 */
function decodeIndexEntryTuple(tuple) {
    const [ kind, hash, size = null, metadata = null ] = tuple;
    return { kind, hash, size, metadata };
}

// Build a tree of nodes - files and directories - and output the list of all
// nodes - files and directories. The directory nodes (kind=tree) contain
// a nested list of all children.
//
// Every precondition this relies on — canonical pathnames, no duplicates, and
// no pathname claimed as both a file and a directory — is enforced by
// validateIndexSourceFiles(), which buildIndex() runs first. Re-checking here
// would only restate those rules as assertions the caller cannot act on.
function buildDirectoryTree(files) {
    const nodeList = [];
    const root = { pathname: '/', kind: 'tree', directories: new Map(), files: new Map() };
    nodeList.push(root);

    for (const entry of files) {
        // entry.pathname is normalized (see addressing.js#normalizePathname): leading
        // slash, no trailing slash, no doubled slashes. Drop the leading empty
        // segment the split produces so directory pathnames don't get doubled.
        const parts = entry.pathname.split('/').slice(1);
        let pathname = '';
        let currentNode = root;
        // Iterate through all the pathname parts up to the last (leaf/file) part
        // to build the directory tree up to the file.
        for (let i = 0; i < parts.length - 1; i += 1) {
            pathname += `/${ parts[i] }`;
            if (currentNode.directories.has(pathname)) {
                currentNode = currentNode.directories.get(pathname);
            } else {
                const node = {
                    pathname,
                    kind: 'tree',
                    directories: new Map(),
                    files: new Map(),
                };
                currentNode.directories.set(pathname, node);
                nodeList.push(node);
                currentNode = node;
            }
        }
        const fileNode = {
            pathname: entry.pathname,
            kind: 'blob',
            hash: entry.hash,
            size: entry.size,
            metadata: entry.metadata,
        };
        nodeList.push(fileNode);
        currentNode.files.set(entry.pathname, fileNode);
    }

    return nodeList;
}

// Hashes one directory node from its immediate children only. Subdirectory
// hashes are read from `treeHashes`, which buildIndex() fills bottom-up; this
// function never descends, so the cost of hashing a whole tree stays linear in
// the number of nodes rather than growing with its depth.
async function hashDirectory(directory, treeHashes) {
    const entries = [];

    for (const [ pathname, file ] of directory.files) {
        const entry = {
            pathname,
            kind: file.kind,
            hash: file.hash,
            size: file.size,
        };
        // Omit the meta key entirely unless it is defined and not null;
        // keeps the metadata-free entries out of the canonicalized JSON
        // so they don't disrupt the tree hash.
        if (!isUndefined(file.metadata) && file.metadata !== null) {
            entry.metadata = file.metadata;
        }
        entries.push(entry);
    }

    for (const pathname of directory.directories.keys()) {
        entries.push({
            pathname,
            kind: 'tree',
            hash: treeHashes.get(pathname),
        });
    }

    // Sort by name so this node's hash is independent of directory-read or
    // insertion order — the same set of children always hashes the same way.
    entries.sort((a, b) => compareStrings(a.pathname, b.pathname));

    return await hashTree({ v: FORMAT, entries });
}

// Find the first index in `sortedArray` whose value is >= `target`.
function lowerBound(sortedArray, target) {
    let lo = 0;
    let hi = sortedArray.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compareStrings(sortedArray[mid], target) < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}
