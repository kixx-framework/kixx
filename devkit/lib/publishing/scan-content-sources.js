import path from 'node:path';
import { isPlainObject, isString } from '../vendor/kixx-assert/mod.js';

import defaultFileSystem from '../file-system.js';
import {
    canonicalize,
    compareStrings,
    getBlobSize,
    hashBlob,
} from './addressing.js';
import {
    RESERVED_PAGE_FILENAMES,
    isValidPathname,
    isValidTemplateFilepath,
} from './content-layout.js';
import { bundleStylesheet } from './bundle-stylesheet.js';
import { stripJavaScriptComments } from './strip-asset-comments.js';

const encoder = new TextEncoder();

/**
 * @typedef {Object} ContentSourceResource
 * @property {string} type - Publishing API resource type
 * @property {string} pathname - Logical resource pathname
 * @property {Object|Array<*>|string|ArrayBuffer} payload - Upload-ready payload
 * @property {string} hash - Framework-compatible blob digest
 * @property {number} size - Persisted blob size in bytes
 * @property {string[]} sourceFiles - Project-relative source paths
 */

/**
 * Materializes all publishable content beneath a project directory.
 * @param {string} projectDirectory - Application project root
 * @param {Object} [options] - Scanner dependencies
 * @param {import('../file-system.js').FileSystem} [options.fileSystem] - Filesystem implementation
 * @returns {Promise<{resources: ContentSourceResource[], unmatchedFiles: string[], problems: Object[]}>} Scanned resources and validation facts
 */
export default async function scanContentSources(projectDirectory, options) {
    const { fileSystem = defaultFileSystem } = options ?? {};
    const scanner = new ContentSourceScanner(projectDirectory, fileSystem);
    return await scanner.scan();
}

class ContentSourceScanner {

    #projectDirectory;
    #fileSystem;
    #resources = [];
    #problems = [];
    #files = new Map();
    #matchedFiles = new Set();
    #staticAssets = new Map();
    #stylesheetProblemKeys = new Set();

    constructor(projectDirectory, fileSystem) {
        if (!isString(projectDirectory) || projectDirectory.length === 0) {
            throw new TypeError('scanContentSources requires a project directory');
        }

        this.#projectDirectory = path.resolve(projectDirectory);
        this.#fileSystem = fileSystem;
    }

