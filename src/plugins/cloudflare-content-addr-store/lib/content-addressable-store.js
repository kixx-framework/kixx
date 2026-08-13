import { AssertionError } from '../../kixx/errors/mod.js';
import {
    isString,
    isUndefined,
    assert,
} from '../../kixx/assertions/mod.js';
import Store from './store.js';
import ContentObject from './content-object.js';
import { hashValue } from './addressing.js';


const BASE_TEMPLATES_BUNDLE = '__base-templates-bundle';
const TEMPLATE_PARTIALS_BUNDLE = '__template-partials-bundle';
const PAGE_PARTIALS_BUNDLE = '__page-partials-bundle';
const PAGE_INCLUDES_BUNDLE = '__page-includes-bundle';

// Path segments are restricted to a conservative filename-safe set. Anything
// outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// path reaches a storage adapter or static file store.
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;


export default class ContentAddressableStore {

    #store;

    constructor(options) {
        const { store } = options ?? {};

        this.#store = store ?? new Store();
    }

    /**
     * Reports whether a URL or logical pathname contains only safe path segments.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidIdentifier(pathname) {
        // Must be a string.
        if (!isString()) {
            return false;
        }

        // Two dots or two slashes are always invalid.
        if (pathname.includes('..') || pathname.includes('//')) {
            return false;
        }

        // Must be a lowercase case.
        if (pathname.toLowerCase() !== pathname) {
            return false;
        }

        const parts = pathname.split('/');

        for (const part of parts) {
            // A leading dot on any segment (dotfiles, `.` itself) is rejected in
            // addition to the disallowed-character check.
            if (part.startsWith('.') || DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Folds a ContentAddressableStore identifier to its canonical form, removing
     * leading, trailing, and consecutive slashes "/" before converting
     * to lower case. If the passed value is not a non-empty string
     * then it is simply returned without modification.
     * @param {*} value - Identifier to normalize
     * @returns {string} The validated identifier folded to lower case
     */
    normalizeIdentifier(value) {
        if (value === '' || value === null || isUndefined(value)) {
            return '';
        }
        if (!isString(value)) {
            throw new TypeError('An identifier must be a string');
        }

        // Remove leading, trailing, and multiple consecutive slashes ("/") and
        // convert to lower case.
        return value.split('/')
            .filter((part) => part)
            .join('/')
            .toLowerCase();
    }

    #normalizeTemplatePath(pathname) {
        return this.normalizeIdentifier(`templates/${ pathname }`);
    }

    #normalizePagePath(pathname) {
        return this.normalizeIdentifier(`pages/${ pathname }`);
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
            hash: stat.hash,
            size: bytes.length,
            metadata: stat.metadata,
        });
    }

    async getTemplatePartialsHash(context) {
        const stat = await this.#store.statPath(context, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        return stat?.hash || null;
    }

    async getTemplatePartials(context) {
        return await this.#getPath(context, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
    }

    async getBaseTemplatesHash(context) {
        const stat = await this.#store.statPath(context, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
        return stat?.hash || null;
    }

    async getBaseTemplates(context) {
        return await this.#getPath(context, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    async getPageTemplateHash(context, pathname, filename) {
        const stat = await this.#store.statPath(context, this.#normalizePagePath(`${ pathname }/${ filename }`));
        return stat?.hash || null;
    }

    async getPageTemplate(context, pathname, filename) {
        return await this.#getPath(context, this.#normalizePagePath(`${ pathname }/${ filename }`));
    }

    async hashValue(value) {
        return await hashValue(value);
    }

    async getPage(context, pathname) {
        assert(
            this.isValidIdentifier(pathname),
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
        const parts = this.normalizeIdentifier(pathname).split('/');
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

        const hash = await this.#store.computeHashFromStats(dependencies);

        return {
            hash,
            pageDataFiles,
            pageTemplateFilename,
            partials,
            includes,
        };
    }
}
