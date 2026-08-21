import { AssertionError } from '../errors/mod.js';
import { assert } from '../assertions/mod.js';
import {
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
    isValidPathname,
    normalizePathname,
    getBaseTemplatesPath,
    getTemplatePartialsPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageIncludesPath,
    getPageTemplatePath,
} from './content-layout.js';
import { HyperviewContentObject, HyperviewContentStat } from './hyperview-content-object.js';


/**
 * Content required to construct a page and its aggregate cache validator.
 * @typedef {Object} PageContent
 * @property {string} etag - Digest covering inherited metadata and every blob in the leaf page directory
 * @property {HyperviewContentObject[]} pageDataFiles - Existing metadata files ordered from the root page to the requested page
 * @property {string|null} pageTemplateFilename - Leaf page template filename, or null when none is committed
 * @property {HyperviewContentObject|null} partials - Leaf page partial-template bundle, or null when absent
 * @property {HyperviewContentObject|null} includes - Leaf page include bundle, or null when absent
 */

// Derives a page's own directory pathname from its metadata path rather than
// exposing a general "join under /pages" constructor from content-layout.js.
// content-layout.js deliberately exposes only fully-formed resource path
// constructors so callers cannot assemble arbitrary internal paths; this
// stays private to the one caller (getPage()) that legitimately needs a page
// directory prefix to list its immediate children.
function getPageDirectoryPath(pathname) {
    const metadataPath = getPageMetadataPath(pathname);
    return metadataPath.slice(0, -'/page.json'.length);
}

/**
 * Request-scoped, Hyperview-semantic view of one immutable content index.
 *
 * Wraps a single generic `ContentIndexSnapshotInterface` and translates
 * Hyperview resource reads onto it. Holds no reference to the underlying
 * store; every read resolves against the index pinned when the wrapped
 * snapshot was opened. Do not retain an instance beyond the request that
 * opened it.
 */
export default class HyperviewContentSnapshot {

    #snapshot;

    /**
     * @param {Object} options
     * @param {import('../content-store/content-addressable-store-interface.js').ContentIndexSnapshotInterface} options.snapshot - Generic snapshot this instance wraps
     */
    constructor(options) {
        this.#snapshot = options.snapshot;
    }

    /**
     * Root hash of the immutable index pinned for this request.
     * @returns {string} Pinned content root hash
     */
    get rootHash() {
        return this.#snapshot.rootHash;
    }

