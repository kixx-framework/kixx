import { isPlainObject, isString } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import {
    canonicalize,
    compareStrings,
    hashBlob,
} from '../content-addressable-store/addressing.js';
import {
    RESERVED_PAGE_FILENAMES,
    isValidPathname,
    isValidTemplateFilepath,
} from '../content-addressable-store/content-layout.js';
import { bundleStylesheet } from './bundle-stylesheet.js';
import { basename, dirname, extname } from './posix-path.js';
import { stripJavaScriptComments } from './strip-asset-comments.js';

/**
 * @typedef {import('./content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

const encoder = new TextEncoder();

// Templates and page.json files keep a leading byte order mark, so a
// page.json that starts with one is malformed JSON. Stylesheets and scripts
// under static-assets/ lose it. Both rules are what published content has
// always been hashed from, so changing either changes object ids.
const sourceTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
const assetTextDecoder = new TextDecoder();

/**
 * @typedef {Object} ContentSourceResource
 * @property {string} type - StaticAsset, GlobalTemplatePartials, BaseTemplates, PageMetadata, PagePartials, PageIncludes, or PageTemplate
 * @property {string} pathname - Logical resource pathname
 * @property {Object|Array<*>|string|ArrayBuffer} payload - Upload-ready payload
 * @property {string} hash - Framework-compatible blob digest
 * @property {number} size - Persisted blob size in bytes
 * @property {string[]} sourceFiles - Paths from the source's root
 */

/**
 * @typedef {Object} PluginContentRoot
 * @property {string} plugin - The plugin's name
 * @property {string} [pagesDirectory] - Path from the source's root
 * @property {string} [templatesDirectory] - Path from the source's root
 * @property {string} [staticAssetsDirectory] - Path from the source's root
 */

// The owner label of the project's own content.
const APP_OWNER = 'app';

const APP_CONTENT_ROOT = Object.freeze({
    owner: APP_OWNER,
    pagesDirectory: 'pages',
    templatesDirectory: 'templates',
    staticAssetsDirectory: 'static-assets',
    publicDirectory: 'public',
});

/**
 * Materializes all publishable content a content source holds: the `pages`,
 * `templates`, `static-assets`, and `public` directories at its root, then
 * the content directories of each plugin.
 *
 * Every owner's content shares one set of namespaces. The first owner to
 * supply a page, global partial, base template, or static asset keeps it:
 * the project first, then the plugins in the order given. Each later one is
 * a collision problem.
 *
 * A problem in the content is returned as data. A failure of the source
 * itself rejects.
 *
 * @param {ContentSourceInterface} source - Rooted at the project
 * @param {Object} [options]
 * @param {PluginContentRoot[]} [options.pluginContentRoots=[]] - Validated by the caller
 * @returns {Promise<{resources: ContentSourceResource[], unmatchedFiles: string[], problems: Object[]}>} Scanned resources and validation facts
 */
export default async function scanContentSources(source, options) {
    const { pluginContentRoots = [] } = options ?? {};
    const scanner = new ContentSourceScanner(source, pluginContentRoots);
    return await scanner.scan();
}

class ContentSourceScanner {

    #source;
    #contentRoots;
    #resources = [];
    #problems = [];
    // Every regular file found beneath a scanned root, by its path from the
    // source's root.
    #files = new Map();
    #symlinks = new Set();
    #matchedFiles = new Set();
    // The page.json that first claimed each page pathname.
    #pages = new Map();
    #staticAssets = new Map();
    #stylesheetProblemKeys = new Set();

