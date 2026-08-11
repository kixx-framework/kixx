import {
    assert,
    assertNonEmptyString,
    isString,
    isUndefined,
    isNonEmptyString,
} from '../assertions/mod.js';


// Path segments are restricted to a conservative filename-safe set. Anything
// outside it (path separators beyond the segment split, query/fragment
// characters, whitespace, shell or URL metacharacters) is rejected before the
// path reaches a storage adapter or static file store.
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;


export default class ContentAddressableStore {


    /**
     * Reports whether a URL or logical pathname contains only safe path segments.
     * @param {string} pathname - The pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidIdentifier(pathname) {
        // Two dots or two slashes are always invalid.
        if (pathname.includes('..') || pathname.includes('//')) {
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

    async statPath(pathOrPrefix) {
        const index = await getIndex();

        if (pathOrPrefix === '') {
            // Look up the root path (pathOrPrefix === '').
            const prefix = normalizeIdentifier(pathOrPrefix);
            const treeHash = index.dirs[prefix];
            if (treeHash) {
                return {
                    kind: 'tree',
                    filepath: prefix,
                    hash, treeHash,
                };
            }
        } else {
            const path = normalizeIdentifier(pathOrPrefix);
            const tuple = index.files[path];
            if (tuple) {
                return decodeIndexEntry(path, tuple);
            }
        }

        return null;
    }

    async getBaseTemplatesDigest(context) {
        const stat = await statPath(context, normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
        return stat?.hash || null;
    }

    async getBaseTemplates(context) {
        return await getPath(context, normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
    }

    async getTemplatePartialsDigest(context) {
        const stat = await statPath(context, normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        return stat?.hash || null;
    }

    async getTemplatePartials(context) {
        return await getPath(context, normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
    }

    async getPage(context, pathname) {
        assertCanonicalIdentifier(
            pathname,
            'ContentAddressableStore#getPage():',
        );

        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json
        const parts = normalizeIdentifier(pathname).split('/');
        const filepaths = [];
        let path;

        // Always start with the root page metadata item.
        filepaths.push(normalizePagePath('page.json'));

        for (const part of parts) {
            // All page data filepaths are prefixed with "pages"
            // in content-addressable storage.
            path = path ? `${ path }/${ part }` : part;
            filepaths.push(normalizePagePath(`${ path }/page.json`));
        }

        // We don't need to get the page leaf node page.json separately, because we'll
        // be fetching everything in the `pages/${ pathname }` directory, including
        // the leaf page.json file. But, we can do a cheap check to make sure it
        // exists before proceeding.
        const leafPage = filepaths.pop();
        const leafPageStat = await statPath(context, leafPage);

        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await statPath(context, parentFilepath);
            // Not all parent pages have a page.json file.
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = normalizePagePath(pathname);

        const sourceFileStats = await listByPathPrefix(context, directory, {
            readCacheTtlSeconds,
        });

        const hashesToFetch = parentStats
            .concat(sourceFileStats)
            .map(({ hash }) => hash);

        const files = await getBatchByHashes(context, hashesToFetch);

        const pageDataFiles = [];
        let pageTemplate = null;
        let partials = null;
        let includes = null;

        for (const file of files) {
            const { filepath } = file;
            if (filepathBasename(filepath) === 'page.json') {
                pageDataFiles.push({
                    filepath: denormalizePagePath(filepath),
                    json: file.json,
                });
            } else if (filepathBasename(filepath) === PAGE_PARTIALS_BUNDLE) {
                partials = file.json;
            } else if (filepathBasename(filepath) === PAGE_INCLUDES_BUNDLE) {
                includes = file.json;
            } else {
                // Whatever is left must be the page template.
                pageTemplate = {
                    filepath: denormalizePagePath(filepath),
                    hash: file.hash,
                    basename: filepathBasename(filepath),
                    text: file.text,
                };
            }
        }

        const directoryStat = await statPath(context, directory);
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
