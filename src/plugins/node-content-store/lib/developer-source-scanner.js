import fsp from 'node:fs/promises';
import path from 'node:path';

import {
    assert,
    assertNonEmptyString,
    isPlainObject,
    isString,
} from '../../../kixx/assertions/mod.js';
import { OperationalError, ValidationError } from '../../../kixx/errors/mod.js';
import { compareStrings } from '../../../kixx/content-addressable-store/addressing.js';
import {
    RESERVED_PAGE_FILENAMES,
    getBaseTemplatesPath,
    getEmailBundlePath,
    getGlobalTemplatePartialsPath,
    getPageIncludesPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageTemplatePath,
    getStaticAssetPath,
    isValidPathname,
} from '../../../kixx/content-addressable-store/content-layout.js';

function makeFileIdentity(filepath, stats) {
    return { filepath, mtimeMs: stats.mtimeMs, size: stats.size };
}

function validationError(filepath, message, cause) {
    const error = new ValidationError(`Invalid developer source file "${ filepath }": ${ message }`, { cause });
    error.push(message, filepath);
    return error;
}

/**
 * Builds storage recipes from mutable developer source directories.
 *
 * Manifest JSON is cached by file identity between scans. Content files are
 * only inspected with `stat`; their bytes remain unread until materialization.
 */
export default class DeveloperSourceScanner {

    #fileSystem;
    #pagesDirectory;
    #templatesDirectory;
    #staticAssetsDirectory;
    #emailsDirectory;
    #jsonCache = new Map();

    /**
     * @param {Object} options - Source roots and optional filesystem implementation
     * @param {string} options.pagesDirectory - Root of page metadata and includes
     * @param {string} options.templatesDirectory - Root containing pages, partials, and base templates
     * @param {string} options.staticAssetsDirectory - Root of directly served static assets
     * @param {string} options.emailsDirectory - Root of email manifests and assets
     * @param {Object} [options.fileSystem] - Promise-based filesystem API used by tests
     */
    constructor(options) {
        const {
            pagesDirectory,
            templatesDirectory,
            staticAssetsDirectory,
            emailsDirectory,
            fileSystem = fsp,
        } = options ?? {};

        assertNonEmptyString(pagesDirectory, 'DeveloperSourceScanner: pagesDirectory');
        assertNonEmptyString(templatesDirectory, 'DeveloperSourceScanner: templatesDirectory');
        assertNonEmptyString(staticAssetsDirectory, 'DeveloperSourceScanner: staticAssetsDirectory');
        assertNonEmptyString(emailsDirectory, 'DeveloperSourceScanner: emailsDirectory');
        assert(fileSystem, 'DeveloperSourceScanner requires a fileSystem');

        this.#pagesDirectory = pagesDirectory;
        this.#templatesDirectory = templatesDirectory;
        this.#staticAssetsDirectory = staticAssetsDirectory;
        this.#emailsDirectory = emailsDirectory;
        this.#fileSystem = fileSystem;
    }

    /**
     * Scans all source roots without reading content-file bytes.
     * @returns {Promise<Map<string, Object>>} Storage pathname to materialization recipe
     * @throws {ValidationError} When source metadata or a source pathname is invalid
     * @throws {OperationalError} When a filesystem operation fails
     */
    async scan() {
        const entries = [];

        await this.#scanPages(entries);
        await this.#scanTemplateBundle(entries, 'partials', getGlobalTemplatePartialsPath());
        await this.#scanTemplateBundle(entries, 'base', getBaseTemplatesPath());
        await this.#scanStaticAssets(entries);
        await this.#scanEmails(entries);

        entries.sort(([ left ], [ right ]) => compareStrings(left, right));
        return new Map(entries);
    }

    async #scanPages(entries) {
        const files = await this.#walkFiles(this.#pagesDirectory);
        const metadataFiles = files.filter(({ relativePath }) => path.posix.basename(relativePath) === 'page.json');
        const pages = new Map();

        for (const file of metadataFiles) {
            this.#assertValidRelativePath(file.relativePath, file.filepath);
            const pagePath = path.posix.dirname(file.relativePath);
            const pathname = pagePath === '.' ? '/' : `/${ pagePath }`;
            const json = await this.#readJson(file);
            this.#validatePageJson(file.filepath, json);
            pages.set(pathname, { file, json });
            entries.push([
                getPageMetadataPath(pathname),
                { kind: 'file', sources: [ makeFileIdentity(file.filepath, file.stats) ], manifests: [] },
            ]);
        }

