import { AssertionError } from '../../../kixx/errors/mod.js';
import { assert } from '../../../kixx/assertions/mod.js';
import {
    BASE_TEMPLATES_BUNDLE,
    TEMPLATE_PARTIALS_BUNDLE,
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
    isValidPathname,
    normalizePagePath,
    normalizePathname,
    normalizeTemplatePath,
} from './addressing.js';
import { ContentObject, StatObject } from './content-object.js';


/**
 * Content required to construct a page and its aggregate cache validator.
 * @typedef {Object} PageContent
 * @property {string} etag - Digest covering inherited metadata and every blob in the leaf page directory
 * @property {ContentObject[]} pageDataFiles - Existing metadata files ordered from the root page to the requested page
 * @property {string|null} pageTemplateFilename - Leaf page template filename, or null when none is committed
 * @property {ContentObject|null} partials - Leaf page partial-template bundle, or null when absent
 * @property {ContentObject|null} includes - Leaf page include bundle, or null when absent
 */

/**
 * Request-scoped view of one immutable content index.
 *
 * Every read performed through an instance resolves against the index captured
 * when its owning store opened the snapshot. Do not retain a snapshot beyond
 * the request that opened it.
 */
export default class ContentSnapshot {

    #store;
    #context;
    #index;

    /**
     * @param {Object} options - Snapshot dependencies captured for one request
     * @param {Object} options.store - Backing blob store
     * @param {Object} options.context - Request context supplying blob bindings
     * @param {import('./content-addressable-index.js').default} options.index - Immutable index pinned for the snapshot lifetime
     */
    constructor(options) {
        this.#store = options.store;
        this.#context = options.context;
        this.#index = options.index;
    }

    /**
     * Root hash of the immutable index pinned for this request.
     * @returns {string} Pinned content root hash
     */
    get rootHash() {
        return this.#index.rootHash;
    }

    /**
     * Looks up a pathname in the index pinned for this snapshot.
     * @param {string} pathname - Logical pathname including a leading slash
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry|null>} Matching node, or null when absent from the pinned index
     */
    async statPath(pathname) {
        return await this.#index.getNode(pathname);
    }

    /**
     * Lists nodes from the index pinned for this snapshot.
     * @param {string} prefix - Directory pathname
     * @param {Object} [options] - Listing options
     * @returns {Promise<import('./content-addressable-index.js').IndexEntry[]>} Matching nodes from the pinned index
     */
    async listStats(prefix, options) {
        return await this.#index.listNodes(prefix, options);
    }

    /**
     * Reads one immutable blob while retaining this snapshot's request bindings.
     * @param {string} hash - Content hash to read
     * @returns {Promise<Uint8Array|null>} Blob bytes, or null when unavailable
     */
    async getBlob(hash) {
        return await this.#store.getBlob(this.#context, hash);
    }

    /**
     * Reads immutable blobs while retaining this snapshot's request bindings.
     * @param {string[]} hashes - Content hashes to read
     * @returns {Promise<Array<Uint8Array|null>>} Bytes in the same order as `hashes`
     */
    async getBlobs(hashes) {
        return await this.#store.getBlobs(this.#context, hashes);
    }

    async #getPath(pathname) {
        const stat = await this.statPath(pathname);

        if (!stat) {
            return null;
        }
        if (stat.kind !== 'blob') {
            throw new AssertionError(
                `ContentAddressableStore#getPath(): The pathname "${ pathname }" points to a directory and not a blob`,
            );
        }

        const bytes = await this.getBlob(stat.hash);
        if (!bytes) {
            throw new AssertionError(
                `ContentAddressableStore#getPath(): The pathname "${ pathname }" references unreadable blob "${ stat.hash }"`,
            );
        }

