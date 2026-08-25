import { ValidationError } from '../errors/mod.js';
import {
    isValidPathname,
    normalizePathname,
    getStaticAssetPath,
    getGlobalTemplatePartialsPath,
    getBaseTemplatesPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageIncludesPath,
    getPageTemplatePath,
    getEmailBundlePath,
} from './content-layout.js';
import { FORMAT, hashTree, compareStrings } from './addressing.js';
import {
    assert,
    assertArray,
    isBoolean,
    isUndefined,
    isPlainObject,
    isNonEmptyString,
    isString,
} from '../assertions/mod.js';

/**
 * The compact, persisted form of one index entry. The arity distinguishes the
 * two kinds, and {@link ContentStoreInterface} requires an adapter to preserve
 * it across a storage round trip:
 *
 * - A tree (directory): `[ 'tree', hash ]`
 * - A blob (file): `[ 'blob', hash, size, metadata ]`
 *
 * A tree's hash covers its canonicalized immediate-child list, so it changes
 * whenever anything beneath it changes. A blob's hash covers its bytes.
 * @typedef {Array} IndexEntryTuple
 */

/**
 * One index entry decoded into named fields and paired with the pathname it is
 * keyed by. Tree entries carry `size: null` and `metadata: null`.
 * @typedef {Object} IndexEntry
 * @property {string} pathname - Canonical pathname the entry is keyed by, with a leading slash
 * @property {('tree'|'blob')} kind - 'tree' for a directory, 'blob' for a file
 * @property {string} hash - Content digest of the blob's bytes, or of the tree's canonicalized child list
 * @property {number|null} size - Byte size of a blob; null for a tree
 * @property {Object|null} metadata - Deep copy of the blob's metadata; null when absent or for a tree
 */

/**
 * One file in the flat list {@link ContentAddressableIndex.buildIndex} derives
 * an index from. Directories are never listed: they are implied by the
 * pathnames and created by the build.
 * @typedef {Object} IndexSourceFile
 * @property {string} pathname - Canonical pathname of the file, with a leading slash and no trailing slash
 * @property {string} hash - Content digest of the file's bytes, computed by the caller
 * @property {number} size - Byte size of the file, as a non-negative integer
 * @property {Object} [metadata] - Arbitrary metadata to persist alongside the entry; contributes to the tree hash when present
 */

/**
 * A `{hash, size, metadata}` reference to one piece of content, matching what
 * the publishing API's `stat*` resources already expose to a client.
 * @typedef {Object} ContentTreeReference
 * @property {string} hash - Content digest of the referenced file's bytes
 * @property {number} size - Byte size of the referenced file
 * @property {Object|null} [metadata] - Arbitrary metadata to persist alongside the entry
 */

/**
 * One page's facets within a {@link ContentTree} commit. Every facet is
 * optional; an absent facet means it is not part of this commit, not that it
 * should be deleted.
 * @typedef {Object} ContentTreePageEntry
 * @property {ContentTreeReference} [metadata] - The page's `page.json` metadata file
 * @property {ContentTreeReference} [partials] - The page's partial-template bundle
 * @property {ContentTreeReference} [includes] - The page's include bundle
 * @property {ContentTreeReference} [template] - The page's template file. Carries its own `pathname` (the full filepath, including the filename) because a page's template filename cannot be derived from the page's logical pathname alone.
 */

/**
 * The structured commit payload the publishing API's `commitChanges` request
 * handler assembles from a parsed JSON:API resource, grouped by content kind
 * and keyed by logical pathname. {@link flattenContentTree} converts this
 * into the flat {@link IndexSourceFile} list {@link ContentAddressableIndex.buildIndex}
 * consumes.
 * @typedef {Object} ContentTree
 * @property {Object<string, ContentTreeReference>} [staticAssets] - Static assets keyed by logical pathname
 * @property {ContentTreeReference} [globalTemplatePartials] - The site-wide partial-template bundle
 * @property {ContentTreeReference} [baseTemplates] - The site-wide base-template bundle
 * @property {Object<string, ContentTreePageEntry>} [pages] - Pages keyed by logical pathname
 * @property {Object<string, ContentTreeReference>} [emails] - Email bundles keyed by logical pathname
 */

/**
 * Read-only, in-memory snapshot of a persisted content-addressable index
 * table. Supports point lookups and prefix listings by pathname without
 * re-deriving the underlying directory structure.
 *
 * An instance is a defensive deep copy of the table it was constructed from and
 * never mutates: the entries an index was opened with are the entries it will
 * report for its whole lifetime, which is what lets a request pin itself to one
 * coherent snapshot while a deploy reassigns the build pointer underneath it.
 * @see getRootHash for naming a closure without constructing an index
 */
