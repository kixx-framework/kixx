import { assert, isUndefined } from '../../../kixx/assertions/mod.js';
import { FORMAT, compareStrings, hashTree } from './addressing.js';

/**
 * Encoded index-table value: kind, hash, size and metadata packed as a
 * fixed-order tuple instead of an object, to keep the persisted table small.
 * @typedef {[('tree'|'blob'), string, (number|null), (Object|null)]} IndexEntryTuple
 */

/**
 * A decoded content-addressable index node.
 * @typedef {Object} IndexEntry
 * @property {string} pathname - Normalized pathname for the node, with a leading slash "/".
 * @property {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file.
 * @property {string} hash - Content digest of the blob's bytes, or of the tree's canonicalized child list.
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
 * Read-only, in-memory view over a persisted content-addressable index table.
 * Supports point lookups and prefix listings by pathname without re-deriving
 * the underlying directory structure.
 */
export default class ContentAddressableIndex {

    #sortedPaths;

    /**
     * @param {Object<string, IndexEntryTuple>} entries - Encoded index table, typically loaded from durable storage or produced by {@link ContentAddressableIndex.buildIndex}.
     */
    constructor(entries) {
        this.entries = entries;
    }

    /**
     * Looks up a single node by exact pathname.
     * @param {string} pathname - The pathname for the node, including a leading slash "/".
     * @returns {IndexEntry|null} The matching node, or null when no entry exists at that pathname.
     */
    getNode(pathname) {
        const tuple = this.entries[pathname];
        return tuple ? decodeIndexEntry(pathname, tuple) : null;
    }

    /**
     * Lists all the nodes under a given directory (the prefix), optionally recursively.
     * @param {string} prefix - A prefix directory with a leading slash; a trailing slash "/" is added if missing. Pass '' to list from the root.
     * @param {Object} [options]
     * @param {boolean} [options.recursive=true] - When false, only list the prefix's immediate children — nested nodes are skipped.
     * @returns {IndexEntry[]} Matching nodes in pathname sort order.
     */
    listNodes(prefix, options) {
        const { recursive = true } = options ?? {};

        // The prefix must end with a slash "/".
        if (prefix !== '' && !prefix.endsWith('/')) {
            prefix = `${ prefix }/`;
        }

        const paths = this.#getSortedPaths();
        const start = lowerBound(paths, prefix);

        const nodes = [];
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
            nodes.push(decodeIndexEntry(path, this.entries[path]));
        }

        return nodes;
    }

    #getSortedPaths() {
        if (this.#sortedPaths) {
            return this.#sortedPaths;
        }
        this.#sortedPaths = Object.keys(this.entries).sort(compareStrings);
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

function decodeIndexEntry(pathname, tuple) {
    const [ kind, hash, size, metadata ] = tuple;
    return {
        pathname,
        kind,
        hash,
        size,
        metadata,
    };
}

function encodeIndexEntry(kind, node) {
    const { hash } = node;
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
