/**
 * Owns the complete Hyperview content model: resource reads and writes,
 * request-scoped content snapshots, and manifest validation and translation,
 * implemented entirely over the generic `ContentAddressableStoreInterface`
 * port. No platform vocabulary and no JSON:API resource-type string enters
 * this module.
 * @module kixx/hyperview/hyperview-content-service
 */

import { ValidationError } from '../errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../assertions/mod.js';
import {
    RESERVED_PAGE_FILENAMES,
    isValidPathname,
    isValidTemplateFilepath,
    normalizePathname,
    getBaseTemplatesPath,
    getTemplatePartialsPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageIncludesPath,
    getPageTemplatePath,
} from './content-layout.js';
import HyperviewContentSnapshot from './hyperview-content-snapshot.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 * @typedef {import('../content-store/content-addressable-store-interface.js').ContentAddressableStoreInterface} ContentAddressableStoreInterface
 */

/**
 * Descriptor returned after writing a resource.
 * @typedef {Object} StoredContentDescriptor
 * @property {string} hash - Content digest of the stored bytes
 * @property {number} size - Byte size of the stored content
 * @property {null} metadata - Always null because Hyperview content resources do not attach blob metadata
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
 * Owns the complete Hyperview content model over a generic content-addressable
 * store: resource reads and writes, request-scoped snapshots, and manifest
 * validation and translation.
 *
 * Upload methods persist immutable blobs but do not make them visible to a
 * build. `commitChanges()` creates an immutable pathname closure from uploaded
 * blob descriptors and points a build at that closure. Every operation accepts
 * a request context so the backing store can resolve its platform bindings at
 * call time.
 */
export default class HyperviewContentService {

    #store;

    /**
     * Connects the required generic content-addressable store.
     * @param {Object} args
     * @param {ContentAddressableStoreInterface} args.contentStore - Backing content-addressable store
     * @returns {void}
     * @throws {AssertionError} When contentStore is absent
     */
    initialize(args) {
        const { contentStore } = args ?? {};
        assert(contentStore, 'HyperviewContentService#initialize() requires a contentStore');
        this.#store = contentStore;
    }

    /**
     * Folds a value to canonical Hyperview pathname form.
     * @param {string} value - Pathname to normalize
     * @returns {string} Canonical lowercase pathname with a leading slash
     * @throws {TypeError} When value is not a string
     */
    normalizePathname(value) {
        return normalizePathname(value);
    }

    /**
     * Reports whether a value satisfies the canonical Hyperview pathname rule.
     * @param {string} value - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(value) {
        return isValidPathname(value);
    }

    /**
     * Reports whether a value is a canonical, non-root Hyperview template filepath.
     * @param {string} value - The filepath to check
     * @returns {boolean} True when the value is a valid, non-root template filepath
     */
    isValidTemplateFilepath(value) {
        return isValidTemplateFilepath(value);
    }

    /**
     * Computes a deterministic digest for a primitive or canonicalizable value.
     * @param {*} value - Value to hash
     * @returns {Promise<string>} Content digest used for cache identities
     * @throws {TypeError} When a non-primitive value cannot be canonicalized
     */
    async hashValue(value) {
        return await this.#store.hashValue(value);
    }

    /**
     * Opens a request-scoped view pinned to one immutable content index.
     * All reads through the returned snapshot use the index resolved here,
     * even if the build is reassigned before the request completes. Do not
     * retain the returned snapshot beyond the request that opened it.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @returns {Promise<HyperviewContentSnapshot>} Snapshot valid only for this request
     */
    async openSnapshot(context) {
        const snapshot = await this.#store.openSnapshot(context);
        return new HyperviewContentSnapshot({ snapshot });
    }

