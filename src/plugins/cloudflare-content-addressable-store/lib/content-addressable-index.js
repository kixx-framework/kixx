import { assert, isUndefined } from '../../kixx/assertions/mod.js';
import { FORMAT, compareStrings, hashTree } from './addressing.js';


export default class ContentAddressableIndex {

    #sortedPaths;

    constructor(entries) {
        this.entries = entries;
    }

    getNode(pathname) {
        const tuple = this.entries[pathname];
        return tuple ? decodeIndexEntry(pathname, tuple) : null;
    }

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
