import {
    TextContentObject,
    JsonContentObject,
    StreamContentObject,
} from './content-object.js';
import {
    isValidPathname,
    normalizePathname,
    getStaticAssetPath,
    getGlobalTemplatePartialsPath,
    getBaseTemplatesPath,
    getPageDirectoryPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageIncludesPath,
    getPageTemplatePath,
    isPageMetadataPath,
    isPagePartialsPath,
    isPageIncludesPath,
    getEmailBundlePath,
} from './content-layout.js';
import {
    canonicalize,
    hashSet,
    hashStringBlob,
    hashArrayBufferBlob,
} from './addressing.js';
import {
    assert,
    assertEqual,
    assertArray,
    assertNonEmptyString,
    isString,
    isPlainObject,
} from '../assertions/mod.js';


/**
 * A read and write view of one immutable content closure, pinned for the life
 * of a request.
 *
 * ## Reads are pinned; writes are not
 * The two halves of this class have deliberately different semantics, and the
 * shared object is what makes the pairing convenient rather than what makes them
 * the same operation.
 *
 * - `stat*` and `get*` resolve a pathname through *this* snapshot's index. They
 *   see exactly the closure the snapshot was opened with, and are unaffected by
 *   a deploy landing mid-request.
 * - `put*` writes a blob to the store and returns its content address. It does
 *   **not** touch this snapshot's index, so a value written here is not readable
 *   through this snapshot, or any other, until a subsequent
 *   `ContentAddressableStore#commitChanges()` publishes a closure naming it.
 *
 * That asymmetry is the whole publishing model: uploading content and making it
 * live are separate steps, which is what lets a build be staged completely
 * before a single request sees any part of it.
 *
 * ## The pathname namespaces
 * Callers pass *logical* pathnames — `/blog/post`, `/logo.png` — and never the
 * storage pathnames the index is keyed by. Each method applies the layout rule
 * for its content kind, mapping the logical pathname into one of the reserved
 * namespaces (`/pages`, `/templates`, `/assets`, `/emails`). Keeping that
 * mapping here rather than at the call sites is what stops one content kind from
 * being written into another's namespace.
 *
 * ## Absence
 * A `get*` for content the index does not name resolves `null`; it is an
 * ordinary outcome, because a published site is not required to contain any
 * particular page or bundle. A pathname the index *does* name but the store
 * cannot produce bytes for is a different matter — the index and the blob store
 * disagree — and asserts.
 * @see ContentAddressableStore#openSnapshot in ./content-addressable-store.js for how a snapshot is obtained
 * @see ContentStoreInterface in ./content-store-interface.js for the persistence contract
 */
export default class ContentSnapshot {

    #store;
    #index;

    /**
     * @param {ContentStoreInterface} store - Platform adapter for blob and index persistence
     * @param {import('./content-addressable-index.js').default} index - The closure this snapshot is pinned to
     */
    constructor(store, index) {
        this.#store = store;
        this.#index = index;
    }

    // Resolves a storage pathname through the pinned index and reads its blob.
    // Returns null for a pathname the index does not name, which every caller
    // translates into its own "no such content" result. A pathname the index
    // does name but the store cannot satisfy is an index/blob-store
    // disagreement rather than missing content, so it asserts instead.
    async #getFile(context, type, pathname) {
        const stat = this.#index.getNode(pathname);

        if (!stat) {
            return null;
        }
        assertEqual('blob', stat.kind, `Expected the path "${ pathname }" to point to a file and not a directory`);

        const bytes = await this.#store.getFile(context, type, stat.pathname, stat.hash);

        // A 'stream' read yields a Web ReadableStream; every other type yields
        // the bytes themselves. Either way a null means the index names a blob
        // the store cannot produce, which is what this guard is really for.
        const isReadable = type === 'stream'
            ? bytes instanceof ReadableStream
            : (isString(bytes) || bytes instanceof ArrayBuffer);

        assert(
            isReadable,
            `The pathname "${ pathname }" references unreadable blob "${ stat.hash }"`,
        );