    constructor(source, pluginContentRoots) {
        this.#source = source;
        this.#contentRoots = [
            APP_CONTENT_ROOT,
            ...pluginContentRoots.map(({ plugin, ...directories }) => {
                return { owner: plugin, ...directories };
            }),
        ];
    }

    async scan() {
        for (const root of this.#contentRoots) {
            if (root.pagesDirectory) {
                await this.#scanPages(root.pagesDirectory, root.owner);
            }
        }

        await this.#scanTemplates();

        // One owner's static-assets and public directories are scanned
        // together, so the project's files claim their pathnames before any
        // plugin's.
        for (const root of this.#contentRoots) {
            if (root.staticAssetsDirectory) {
                await this.#scanStaticAssets(root.staticAssetsDirectory, root.owner);
            }

            if (root.publicDirectory) {
                await this.#scanStaticDirectory(root.publicDirectory, root.owner);
            }
        }

        this.#resources.sort((left, right) => {
            return compareStrings(`${ left.type }\0${ left.pathname }`, `${ right.type }\0${ right.pathname }`);
        });

        const unmatchedFiles = Array.from(this.#files.keys())
            .filter((filepath) => !this.#matchedFiles.has(filepath))
            .sort(compareStrings);

        return {
            resources: this.#resources,
            unmatchedFiles,
            problems: this.#problems,
        };
    }

    async #scanPages(directory, owner) {
        const { files } = await this.#walkFiles(directory, owner);
        const manifests = files.filter(({ relativePath }) => {
            return basename(relativePath) === 'page.json';
        });

        for (const file of manifests) {
            this.#matchedFiles.add(file.sourcePath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const pageDirectory = dirname(file.relativePath);
            const pathname = pageDirectory === '' ? '/' : `/${ pageDirectory }`;

            // A page.json claims its pathname even when it turns out to be
            // malformed, so fixing it can't surprise the next owner.
            const claimant = this.#pages.get(pathname);
            if (claimant) {
                this.#addCollision({
                    code: 'page-collision',
                    label: `Page "${ pathname }"`,
                    file,
                    claimant,
                    pathname,
                });
                continue;
            }

            this.#pages.set(pathname, file);

            const metadata = await this.#readManifest(file, 'page.json');
            if (!metadata) {
                continue;
            }

            this.#resources.push(await this.#makeResource(
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

        const filename = basename(template);
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

        this.#resources.push(await this.#makeResource(
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

        this.#resources.push(await this.#makeResource(
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

        this.#resources.push(await this.#makeResource(
            'PageIncludes',
            pathname,
            payload,
            sourceFiles,
        ));
    }

    async #scanTemplates() {
        const listings = [];

        for (const root of this.#contentRoots) {
            if (root.templatesDirectory) {
                listings.push(await this.#walkFiles(root.templatesDirectory, root.owner));
            }
        }

        await this.#scanTemplateBundle(listings, {
            directoryName: 'partials',
            type: 'GlobalTemplatePartials',
            collisionCode: 'partial-collision',
            label: 'Global partial',
        });
        await this.#scanTemplateBundle(listings, {
            directoryName: 'base',
            type: 'BaseTemplates',
            collisionCode: 'base-template-collision',
            label: 'Base template',
        });
    }

    // Builds the one bundle a Release has for a kind of template, from every
    // owner's templates: owners in order, and each owner's in walk order.
    async #scanTemplateBundle(listings, spec) {
        const { directoryName, type, collisionCode, label } = spec;
        const prefix = `${ directoryName }/`;
        const payload = [];
        const sourceFiles = [];
        const claimants = new Map();
        let directoryExists = false;

        for (const { files, entries } of listings) {
            // A listing holds files and symbolic links, never directories,
            // so the bundle directory exists when something is listed in
            // it. An empty directory can't be seen, and yields no bundle.
            directoryExists ||= entries.some((entry) => {
                return entry.path === directoryName || entry.path.startsWith(prefix);
            });

            for (const file of files) {
                if (!file.relativePath.startsWith(prefix)) {
                    continue;
                }

                this.#matchedFiles.add(file.sourcePath);

                const id = file.relativePath.slice(prefix.length);
                if (!this.#validateSourcePath({ ...file, relativePath: id })) {
                    continue;
                }

                const claimant = claimants.get(id);
                if (claimant) {
                    this.#addCollision({
                        code: collisionCode,
                        label: `${ label } "${ id }"`,
                        file,
                        claimant,
                        id,
                    });
                    continue;
                }

                claimants.set(id, file);

                const source = await this.#readText(file.sourcePath);
                payload.push({ id, source });
                sourceFiles.push(file.sourcePath);
            }
        }

        if (!directoryExists) {
            return;
        }

        this.#resources.push(await this.#makeResource(type, '/', payload, sourceFiles));
    }

    async #scanStaticAssets(directory, owner) {
        const { files } = await this.#walkFiles(directory, owner);
        const assets = [];
        const stylesheets = new Map();

        for (const file of files) {
            this.#matchedFiles.add(file.sourcePath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const payload = await this.#readBytes(file.sourcePath);
            assets.push({ file, payload });

            if (extname(file.relativePath) === '.css') {
                stylesheets.set(`/${ file.relativePath }`, {
                    sourcePath: file.sourcePath,
                    text: assetTextDecoder.decode(payload),
                });
            }
        }

        for (const asset of assets) {
            const { file } = asset;
            const extension = extname(file.relativePath);
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

            await this.#publishStaticAsset(file, payload, sourceFiles);
        }
    }

    async #scanStaticDirectory(directory, owner) {
        const { files } = await this.#walkFiles(directory, owner);

        for (const file of files) {
            this.#matchedFiles.add(file.sourcePath);

            if (!this.#validateSourcePath(file)) {
                continue;
            }

            const payload = await this.#readBytes(file.sourcePath);
            await this.#publishStaticAsset(file, payload, [ file.sourcePath ]);
        }
    }

    async #publishStaticAsset(file, payload, sourceFiles) {
        if (payload.byteLength === 0) {
            this.#addProblem({
                code: 'empty-static-asset',
                filepath: file.sourcePath,
                message: 'Static asset is empty',
            });
            return;
        }

        const resource = await this.#makeResource(
            'StaticAsset',
            file.relativePath,
            payload,
            sourceFiles,
        );
        const claimant = this.#staticAssets.get(file.relativePath);

        if (claimant) {
            this.#addCollision({
                code: 'static-asset-collision',
                label: `Static asset "${ file.relativePath }"`,
                file,
                claimant,
                pathname: file.relativePath,
            });
            return;
        }

        // A bundled stylesheet is named by its first source file.
        this.#staticAssets.set(file.relativePath, { ...file, sourcePath: sourceFiles[0] });
        this.#resources.push(resource);
    }

    // Reports a path that an earlier file already claimed. The earlier file
    // keeps the path.
    #addCollision(spec) {
        const { code, label, file, claimant, ...name } = spec;

        // Two of the project's own files can only collide as static assets
        // (static-assets/ and public/ share a namespace), and that message
        // names no owner.
        const message = file.owner === APP_OWNER && claimant.owner === APP_OWNER
            ? `Static asset pathname "${ file.relativePath }" is also produced by "${ claimant.sourcePath }"`
            : `${ label } is supplied by ${ describeOwner(claimant) } and by ${ describeOwner(file) }`;

        this.#addProblem({
            code,
            filepath: file.sourcePath,
            message,
            conflictingFile: claimant.sourcePath,
            owner: file.owner,
            conflictingOwner: claimant.owner,
            ...name,
        });
    }

    #stripJavaScriptComments(file, payload) {
        const source = assetTextDecoder.decode(payload);
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
        const source = await this.#readText(file.sourcePath);

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
        const sourcePath = resolveReference(dirname(manifest.sourcePath), reference);

        // The target counts as matched even when the reference is refused
        // below, so one mistake is reported once and not again as an
        // unmatched file.
        if (sourcePath !== null) {
            this.#matchedFiles.add(sourcePath);
        }

        if (sourcePath === null || !isValidPathname(`/${ reference }`)) {
            this.#addProblem({
                code: 'invalid-pathname',
                filepath: manifest.sourcePath,
                message: `${ role } references invalid pathname "${ reference }"`,
                referencedFile: reference,
            });
            return null;
        }

        const symlinkPath = this.#findSymlinkInPath(sourcePath);
        if (symlinkPath) {
            this.#addProblem({
                code: 'symlink-referenced-file',
                filepath: manifest.sourcePath,
                message: `${ role } reference "${ sourcePath }" cannot use symbolic link "${ symlinkPath }"`,
                referencedFile: sourcePath,
                symlink: symlinkPath,
            });
            return null;
        }

        if (!this.#files.has(sourcePath)) {
            // A valid reference can't leave its page's directory, so the
            // listing of pages/ already holds everything it could name.
            const message = this.#isDirectory(sourcePath)
                ? `${ role } reference "${ sourcePath }" is not a file`
                : `${ role } references missing file "${ sourcePath }"`;

            this.#addProblem({
                code: 'missing-referenced-file',
                filepath: manifest.sourcePath,
                message,
                referencedFile: sourcePath,
            });
            return null;
        }

        return {
            sourcePath,
            text: await this.#readText(sourcePath),
        };
    }

    // Returns the first symbolic link that is the path or one of its
    // parent directories.
    #findSymlinkInPath(sourcePath) {
        const segments = sourcePath.split('/');

        for (let length = 1; length <= segments.length; length += 1) {
            const candidate = segments.slice(0, length).join('/');

            if (this.#symlinks.has(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    #isDirectory(sourcePath) {
        const prefix = `${ sourcePath }/`;

        for (const filepath of this.#files.keys()) {
            if (filepath.startsWith(prefix)) {
                return true;
            }
        }

        for (const filepath of this.#symlinks) {
            if (filepath.startsWith(prefix)) {
                return true;
            }
        }

        return false;
    }

    async #readBytes(sourcePath) {
        const bytes = await this.#source.readFile(sourcePath);

        if (bytes === null) {
            throw new OperationalError(`Content source listed "${ sourcePath }" but has no such file`);
        }

        return bytes;
    }

    async #readText(sourcePath) {
        return sourceTextDecoder.decode(await this.#readBytes(sourcePath));
    }

    async #makeResource(type, pathname, payload, sourceFiles) {
        const blob = isString(payload) || payload instanceof ArrayBuffer
            ? payload
            : canonicalize(payload);

        return {
            type,
            pathname,
            payload,
            hash: await hashBlob(blob),
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

    // Lists one source root. A symbolic link is reported and never followed,
    // which is what keeps content from outside the project out of a Release.
    async #walkFiles(root, owner) {
        const files = [];
        const listing = await this.#source.listFiles(root);

        if (listing.kind === 'symlink') {
            this.#addProblem({
                code: 'symlink-source-root',
                filepath: root,
                message: `Source root "${ root }" cannot be a symbolic link`,
            });
            return { files, entries: [] };
        }

        if (listing.kind !== 'directory') {
            return { files, entries: [] };
        }

        // A source may list in any order. Template bundles hold their
        // templates in this order, so it decides their hashes.
        const entries = listing.entries.slice().sort(compareWalkOrder);

        for (const entry of entries) {
            const sourcePath = `${ root }/${ entry.path }`;

            if (entry.type === 'symlink') {
                this.#symlinks.add(sourcePath);
                this.#addProblem({
                    code: 'symlink-source-file',
                    filepath: sourcePath,
                    message: `Source path "${ entry.path }" cannot be a symbolic link`,
                });
                continue;
            }

            const file = {
                relativePath: entry.path,
                sourcePath,
                owner,
            };
            files.push(file);
            this.#files.set(sourcePath, file);
        }

        return { files, entries };
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

