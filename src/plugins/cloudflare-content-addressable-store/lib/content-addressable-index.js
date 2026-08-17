import {
    assert,
    assertArray,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import { FORMAT, compareStrings, hashEtag, hashTree } from './addressing.js';

/**
 * Encoded directory entry containing only the fields which apply to trees.
 * @typedef {['tree', string]} TreeIndexEntryTuple
 */

/**
 * Encoded file entry with its content attributes in a fixed order.
 * @typedef {['blob', string, (number|null), (Object|null)]} BlobIndexEntryTuple
 */

/**
 * Compact encoded index-table value used to keep the persisted table small.
 * @typedef {TreeIndexEntryTuple|BlobIndexEntryTuple} IndexEntryTuple
 */

/**
 * A decoded content-addressable index node.
 * @typedef {Object} IndexEntry
 * @property {string} pathname - Normalized pathname for the node, with a leading slash "/".
 * @property {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file.
 * @property {string} hash - Content digest of the blob's bytes, or of the tree's canonicalized child list.
 * @property {string|null} etag - Digest of a blob's content hash and canonicalized metadata, or null for a tree.
 * @property {number|null} size - Byte size of a blob, or null for a tree or an unspecified size.
 * @property {Object|null} metadata - Caller-supplied metadata for a blob, or null.
 */

/**
 * A file to include when building an index, before directory nodes are derived.
 * @typedef {Object} IndexSourceFile
 * @property {string} pathname - Normalized pathname for the file, with a leading slash "/".
 * @property {string} hash - Content digest of the file bytes, computed by the caller (see hashBlob in addressing.js).
 * @property {number} [size] - Byte size of the file.
 * @property {Object} [metadata] - Caller-supplied metadata to associate with the file.
 */

/**
 * Read-only, in-memory snapshot of a persisted content-addressable index
 * table. Supports point lookups and prefix listings by pathname without
 * re-deriving the underlying directory structure.
 */
export default class ContentAddressableIndex {

    #entries;
    #etagPromises = new Map();
    #sortedPaths;

    /**
     * @param {Object<string, IndexEntryTuple>} entries - Encoded index table to validate and copy, typically loaded from durable storage or produced by {@link ContentAddressableIndex.buildIndex}.
     */
    constructor(entries) {
        assert(isPlainObject(entries), 'ContentAddressableIndex: entries must be a plain object');

        for (const [ pathname, tuple ] of Object.entries(entries)) {
            assertValidIndexEntryTuple(pathname, tuple);
        }

        this.#entries = structuredClone(entries);
    }

    /**
     * Looks up a single node by exact pathname.
     * @param {string} pathname - The pathname for the node, including a leading slash "/".
     * @returns {Promise<IndexEntry|null>} The matching node, or null when no entry exists at that pathname.
     */
    async getNode(pathname) {
        const tuple = this.#entries[pathname];
        return tuple ? await this.#decodeNode(pathname, tuple) : null;
    }

    /**
     * Lists all the nodes under a given directory (the prefix), optionally recursively.
     * @param {string} prefix - A prefix directory with a leading slash; a trailing slash "/" is added if missing. Pass '' to list from the root.
     * @param {Object} [options]
     * @param {boolean} [options.recursive=true] - When false, only list the prefix's immediate children — nested nodes are skipped.
     * @returns {Promise<IndexEntry[]>} Matching nodes in pathname sort order.
     */
    async listNodes(prefix, options) {
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
            // If a path includes a "/" beyond the scope, then we know it is nested.
            // Paths never end with a slash "/" -- not even directories.
            if (!recursive && path.slice(prefix.length).includes('/')) {
                continue;
            }
            matchingPaths.push(path);
        }

        return await Promise.all(matchingPaths.map((path) => {
            return this.#decodeNode(path, this.#entries[path]);
        }));
    }

    async #decodeNode(pathname, tuple) {
        const [ kind, hash, size = null, metadata = null ] = tuple;
        const etag = kind === 'blob' ? await this.#getEtag(pathname, hash, metadata) : null;
        return {
            pathname,
            kind,
            hash,
            etag,
            size,
            metadata: metadata === null ? null : structuredClone(metadata),
        };
    }

    async #getEtag(pathname, hash, metadata) {
        let promise = this.#etagPromises.get(pathname);
        if (!promise) {
            promise = hashEtag(hash, metadata);
            this.#etagPromises.set(pathname, promise);
        }
        return await promise;
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
     */
    static async buildIndex(files) {
        const nodeList = buildDirectoryTree(files);
        const entries = {};

        for (const node of nodeList) {
            if (node.kind === 'tree') {
                // The "tree" kind is a directory
                const hash = await hashDirectory(node);
                entries[node.pathname] = encodeIndexEntry('tree', { hash });
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
        size === null || (Number.isInteger(size) && size >= 0),
        `${ messagePrefix } blob size must be a non-negative integer or null`,
    );
    assert(
        metadata === null || isPlainObject(metadata),
        `${ messagePrefix } blob metadata must be a plain object or null`,
    );
}

function encodeIndexEntry(kind, node) {
    const { hash } = node;
    if (kind === 'tree') {
        return [ kind, hash ];
    }

    const size = isUndefined(node.size) ? null : node.size;
    const metadata = isUndefined(node.metadata) ? null : node.metadata;
    return [ kind, hash, size, metadata ];
}

// Build a tree of nodes - files and directories - and output the list of all
// nodes - files and directories. The directory nodes (kind=tree) contain
// a nested list of all children.
function buildDirectoryTree(files) {
    const nodeList = [];
    const root = { pathname: '/', kind: 'tree', directories: new Map(), files: new Map() };
    nodeList.push(root);

    for (const entry of files) {
        assert(entry.pathname.startsWith('/'), `buildDirectoryTree: entry.pathname must start with "/", got "${ entry.pathname }"`);

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

async function hashDirectory(directory) {
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

    for (const [ pathname, sub ] of directory.directories) {
        const hash = await hashDirectory(sub);
        entries.push({
            pathname,
            kind: 'tree',
            hash,
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
