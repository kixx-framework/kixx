/**
 * Maps Kixx publishing and page-rendering resources onto the logical pathname
 * model provided by Cloudflare content-addressable storage.
 * @module cloudflare-content-addressable-store/content-addressable-store
 */

import { ValidationError } from '../../../kixx/errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import CloudflareContentStore from './cloudflare-content-store.js';
import { getRootHash } from './content-addressable-index.js';
import {
    BASE_TEMPLATES_BUNDLE,
    TEMPLATE_PARTIALS_BUNDLE,
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
    canonicalize,
    hashValue,
    isValidPathname,
    normalizePagePath,
    normalizePathname,
    normalizeTemplatePath,
    stringToUint8Array,
} from './addressing.js';

const RESERVED_PAGE_FILENAMES = new Set([
    'page.json',
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
]);


/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 * @typedef {import('../../../kixx/logger/logger.js').default} Logger
 * @typedef {import('./content-snapshot.js').default} ContentSnapshot
 */

/**
 * Identifies an uploaded blob that can be included in a content manifest.
 * @typedef {Object} StoredContentDescriptor
 * @property {string} hash - Content digest of the stored bytes
 * @property {number} size - Byte size of the stored content
 * @property {null} metadata - Always null because Kixx content resources do not attach blob metadata
 */

/**
 * Identifies an uploaded blob for inclusion in a content manifest.
 * @typedef {Object} ManifestBlobDescriptor
 * @property {string} hash - Content digest returned by an upload method
 * @property {number} size - Byte size returned by an upload method
 */

/**
 * Identifies an uploaded page resource by its public page pathname.
 * @typedef {ManifestBlobDescriptor & {pathname: string}} PageContentDescriptor
 */

/**
 * Identifies an uploaded page template by its filepath beneath `/pages`.
 * @typedef {ManifestBlobDescriptor & {filename: string}} PageTemplateDescriptor
 */

/**
 * Uploaded resources which form one immutable build closure. Omitted resource
 * groups are absent from the committed build rather than inherited from its
 * previous closure.
 * @typedef {Object} ContentManifest
 * @property {ManifestBlobDescriptor} [templatePartials] - Global partial-template bundle
 * @property {ManifestBlobDescriptor} [baseTemplates] - Base-template bundle
 * @property {PageContentDescriptor[]} [pageMetadata] - Page metadata resources
 * @property {PageContentDescriptor[]} [pagePartials] - Page partial-template bundles
 * @property {PageContentDescriptor[]} [pageIncludes] - Page include bundles
 * @property {PageTemplateDescriptor[]} [pageTemplates] - Page template source files
 */

/**
 * Provides Kixx-specific publishing and page-loading operations over a
 * Cloudflare content-addressable store.
 *
 * Upload methods persist immutable blobs but do not make them visible to a
 * build. `commitChanges()` creates an immutable pathname closure from uploaded
 * blob descriptors and points a build at that closure. Every operation accepts
 * a request context so the backing Cloudflare bindings can be resolved at call
 * time.
 *
 * @see CloudflareContentStore for the Cloudflare KV, Durable Object, and cache implementation
 */
export default class ContentAddressableStore {

    #logger;
    #store;