        // `bytes` could be a String, ArrayBuffer, or ReadableStream, depending
        // on the `type`.
        return [ stat, bytes ];
    }

    // The type selects the hash function and nothing else — the store derives
    // the representation from the blob itself. An unrecognized type must throw
    // rather than fall through: hashing nothing would content-address the blob
    // by `undefined` and the mistake would only surface a layer down.
    async #putFile(context, type, pathname, bytes) {
        assert(
            type === 'text' || type === 'arrayBuffer',
            `Invalid type "${ type }" passed into ContentSnapshot#putFile()`,
        );

        const hash = type === 'text'
            ? await hashStringBlob(bytes)
            : await hashArrayBufferBlob(bytes);

        await this.#store.putFile(context, pathname, hash, bytes);

        return {
            pathname,
            hash,
        };
    }

    /**
     * Reads a static asset's index entry without fetching its bytes. Used to
     * answer conditional requests and to derive cache keys.
     * @param {string} pathname - Logical asset pathname
     * @returns {import('./content-addressable-index.js').IndexEntry|null} The entry, or null when the asset is not published
     */
    statStaticAsset(pathname) {
        assert(isValidPathname(pathname), 'statStaticAsset() requires a valid pathname');
        const fullPathname = getStaticAssetPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Reads a static asset as a stream of its bytes.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical asset pathname
     * @returns {Promise<import('./content-object.js').StreamContentObject|null>} The asset, or null when it is not published
     * @throws {AssertionError} When the index names the asset but the store cannot produce it
     * @throws {OperationalError} When the backing store fails
     */
    async getStaticAsset(context, pathname) {
        assert(isValidPathname(pathname), 'getStaticAsset() requires a valid pathname');
        const fullPathname = getStaticAssetPath(pathname);
        // Static assets are the one read that streams: they are the largest
        // blobs served and their bytes go straight to the response, so there is
        // nothing to gain by buffering them into memory first. Writes stay
        // buffered, because the content address is derived from the whole blob.
        //
        // The returned stream is single-use. A caller that does not consume it
        // (a HEAD request, a 304) MUST cancel it to release the underlying
        // binding or file handle.
        const result = await this.#getFile(context, 'stream', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, stream ] = result;
        return new StreamContentObject(stream, stat);
    }

    /**
     * Writes a static asset's bytes to the blob store. The asset does not become
     * readable until a later commit publishes a closure naming the returned hash.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical asset pathname
     * @param {ArrayBuffer} arrayBuffer - The asset's bytes
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putStaticAsset(context, pathname, arrayBuffer) {
        assert(isValidPathname(pathname), 'putStaticAsset() requires a valid pathname');
        assert(arrayBuffer instanceof ArrayBuffer, 'putStaticAsset() requires an ArrayBuffer payload');
        const fullPathname = getStaticAssetPath(pathname);
        return await this.#putFile(context, 'arrayBuffer', fullPathname, arrayBuffer);
    }

    /**
     * Reads the global partial-template bundle's index entry without fetching it.
     * @returns {import('./content-addressable-index.js').IndexEntry|null} The entry, or null when no bundle is published
     */
    statGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();
        return this.#index.getNode(fullPathname);
    }

    /**
     * Reads the global partial-template bundle, shared by every page render.
     * @param {Object} context - Request or execution context
     * @returns {Promise<import('./content-object.js').JsonContentObject|null>} The parsed bundle, or null when none is published
     * @throws {AssertionError} When the index names the bundle but the store cannot produce it
     * @throws {OperationalError} When the backing store fails
     */
    async getGlobalTemplatePartials(context) {
        const fullPathname = getGlobalTemplatePartialsPath();

        const result = await this.#getFile(context, 'text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    /**
     * Writes the global partial-template bundle to the blob store, canonicalized
     * so that an unchanged bundle always hashes to the same address.
     * @param {Object} context - Request or execution context
     * @param {Array<*>} bundle - The partial-template bundle to publish
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putGlobalTemplatePartials(context, bundle) {
        assertArray(bundle, 'putGlobalTemplatePartials() requires an Array bundle');
        const fullPathname = getGlobalTemplatePartialsPath();
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads the base-template bundle's index entry without fetching it.
     * @returns {import('./content-addressable-index.js').IndexEntry|null} The entry, or null when no bundle is published
     */
    statBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();
        return this.#index.getNode(fullPathname);
    }

    /**
     * Reads the base-template bundle, which supplies the outer document each
     * page template renders into.
     * @param {Object} context - Request or execution context
     * @returns {Promise<import('./content-object.js').JsonContentObject|null>} The parsed bundle, or null when none is published
     * @throws {AssertionError} When the index names the bundle but the store cannot produce it
     * @throws {OperationalError} When the backing store fails
     */
    async getBaseTemplates(context) {
        const fullPathname = getBaseTemplatesPath();

        const result = await this.#getFile(context, 'text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    /**
     * Writes the base-template bundle to the blob store, canonicalized so that
     * an unchanged bundle always hashes to the same address.
     * @param {Object} context - Request or execution context
     * @param {Array<*>} bundle - The base-template bundle to publish
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putBaseTemplates(context, bundle) {
        assertArray(bundle, 'putBaseTemplates() requires an Array bundle');
        const fullPathname = getBaseTemplatesPath();
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads a page's metadata index entry without fetching its bytes.
     * @param {string} pathname - Logical page pathname
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} The entry, or null when the page publishes no metadata
     */
    async statPageMetadata(pathname) {
        assert(isValidPathname(pathname), 'statPageMetadata() requires a valid pathname');
        const fullPathname = getPageMetadataPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Writes a page's metadata to the blob store, canonicalized so that
     * unchanged metadata always hashes to the same address.
     *
     * Metadata is inherited: a page render merges the metadata of every ancestor
     * directory, broadest first, so a value published here becomes a default for
     * everything nested beneath this pathname.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical page pathname
     * @param {Object} obj - Page metadata to publish
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putPageMetadata(context, pathname, obj) {
        assert(isValidPathname(pathname), 'putPageMetadata() requires a valid pathname');
        assert(isPlainObject(obj), 'putPageMetadata() requires a metadata object');
        const fullPathname = getPageMetadataPath(pathname);
        const json = canonicalize(obj);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads a page's include-bundle index entry without fetching its bytes.
     * @param {string} pathname - Logical page pathname
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} The entry, or null when the page publishes no includes
     */
    async statPageIncludes(pathname) {
        assert(isValidPathname(pathname), 'statPageIncludes() requires a valid pathname');
        const fullPathname = getPageIncludesPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Writes a page's include bundle — the pre-rendered fragments its template
     * interpolates — to the blob store, canonicalized.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical page pathname
     * @param {Object} bundle - The include bundle to publish, keyed by include name
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putPageIncludes(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putPageIncludes() requires a valid pathname');
        assert(isPlainObject(bundle), 'putPageIncludes() requires a plain object bundle');
        const fullPathname = getPageIncludesPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads a page's partial-bundle index entry without fetching its bytes.
     * @param {string} pathname - Logical page pathname
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} The entry, or null when the page publishes no partials
     */
    async statPagePartials(pathname) {
        assert(isValidPathname(pathname), 'statPagePartials() requires a valid pathname');
        const fullPathname = getPagePartialsPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Writes a page's partial-template bundle to the blob store, canonicalized.
     * These partials layer over the global bundle for this page only.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical page pathname
     * @param {Array<*>} bundle - The partial-template bundle to publish
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putPagePartials(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putPagePartials() requires a valid pathname');
        assertArray(bundle, 'putPagePartials() requires an Array bundle');
        const fullPathname = getPagePartialsPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads a page template's index entry without fetching its source.
     * @param {string} pathname - Logical template filepath, including the filename
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} The entry, or null when no such template is published
     */
    async statPageTemplate(pathname) {
        assert(isValidPathname(pathname), 'statPageTemplate() requires a valid pathname');
        const fullPathname = getPageTemplatePath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Writes a page template's source to the blob store.
     *
     * Unlike the bundles, a template is stored as an ordinary file inside its
     * page directory, so the filepath must name a file and must not collide with
     * one of the directory's reserved bundle filenames.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical template filepath, including the filename
     * @param {string} source - Template source text
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     * @see isValidTemplateFilepath in ./content-layout.js for the filepath rule
     */
    async putPageTemplate(context, pathname, source) {
        assert(isValidPathname(pathname), 'putPageTemplate() requires a valid pathname');
        assertNonEmptyString(source, 'putPageTemplate() requires a non-empty source string');
        const fullPathname = getPageTemplatePath(pathname);
        return await this.#putFile(context, 'text', fullPathname, source);
    }

    /**
     * Reads an email bundle's index entry without fetching its bytes.
     * @param {string} pathname - Logical email pathname
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} The entry, or null when no bundle is published
     */
    async statEmailAssets(pathname) {
        assert(isValidPathname(pathname), 'statEmailAssets() requires a valid pathname');
        const fullPathname = getEmailBundlePath(pathname);
        return this.#index.getNode(fullPathname);
    }

    /**
     * Reads an email bundle: the subject metadata plus the HTML and text
     * templates for one email, published as a single object.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical email pathname
     * @returns {Promise<import('./content-object.js').JsonContentObject|null>} The parsed bundle, or null when none is published
     * @throws {AssertionError} When the index names the bundle but the store cannot produce it
     * @throws {OperationalError} When the backing store fails
     */
    async getEmailAssets(context, pathname) {
        assert(isValidPathname(pathname), 'getEmailAssets() requires a valid pathname');

        const fullPathname = getEmailBundlePath(pathname);
        const result = await this.#getFile(context, 'text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    /**
     * Writes an email bundle to the blob store, canonicalized.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical email pathname
     * @param {Object} bundle - The email bundle to publish
     * @returns {Promise<{pathname: string, hash: string}>} The storage pathname and content hash to record in the manifest
     * @throws {OperationalError} When the backing store fails
     */
    async putEmailAssets(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putEmailAssets() requires a valid pathname');
        assert(isPlainObject(bundle), 'putEmailAssets() requires a plain object bundle');
        const fullPathname = getEmailBundlePath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    /**
     * Reads everything one page render needs in a single bulk fetch: the
     * metadata of every ancestor directory, plus the leaf page's own template,
     * partials, and includes.
     *
     * This exists as one method rather than several because a render must not
     * compose a page from separately-timed reads, and because a page beneath n
     * directories would otherwise cost n+4 round trips. The `hash` it returns
     * covers every file the render actually read, so it is a complete
     * invalidation key for the rendered output.
     *
     * A page's directory is treated as closed: any blob directly inside it which
     * is not one of the reserved bundle filenames is taken to be the page
     * template, and exactly one is expected.
     * @param {Object} context - Request or execution context
     * @param {string} pathname - Logical page pathname
     * @returns {Promise<{hash: string, pageDataFiles: import('./content-object.js').JsonContentObject[], template: import('./content-object.js').TextContentObject|null, partials: import('./content-object.js').JsonContentObject|null, includes: import('./content-object.js').JsonContentObject|null}|null>} The page's content, with `pageDataFiles` ordered from the broadest ancestor to the leaf, or null when the leaf page publishes no metadata of its own
     * @throws {AssertionError} When the index names a file the store cannot produce, or the page directory holds more than one template
     * @throws {OperationalError} When the backing store fails
     */
    async batchGetPageAssets(context, pathname) {
        assert(isValidPathname(pathname), 'batchGetPageAssets() requires a valid pathname');

        const parts = normalizePathname(pathname).split('/').filter((part) => part);
        const filepaths = [ getPageMetadataPath('/') ];
        let path = '/';

        for (const part of parts) {
            path = `${ path }${ part }/`;
            filepaths.push(getPageMetadataPath(path));
        }

        const leafPage = filepaths.pop();
        const leafPageStat = this.#index.getNode(leafPage);
        if (!leafPageStat) {
            // If the leaf page node does not exist, we consider the page to not exist.
            return null;
        }

        const parentStats = filepaths.map((parentFilepath) => {
            return this.#index.getNode(parentFilepath);
        });

        const directory = getPageDirectoryPath(pathname);
        const sourceFileStats = this.#index.listNodes(directory, { recursive: false });

        const files = parentStats
            .concat(sourceFileStats)
            // Ancestor page metadata is optional: a nested page may sit beneath
            // directories which publish no page.json of their own, and getNode()
            // returns null for each of those.
            .filter((entry) => entry !== null && entry.kind === 'blob');

        const results = await this.#store.getFiles(context, 'text', files);

        const pageDataFiles = [];
        let template = null;
        let partials = null;
        let includes = null;

        for (let i = 0; i < results.length; i += 1) {
            // It is important that getFiles() returns results in the same
            // order as the stats array we passed into it, so that
            // we can match stats with their blobs.
            const stat = files[i];
            const bytes = results[i];
            assertNonEmptyString(bytes, `The pathname "${ stat.pathname }" references unreadable blob "${ stat.hash }"`);

            if (isPageMetadataPath(stat.pathname)) {
                pageDataFiles.push(new JsonContentObject(bytes, stat));
            } else if (isPagePartialsPath(stat.pathname)) {
                partials = new JsonContentObject(bytes, stat);
            } else if (isPageIncludesPath(stat.pathname)) {
                includes = new JsonContentObject(bytes, stat);
            } else {
                assert(
                    template === null,
                    `batchGetPageAssets(): found more than one page template in "${ directory }"`,
                );
                template = new TextContentObject(bytes, stat);
            }
        }

        const hash = await hashSet(files);
        return { hash, pageDataFiles, template, partials, includes };
    }
}