    async scan() {
        await this.#scanPages();
        await this.#scanTemplates();
        await this.#scanStaticAssets();
        await this.#scanStaticDirectory('public');
        await this.#scanEmails();

        this.#resources.sort((left, right) => {
            return compareStrings(`${ left.type }\0${ left.pathname }`, `${ right.type }\0${ right.pathname }`);
        });

        const unmatchedFiles = Array.from(this.#files.keys())
            .filter((filepath) => !this.#matchedFiles.has(filepath))
            .map((filepath) => this.#relativeProjectPath(filepath))
            .sort(compareStrings);

        return {
            resources: this.#resources,
            unmatchedFiles,
            problems: this.#problems,
        };
    }

    async #scanPages() {
        const root = path.join(this.#projectDirectory, 'pages');
        const { files } = await this.#walkFiles(root);
        const manifests = files.filter(({ relativePath }) => {
            return path.posix.basename(relativePath) === 'page.json';
        });

        for (const file of manifests) {
            this.#matchedFiles.add(file.filepath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const metadata = await this.#readManifest(file, 'page.json');
            if (!metadata) {
                continue;
            }

            const pageDirectory = path.posix.dirname(file.relativePath);
            const pathname = pageDirectory === '.' ? '/' : `/${ pageDirectory }`;
            this.#resources.push(this.#makeResource(
                'PageMetadata',
                pathname,
                metadata,
                [ file.sourcePath ],
            ));

            const page = this.#validatePageManifest(file, metadata);
            await this.#scanPageTemplate(file, pathname, page.template);
            await this.#scanPagePartials(file, pathname, page.partials);
            await this.#scanPageIncludes(file, pathname, page.includes);
        }
    }

    async #scanPageTemplate(manifest, pathname, template) {
        if (!template) {
            return;
        }

        const source = await this.#readReferencedText({
            manifest,
            reference: template,
            role: 'page template',
        });

        if (!source) {
            return;
        }

        const filename = path.posix.basename(template);
        if (RESERVED_PAGE_FILENAMES.has(filename)) {
            this.#addProblem({
                code: 'reserved-template-filename',
                filepath: manifest.sourcePath,
                message: `Page template "${ template }" uses reserved filename "${ filename }"`,
                referencedFile: source.sourcePath,
            });
            return;
        }

        // A template reference may include directories, but the framework
        // publishes it as a sibling of page.json under its basename.
        const templatePathname = pathname === '/'
            ? `/${ filename }`
            : `${ pathname }/${ filename }`;

        if (!isValidTemplateFilepath(templatePathname)) {
            this.#addProblem({
                code: 'invalid-pathname',
                filepath: source.sourcePath,
                message: `Page template cannot be published at "${ templatePathname }"`,
            });
            return;
        }

        // The Publishing API rejects empty objects at upload time. Catching
        // it here fails the scan instead of the upload phase, so nothing is
        // written to the server for a locally invalid source.
        if (source.text.length === 0) {
            this.#addProblem({
                code: 'empty-page-template',
                filepath: manifest.sourcePath,
                message: `Page template "${ template }" is empty`,
                referencedFile: source.sourcePath,
            });
            return;
        }

        this.#resources.push(this.#makeResource(
            'PageTemplate',
            templatePathname,
            source.text,
            [ manifest.sourcePath, source.sourcePath ],
        ));
    }

    async #scanPagePartials(manifest, pathname, partials) {
        const payload = [];
        const sourceFiles = [ manifest.sourcePath ];

        for (const partial of partials) {
            const source = await this.#readReferencedText({
                manifest,
                reference: partial.filename,
                role: `page partial "${ partial.id }"`,
            });

            if (source) {
                payload.push({ id: partial.id, source: source.text });
                sourceFiles.push(source.sourcePath);
            }
        }

        this.#resources.push(this.#makeResource(
            'PagePartials',
            pathname,
            payload,
            sourceFiles,
        ));
    }

    async #scanPageIncludes(manifest, pathname, includes) {
        const payload = {};
        const sourceFiles = [ manifest.sourcePath ];

        for (const include of includes) {
            const source = await this.#readReferencedText({
                manifest,
                reference: include.filename,
                role: `page include "${ include.name }"`,
            });

            if (source) {
                payload[include.name] = source.text;
                sourceFiles.push(source.sourcePath);
            }
        }

        this.#resources.push(this.#makeResource(
            'PageIncludes',
            pathname,
            payload,
            sourceFiles,
        ));
    }

    async #scanTemplates() {
        const root = path.join(this.#projectDirectory, 'templates');
        const { files } = await this.#walkFiles(root);

        await this.#scanTemplateBundle(root, files, 'partials', 'GlobalTemplatePartials');
        await this.#scanTemplateBundle(root, files, 'base', 'BaseTemplates');
    }

    async #scanTemplateBundle(root, files, directoryName, type) {
        const directory = path.join(root, directoryName);
        const prefix = `${ directoryName }/`;
        const bundleFiles = files.filter(({ relativePath }) => relativePath.startsWith(prefix));

        if (bundleFiles.length === 0 && !await this.#directoryExists(directory)) {
            return;
        }

        const payload = [];
        const sourceFiles = [];

        for (const file of bundleFiles) {
            this.#matchedFiles.add(file.filepath);

            const bundlePath = file.relativePath.slice(prefix.length);
            if (!this.#validateSourcePath({ ...file, relativePath: bundlePath })) {
                continue;
            }

            const source = await this.#fileSystem.readFile(file.filepath);
            payload.push({ id: bundlePath, source });
            sourceFiles.push(file.sourcePath);
        }

        this.#resources.push(this.#makeResource(type, '/', payload, sourceFiles));
    }

    async #scanStaticAssets() {
        const root = path.join(this.#projectDirectory, 'static-assets');
        const { files } = await this.#walkFiles(root);
        const assets = [];
        const stylesheets = new Map();

        for (const file of files) {
            this.#matchedFiles.add(file.filepath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const payload = await this.#fileSystem.readBinaryFile(file.filepath);
            assets.push({ file, payload });

            if (path.posix.extname(file.relativePath) === '.css') {
                stylesheets.set(`/${ file.relativePath }`, {
                    sourcePath: file.sourcePath,
                    text: new TextDecoder().decode(payload),
                });
            }
        }

        for (const asset of assets) {
            const { file } = asset;
            const extension = path.posix.extname(file.relativePath);
            let { payload } = asset;
            let sourceFiles = [ file.sourcePath ];

            if (extension === '.css') {
                const bundle = bundleStylesheet({
                    entryPathname: `/${ file.relativePath }`,
                    getStylesheet: (pathname) => stylesheets.get(pathname) ?? null,
                });
                payload = encoder.encode(bundle.source).buffer;
                sourceFiles = bundle.sourceFiles;

                for (const problem of bundle.problems) {
                    this.#addStylesheetProblem(problem);
                }
            } else if (extension === '.js') {
                payload = this.#stripJavaScriptComments(file, payload);

                if (!payload) {
                    continue;
                }
            }

            this.#publishStaticAsset(file, payload, sourceFiles);
        }
    }

    async #scanStaticDirectory(directoryName) {
        const root = path.join(this.#projectDirectory, directoryName);
        const { files } = await this.#walkFiles(root);

        for (const file of files) {
            this.#matchedFiles.add(file.filepath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const payload = await this.#fileSystem.readBinaryFile(file.filepath);
            this.#publishStaticAsset(file, payload, [ file.sourcePath ]);
        }
    }

    #publishStaticAsset(file, payload, sourceFiles) {
        if (payload.byteLength === 0) {
            this.#addProblem({
                code: 'empty-static-asset',
                filepath: file.sourcePath,
                message: 'Static asset is empty',
            });
            return;
        }

        const resource = this.#makeResource(
            'StaticAsset',
            file.relativePath,
            payload,
            sourceFiles,
        );
        const existing = this.#staticAssets.get(file.relativePath);

        if (existing) {
            this.#addProblem({
                code: 'static-asset-collision',
                filepath: file.sourcePath,
                message: `Static asset pathname "${ file.relativePath }" is also produced by "${ existing.sourceFiles[0] }"`,
                conflictingFile: existing.sourceFiles[0],
                pathname: file.relativePath,
            });
            return;
        }

        this.#staticAssets.set(file.relativePath, resource);
        this.#resources.push(resource);
    }

    #stripJavaScriptComments(file, payload) {
        const source = new TextDecoder().decode(payload);
        let stripped;

        try {
            stripped = stripJavaScriptComments(source);
        } catch (cause) {
            this.#addProblem({
                code: 'invalid-javascript',
                filepath: file.sourcePath,
                message: `JavaScript cannot be parsed at line ${ cause.lineNumber }, column ${ cause.column }`,
                line: cause.lineNumber,
                column: cause.column,
            });
            return null;
        }

        return encoder.encode(stripped).buffer;
    }

    async #scanEmails() {
        const root = path.join(this.#projectDirectory, 'emails');
        const { files } = await this.#walkFiles(root);
        const manifests = files.filter(({ relativePath }) => {
            return path.posix.basename(relativePath) === 'email.json';
        });

        for (const file of manifests) {
            this.#matchedFiles.add(file.filepath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const json = await this.#readManifest(file, 'email.json');
            if (!json) {
                continue;
            }

            const emailDirectory = path.posix.dirname(file.relativePath);
            const pathname = emailDirectory === '.' ? '/' : `/${ emailDirectory }`;
            const email = this.#validateEmailManifest(file, json);
            const payload = {
                contextData: json.contextData ?? {},
                partials: [],
                includes: {},
            };
            const sourceFiles = [ file.sourcePath ];

            for (const role of [ 'htmlTemplate', 'textTemplate' ]) {
                const specification = email[role];
                if (!specification) {
                    continue;
                }

                const source = await this.#readReferencedText({
                    manifest: file,
                    reference: specification.filename,
                    role: `email ${ role }`,
                });
                if (source) {
                    payload[role] = { id: specification.id, source: source.text };
                    sourceFiles.push(source.sourcePath);
                }
            }

            for (const partial of email.partials) {
                const source = await this.#readReferencedText({
                    manifest: file,
                    reference: partial.filename,
                    role: `email partial "${ partial.id }"`,
                });
                if (source) {
                    payload.partials.push({ id: partial.id, source: source.text });
                    sourceFiles.push(source.sourcePath);
                }
            }

            this.#resources.push(this.#makeResource(
                'EmailAssets',
                pathname,
                payload,
                sourceFiles,
            ));
        }
    }

    #validatePageManifest(file, json) {
        let template = '';
        if (Object.hasOwn(json, 'template')) {
            if (isString(json.template)) {
                template = json.template;
            } else {
                this.#invalidManifest(file, 'template must be a string');
            }
        }

        return {
            template,
            partials: this.#validatePartials(file, json.partials),
            includes: this.#validateIncludes(file, json.includes),
        };
    }

    #validateEmailManifest(file, json) {
        const result = {
            htmlTemplate: null,
            textTemplate: null,
            partials: this.#validatePartials(file, json.partials),
        };

        for (const field of [ 'htmlTemplate', 'textTemplate' ]) {
            const specification = json[field];

            if (!specification) {
                continue;
            }
            if (this.#isValidSourceSpecification(specification)) {
                result[field] = specification;
            } else {
                this.#invalidManifest(file, `${ field } must contain non-empty id and filename strings`);
            }
        }

        return result;
    }

    #validatePartials(file, value) {
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            this.#invalidManifest(file, 'partials must be an array');
            return [];
        }

        const ids = new Set();
        const partials = [];

        for (const [ index, partial ] of value.entries()) {
            if (!this.#isValidSourceSpecification(partial)) {
                this.#invalidManifest(file, `partials[${ index }] must contain non-empty id and filename strings`);
                continue;
            }
            if (ids.has(partial.id)) {
                this.#invalidManifest(file, `partials contains duplicate id "${ partial.id }"`);
                continue;
            }

            ids.add(partial.id);
            partials.push(partial);
        }

        return partials.sort((left, right) => compareStrings(left.id, right.id));
    }

    #validateIncludes(file, value) {
        if (value === undefined) {
            return [];
        }
        if (!isPlainObject(value)) {
            this.#invalidManifest(file, 'includes must be an object');
            return [];
        }

        const includes = [];

        for (const name of Object.keys(value).sort(compareStrings)) {
            const include = value[name];
            if (!name || !isPlainObject(include) || !isString(include.filename) || !include.filename) {
                this.#invalidManifest(file, `include "${ name }" must contain a non-empty filename string`);
                continue;
            }
            includes.push({ name, filename: include.filename });
        }

        return includes;
    }

    #isValidSourceSpecification(value) {
        return isPlainObject(value) &&
            isString(value.id) && value.id.length > 0 &&
            isString(value.filename) && value.filename.length > 0;
    }

    #invalidManifest(file, message) {
        this.#addProblem({
            code: 'invalid-manifest',
            filepath: file.sourcePath,
            message,
        });
    }

    async #readManifest(file, name) {
        let source;

        try {
            source = await this.#fileSystem.readFile(file.filepath);
        } catch (cause) {
            throw new Error(`Failed to read "${ file.sourcePath }"`, { cause });
        }

        let json;
        try {
            json = JSON.parse(source);
        } catch (cause) {
            this.#addProblem({
                code: 'malformed-json',
                filepath: file.sourcePath,
                message: `${ name } contains malformed JSON: ${ cause.message }`,
            });
            return null;
        }

        if (!isPlainObject(json)) {
            this.#addProblem({
                code: 'invalid-manifest',
                filepath: file.sourcePath,
                message: `${ name } must contain a JSON object`,
            });
            return null;
        }

        return json;
    }

    async #readReferencedText(args) {
        const { manifest, reference, role } = args;
        const filepath = path.resolve(path.dirname(manifest.filepath), reference);
        const sourcePath = this.#relativeProjectPath(filepath);

        if (this.#isInsideProject(filepath)) {
            this.#matchedFiles.add(filepath);
        }

        if (path.isAbsolute(reference) || !isValidPathname(`/${ reference }`) || !this.#isInsideProject(filepath)) {
            this.#addProblem({
                code: 'invalid-pathname',
                filepath: manifest.sourcePath,
                message: `${ role } references invalid pathname "${ reference }"`,
                referencedFile: reference,
            });
            return null;
        }

        const symlinkPath = await this.#findSymlinkInProjectPath(filepath);
        if (symlinkPath) {
            this.#addProblem({
                code: 'symlink-referenced-file',
                filepath: manifest.sourcePath,
                message: `${ role } reference "${ sourcePath }" cannot use symbolic link "${ this.#relativeProjectPath(symlinkPath) }"`,
                referencedFile: sourcePath,
                symlink: this.#relativeProjectPath(symlinkPath),
            });
            return null;
        }

        let stats;
        try {
            stats = await this.#fileSystem.stat(filepath);
        } catch (cause) {
            if (isMissingPathError(cause)) {
                this.#addProblem({
                    code: 'missing-referenced-file',
                    filepath: manifest.sourcePath,
                    message: `${ role } references missing file "${ sourcePath }"`,
                    referencedFile: sourcePath,
                });
                return null;
            }
            throw cause;
        }

        if (!stats.isFile()) {
            this.#addProblem({
                code: 'missing-referenced-file',
                filepath: manifest.sourcePath,
                message: `${ role } reference "${ sourcePath }" is not a file`,
                referencedFile: sourcePath,
            });
            return null;
        }

        return {
            sourcePath,
            text: await this.#fileSystem.readFile(filepath),
        };
    }

    async #findSymlinkInProjectPath(filepath) {
        const relativePath = path.relative(this.#projectDirectory, filepath);
        const segments = relativePath.split(path.sep);
        let candidate = this.#projectDirectory;

        for (const segment of segments) {
            candidate = path.join(candidate, segment);

            try {
                const stats = await this.#fileSystem.lstat(candidate);
                if (stats.isSymbolicLink()) {
                    return candidate;
                }
            } catch (cause) {
                if (isMissingPathError(cause)) {
                    return null;
                }
                throw cause;
            }
        }

        return null;
    }

    #makeResource(type, pathname, payload, sourceFiles) {
        const blob = isString(payload) || payload instanceof ArrayBuffer
            ? payload
            : canonicalize(payload);

        return {
            type,
            pathname,
            payload,
            hash: hashBlob(blob),
            size: getBlobSize(blob),
            sourceFiles,
        };
    }

    #validateSourcePath(file) {
        if (file.relativePath && isValidPathname(`/${ file.relativePath }`)) {
            return true;
        }

        this.#addProblem({
            code: 'invalid-pathname',
            filepath: file.sourcePath,
            message: 'Filepath cannot be represented by a canonical content pathname',
        });
        return false;
    }

    async #walkFiles(root) {
        const files = [];
        let exists = true;

        // A symlinked source root would let readDirectory() follow it and
        // publish content from outside the project. Reject it up front,
        // matching the policy already applied to referenced files.
        if (await this.#isSymlink(root)) {
            this.#addProblem({
                code: 'symlink-source-root',
                filepath: this.#relativeProjectPath(root),
                message: `Source root "${ this.#relativeProjectPath(root) }" cannot be a symbolic link`,
            });
            return { exists: false, files };
        }

        const visit = async (directory, relativeDirectory) => {
            let entries;
            try {
                entries = await this.#fileSystem.readDirectory(directory);
            } catch (cause) {
                if (isMissingPathError(cause)) {
                    if (directory === root) {
                        exists = false;
                    }
                    return;
                }
                throw cause;
            }

            entries.sort((left, right) => compareStrings(left.name, right.name));

            for (const entry of entries) {
                const relativePath = relativeDirectory
                    ? `${ relativeDirectory }/${ entry.name }`
                    : entry.name;
                const filepath = path.join(directory, entry.name);

                // Dirent reflects the entry itself, so a symlink is neither a
                // directory nor a file here regardless of what it targets.
                // Report it instead of silently dropping it from the scan.
                if (entry.isSymbolicLink()) {
                    this.#addProblem({
                        code: 'symlink-source-file',
                        filepath: this.#relativeProjectPath(filepath),
                        message: `Source path "${ relativePath }" cannot be a symbolic link`,
                    });
                    continue;
                }

                if (entry.isDirectory()) {
                    await visit(filepath, relativePath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }

                const file = {
                    filepath,
                    relativePath,
                    sourcePath: this.#relativeProjectPath(filepath),
                };
                files.push(file);
                this.#files.set(filepath, file);
            }
        };

        await visit(root, '');
        return { exists, files };
    }

    async #isSymlink(filepath) {
        try {
            const stats = await this.#fileSystem.lstat(filepath);
            return stats.isSymbolicLink();
        } catch (cause) {
            if (isMissingPathError(cause)) {
                return false;
            }
            throw cause;
        }
    }

    async #directoryExists(directory) {
        try {
            return (await this.#fileSystem.stat(directory)).isDirectory();
        } catch (cause) {
            if (isMissingPathError(cause)) {
                return false;
            }
            throw cause;
        }
    }

    #relativeProjectPath(filepath) {
        return path.relative(this.#projectDirectory, filepath).split(path.sep).join('/');
    }

    #isInsideProject(filepath) {
        const relativePath = path.relative(this.#projectDirectory, filepath);
        return relativePath !== '..' &&
            !relativePath.startsWith(`..${ path.sep }`) &&
            !path.isAbsolute(relativePath);
    }

    #addProblem(problem) {
        this.#problems.push(problem);
    }

    #addStylesheetProblem(problem) {
        const key = [
            problem.code,
            problem.filepath,
            problem.line,
            problem.column,
        ].join('\0');

        if (this.#stylesheetProblemKeys.has(key)) {
            return;
        }

        this.#stylesheetProblemKeys.add(key);
        this.#addProblem(problem);
    }
}

function isMissingPathError(error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}