    /**
     * Looks up global partial-template metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statTemplatePartials(context) {
        const content = await this.openSnapshot(context);
        return await content.statTemplatePartials();
    }

    /**
     * Looks up base-template metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statBaseTemplates(context) {
        const content = await this.openSnapshot(context);
        return await content.statBaseTemplates();
    }

    /**
     * Looks up page metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {string} pathname - Valid logical page pathname
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statPageMetadata(context, pathname) {
        const content = await this.openSnapshot(context);
        return await content.statPageMetadata(pathname);
    }

    /**
     * Looks up page partial metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {string} pathname - Valid logical page pathname
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statPagePartials(context, pathname) {
        const content = await this.openSnapshot(context);
        return await content.statPagePartials(pathname);
    }

    /**
     * Looks up page include metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {string} pathname - Valid logical page pathname
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statPageIncludes(context, pathname) {
        const content = await this.openSnapshot(context);
        return await content.statPageIncludes(pathname);
    }

    /**
     * Looks up page-template metadata, opening one snapshot for this call.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {string} filepath - Valid, non-root template filepath
     * @returns {Promise<import('./hyperview-content-object.js').HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statPageTemplate(context, filepath) {
        const content = await this.openSnapshot(context);
        return await content.statPageTemplate(filepath);
    }

    /**
     * Uploads the canonicalized global partial-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {Array<*>|Object} args.bundle - JSON-compatible partial-template definitions
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putTemplatePartials(context, args) {
        const { bundle, etag } = args;
        const pathname = getTemplatePartialsPath();
        const { hash, size, metadata } = await this.#store.putObject(context, pathname, bundle, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads the canonicalized base-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {Array<*>|Object} args.bundle - JSON-compatible base-template definitions
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putBaseTemplates(context, args) {
        const { bundle, etag } = args;
        const pathname = getBaseTemplatesPath();
        const { hash, size, metadata } = await this.#store.putObject(context, pathname, bundle, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads canonicalized metadata for a page as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {string} args.pathname - Valid logical page pathname
     * @param {Object} args.metadata - JSON-compatible page metadata
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {AssertionError} When pathname is not a valid page pathname
     * @throws {TypeError} When metadata cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageMetadata(context, args) {
        const { pathname: pagePath, metadata: pageMetadata, etag } = args;
        const pathname = getPageMetadataPath(pagePath);
        const { hash, size, metadata } = await this.#store.putObject(context, pathname, pageMetadata, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads a canonicalized page partial-template bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {string} args.pathname - Valid logical page pathname
     * @param {Array<*>|Object} args.bundle - JSON-compatible page partial-template definitions
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {AssertionError} When pathname is not a valid page pathname
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPagePartials(context, args) {
        const { pathname: pagePath, bundle, etag } = args;
        const pathname = getPagePartialsPath(pagePath);
        const { hash, size, metadata } = await this.#store.putObject(context, pathname, bundle, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads a canonicalized page include bundle as an immutable blob.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {string} args.pathname - Valid logical page pathname
     * @param {Array<*>|Object} args.bundle - JSON-compatible page include definitions
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {AssertionError} When pathname is not a valid page pathname
     * @throws {TypeError} When bundle cannot be canonicalized
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageIncludes(context, args) {
        const { pathname: pagePath, bundle, etag } = args;
        const pathname = getPageIncludesPath(pagePath);
        const { hash, size, metadata } = await this.#store.putObject(context, pathname, bundle, null, etag);
        return { hash, size, metadata };
    }

    /**
     * Uploads page template source as an immutable blob without canonicalizing it.
     * The blob remains unreachable from builds until included in `commitChanges()`.
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {string} args.filepath - Valid, non-root template filepath
     * @param {string} args.source - Template source text
     * @param {string} [args.etag] - Expected digest used to verify upload integrity
     * @returns {Promise<StoredContentDescriptor>} Descriptor for a content manifest
     * @throws {AssertionError} When filepath is not a valid, non-root template filepath
     * @throws {ValidationError} When etag does not match the uploaded content
     */
    async putPageTemplate(context, args) {
        const { filepath, source, etag } = args;
        const pathname = getPageTemplatePath(filepath);
        const { hash, size, metadata } = await this.#store.putUtf8(context, pathname, source, null, etag);
        return { hash, size, metadata };
    }

