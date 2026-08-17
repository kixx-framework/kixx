import { AssertionError } from '../../../kixx/errors/mod.js';
import { assert } from '../../../kixx/assertions/mod.js';
import Store from './store.js';
import { ContentObject, StatObject } from './content-object.js';
import {
    canonicalize,
    hashValue,
    isValidPathname,
    normalizePathname,
    stringToUint8Array,
} from './addressing.js';


const BASE_TEMPLATES_BUNDLE = '__base-templates-bundle';
const TEMPLATE_PARTIALS_BUNDLE = '__template-partials-bundle';
const PAGE_PARTIALS_BUNDLE = '__page-partials-bundle';
const PAGE_INCLUDES_BUNDLE = '__page-includes-bundle';


export default class ContentAddressableStore {

    #logger;
    #store;

    constructor(options) {
        this.#logger = options.logger.createChild('ContentAddressableStore');

        this.#store = options.store ?? new Store({
            logger: this.#logger,
            kvBindingName: options.kvBindingName,
            durableObjectBindingName: options.durableObjectBindingName,
            blobReadCacheTtlSeconds: options.blobReadCacheTtlSeconds,
            indexCacheTtlSeconds: options.indexCacheTtlSeconds,
        });
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
     * Folds a ContentAddressableStore pathname to its canonical form, removing
     * trailing, and consecutive slashes "/" before converting to lower case
     * and ensuring it starts with a slash "/".
     * @param {string} value - Identifier to normalize
     * @returns {string} The validated identifier folded to lower case
     */
    normalizePathname(value) {
        return normalizePathname(value);
    }

    #normalizeTemplatePath(pathname) {
        return this.normalizePathname(`templates/${ pathname }`);
    }

    #normalizePagePath(pathname) {
        return this.normalizePathname(`pages/${ pathname }`);
    }

    #filepathBasename(pathname) {
        return pathname.split('/').pop();
    }

    async #getPath(context, pathname) {
        const stat = await this.#store.statPath(context, pathname);

        if (!stat) {
            return null;
        }
        if (stat.kind !== 'blob') {
            throw new AssertionError(
                `ContentAddressableStore#getPath(): The pathname "${ pathname }" points to a directory and not a blob`,
            );
        }

        const bytes = await this.#store.getBlob(context, stat.hash);

        if (bytes) {
            return null;
        }

        return new ContentObject(bytes, {
            pathname: stat.pathname,
            kind: 'blob',
            hash: stat.hash,
            size: bytes.length,
            metadata: stat.metadata,
        });
    }

    async putTemplatePartials(context, bundle, etag) {
        const pathname = this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statTemplatePartials(context) {
        const entry = await this.#store.statPath(context, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async getTemplatePartials(context) {
        return await this.#getPath(context, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
    }

    async putBaseTemplates(context, bundle, etag) {
        const pathname = this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statBaseTemplates(context) {
        const entry = await this.#store.statPath(context, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async getBaseTemplates(context) {
        return await this.#getPath(context, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    async putPageMetadata(context, pagePath, obj, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPageMetadata() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/page.json`);
        const blob = stringToUint8Array(canonicalize(obj));
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statPageMetadata(context, pagePath) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#statPageMetadata() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/page.json`);
        const entry = await this.#store.statPath(context, pathname);
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async putPagePartials(context, pagePath, bundle, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPagePartials() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/${ PAGE_PARTIALS_BUNDLE }`);
        const blob = stringToUint8Array(canonicalize(bundle));
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statPagePartials(context, pagePath) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#statPagePartials() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/${ PAGE_PARTIALS_BUNDLE }`);
        const entry = await this.#store.statPath(context, pathname);
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async putPageIncludes(context, pagePath, bundle, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPageIncludes() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/${ PAGE_INCLUDES_BUNDLE }`);
        const blob = stringToUint8Array(canonicalize(bundle));
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statPageIncludes(context, pagePath) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#statPageIncludes() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/${ PAGE_INCLUDES_BUNDLE }`);
        const entry = await this.#store.statPath(context, pathname);
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async putPageTemplate(context, filepath, sourceText, etag) {
        assert(
            this.isValidPathname(filepath),
            'ContentAddressableStore#putPageTemplate() requires a valid filepath',
        );

        const pathname = this.#normalizePagePath(filepath);
        const blob = stringToUint8Array(sourceText);
        const stats = await this.#store.putBlob(context, pathname, blob, null, etag);
        return await this.#store.touchBlob(context, stats);
    }

    async statPageTemplate(context, filepath) {
        assert(
            this.isValidPathname(filepath),
            'ContentAddressableStore#statPageTemplate() requires a valid pathname and filename',
        );

        const entry = await this.#store.statPath(context, this.#normalizePagePath(filepath));
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async getPageTemplate(context, filepath) {
        return await this.#getPath(context, this.#normalizePagePath(filepath));
    }

    async hashValue(value) {
        return await hashValue(value);
    }

    async getPage(context, pathname) {
        assert(
            this.isValidPathname(pathname),
            'ContentAddressableStore#getPage() requires a valid pathname',
        );

        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json
        const parts = this.normalizePathname(pathname).split('/');
        const filepaths = [];
        let path;

        // Always start with the root page metadata item.
        filepaths.push(this.#normalizePagePath('page.json'));

        for (const part of parts) {
            path = `${ path }/${ part }`;
            filepaths.push(this.#normalizePagePath(`${ path }/page.json`));
        }

        // We don't need to get the page leaf node page.json separately, because we'll
        // be fetching everything in the `pages/${ pathname }` directory, including
        // the leaf page.json file. But, we can do a cheap check to make sure it
        // exists before proceeding.
        const leafPage = filepaths.pop();
        const leafPageStat = await this.#store.statPath(context, leafPage);

        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await this.#store.statPath(context, parentFilepath);
            // Not all parent pages have a page.json file.
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = this.#normalizePagePath(pathname);

        const sourceFileStats = await this.#store.listStats(context, directory, { recursive: false });

        const hashesToFetch = parentStats
            .concat(sourceFileStats)
            .map(({ hash }) => hash);

        const entries = await this.#store.getBlobs(context, hashesToFetch);

        const pageDataFiles = [];
        let pageTemplateFilename = null;
        let partials = null;
        let includes = null;
        const pageFiles = [];

        for (const entry of entries) {
            // We are not interested in including any child directories which may
            // be listed in this page directory; so filter on 'blob'.
            if (entry.kind === 'blob') {
                pageFiles.push(entry);
                if (this.#filepathBasename(entry.pathname) === 'page.json') {
                    pageDataFiles.push(entry);
                } else if (this.#filepathBasename(entry.pathname) === PAGE_PARTIALS_BUNDLE) {
                    partials = entry;
                } else if (this.#filepathBasename(entry.pathname) === PAGE_INCLUDES_BUNDLE) {
                    includes = entry;
                } else {
                    // Whatever is left must be the page template.
                    pageTemplateFilename = this.#filepathBasename(entry.pathname);
                }
            }
        }

        // Include the page files with the parent page.json filepaths to
        // accumulate the full dependencies list.
        const dependencies = parentStats.concat(pageFiles);

        const etag = await this.#store.computeHashFromStats(dependencies);

        return {
            etag,
            pageDataFiles,
            pageTemplateFilename,
            partials,
            includes,
        };
    }
}
