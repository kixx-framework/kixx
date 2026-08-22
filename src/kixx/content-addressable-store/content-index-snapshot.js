export default class ContentIndexSnapshot {

    async #getPath(type, pathname) {
        const stat = this.#index.getNode(pathname);

        if (!stat) {
            return null;
        }
        if (stat.kind !== 'blob') {
            throw new AssertionError(
                `Expected the  path "${ pathname }" to point to a file and not a directory`,
            );
        }

        const bytes = await this.#store.getFile(type, stat);
        if (!bytes) {
            throw new AssertionError(
                `The pathname "${ pathname }" references unreadable blob "${ stat.hash }"`,
            );
        }

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

        const results = await this.#store.getFiles(type, files);

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
            if (!bytes) {
                throw new AssertionError(
                    `The pathname "${ stat.pathname }" references unreadable blob "${ stat.hash }"`,
                );
            }
            const basename = stat.pathname.split('/').pop();
            if (basename === 'page.json') {
                pageDataFiles.push(new JsonContentObject(bytes, stat));
            } else if (isPagePartialsBundleBasename(basename)) {
                partials = new JsonContentObject(bytes, stat);
            } else if (isPageIncludesBundleBasename(basename)) {
                includes = new JsonContentObject(bytes, stat);
            } else {
                assert(
                    template === null,
                    `batchGetPageAssets(): found more than one page template in "${ directory }"`,
                );
                template = new TextContentObject(bytes, stat);
            }
        }

        const hash = await hashFileStats(files);
        return { hash, pageDataFiles, template, partials, includes };
    }
}
