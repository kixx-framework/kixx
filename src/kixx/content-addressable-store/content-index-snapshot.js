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

        // `bytes` could be a String, ArrayBuffer, or plain JS object from JSON.
        return [ stat, bytes ];
    }

    async statGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();
        return this.#index.getNode(fullPathname);
    }

    async getGlobalTemplatePartials() {
        const fullPathname = getGlobalTemplatePartialsPath();

        const result = await this.#getPath('json', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;

        return new JsonContentObject(json, {
            kind: 'blob',
            hash: stat.hash,
            size: stat.size,
            metadata: stat.metadata,
        });
    }

    async statBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();
        return this.#index.getNode(fullPathname);
    }

    async getBaseTemplates() {
        const fullPathname = getBaseTemplatesPath();

        const result = await this.#getPath('text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, text ] = result;

        return new TextContentObject(text, {
            kind: 'blob',
            hash: stat.hash,
            size: stat.size,
            metadata: stat.metadata,
        });
    }

    async batchStatPageMetadata(pathnames) {
        return pathnames.map((pathname) => {
            const fullPathname = getPageMetadataPath(pathname);
            return this.#index.getNode(fullPathname);
        });
    }

    async batchGetPageMetadata(pathnames) {
        const files = pathnames.map((pathname) => {
            return { type: 'json', pathname: getPageMetadataPath(pathname) };
        });

        const results = await this.#batchGetPaths(files);

        return results.map((result) => {
            if (!result) {
                return null;
            }

            const [ stat, json ] = result;

            return new JsonContentObject(json, {
                kind: 'blob',
                hash: stat.hash,
                size: stat.size,
                metadata: stat.metadata,
            });
        });
    }

    async statPageTemplate(filepath) {
        const fullPathname = getPageTemplatePath(filepath);
        return this.#index.getNode(fullPathname);
    }

    async getPageTemplate(filepath) {
        const fullPathname = getPageTemplatePath(filepath);

        const result = await this.#getPath('text', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, text ] = result;

        return new TextContentObject(text, {
            kind: 'blob',
            hash: stat.hash,
            size: stat.size,
            metadata: stat.metadata,
        });
    }

    async statPageIncludes(pathname) {
        const fullPathname = getPageIncludesPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async getPageIncludes(pathname) {
        const fullPathname = getPageIncludesPath(pathname);

        const result = await this.#getPath('json', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;

        return new JsonContentObject(json, {
            kind: 'blob',
            hash: stat.hash,
            size: stat.size,
            metadata: stat.metadata,
        });
    }

    async statPagePartials(pathname) {
        const fullPathname = getPagePartialsPath(pathname);
        return this.#index.getNode(fullPathname);
    }

    async getPagePartials(pathname) {
        const fullPathname = getPagePartialsPath(pathname);

        const result = await this.#getPath('json', fullPathname);

        if (!result) {
            return null;
        }

        const [ stat, json ] = result;

        return new JsonContentObject(json, {
            kind: 'blob',
            hash: stat.hash,
            size: stat.size,
            metadata: stat.metadata,
        });
    }
}