        return new ContentObject(bytes, {
            kind: 'blob',
            hash: stat.hash,
            size: bytes.length,
            metadata: stat.metadata,
        });
    }

    /**
     * Looks up global partial-template metadata in the pinned index.
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statTemplatePartials() {
        return await this.#statPath(normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
    }

    /**
     * Loads global partial-template content from the pinned index.
     * @returns {Promise<ContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When the indexed blob is unreadable
     */
    async getTemplatePartials() {
        return await this.#getPath(normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
    }

    /**
     * Looks up base-template metadata in the pinned index.
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statBaseTemplates() {
        return await this.#statPath(normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    /**
     * Loads base-template content from the pinned index.
     * @returns {Promise<ContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When the indexed blob is unreadable
     */
    async getBaseTemplates() {
        return await this.#getPath(normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    /**
     * Looks up page metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statPageMetadata(pagePath) {
        this.#assertPagePath('statPageMetadata', pagePath, 'valid page pathname');
        return await this.#statPath(normalizePagePath(`${ pagePath }/page.json`));
    }

    /**
     * Looks up page partial metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statPagePartials(pagePath) {
        this.#assertPagePath('statPagePartials', pagePath, 'valid page pathname');
        return await this.#statPath(normalizePagePath(`${ pagePath }/${ PAGE_PARTIALS_BUNDLE }`));
    }

    /**
     * Looks up page include metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statPageIncludes(pagePath) {
        this.#assertPagePath('statPageIncludes', pagePath, 'valid page pathname');
        return await this.#statPath(normalizePagePath(`${ pagePath }/${ PAGE_INCLUDES_BUNDLE }`));
    }

    /**
     * Looks up page-template metadata in the pinned index.
     * @param {string} filepath - Valid template filepath beneath `/pages`
     * @returns {Promise<StatObject|null>} Resource attributes, or null when absent
     */
    async statPageTemplate(filepath) {
        this.#assertPagePath('statPageTemplate', filepath, 'valid pathname and filename');
        return await this.#statPath(normalizePagePath(filepath));
    }

    /**
     * Loads page-template content from the pinned index.
     * @param {string} filepath - Template filepath beneath `/pages`
     * @returns {Promise<ContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When the indexed blob is unreadable
     */
    async getPageTemplate(filepath) {
        return await this.#getPath(normalizePagePath(filepath));
    }

    async #statPath(pathname) {
        const entry = await this.statPath(pathname);
        return entry ? new StatObject(entry) : null;
    }

    #assertPagePath(methodName, pathname, description) {
        assert(
            isValidPathname(pathname),
            `ContentAddressableStore#${ methodName }() requires a ${ description }`,
        );
    }

    /**
     * Loads the requested page's inherited metadata and immediate leaf
     * resources from the index pinned for this snapshot. Metadata is returned
     * in root-to-leaf order. The aggregate etag covers every returned metadata
     * file and every blob in the leaf page directory.
     * @param {string} pathname - Valid logical page pathname
     * @returns {Promise<PageContent|null>} Page content, or null when leaf metadata is absent
     */
    async getPage(pathname) {
        this.#assertPagePath('getPage', pathname, 'valid pathname');

        const parts = normalizePathname(pathname).split('/').filter((part) => part);
        const filepaths = [ normalizePagePath('page.json') ];
        let path = '/';

        for (const part of parts) {
            path = `${ path }${ part }/`;
            filepaths.push(normalizePagePath(`${ path }page.json`));
        }

        const leafPage = filepaths.pop();
        const leafPageStat = await this.statPath(leafPage);
        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await this.statPath(parentFilepath);
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = normalizePagePath(pathname);
        const sourceFileStats = await this.listStats(directory, { recursive: false });
        const entries = parentStats.concat(sourceFileStats);
        const blobs = await this.getBlobs(entries.map(({ hash }) => hash));

        const pageDataFiles = [];
        let pageTemplateFilename = null;
        let partials = null;
        let includes = null;
        const pageFiles = [];

        for (let i = 0; i < entries.length; i += 1) {
            const entry = entries[i];
            const bytes = blobs[i];
            if (entry.kind === 'blob') {
                assert(bytes, `missing expected blob from ${ entry.pathname }`);
                pageFiles.push(entry);
                const basename = entry.pathname.split('/').pop();
                if (basename === 'page.json') {
                    pageDataFiles.push(new ContentObject(bytes, entry));
                } else if (basename === PAGE_PARTIALS_BUNDLE) {
                    partials = new ContentObject(bytes, entry);
                } else if (basename === PAGE_INCLUDES_BUNDLE) {
                    includes = new ContentObject(bytes, entry);
                } else {
                    assert(
                        pageTemplateFilename === null,
                        `ContentAddressableStore#getPage(): found more than one page template in "${ directory }"`,
                    );
                    pageTemplateFilename = basename;
                }
            }
        }

        const dependencies = parentStats.concat(pageFiles);
        const etag = await this.#store.computeHashFromStats(dependencies);

        return { etag, pageDataFiles, pageTemplateFilename, partials, includes };
    }
}