export default class ContentAddressableIndex {

    #entries;
    #sortedPaths;

    /**
     * @param {Object<string, IndexEntryTuple>} entries - Encoded index table to validate and copy, typically loaded from durable storage or produced by {@link ContentAddressableIndex.buildIndex}.
     */
    constructor(entries) {
        assertValidIndexTable(entries);
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
     * @returns {IndexEntry|null} The matching node, or null when no entry exists at that pathname.
     */
    getNode(pathname) {
        const tuple = this.#entries[pathname];
        return tuple ? this.#decodeNode(pathname, tuple) : null;
    }

    /**
     * Lists the nodes beneath a directory, optionally recursively. The prefix
     * directory itself is never included, and a prefix naming nothing yields an
     * empty array rather than throwing — an absent directory and an empty one
     * are indistinguishable here, because the index stores no empty trees.
     *
     * The empty-string prefix is a separate mode: it matches the whole table,
     * including the root node, and is only meaningful with `recursive: true`.
     * To list the root's children, pass '/'.
     * @param {string} prefix - Directory pathname with a leading slash; a trailing slash is appended when missing. Pass '/' to list from the root, or '' to dump every node.
     * @param {Object} [options]
     * @param {boolean} [options.recursive=true] - When false, list only the prefix's immediate children — both blobs and the trees directly beneath it — and skip everything nested deeper.
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

        const matchingPaths = [];
        for (let i = start; i < paths.length; i += 1) {
            const path = paths[i];
            // Sorted order guarantees every path sharing the prefix is
            // contiguous, so the first miss past `start` means there are no
            // more — stop instead of scanning the rest of the index.
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

    #decodeNode(pathname, tuple) {
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

/**
 * Asserts that an encoded index table can be safely persisted and reopened.
 *
 * This is the framework's single validation boundary for encoded tables. It
 * validates both the content-addressable tree and the JSON fidelity storage
 * adapters require, without giving adapters ownership of index semantics.
 * @param {Object<string, IndexEntryTuple>} entries - Encoded table to validate.
 * @returns {void}
 * @throws {AssertionError} When the table is malformed or cannot round-trip through JSON faithfully
 */
export function assertValidIndexTable(entries) {
    assert(isPlainObject(entries), 'ContentAddressableIndex: entries must be a plain object');

    for (const [ pathname, tuple ] of Object.entries(entries)) {
        assertValidIndexEntryTuple(pathname, tuple);
    }
    assertValidTreeStructure(entries);
    assertJsonFidelity(entries, 'entries', new Set());
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

function assertJsonFidelity(value, pathname, ancestors) {
    if (value === null || (isString(value) && Object(value) !== value)) {
        return;
    }
    if ((isBoolean(value) && Object(value) !== value) || Number.isFinite(value)) {
        return;
    }

    if (Array.isArray(value)) {
        assert(!ancestors.has(value), `${ pathname } must not contain a cycle`);
        ancestors.add(value);

        const propertyNames = Object.getOwnPropertyNames(value);
        assert(
            propertyNames.length === value.length + 1,
            `${ pathname } must be a dense array without extra properties`,
        );

        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, `${ index }`);
            assert(
                descriptor && descriptor.enumerable && 'value' in descriptor,
                `${ pathname } must be a dense array of data values`,
            );
            assertJsonFidelity(descriptor.value, `${ pathname }[${ index }]`, ancestors);
        }
        assertNoSymbolProperties(value, pathname);
        ancestors.delete(value);
        return;
    }

    assert(isPlainObject(value), `${ pathname } must contain only JSON values`);
    assert(!ancestors.has(value), `${ pathname } must not contain a cycle`);
    ancestors.add(value);

    for (const propertyName of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
        assert(
            descriptor.enumerable && 'value' in descriptor,
            `${ pathname }.${ propertyName } must be an enumerable data property`,
        );
        assertJsonFidelity(descriptor.value, `${ pathname }.${ propertyName }`, ancestors);
    }
    assertNoSymbolProperties(value, pathname);
    ancestors.delete(value);
}

function assertNoSymbolProperties(value, pathname) {
    assert(
        Object.getOwnPropertySymbols(value).length === 0,
        `${ pathname } must not contain symbol properties`,
    );
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
 * Converts a structured {@link ContentTree} commit payload into the flat
 * {@link IndexSourceFile} list {@link ContentAddressableIndex.buildIndex}
 * consumes, deriving each entry's storage pathname via `content-layout.js`'s
 * builders.
 *
 * Every key or facet pathname in `contentTree` originates in an HTTP request
 * body, so a malformed one is an expected operational failure reported as a
 * single ValidationError collecting every violation — mirroring
 * {@link validateIndexSourceFiles}. `contentTree` itself and its dictionary
 * values are treated as an already-validated internal contract and only
 * asserted; only pathname-shaped values are user input. `hash`/`size`/`metadata`
 * are passed through unvalidated: `buildIndex()` already validates that shape
 * and remains the single source of truth for it.
 * @param {ContentTree} contentTree - Structured commit payload to flatten.
 * @returns {IndexSourceFile[]} Flat file list, ready for {@link ContentAddressableIndex.buildIndex}.
 * @throws {AssertionError} When `contentTree` or one of its dictionary values is not a plain object
 * @throws {ValidationError} When a key or a template facet's pathname is unsafe or not canonical
 */
export function flattenContentTree(contentTree) {
    assert(isPlainObject(contentTree), 'flattenContentTree: contentTree must be a plain object');

    const {
        staticAssets,
        globalTemplatePartials,
        baseTemplates,
        pages,
        emails,
    } = contentTree;

    const error = new ValidationError('The content tree contains invalid pathnames');

    validateKeyedPathnames(error, 'staticAssets', staticAssets);
    validateKeyedPathnames(error, 'emails', emails);
    validatePages(error, pages);

    if (error.length) {
        throw error;
    }

    const files = [];

    if (staticAssets) {
        for (const [ pathname, reference ] of Object.entries(staticAssets)) {
            files.push(toIndexSourceFile(getStaticAssetPath(pathname), reference));
        }
    }

    if (globalTemplatePartials) {
        files.push(toIndexSourceFile(getGlobalTemplatePartialsPath(), globalTemplatePartials));
    }

    if (baseTemplates) {
        files.push(toIndexSourceFile(getBaseTemplatesPath(), baseTemplates));
    }

    if (pages) {
        for (const [ pathname, page ] of Object.entries(pages)) {
            if (page.metadata) {
                files.push(toIndexSourceFile(getPageMetadataPath(pathname), page.metadata));
            }
            if (page.partials) {
                files.push(toIndexSourceFile(getPagePartialsPath(pathname), page.partials));
            }
            if (page.includes) {
                files.push(toIndexSourceFile(getPageIncludesPath(pathname), page.includes));
            }
            if (page.template) {
                files.push(toIndexSourceFile(getPageTemplatePath(page.template.pathname), page.template));
            }
        }
    }

    if (emails) {
        for (const [ pathname, reference ] of Object.entries(emails)) {
            files.push(toIndexSourceFile(getEmailBundlePath(pathname), reference));
        }
    }

    return files;
}

// Validates the keys of a ContentTree dictionary facet (staticAssets, emails),
// collecting every invalid key into `error` rather than throwing immediately,
// so a caller sees every problem in the tree at once.
function validateKeyedPathnames(error, kindName, dict) {
    if (!dict) {
        return;
    }
    assert(isPlainObject(dict), `flattenContentTree: ${ kindName } must be a plain object`);

    for (const pathname of Object.keys(dict)) {
        if (!isValidPathname(pathname) || normalizePathname(pathname) !== pathname) {
            error.push(
                `${ kindName } key "${ pathname }" must be a safe, canonical pathname`,
                `${ kindName }["${ pathname }"]`,
            );
        }
    }
}

// Validates page keys and each page's template facet pathname. The other
// three page facets (metadata, partials, includes) derive their storage
// pathname from the already-validated page key, so they need no pathname
// validation of their own.
function validatePages(error, pages) {
    if (!pages) {
        return;
    }
    assert(isPlainObject(pages), 'flattenContentTree: pages must be a plain object');

    for (const [ pathname, page ] of Object.entries(pages)) {
        assert(isPlainObject(page), `flattenContentTree: pages["${ pathname }"] must be a plain object`);

        if (!isValidPathname(pathname) || normalizePathname(pathname) !== pathname) {
            error.push(
                `pages key "${ pathname }" must be a safe, canonical pathname`,
                `pages["${ pathname }"]`,
            );
        }

        const { template } = page;
        if (!template) {
            continue;
        }
        assert(isPlainObject(template), `flattenContentTree: pages["${ pathname }"].template must be a plain object`);

        const { pathname: templatePathname } = template;
        if (!isNonEmptyString(templatePathname)
            || !isValidPathname(templatePathname)
            || normalizePathname(templatePathname) !== templatePathname) {
            error.push(
                `pages["${ pathname }"].template.pathname must be a safe, canonical pathname`,
                `pages["${ pathname }"].template.pathname`,
            );
        }
    }
}

function toIndexSourceFile(pathname, reference) {
    return {
        pathname,
        hash: reference.hash,
        size: reference.size,
        metadata: reference.metadata,
    };
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
        // entry.pathname is normalized (see content-layout.js#normalizePathname): leading
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