        for (const [ pathname, page ] of pages) {
            const manifest = makeFileIdentity(page.file.filepath, page.file.stats);
            const { template, partials = [], includes = {} } = page.json;

            if (template) {
                const templateFile = await this.#getNamedFile(
                    path.join(this.#templatesDirectory, 'pages'),
                    template,
                );
                const filename = path.posix.basename(template);
                assert(!RESERVED_PAGE_FILENAMES.has(filename), `Developer page template "${ templateFile.filepath }" collides with a reserved filename`);
                const templatePathname = pathname === '/' ? `/${ filename }` : `${ pathname }/${ filename }`;
                entries.push([
                    getPageTemplatePath(templatePathname),
                    { kind: 'file', sources: [ makeFileIdentity(templateFile.filepath, templateFile.stats) ], manifests: [ manifest ] },
                ]);
            }

            const partialSources = [];
            const sortedPartials = partials.slice().sort((left, right) => compareStrings(left.id, right.id));
            for (const { id, filename } of sortedPartials) {
                const sourceFile = await this.#getNamedFile(
                    path.join(this.#templatesDirectory, 'pages'),
                    filename,
                );
                partialSources.push({ id, ...makeFileIdentity(sourceFile.filepath, sourceFile.stats) });
            }
            entries.push([
                getPagePartialsPath(pathname),
                { kind: 'partials', sources: partialSources, manifests: [ manifest ] },
            ]);

            const includeSources = [];
            for (const name of Object.keys(includes).sort(compareStrings)) {
                const sourceFile = await this.#getNamedFile(path.dirname(page.file.filepath), includes[name].filename);
                includeSources.push({ name, ...makeFileIdentity(sourceFile.filepath, sourceFile.stats) });
            }
            entries.push([
                getPageIncludesPath(pathname),
                { kind: 'includes', sources: includeSources, manifests: [ makeFileIdentity(page.file.filepath, page.file.stats) ] },
            ]);
        }
    }

    async #scanTemplateBundle(entries, directoryName, storagePathname) {
        const root = path.join(this.#templatesDirectory, directoryName);
        const files = await this.#walkFiles(root);
        if (files.length === 0 && !await this.#directoryExists(root)) {
            return;
        }

        const sources = files.map((file) => {
            this.#assertValidRelativePath(file.relativePath, file.filepath);
            return { id: file.relativePath, ...makeFileIdentity(file.filepath, file.stats) };
        });
        entries.push([ storagePathname, { kind: 'partials', sources, manifests: [] } ]);
    }

    async #scanStaticAssets(entries) {
        for (const file of await this.#walkFiles(this.#staticAssetsDirectory)) {
            this.#assertValidRelativePath(file.relativePath, file.filepath);
            entries.push([
                getStaticAssetPath(file.relativePath),
                { kind: 'file', sources: [ makeFileIdentity(file.filepath, file.stats) ], manifests: [] },
            ]);
        }
    }

    async #scanEmails(entries) {
        const files = await this.#walkFiles(this.#emailsDirectory);
        for (const file of files.filter(({ relativePath }) => path.posix.basename(relativePath) === 'email.json')) {
            this.#assertValidRelativePath(file.relativePath, file.filepath);
            const emailPath = path.posix.dirname(file.relativePath);
            const pathname = emailPath === '.' ? '/' : `/${ emailPath }`;
            const json = await this.#readJson(file);
            this.#validateEmailJson(file.filepath, json);
            const sources = [];

            for (const field of [ 'htmlTemplate', 'textTemplate' ]) {
                if (json[field]) {
                    const sourceFile = await this.#getNamedFile(path.dirname(file.filepath), json[field].filename);
                    sources.push({ role: field, id: json[field].id, ...makeFileIdentity(sourceFile.filepath, sourceFile.stats) });
                }
            }
            const sortedPartials = (json.partials ?? []).slice().sort((left, right) => compareStrings(left.id, right.id));
            for (const { id, filename } of sortedPartials) {
                const sourceFile = await this.#getNamedFile(path.dirname(file.filepath), filename);
                sources.push({ role: 'partial', id, ...makeFileIdentity(sourceFile.filepath, sourceFile.stats) });
            }

            entries.push([
                getEmailBundlePath(pathname),
                {
                    kind: 'email',
                    sources,
                    manifests: [ makeFileIdentity(file.filepath, file.stats) ],
                    contextData: json.contextData ?? {},
                },
            ]);
        }
    }

    async #walkFiles(root) {
        const files = [];
        const visit = async (directory, relativeDirectory) => {
            let directoryEntries;
            try {
                directoryEntries = await this.#fileSystem.readdir(directory, { withFileTypes: true });
            } catch (cause) {
                if (cause.code === 'ENOENT') {
                    return;
                }
                throw new OperationalError(`DeveloperSourceScanner failed to read directory "${ directory }"`, { cause });
            }

            directoryEntries.sort((left, right) => compareStrings(left.name, right.name));
            for (const entry of directoryEntries) {
                const relativePath = relativeDirectory ? `${ relativeDirectory }/${ entry.name }` : entry.name;
                const filepath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    await visit(filepath, relativePath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }

                try {
                    files.push({ filepath, relativePath, stats: await this.#fileSystem.stat(filepath) });
                } catch (cause) {
                    throw new OperationalError(`DeveloperSourceScanner failed to inspect file "${ filepath }"`, { cause });
                }
            }
        };

        await visit(root, '');
        return files;
    }

    async #directoryExists(directory) {
        try {
            return (await this.#fileSystem.stat(directory)).isDirectory();
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return false;
            }
            throw new OperationalError(`DeveloperSourceScanner failed to inspect directory "${ directory }"`, { cause });
        }
    }

    async #getNamedFile(root, relativePath) {
        assertNonEmptyString(relativePath, 'DeveloperSourceScanner source filepath');
        const portablePath = relativePath.split(path.sep).join('/');
        const filepath = path.join(root, relativePath);
        this.#assertValidRelativePath(portablePath, filepath);
        try {
            const stats = await this.#fileSystem.stat(filepath);
            if (!stats.isFile()) {
                throw validationError(filepath, 'expected a file');
            }
            return { filepath, relativePath: portablePath, stats };
        } catch (cause) {
            if (cause.name === 'ValidationError') {
                throw cause;
            }
            if (cause.code === 'ENOENT') {
                throw validationError(filepath, 'referenced file does not exist', cause);
            }
            throw new OperationalError(`DeveloperSourceScanner failed to inspect file "${ filepath }"`, { cause });
        }
    }

    async #readJson(file) {
        const cacheKey = `${ file.filepath }:${ file.stats.mtimeMs }:${ file.stats.size }`;
        if (this.#jsonCache.has(cacheKey)) {
            return this.#jsonCache.get(cacheKey);
        }

        let source;
        try {
            source = await this.#fileSystem.readFile(file.filepath, 'utf8');
        } catch (cause) {
            throw new OperationalError(`DeveloperSourceScanner failed to read manifest "${ file.filepath }"`, { cause });
        }

        let json;
        try {
            json = JSON.parse(source);
        } catch (cause) {
            throw validationError(file.filepath, 'malformed JSON', cause);
        }
        if (!isPlainObject(json)) {
            throw validationError(file.filepath, 'manifest must contain a JSON object');
        }

        this.#jsonCache.set(cacheKey, json);
        return json;
    }

    #validatePageJson(filepath, json) {
        if (Object.hasOwn(json, 'template') && !isString(json.template)) {
            throw validationError(filepath, 'template must be a string');
        }
        this.#validatePartials(filepath, json);
        if (Object.hasOwn(json, 'includes') && !isPlainObject(json.includes)) {
            throw validationError(filepath, 'includes must be an object');
        }
        for (const [ name, include ] of Object.entries(json.includes ?? {})) {
            if (!name || !isPlainObject(include) || !isString(include.filename) || !include.filename) {
                throw validationError(filepath, 'includes must map names to objects with a filename');
            }
        }
    }

    #validateEmailJson(filepath, json) {
        for (const field of [ 'htmlTemplate', 'textTemplate' ]) {
            const template = json[field];
            if (template && (!isPlainObject(template) || !isString(template.id) || !template.id || !isString(template.filename) || !template.filename)) {
                throw validationError(filepath, `${ field } must contain non-empty id and filename strings`);
            }
        }
        this.#validatePartials(filepath, json);
    }

    #validatePartials(filepath, json) {
        if (Object.hasOwn(json, 'partials') && !Array.isArray(json.partials)) {
            throw validationError(filepath, 'partials must be an array');
        }

        const ids = new Set();
        for (const partial of json.partials ?? []) {
            if (!isPlainObject(partial) || !isString(partial.id) || !partial.id || !isString(partial.filename) || !partial.filename) {
                throw validationError(filepath, 'partials must contain objects with non-empty id and filename strings');
            }
            if (ids.has(partial.id)) {
                throw validationError(filepath, `partials contains duplicate id "${ partial.id }"`);
            }
            ids.add(partial.id);
        }
    }

    #assertValidRelativePath(relativePath, filepath) {
        if (!relativePath || path.isAbsolute(relativePath) || !isValidPathname(`/${ relativePath }`)) {
            throw validationError(filepath, 'filepath cannot be represented by a canonical storage pathname');
        }
    }
}
