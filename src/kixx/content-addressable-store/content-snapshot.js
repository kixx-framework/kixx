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


export default class ContentSnapshot {

    #store;
    #index;

    constructor(store, index) {
        this.#store = store;
        this.#index = index;
    }

    async #getFile(context, type, pathname) {
        const stat = this.#index.getNode(pathname);

        if (!stat) {
            return null;
        }
        assertEqual('blob', stat.kind, `Expected the  path "${ pathname }" to point to a file and not a directory`);

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

    async #putFile(context, type, pathname, bytes) {
        let hash;
        if (type === 'text') {
            hash = await hashStringBlob(bytes);
        }
        if (type === 'arrayBuffer') {
            hash = await hashArrayBufferBlob(bytes);
        }

        await this.#store.putFile(context, type, pathname, hash, bytes);

        return {
            pathname,
            hash,
        };
    }

    statStaticAsset(pathname) {
        assert(isValidPathname(pathname), 'statStaticAsset() requires a valid pathname');
        const fullPathname = getStaticAssetPath(pathname);
        return this.#index.getNode(fullPathname);
    }

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

    async putStaticAsset(context, pathname, arrayBuffer) {
        assert(isValidPathname(pathname), 'putStaticAsset() requires a valid pathname');
        assert(arrayBuffer instanceof ArrayBuffer, 'putStaticAsset() requires an ArrayBuffer payload');
        const fullPathname = getStaticAssetPath(pathname);
        return await this.#putFile(context, 'arrayBuffer', fullPathname, arrayBuffer);
    }

    statGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();
        return this.#index.getNode(fullPathname);
    }

    async getGlobalTemplatePartials(context) {
        const fullPathname = getGlobalTemplatePartialsPath();

        const result = await this.#getFile(context, 'text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    async putGlobalTemplatePartials(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putGlobalTemplatePartials() requires a valid pathname');
        assertArray(bundle, 'putGlobalTemplatePartials() requires an Array bundle');
        const fullPathname = getGlobalTemplatePartialsPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    statBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();
        return this.#index.getNode(fullPathname);
    }

    async getBaseTemplates(context) {
        const fullPathname = getBaseTemplatesPath();

        const result = await this.#getFile(context, 'text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    async putBaseTemplates(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putBaseTemplates() requires a valid pathname');
        assertArray(bundle, 'putBaseTemplates() requires an Array bundle');
        const fullPathname = getBaseTemplatesPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    async statPageMetadata(pathname) {
        assert(isValidPathname(pathname), 'statPageMetadata() requires a valid pathname');
        const fullPathname = getPageMetadataPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async putPageMetadata(context, pathname, obj) {
        assert(isValidPathname(pathname), 'putPageMetadata() requires a valid pathname');
        assert(isPlainObject(obj), 'putPageMetadata() requires a metadata object');
        const fullPathname = getPageMetadataPath(pathname);
        const json = canonicalize(obj);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    async statPageIncludes(pathname) {
        assert(isValidPathname(pathname), 'statPageIncludes() requires a valid pathname');
        const fullPathname = getPageIncludesPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async putPageIncludes(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putPageIncludes() requires a valid pathname');
        assert(isPlainObject(bundle), 'putPageIncludes() requires an Array bundle');
        const fullPathname = getPageIncludesPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    async statPagePartials(pathname) {
        assert(isValidPathname(pathname), 'statPagePartials() requires a valid pathname');
        const fullPathname = getPagePartialsPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async putPagePartials(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putPagePartials() requires a valid pathname');
        assertArray(bundle, 'putPagePartials() requires an Array bundle');
        const fullPathname = getPagePartialsPath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

    async statPageTemplate(pathname) {
        assert(isValidPathname(pathname), 'statPageTemplate() requires a valid pathname');
        const fullPathname = getPageTemplatePath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async putPageTemplate(context, pathname, source) {
        assert(isValidPathname(pathname), 'putPageTemplate() requires a valid pathname');
        assertNonEmptyString(source, 'putPageTemplate() requires a non-empty source string');
        const fullPathname = getPageTemplatePath(pathname);
        return await this.#putFile(context, 'text', fullPathname, source);
    }

    async statEmailAssets(pathname) {
        assert(isValidPathname(pathname), 'statEmailAssets() requires a valid pathname');
        const fullPathname = getEmailBundlePath(pathname);
        return this.#index.getNode(fullPathname);
    }

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

    async putEmailAssets(context, pathname, bundle) {
        assert(isValidPathname(pathname), 'putEmailAssets() requires a valid pathname');
        assert(isPlainObject(bundle), 'putEmailAssets() requires a plain object bundle');
        const fullPathname = getEmailBundlePath(pathname);
        const json = canonicalize(bundle);
        return await this.#putFile(context, 'text', fullPathname, json);
    }

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