    /**
     * @param {Object} options - Store configuration
     * @param {Logger} options.logger - Root logger used to create the store's child logger
     * @param {CloudflareContentStore} [options.store] - Compatible backing store; primarily injectable for tests
     * @param {string} [options.kvBindingName] - Name of the blob KV binding on `context.env`
     * @param {string} [options.durableObjectBindingName] - Name of the index Durable Object binding on `context.env`
     * @param {number} [options.blobReadCacheTtlSeconds] - Cloudflare KV cache TTL used when reading blob bytes
     * @param {number} [options.indexCacheTtlSeconds] - In-memory and edge-cache TTL for build indexes
     */
    constructor(options) {
        this.#logger = options.logger.createChild('ContentAddressableStore');

        this.#store = options.store ?? new CloudflareContentStore({
            logger: this.#logger,
            kvBindingName: options.kvBindingName,
            durableObjectBindingName: options.durableObjectBindingName,
            blobReadCacheTtlSeconds: options.blobReadCacheTtlSeconds,
            indexCacheTtlSeconds: options.indexCacheTtlSeconds,
        });
    }

    /**
     * Computes a deterministic digest for a primitive or canonicalizable value.
     * @param {*} value - Value to hash
     * @returns {Promise<string>} Content digest in the current wire format
     * @throws {TypeError} When a non-primitive value cannot be canonicalized
     */
    async hashValue(value) {
        return await hashValue(value);
    }

    /**
     * Reports whether a logical pathname contains only lowercase and
     * safe path segments.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    /**
     * Folds a logical pathname to canonical form by removing empty path
     * segments, converting it to lowercase, and adding a leading slash.
     * This operation does not reject unsafe path segments; use
     * `isValidPathname()` when validation is required.
     * @param {string} value - Pathname to normalize
     * @returns {string} Canonical lowercase pathname with a leading slash
     * @throws {TypeError} When value is not a string
     */
    normalizePathname(value) {
        return normalizePathname(value);
    }

    #filepathDirname(pathname) {
        const parts = pathname.split('/');
        parts.pop();
        return parts.join('/');
    }

    /**
     * Opens a request-scoped view pinned to one immutable content index.
     * All reads through the returned snapshot use the index resolved here,
     * even if the build is reassigned before the request completes.
     * @param {RequestContext} context - Request context carrying the current build ID and platform bindings
     * @returns {Promise<ContentSnapshot>} Snapshot valid only for this request
     */
    async openSnapshot(context) {
        return await this.#store.openSnapshot(context);
    }

    /**
     * Uploads the canonicalized global partial-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {Array<*>|Object} bundle - JSON-compatible partial-template definitions
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putTemplatePartials(context, bundle, etag) {
        const pathname = normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata: null };
    }

    /**
     * Uploads the canonicalized base-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {Array<*>|Object} bundle - JSON-compatible base-template definitions
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putBaseTemplates(context, bundle, etag) {
        const pathname = normalizeTemplatePath(BASE_TEMPLATES_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata: null };
    }

    /**
     * Uploads canonicalized metadata for a page as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} pagePath - Valid logical page pathname
     * @param {Object} obj - JSON-compatible page metadata
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When obj cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageMetadata(context, pagePath, obj, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPageMetadata() requires a valid page pathname',
        );

        const pathname = normalizePagePath(`${ pagePath }/page.json`);
        const blob = stringToUint8Array(canonicalize(obj));
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads a canonicalized page partial-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} pagePath - Valid logical page pathname
     * @param {Array<*>|Object} bundle - JSON-compatible page partial-template definitions
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPagePartials(context, pagePath, bundle, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPagePartials() requires a valid page pathname',
        );

        const pathname = normalizePagePath(`${ pagePath }/${ PAGE_PARTIALS_BUNDLE }`);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads a canonicalized page include bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} pagePath - Valid logical page pathname
     * @param {Array<*>|Object} bundle - JSON-compatible page include definitions
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageIncludes(context, pagePath, bundle, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPageIncludes() requires a valid page pathname',
        );

        const pathname = normalizePagePath(`${ pagePath }/${ PAGE_INCLUDES_BUNDLE }`);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads page template source as an immutable blob without canonicalizing it.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} filepath - Valid template filepath beneath the logical `/pages` namespace
     * @param {string} sourceText - Template source text
     * @param {string} [etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageTemplate(context, filepath, sourceText, etag) {
        assert(
            this.isValidPathname(filepath),
            'ContentAddressableStore#putPageTemplate() requires a valid filepath',
        );

        const pathname = normalizePagePath(filepath);
        const blob = stringToUint8Array(sourceText);
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
    }

    // Checks that a manifest bundle/entry is an object carrying a
    // content-addressing hash and byte size, the two fields buildIndex()
    // assumes are already well-formed when it derives the directory tree.
    // Errors are pushed onto `error` rather than thrown so the caller can
    // report every problem in the manifest at once.
    #checkBlobDescriptor(error, source, descriptor) {
        if (!isPlainObject(descriptor)) {
            error.push(`${ source } must be an object`, source);
            return;
        }
        if (!isNonEmptyString(descriptor.hash)) {
            error.push(`${ source }.hash must be a non-empty string`, `${ source }.hash`);
        }
        if (!Number.isInteger(descriptor.size) || descriptor.size < 0) {
            error.push(`${ source }.size must be a non-negative integer`, `${ source }.size`);
        }
    }

    // Rejects a manifest that assigns more than one page template to the
    // same page directory. Entries with an invalid or missing filename are
    // skipped here; checkArray() already reports those separately.
    #checkOnePageTemplatePerDirectory(error, entries, source) {
        if (isUndefined(entries) || !Array.isArray(entries)) {
            return;
        }

        const directories = new Map();

        entries.forEach((entry, index) => {
            const filename = isPlainObject(entry) ? entry.filename : null;
            if (!isNonEmptyString(filename) || !this.isValidPathname(filename)) {
                return;
            }

            const entrySource = `${ source }[${ index }]`;
            const directory = this.#filepathDirname(normalizePagePath(filename));
            const existingSource = directories.get(directory);

            if (existingSource) {
                error.push(
                    `${ entrySource }.filename "${ filename }" duplicates the page template already assigned to page "${ directory }" by ${ existingSource }`,
                    `${ entrySource }.filename`,
                );
            } else {
                directories.set(directory, entrySource);
            }
        });
    }

    // Validates the whole manifest up front and returns the flat IndexSourceFile
    // list buildIndex() expects, instead of letting its bare assumptions about
    // pathname/hash/size shape surface as a deep, hard-to-trace AssertionError.
    // The manifest is client-supplied (it arrives via the CommitChanges JSON:API
    // request), so failures here are reported as a ValidationError rather than
    // an assertion, and every problem is collected before throwing.
    #buildManifestFiles(manifest) {
        assert(isPlainObject(manifest), 'ContentAddressableStore#commitChanges() requires a manifest object');

        const error = new ValidationError('The content manifest contains invalid entries');
        const files = [];
        const pathnames = new Set();
        // Every directory implied by an accepted pathname. buildDirectoryTree()
        // derives the same set and asserts when a pathname is claimed as both a
        // blob and a tree, so the conflict is caught here instead, where it can
        // be reported against the manifest entry which caused it.
        const directories = new Set([ '/' ]);

        const addFile = (source, pathname, hash, size) => {
            if (pathnames.has(pathname)) {
                error.push(`${ source } duplicates pathname "${ pathname }"`, source);
                return;
            }
            if (directories.has(pathname)) {
                error.push(
                    `${ source } pathname "${ pathname }" is already used as a page directory`,
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
            files.push({ pathname, hash, size });
        };

        // A single bundle descriptor, e.g. manifest.templatePartials.
        const checkBundle = (source, bundle, internalPathname) => {
            if (isUndefined(bundle)) {
                return;
            }
            this.#checkBlobDescriptor(error, source, bundle);
            if (isPlainObject(bundle)) {
                addFile(source, internalPathname, bundle.hash, bundle.size);
            }
        };

        // An array of per-page descriptors, e.g. manifest.pageMetadata.
        // `pathField` is "pathname" for page entries or "filename" for page
        // templates; `toInternalPathname` maps the caller-supplied value to
        // the pathname buildIndex() will index by.
        const checkArray = (entries, source, pathField, toInternalPathname, reservedFilenames) => {
            if (isUndefined(entries)) {
                return;
            }
            if (!Array.isArray(entries)) {
                error.push(`${ source } must be an array`, source);
                return;
            }

            entries.forEach((entry, index) => {
                const entrySource = `${ source }[${ index }]`;

                if (!isPlainObject(entry)) {
                    error.push(`${ entrySource } must be an object`, entrySource);
                    return;
                }

                const pathValue = entry[pathField];
                const isValidPath = isNonEmptyString(pathValue) && this.isValidPathname(pathValue);
                if (!isValidPath) {
                    error.push(`${ entrySource }.${ pathField } must be a valid pathname`, `${ entrySource }.${ pathField }`);
                }

                this.#checkBlobDescriptor(error, entrySource, entry);

                if (isValidPath) {
                    const pathname = toInternalPathname(pathValue);
                    // Take the basename from the caller-supplied path rather
                    // than the internal one. For page entries the internal
                    // pathname always ends in a reserved bundle filename this
                    // method appended itself; the name the caller chose — the
                    // page directory, or the template filename — is the one
                    // which must not collide with a reserved filename.
                    const basename = normalizePagePath(pathValue).split('/').pop();

                    if (reservedFilenames.has(basename)) {
                        error.push(
                            `${ entrySource }.${ pathField } uses reserved page filename "${ basename }"`,
                            `${ entrySource }.${ pathField }`,
                        );
                    } else {
                        addFile(entrySource, pathname, entry.hash, entry.size);
                    }
                }
            });
        };

        checkBundle('templatePartials', manifest.templatePartials, normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        checkBundle('baseTemplates', manifest.baseTemplates, normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));

        checkArray(
            manifest.pageMetadata,
            'pageMetadata',
            'pathname',
            (pathname) => normalizePagePath(`${ pathname }/page.json`),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pagePartials,
            'pagePartials',
            'pathname',
            (pathname) => normalizePagePath(`${ pathname }/${ PAGE_PARTIALS_BUNDLE }`),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pageIncludes,
            'pageIncludes',
            'pathname',
            (pathname) => normalizePagePath(`${ pathname }/${ PAGE_INCLUDES_BUNDLE }`),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pageTemplates,
            'pageTemplates',
            'filename',
            (filename) => normalizePagePath(filename),
            RESERVED_PAGE_FILENAMES,
        );

        // getPage() picks "whatever is left" in a page directory as its
        // template, so two templates in the same directory would silently
        // collide with only one winning. Reject that here, at the manifest
        // boundary, rather than let it land in the committed index.
        this.#checkOnePageTemplatePerDirectory(error, manifest.pageTemplates, 'pageTemplates');

        if (error.length) {
            throw error;
        }

        return files;
    }

    /**
     * Validates and commits a complete manifest of uploaded resources, then
     * points a build at the resulting immutable content closure. Resource
     * groups omitted from the manifest are absent from the new closure.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} buildId - Build to point at the newly committed closure
     * @param {ContentManifest} manifest - Uploaded resources to include in the closure
     * @returns {Promise<{hash: string, count: number}>} Root hash and total number of file and directory nodes
     * @throws {ValidationError} When manifest entries are malformed, map to duplicate paths, or assign multiple templates to one page
     */
    async commitChanges(context, buildId, manifest) {
        const files = this.#buildManifestFiles(manifest);

        const entries = await this.#store.commitChanges(context, buildId, files);

        return {
            hash: getRootHash(entries),
            count: Object.keys(entries).length,
        };
    }

    /**
     * Points a build at a previously committed root hash without rewriting
     * closure content. This supports rollback and re-promotion of a build.
     * @param {RequestContext} context - Request context carrying Cloudflare bindings
     * @param {string} buildId - Build to repoint
     * @param {string} rootHash - Root hash previously returned from `commitChanges()`
     * @returns {Promise<void>}
     * @throws {OperationalError} When the Durable Object rejects the assignment, including for an unknown rootHash
     */
    async assignBuild(context, buildId, rootHash) {
        await this.#store.assignBuild(context, buildId, rootHash);
    }
}
