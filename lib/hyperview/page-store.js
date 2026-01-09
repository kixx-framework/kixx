import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


const JSON_FILE_PATTERN = /page.jsonc?$/;
const TEMPLATE_FILE_PATTERN = /page.(html|xml)$/;
const MARKDOWN_FILE_PATTERN = /.md$/;


export default class PageStore {

    #fileSystem = null;
    #directory = null;

    constructor(options) {
        options = options || {};

        assertNonEmptyString(options.directory, 'PageStore requires a base directory path');

        this.#directory = options.directory;
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    async doesPageExist(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);
        const stats = await this.#fileSystem.getFileStats(dirpath);
        return Boolean(stats && stats.isDirectory());
    }

    async getPageData(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const file = files.find((f) => {
            return JSON_FILE_PATTERN.test(f.name);
        });

        if (!file || !file.isFile()) {
            return {};
        }

        const data = await this.#fileSystem.readJSONFile(path.join(dirpath, file.name));

        return data;
    }

    async getPageTemplate(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const file = files.find((f) => {
            return TEMPLATE_FILE_PATTERN.test(f.name);
        });

        if (!file || !file.isFile()) {
            return null;
        }

        const source = await this.#fileSystem.readUtf8File(path.join(dirpath, file.name));

        return { filename: file.name, source };
    }

    async getMarkdownContent(pathname) {
        const dirpath = this.#pathnameToDirectory(pathname);

        const files = await this.#fileSystem.readDirectory(dirpath);

        const markdownFiles = files.filter((f) => {
            return MARKDOWN_FILE_PATTERN.test(f.name);
        });

        const promises = markdownFiles.map((file) => {
            return this.#fileSystem.readUtf8File(path.join(dirpath, file.name));
        });

        const sources = await Promise.all(promises);

        return sources.map((source, index) => {
            const filename = markdownFiles[index].name;
            return { filename, source };
        });
    }

    #pathnameToDirectory(pathname) {
        const parts = pathname.split('/');
        // The call to path.join() will ignore empty strings in the parts Array, removing
        // leading/trailing slashes for us.
        return path.join(this.#directory, ...parts);
    }
}