    // Checks that a manifest bundle/entry is an object carrying a
    // content-addressing hash and byte size, the two fields the generic store
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

    #filepathDirname(pathname) {
        const parts = pathname.split('/');
        parts.pop();
        return parts.join('/');
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
            if (!isNonEmptyString(filename) || !isValidTemplateFilepath(filename)) {
                return;
            }

            const entrySource = `${ source }[${ index }]`;
            const directory = this.#filepathDirname(getPageTemplatePath(filename));
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

    // Validates the whole manifest up front and returns the flat
    // ContentManifestFile list the generic store expects, instead of letting
    // its bare assumptions about pathname/hash/size shape surface as a deep,
    // hard-to-trace AssertionError. The manifest is client-supplied (it
    // arrives via the CommitChanges JSON:API request), so field-level failures
    // are reported as a ValidationError rather than an assertion, and every
    // problem is collected before throwing. The top-level shape is a call
    // contract, not client input, so a non-object manifest still asserts.
    #buildManifestFiles(manifest) {
        assert(isPlainObject(manifest), 'HyperviewContentService#commitChanges() requires a manifest object');

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
        // templates. `pathnameValidator` and `pathDescription` are page-path
        // for every group except pageTemplates, which uses the stricter
        // template-filepath rule: the page-path rule accepts "/", and letting
        // that through here would map a page-template entry onto the /pages
        // namespace root instead of a real file. `toInternalPathname` maps the
        // caller-supplied value to the pathname the generic store will index by.
        const checkArray = (entries, source, pathField, pathnameValidator, pathDescription, toInternalPathname, reservedFilenames) => {
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
                const isValidPath = isNonEmptyString(pathValue) && pathnameValidator(pathValue);
                if (!isValidPath) {
                    error.push(`${ entrySource }.${ pathField } must be a ${ pathDescription }`, `${ entrySource }.${ pathField }`);
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
                    const basename = normalizePathname(pathValue).split('/').pop();

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

        checkBundle('templatePartials', manifest.templatePartials, getTemplatePartialsPath());
        checkBundle('baseTemplates', manifest.baseTemplates, getBaseTemplatesPath());

        checkArray(
            manifest.pageMetadata,
            'pageMetadata',
            'pathname',
            isValidPathname,
            'valid pathname',
            (pathname) => getPageMetadataPath(pathname),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pagePartials,
            'pagePartials',
            'pathname',
            isValidPathname,
            'valid pathname',
            (pathname) => getPagePartialsPath(pathname),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pageIncludes,
            'pageIncludes',
            'pathname',
            isValidPathname,
            'valid pathname',
            (pathname) => getPageIncludesPath(pathname),
            RESERVED_PAGE_FILENAMES,
        );
        checkArray(
            manifest.pageTemplates,
            'pageTemplates',
            'filename',
            isValidTemplateFilepath,
            'valid, non-root template filepath',
            (filename) => getPageTemplatePath(filename),
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
     * @param {RequestContext} context - Request context carrying platform bindings
     * @param {Object} args
     * @param {string} [args.buildId] - Build to point at the newly committed closure; defaults to `context.runtime.build.id` only when omitted or `undefined`
     * @param {ContentManifest} args.manifest - Uploaded resources to include in the closure
     * @returns {Promise<{hash: string, count: number}>} Root hash and total number of file and directory nodes
     * @throws {ValidationError} When manifest entries are malformed, map to duplicate paths, or assign multiple templates to one page
     */
    async commitChanges(context, args) {
        const { buildId, manifest } = args ?? {};
        const resolvedBuildId = isUndefined(buildId) ? context.runtime.build.id : buildId;

        const files = this.#buildManifestFiles(manifest);

        const { rootHash, nodeCount } = await this.#store.commitChanges(context, resolvedBuildId, files);

        return { hash: rootHash, count: nodeCount };
    }
}