function describeOwner(file) {
    const owner = file.owner === APP_OWNER ? 'the app' : `plugin "${ file.owner }"`;
    return `${ owner } (${ file.sourcePath })`;
}

// Orders paths as a depth-first walk that sorts each directory's entries by
// name would visit them: segment by segment. A plain comparison of whole
// paths differs, because "-" sorts before "/".
function compareWalkOrder(left, right) {
    const leftSegments = left.path.split('/');
    const rightSegments = right.path.split('/');
    const length = Math.min(leftSegments.length, rightSegments.length);

    for (let index = 0; index < length; index += 1) {
        const order = compareStrings(leftSegments[index], rightSegments[index]);

        if (order !== 0) {
            return order;
        }
    }

    return leftSegments.length - rightSegments.length;
}

// Resolves a page.json reference against the directory that holds the
// page.json. Returns the path from the source's root, or null when the
// reference is absolute or climbs out of the root.
function resolveReference(directory, reference) {
    if (reference.startsWith('/')) {
        return null;
    }

    const segments = directory.split('/');

    for (const segment of reference.split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }

        if (segment === '..') {
            if (segments.length === 0) {
                return null;
            }

            segments.pop();
            continue;
        }

        segments.push(segment);
    }

    return segments.join('/');
}

function getBlobSize(blob) {
    return isString(blob) ? encoder.encode(blob).byteLength : blob.byteLength;
}
