import { TextContentObject, JsonContentObject } from './content-object.js';
import {
    isValidPathname,
    normalizePathname,
    getGlobalTemplatePartialsPath,
    getBaseTemplatesPath,
    getPageDirectoryPath,
    getPageMetadataPath,
    isPageMetadataPath,
    isPagePartialsPath,
    isPageIncludesPath,
    getEmailBundlePath,
} from './content-layout.js';
import { hashSet } from './addressing.js';
import {
    assert,
    assertEqual,
    assertNonEmptyString,
} from '../assertions/mod.js';


export default class ContentSnapshot {

    #store;
    #index;

    constructor(store, index) {
        this.#store = store;
        this.#index = index;
    }

    async #getPath(type, pathname) {
        const stat = this.#index.getNode(pathname);

        if (!stat) {
            return null;
        }
        assertEqual('blob', stat.kind, `Expected the  path "${ pathname }" to point to a file and not a directory`);

        const bytes = await this.#store.getFile(type, stat);
        assert(bytes, `The pathname "${ pathname }" references unreadable blob "${ stat.hash }"`);

        // `bytes` could be a String or ArrayBuffer, depending on the `type`.
        return [ stat, bytes ];
    }

    statGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();
        return this.#index.getNode(fullPathname);
    }

    async getGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();

        const result = await this.#getPath('text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    statBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();
        return this.#index.getNode(fullPathname);
    }

    async getBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();

        const result = await this.#getPath('text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }

    async batchGetPageAssets(pathname) {
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
        const sourceFileStats = this.#index.listStats(directory, { recursive: false });

        const files = parentStats
            .concat(sourceFileStats)
            .filter((entry) => entry.kind === 'blob');

        const results = await this.#store.getFiles('text', files);

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

    async getEmailAssets(pathname) {
        assert(isValidPathname(pathname), 'batchGetEmailAssets() requires a valid pathname');

        const fullPathname = getEmailBundlePath(pathname);
        const result = await this.#getPath('text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;
        return new JsonContentObject(json, stat);
    }
}