    async #statPath(pathname) {
        const entry = await this.#snapshot.statPath(pathname);
        return entry ? new HyperviewContentStat(entry) : null;
    }

    async #getPath(pathname) {
        const stat = await this.#snapshot.statPath(pathname);

        if (!stat) {
            return null;
        }
        if (stat.kind !== 'blob') {
            throw new AssertionError(
                `HyperviewContentSnapshot#getPath(): The pathname "${ pathname }" points to a directory and not a blob`,
            );
        }

        const bytes = await this.#snapshot.getBlob(stat.hash);
        if (!bytes) {
            throw new AssertionError(
                `HyperviewContentSnapshot#getPath(): The pathname "${ pathname }" references unreadable blob "${ stat.hash }"`,
            );
        }

        // Carry the index entry's etag onto the content object. Callers cache
        // compiled templates under it and compare it against the etag from the
        // matching stat method, so dropping it here silently turns every one of
        // those caches into a permanent miss.
        return new HyperviewContentObject(bytes, {
            kind: 'blob',
            hash: stat.hash,
            etag: stat.etag,
            size: bytes.length,
            metadata: stat.metadata,
        });
    }

    /**
     * Looks up global partial-template metadata in the pinned index.
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statTemplatePartials() {
        return await this.#statPath(getTemplatePartialsPath());
    }

    /**
     * Loads global partial-template content from the pinned index.
     * @returns {Promise<HyperviewContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When the indexed blob is unreadable
     */
    async getTemplatePartials() {
        return await this.#getPath(getTemplatePartialsPath());
    }

    /**
     * Looks up base-template metadata in the pinned index.
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     */
    async statBaseTemplates() {
        return await this.#statPath(getBaseTemplatesPath());
    }

    /**
     * Loads base-template content from the pinned index.
     * @returns {Promise<HyperviewContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When the indexed blob is unreadable
     */
    async getBaseTemplates() {
        return await this.#getPath(getBaseTemplatesPath());
    }

    /**
     * Looks up page metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     * @throws {AssertionError} When pagePath is not a valid page pathname
     */
    async statPageMetadata(pagePath) {
        return await this.#statPath(getPageMetadataPath(pagePath));
    }

    /**
     * Looks up page partial metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     * @throws {AssertionError} When pagePath is not a valid page pathname
     */
    async statPagePartials(pagePath) {
        return await this.#statPath(getPagePartialsPath(pagePath));
    }

    /**
     * Looks up page include metadata in the pinned index.
     * @param {string} pagePath - Valid logical page pathname
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     * @throws {AssertionError} When pagePath is not a valid page pathname
     */
    async statPageIncludes(pagePath) {
        return await this.#statPath(getPageIncludesPath(pagePath));
    }

    /**
     * Looks up page-template metadata in the pinned index.
     * @param {string} filepath - Valid, non-root template filepath
     * @returns {Promise<HyperviewContentStat|null>} Resource attributes, or null when absent
     * @throws {AssertionError} When filepath is not a valid, non-root template filepath
     */
    async statPageTemplate(filepath) {
        return await this.#statPath(getPageTemplatePath(filepath));
    }

    /**
     * Loads page-template content from the pinned index.
     * @param {string} filepath - Valid, non-root template filepath
     * @returns {Promise<HyperviewContentObject|null>} Content, or null when absent
     * @throws {AssertionError} When filepath is not a valid, non-root template filepath, or the indexed blob is unreadable
     */
    async getPageTemplate(filepath) {
        return await this.#getPath(getPageTemplatePath(filepath));
    }

    /**
     * Loads the requested page's inherited metadata and immediate leaf
     * resources from the index pinned for this snapshot. Metadata is returned
     * in root-to-leaf order. The aggregate etag covers every returned metadata
     * file and every blob in the leaf page directory.
     * @param {string} pathname - Valid logical page pathname
     * @returns {Promise<PageContent|null>} Page content, or null when leaf metadata is absent
     * @throws {AssertionError} When pathname is not a valid page pathname, or more than one page template exists in the leaf directory
     */
    async getPage(pathname) {
        assert(isValidPathname(pathname), 'HyperviewContentSnapshot#getPage() requires a valid pathname');

        const parts = normalizePathname(pathname).split('/').filter((part) => part);
        const filepaths = [ getPageMetadataPath('/') ];
        let path = '/';

        for (const part of parts) {
            path = `${ path }${ part }/`;
            filepaths.push(getPageMetadataPath(path));
        }

        const leafPage = filepaths.pop();
        const leafPageStat = await this.#snapshot.statPath(leafPage);
        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await this.#snapshot.statPath(parentFilepath);
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = getPageDirectoryPath(pathname);
        const sourceFileStats = await this.#snapshot.listStats(directory, { recursive: false });
        const entries = parentStats
            .concat(sourceFileStats)
            .filter((entry) => entry.kind === 'blob');
        const blobs = await this.#snapshot.getBlobs(entries.map(({ hash }) => hash));

        const pageDataFiles = [];
        let pageTemplateFilename = null;
        let partials = null;
        let includes = null;
        const pageFiles = [];

        for (let i = 0; i < entries.length; i += 1) {
            const entry = entries[i];
            const bytes = blobs[i];
            assert(bytes, `missing expected blob from ${ entry.pathname }`);
            pageFiles.push(entry);
            const basename = entry.pathname.split('/').pop();
            if (basename === 'page.json') {
                pageDataFiles.push(new HyperviewContentObject(bytes, entry));
            } else if (basename === PAGE_PARTIALS_BUNDLE) {
                partials = new HyperviewContentObject(bytes, entry);
            } else if (basename === PAGE_INCLUDES_BUNDLE) {
                includes = new HyperviewContentObject(bytes, entry);
            } else {
                assert(
                    pageTemplateFilename === null,
                    `HyperviewContentSnapshot#getPage(): found more than one page template in "${ directory }"`,
                );
                pageTemplateFilename = basename;
            }
        }

        const etag = await this.#snapshot.computeHashFromStats(pageFiles);

        return {
            etag, pageDataFiles, pageTemplateFilename, partials, includes,
        };
    }
}
