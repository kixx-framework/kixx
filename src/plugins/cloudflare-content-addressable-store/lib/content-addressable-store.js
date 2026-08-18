import { AssertionError, ValidationError } from '../../../kixx/errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import CloudflareContentStore from './cloudflare-content-store.js';
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

        this.#store = options.store ?? new CloudflareContentStore({
            logger: this.#logger,
            kvBindingName: options.kvBindingName,
            durableObjectBindingName: options.durableObjectBindingName,
            blobReadCacheTtlSeconds: options.blobReadCacheTtlSeconds,
            indexCacheTtlSeconds: options.indexCacheTtlSeconds,
        });
    }

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

        if (!bytes) {
            return null;
        }

        return new ContentObject(bytes, {
            kind: 'blob',
            hash: stat.hash,
            size: bytes.length,
            metadata: stat.metadata,
        });
    }

    async putTemplatePartials(context, bundle, etag) {
        const pathname = this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata: null };
    }

    async statTemplatePartials(context) {
        const entry = await this.#store.statPath(context, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async getTemplatePartials(context) {
        return await this.#getPath(
            context,
            this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE),
        );
    }

    async putBaseTemplates(context, bundle, etag) {
        const pathname = this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE);
        const blob = stringToUint8Array(canonicalize(bundle));
        const { hash, size } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata: null };
    }

    async statBaseTemplates(context) {
        const entry = await this.#store.statPath(context, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));
        if (entry) {
            return new StatObject(entry);
        }
        return null;
    }

    async getBaseTemplates(context) {
        return await this.#getPath(
            context,
            this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE),
        );
    }

    async putPageMetadata(context, pagePath, obj, etag) {
        assert(
            this.isValidPathname(pagePath),
            'ContentAddressableStore#putPageMetadata() requires a valid page pathname',
        );

        const pathname = this.#normalizePagePath(`${ pagePath }/page.json`);
        const blob = stringToUint8Array(canonicalize(obj));
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
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
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
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
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
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
        const { hash, size, metadata } = await this.#store.putBlob(context, pathname, blob, null, etag);
        return { hash, size, metadata };
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

        const addFile = (source, pathname, hash, size) => {
            if (pathnames.has(pathname)) {
                error.push(`${ source } duplicates pathname "${ pathname }"`, source);
                return;
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
        const checkArray = (entries, source, pathField, toInternalPathname) => {
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
                    addFile(entrySource, toInternalPathname(pathValue), entry.hash, entry.size);
                }
            });
        };

        checkBundle('templatePartials', manifest.templatePartials, this.#normalizeTemplatePath(TEMPLATE_PARTIALS_BUNDLE));
        checkBundle('baseTemplates', manifest.baseTemplates, this.#normalizeTemplatePath(BASE_TEMPLATES_BUNDLE));

        checkArray(
            manifest.pageMetadata,
            'pageMetadata',
            'pathname',
            (pathname) => this.#normalizePagePath(`${ pathname }/page.json`),
        );
        checkArray(
            manifest.pagePartials,
            'pagePartials',
            'pathname',
            (pathname) => this.#normalizePagePath(`${ pathname }/${ PAGE_PARTIALS_BUNDLE }`),
        );
        checkArray(
            manifest.pageIncludes,
            'pageIncludes',
            'pathname',
            (pathname) => this.#normalizePagePath(`${ pathname }/${ PAGE_INCLUDES_BUNDLE }`),
        );
        checkArray(
            manifest.pageTemplates,
            'pageTemplates',
            'filename',
            (filename) => this.#normalizePagePath(filename),
        );

        if (error.length) {
            throw error;
        }

        return files;
    }

    async commitChanges(context, buildId, manifest) {
        const files = this.#buildManifestFiles(manifest);

        const index = await this.#store.commitChanges(context, buildId, files);

        const entries = Object.keys(index);

        return {
            // Return the root hash.
            hash: index['/'][1],
            count: entries.length,
        };
    }

    /**
     * Points an already-deployed buildId at a previously committed root
     * hash. This is the rollback (and re-promotion) operation: it never
     * rewrites closure content, only the build's pointer to one.
     * @param {Object} context - Request or runtime context.
     * @param {string} buildId - The build to repoint.
     * @param {string} rootHash - The root hash of a closure previously returned from commitChanges().
     * @throws {AssertionError} When no closure exists for rootHash.
     */
    async assignBuild(context, buildId, rootHash) {
        await this.#store.assignBuild(context, buildId, rootHash);
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
        const parts = this.normalizePathname(pathname).split('/').filter((part) => part);
        // Start with the root page data.
        const filepaths = [ this.#normalizePagePath('page.json') ];
        let path = '/';

        for (const part of parts) {
            path = `${ path }${ part }/`;
            filepaths.push(this.#normalizePagePath(`${ path }page.json`));
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

        const entries = parentStats.concat(sourceFileStats);
        const hashesToFetch = entries.map(({ hash }) => hash);
        const blobs = await this.#store.getBlobs(context, hashesToFetch);

        const pageDataFiles = [];
        let pageTemplateFilename = null;
        let partials = null;
        let includes = null;
        const pageFiles = [];

        for (let i = 0; i < entries.length; i += 1) {
            const entry = entries[i];
            const bytes = blobs[i];
            // We are not interested in including any child directories which may
            // be listed in this page directory; so filter on 'blob'.
            if (entry.kind === 'blob') {
                assert(bytes, `missing expected blob from ${ entry.pathname }`);
                pageFiles.push(entry);
                if (this.#filepathBasename(entry.pathname) === 'page.json') {
                    pageDataFiles.push(new ContentObject(bytes, entry));
                } else if (this.#filepathBasename(entry.pathname) === PAGE_PARTIALS_BUNDLE) {
                    partials = new ContentObject(bytes, entry);
                } else if (this.#filepathBasename(entry.pathname) === PAGE_INCLUDES_BUNDLE) {
                    includes = new ContentObject(bytes, entry);
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
