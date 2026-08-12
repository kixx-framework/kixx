import { AssertionError } from '../errors/mod.js';
import {
    isString,
    isUndefined,
    assert,
} from '../assertions/mod.js';


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

    #pendingIndex = null;

    constructor() {
        this.blobReadCacheTtl = 60 * 60 * 36;
    }

    #resolveDurableObject() {
        // TODO: Implement resolveDurableObject()
    }

    #resolveKvStore() {
        // TODO: Implement resolveKvStore()
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

    normalizeTemplatePath(pathname) {
        return this.normalizeIdentifier(`templates/${ pathname }`);
    }

    normalizePagePath(pathname) {
        return this.normalizeIdentifier(`pages/${ pathname }`);
    }

    denormalizePagePath(pathname) {
        return pathname.replace(/^pages\//, '');
    }

    filepathBasename(pathname) {
        return pathname.split('/').pop();
    }

    async getIndex(context) {
        // We cache pending index promises for a few moments in runtime memory.
        if (this.#pendingIndex) {
            return this.#pendingIndex;
        }

        const durableObject = this.#resolveDurableObject(context);
        const buildId = context.runtime.build.id;

        const pending = durableObject.getContentAddressableIndex(buildId)
            .then((result) => {
                if (!result) {
                    // If the index does not exist, then the system is not recoverable.
                    throw new AssertionError(`No registered content index for BUILD_ID ${ buildId }`);
                }
                return new ContentAddressableIndex(result);
            })
            .finally(() => {
                if (this.#pendingIndex === pending) {
                    this.#pendingIndex = null;
                }
            });

        this.#pendingIndex = pending;
        return pending;
    }

    #decodeIndexEntry(pathname, tuple) {
        const [ kind, hash, size, metadata ] = tuple;
        return {
            pathname,
            kind,
            hash,
            size,
            metadata,
        };
    }

    async statPath(context, pathname) {
        assert(
            this.isValidIdentifier(pathname),
            'ContentAddressableStore#statPath() requires a valid pathname',
        );

        pathname = this.normalizeIdentifier(pathname);

        const index = await this.getIndex(context);
        const tuple = index.files[pathname];
        if (tuple) {
            return this.#decodeIndexEntry(pathname, tuple);
        }
        return null;
    }

    async getPath(context, pathname) {
        assert(
            this.isValidIdentifier(pathname),
            'ContentAddressableStore#getPath() requires a valid pathname',
        );

        pathname = this.normalizeIdentifier(pathname);

        const stat = await this.statPath(context, pathname);

        if (!stat) {
            return null;
        }
        if (stat.kind !== 'blob') {
            throw new AssertionError(
                `ContentAddressableStore#getPath(): The pathname "${ pathname }" points to a directory and not a blob`,
            );
        }

        const kv = this.#resolveKvStore(context);
        const key = `${ KEY.blob }#${ stat.hash }`;
        const result = await kv.get(key, {
            type: 'arrayBuffer',
            cacheTtl: this.blobReadCacheTtl,
        });

        if (result) {
            return null;
        }

        const bytes = new Uint8Array(result);

        return new ContentObject({
            pathname: stat.pathname,
            hash: stat.hash,
            size: bytes.length,
            metadata: stat.metadata,
            bytes,
        });
    }

    async getBaseTemplatesDigest(context) {
        const stat = await this.statPath(context, this.normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
        return stat?.hash || null;
    }

    async getBaseTemplates(context) {
        return await this.getPath(context, this.normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    async getTemplatePartialsDigest(context) {
        const stat = await this.statPath(context, this.normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        return stat?.hash || null;
    }

    async getTemplatePartials(context) {
        return await this.getPath(context, this.normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
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
        filepaths.push(this.normalizePagePath('page.json'));

        for (const part of parts) {
            path = `${ path }/${ part }`;
            filepaths.push(this.normalizePagePath(`${ path }/page.json`));
        }

        // We don't need to get the page leaf node page.json separately, because we'll
        // be fetching everything in the `pages/${ pathname }` directory, including
        // the leaf page.json file. But, we can do a cheap check to make sure it
        // exists before proceeding.
        const leafPage = filepaths.pop();
        const leafPageStat = await this.statPath(context, leafPage);

        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await this.statPath(context, parentFilepath);
            // Not all parent pages have a page.json file.
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = this.normalizePagePath(pathname);

        const sourceFileStats = await listByPathPrefix(context, directory);

        const hashesToFetch = parentStats
            .concat(sourceFileStats)
            .map(({ hash }) => hash);

        const files = await getBatchByHashes(context, hashesToFetch);

        const pageDataFiles = [];
        let pageTemplate = null;
        let partials = null;
        let includes = null;

        for (const file of files) {
            if (this.filepathBasename(file.pathname) === 'page.json') {
                pageDataFiles.push({
                    filepath: this.denormalizePagePath(file.pathname),
                    json: file.json,
                });
            } else if (this.filepathBasename(file.pathname) === PAGE_PARTIALS_BUNDLE) {
                partials = file.json;
            } else if (this.filepathBasename(file.pathname) === PAGE_INCLUDES_BUNDLE) {
                includes = file.json;
            } else {
                // Whatever is left must be the page template.
                pageTemplate = {
                    filepath: this.denormalizePagePath(file.pathname),
                    hash: file.hash,
                    basename: this.filepathBasename(file.pathname),
                    text: file.text,
                };
            }
        }

        const directoryStat = await this.statPath(context, directory);
        // Include the page leaf directory with the parent page.json filepaths to
        // accumulate the full dependencies list.
        const dependencies = parentStats.concat([ directoryStat ]);

        const digest = computeDigestFromStats(dependencies);

        return {
            digest,
            pageDataFiles,
            pageTemplate,
            partials,
            includes,
        };
    }

    hashString(_str) {
        // Get the hash of a string.
        throw new Error('hashString() is not implemented');
    }

    canonicalObjectDigest(_obj) {
        // Get the hash of a JavaScript object
        throw new Error('canonicalObjectDigest() is not implemented');
    }
}
