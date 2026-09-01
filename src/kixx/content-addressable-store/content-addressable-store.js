import ContentAddressableIndex, {
    assertValidIndexTable,
    getRootHash,
} from './content-addressable-index.js';
import { validateReleaseManifest, validateStructuredContent } from './release-manifest.js';
import ContentSnapshot from './content-snapshot.js';
import {
    canonicalize,
    hashBlob,
    hashSet,
    hashString,
    isValidHash,
} from './addressing.js';
import {
    CONTENT_CONTRACT_PATH,
    RELEASE_MANIFEST_PATH,
    getStaticAssetPath,
    normalizePathname,
    isValidPathname,
} from './content-layout.js';
import { compileHyperviewTemplate } from '../hyperview/template-compiler.js';
import { BUILD_ASSIGNMENT_OUTCOME } from './content-store-interface.js';
import { assert, assertNonEmptyString, isPlainObject } from '../assertions/mod.js';
import { ConflictError, NotFoundError, OperationalError, ValidationError } from '../errors/mod.js';

const BULK_FILE_LIMIT = 100;
const MISSING_OBJECT_REPORT_LIMIT = 1000;

/**
 * Version of the published content semantics this runtime supports.
 * @type {number}
 * @readonly
 */
export const CONTENT_CONTRACT_VERSION = 1;

/**
 * The framework-facing entry point to published site content.
 *
 * Site content — page metadata, page templates, template bundles, email
 * bundles, and static assets — is not stored as mutable files. It is stored the
 * way a version control system stores a commit: every file is an immutable blob
 * named by the hash of its bytes, every directory is an immutable tree named by
 * the hash of its children, and one whole published site is a *closure* named by
 * the hash of its root tree. Publishing a new version writes only the blobs that
 * actually changed, then moves a single pointer — the build id — to name the new
 * closure. Rolling back moves that pointer back and re-uploads nothing.
 *
 * This class owns the Release lifecycle against that model:
 *
 * - {@link ContentAddressableStore#createRelease} verifies and persists a closure.
 * - {@link ContentAddressableStore#assignRelease} points a build id at it.
 * - {@link ContentAddressableStore#openSnapshot} resolves a build id to the
 *   closure it names and returns a {@link ContentSnapshot} for reading it.
 * - {@link ContentAddressableStore#getStaticAssetByHash} reads an asset blob by
 *   content address without resolving a closure.
 *
 * Everything about *how* content is persisted lives behind the
 * {@link ContentStoreInterface} port supplied at initialization, so the same
 * framework code runs on every deploy target.
 *
 * ## Why reads go through a snapshot
 * A snapshot pins one closure for the life of a request. A deploy that lands
 * mid-request reassigns the build pointer, but an in-flight render keeps reading
 * the index it opened with, so it can never compose a page from a mix of two
 * publications. This is the reason reads are not exposed as methods on this
 * class: there would be no request-scoped boundary to pin them to. The sole
 * exception is a direct static-asset blob read by its content address. That
 * read is deliberately closure-independent, so putting it on a snapshot would
 * force an index read solely to bypass the index.
 *
 * ## Lifecycle
 * The instance is registered as a service before the store it depends on is
 * available, so construction takes no arguments and
 * {@link ContentAddressableStore#initialize} supplies the dependency in a second
 * phase. Every other method requires initialize() to have run.
 * @see ContentStoreInterface in ./content-store-interface.js for the persistence contract
 * @see ContentSnapshot in ./content-snapshot.js for the read and write API
 */
export default class ContentAddressableStore {

    #store;
    #logger;

    // Keyed by Release root hash rather than build id, because compatibility is
    // a property of immutable content: once checked, a Release never needs
    // re-checking, and two build ids serving the same Release share the result.
    #contractCheckCache = new Map();

    // A build with no assigned Release has no root hash to key a cache entry
    // by, so the "already logged" fact is tracked separately, by build id.
    #loggedMissingBuildIds = new Set();

    /**
     * Supplies the persistence port. Called by the plugin's `initialize()`
     * phase, once the platform adapter has registered its ContentStore.
     * @param {Object} args
     * @param {import('../logger/logger.js').default} args.logger - Root logger used to create a child logger
     * @param {ContentStoreInterface} args.contentStore - Platform adapter implementing the persistence contract
     */
    initialize(args) {
        const { logger, contentStore } = args ?? {};
        assert(logger, 'ContentAddressableStore requires a logger');
        assert(contentStore, 'ContentAddressableStore requires a ContentStore');
        this.#logger = logger.createChild('ContentAddressableStore');
        this.#store = contentStore;
    }

    /**
     * Folds a pathname to the canonical form the index is keyed by.
     *
     * Re-exported as a method so callers holding only this service — request
     * handlers and the Hyperview service — can reach the layout rules without
     * importing the layout module directly.
     * @param {string} pathname - Pathname to normalize
     * @returns {string} The pathname folded to canonical form
     * @throws {TypeError} When pathname is not a string
     */
    normalizePathname(pathname) {
        return normalizePathname(pathname);
    }

    /**
     * Reports whether a pathname satisfies the canonical pathname rules.
     * @param {string} pathname - Pathname to check
     * @returns {boolean} True when the pathname is valid
     */
    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    /**
     * Hashes a string under the framework's string domain. Used for deriving
     * short, opaque cache keys from arbitrarily long logical identities.
     * @param {string} value - String to hash
     * @returns {Promise<string>} Digest in the current wire format
     * @throws {TypeError} When value is not a string
     */
    async hashString(value) {
        return await hashString(value);
    }

    /**
     * Hashes a canonicalizable collection under the framework's set domain.
     * Used for deriving a digest from a plain object or array, such as a
     * page's props, rather than an already-composed string.
     * @param {Object|Array<*>} value - Collection to canonicalize and hash
     * @returns {Promise<string>} Digest in the current wire format
     * @throws {TypeError} When value contains a value that cannot be canonicalized
     */
    async hashSet(value) {
        return await hashSet(value);
    }

    /**
     * Resolves the running build's closure and returns a read/write view of it.
     *
     * The returned snapshot is pinned to the closure this call resolved, so a
     * deploy landing afterwards is invisible to it. Open exactly one per request
     * and thread it through the render; opening a second mid-request reintroduces
     * the torn-read the snapshot exists to prevent.
     * @param {Object} context - Request or execution context, passed through to the store
     * @returns {Promise<ContentSnapshot>} A snapshot pinned to the current build's closure
     * @throws {AssertionError} When the stored index table is malformed
     * @throws {OperationalError} When the build has no assigned Release, its Release's content
     *   contract is unsupported by this code, or the backing store fails
     */
    async openSnapshot(context) {
        const buildId = context.runtime.build.id ?? null;
        const build = await this.#store.getBuild(context, buildId);

        // A missing pointer or an incompatible content contract means the
        // running deploy cannot serve any content at all. This is a deploy
        // configuration fault — the code and the content it was given are
        // mismatched — not a programmer error, so it is reported as an
        // expected 503 rather than crashing the process.
        if (!build) {
            this.#reportUnservableBuild(buildId, 'no Release is assigned to this build');
            throw new OperationalError(`Build "${ buildId }" has no assigned Release`, {
                code: 'BuildNotServable',
                httpStatusCode: 503,
            });
        }

        const index = new ContentAddressableIndex(build.entries);

        // A null rootHash means developer mode: a live scan with no immutable
        // Release, so there is no content contract to verify against.
        if (build.rootHash) {
            await this.#verifyContentContract(context, buildId, build.rootHash, index);
        }

        return new ContentSnapshot(this.#store, index);
    }

    // Reports (once per build id) that a build has no assigned Release. Called
    // only from openSnapshot(); getCurrentBuild() treats the same condition as
    // an expected, unlogged "null" outcome for its own callers.
    #reportUnservableBuild(buildId, reason) {
        if (this.#loggedMissingBuildIds.has(buildId)) {
            return;
        }
        this.#loggedMissingBuildIds.add(buildId);
        this.#logger.error(`build "${ buildId }" cannot serve content: ${ reason }`, { buildId });
    }

    // Verifies, once per distinct Release, that this code's content contract
    // version matches the version the Release was authored against. The check
    // cannot run any earlier: the running build's code and its assigned
    // Release are both known for the first time here.
    async #verifyContentContract(context, buildId, releaseId, index) {
        let outcome = this.#contractCheckCache.get(releaseId);

        if (!outcome) {
            const stat = index.getNode(CONTENT_CONTRACT_PATH);
            assert(stat, `Release "${ releaseId }" has no content contract entry`);
            const text = await this.#store.getFile(context, 'text', CONTENT_CONTRACT_PATH, stat.hash);
            assertNonEmptyString(text, `Release "${ releaseId }" references an unreadable content contract`);
            const { version } = JSON.parse(text);

            outcome = { compatible: version === CONTENT_CONTRACT_VERSION, foundVersion: version };
            this.#contractCheckCache.set(releaseId, outcome);

            if (!outcome.compatible) {
                this.#logger.error('build cannot serve content: unsupported content contract version', {
                    buildId,
                    releaseId,
                    expectedContractVersion: CONTENT_CONTRACT_VERSION,
                    foundContractVersion: outcome.foundVersion,
                });
            }
        }

        if (!outcome.compatible) {
            throw new OperationalError(
                `Build "${ buildId }" Release "${ releaseId }" uses content contract version ${ outcome.foundVersion }, but this code supports version ${ CONTENT_CONTRACT_VERSION }`,
                { code: 'BuildNotServable', httpStatusCode: 503 },
            );
        }
    }

    /**
     * Resolves the closure currently assigned to the running deploy's build,
     * for callers that must report or restore it rather than read through it.
     *
     * Unlike {@link ContentAddressableStore#openSnapshot}, absence at every
     * level is reported as `null` rather than thrown: this method backs public
     * request handling (the Publishing API's Build resource) and end-to-end
     * restoration, where "no active build" is an expected outcome to report,
     * not a startup-class fault.
     * @param {Object} context - Request or execution context, passed through to the store
     * @returns {Promise<{id: string, rootHash: string}|null>} The running build's id and assigned root hash, or null when the runtime has no build id, no registered pointer, or (developer mode) no persisted pointer
     * @throws {OperationalError} When the backing store fails
     */
    async getCurrentBuild(context) {
        const buildId = context.runtime.build.id ?? null;
        if (!buildId) {
            return null;
        }

        const build = await this.#store.getBuild(context, buildId);
        if (!build || !build.rootHash) {
            return null;
        }

        return { id: buildId, rootHash: build.rootHash };
    }

    /**
     * Reads pointer metadata for any build without loading its Release closure.
     * @param {Object} context - Request or execution context
     * @param {string} buildId - Operator-chosen build identifier
     * @returns {Promise<Object|null>} Pointer metadata or null when unassigned
     */
    async getBuildPointer(context, buildId) {
        assertNonEmptyString(buildId, 'ContentAddressableStore#getBuildPointer: buildId');
        return await this.#store.getBuildPointer(context, buildId);
    }

    /**
     * Lists every assigned build newest assignment first.
     * @param {Object} context - Request or execution context
     * @returns {Promise<Object[]>} Build pointer records
     */
    async listBuilds(context) {
        return await this.#store.listBuilds(context);
    }

    /**
     * Assigns an existing Release to any build using the requested precondition.
     * @param {Object} context - Request or execution context
     * @param {string} buildId - Build identifier to assign
     * @param {Object} assignment - Release and pointer precondition
     * @param {string} assignment.releaseId - Existing Release id
     * @param {(string|null)} [assignment.precondition] - Expected current Release, null for unassigned, or absent for unconditional
     * @returns {Promise<Object>} Resulting build pointer
     * @throws {NotFoundError} When the Release does not exist
     * @throws {ConflictError} When the pointer precondition fails
     */
    async assignRelease(context, buildId, assignment) {
        const { releaseId, precondition } = assignment ?? {};
        assertNonEmptyString(buildId, 'ContentAddressableStore#assignRelease: buildId');
        assertNonEmptyString(releaseId, 'ContentAddressableStore#assignRelease: releaseId');
        assert(
            precondition === undefined || precondition === null || isValidHash(precondition),
            'ContentAddressableStore#assignRelease: precondition',
        );

        const current = await this.#store.getBuildPointer(context, buildId);
        if (current?.rootHash === releaseId) {
            return { buildId, releaseId, assignedAt: current.assignedAt };
        }

        const outcome = await this.#store.assignBuild(context, buildId, {
            rootHash: releaseId,
            expectedRootHash: precondition,
        });
        if (outcome === BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE) {
            throw new NotFoundError(`Release "${ releaseId }" was not found.`, { code: 'ReleaseNotFound' });
        }
        if (outcome === BUILD_ASSIGNMENT_OUTCOME.CONFLICT) {
            throw new ConflictError('The build pointer precondition failed.', { code: 'BuildPointerConflict' });
        }
        const pointer = await this.#store.getBuildPointer(context, buildId);
        return { buildId, releaseId, assignedAt: pointer.assignedAt };
    }

    /**
     * Reads a static asset blob directly by content hash, without loading an
     * index or resolving the running build's closure.
     * @param {Object} context - Request or execution context, passed through to the store
     * @param {string} pathname - Logical asset pathname, used by pathname-backed adapters
     * @param {string} hash - Content address of the blob to read
     * @returns {Promise<ReadableStream|null>} The blob stream, or null when the blob is absent
     * @throws {AssertionError} When pathname or hash is invalid, or a present blob is not a stream
     * @throws {OperationalError} When the backing store fails
     */
    async getStaticAssetByHash(context, pathname, hash) {
        assert(isValidPathname(pathname), 'getStaticAssetByHash() requires a valid pathname');
        assert(isValidHash(hash), 'getStaticAssetByHash() requires a valid hash');

        const stream = await this.#store.getFile(
            context,
            'stream',
            getStaticAssetPath(pathname),
            hash,
        );

        assert(
            stream === null || stream instanceof ReadableStream,
            `The static asset hash "${ hash }" references unreadable content`,
        );

        return stream;
    }

    /**
     * Stores one immutable object without resolving a build snapshot.
     * @param {Object} context - Request or execution context
     * @param {string|ArrayBuffer} payload - Object bytes
     * @returns {Promise<{objectId: string, size: number}>} Content address and size
     */
    async putObject(context, payload) {
        const objectId = await hashBlob(payload);
        const size = await this.#store.putFile(context, '', objectId, payload);
        return { objectId, size };
    }

    /**
     * Reports stored sizes for content addresses without reading payload bytes.
     * @param {Object} context - Request or execution context
     * @param {string[]} objectIds - Up to 100 content addresses
     * @returns {Promise<Array<{size: number}|null>>} Positionally aligned object metadata
     */
    async statObjects(context, objectIds) {
        return await this.#store.statFiles(context, objectIds);
    }

    /**
     * Verifies a Release manifest without persisting blobs or a closure.
     * @param {Object} context - Request or execution context
     * @param {Object} manifest - Complete Release manifest
     * @returns {Promise<Object>} Derived Release identity and aggregate statistics
     * @throws {ValidationError} When the Release cannot be served completely
     */
    async validateRelease(context, manifest) {
        const prepared = await this.#prepareRelease(context, manifest);
        return releaseResult(prepared);
    }

    /**
     * Verifies and persists an immutable Release without assigning a build.
     * @param {Object} context - Request or execution context
     * @param {Object} manifest - Complete Release manifest
     * @param {Object} [_options] - Reserved creation options
     * @returns {Promise<Object>} Release identity and aggregate statistics
     * @throws {ValidationError} When the Release cannot be served completely
     */
    async createRelease(context, manifest, _options) {
        const prepared = await this.#prepareRelease(context, manifest);
        for (const generated of prepared.generatedObjects) {
            await this.#store.putFile(context, generated.pathname, generated.hash, generated.text);
        }
        await this.#store.saveIndex(context, prepared.releaseId, prepared.entries);
        return releaseResult(prepared);
    }

    /**
     * Reads the complete manifest stored inside an immutable Release closure.
     * @param {Object} context - Request or execution context
     * @param {string} releaseId - Release root hash
     * @returns {Promise<Object|null>} Manifest or null when the Release does not exist
     */
    async getReleaseManifest(context, releaseId) {
        assertNonEmptyString(releaseId, 'ContentAddressableStore#getReleaseManifest: releaseId');
        const entries = await this.#store.getIndex(context, releaseId);
        if (!entries) {
            return null;
        }
        const index = new ContentAddressableIndex(entries);
        const stat = index.getNode(RELEASE_MANIFEST_PATH);
        assert(stat, `Release "${ releaseId }" has no manifest entry`);
        const text = await this.#store.getFile(context, 'text', RELEASE_MANIFEST_PATH, stat.hash);
        assertNonEmptyString(text, `Release "${ releaseId }" references an unreadable manifest`);
        return JSON.parse(text);
    }

    async #prepareRelease(context, manifest) {
        const files = validateReleaseManifest(manifest);
        const error = new ValidationError('The Release content is invalid');
        await this.#verifyObjectStats(context, files, error);
        const contentByPath = await this.#readStructuredContent(context, files, error);
        this.#verifyStructuredContent(files, contentByPath, error);
        this.#verifyTemplates(files, contentByPath, error);
        if (error.length) {
            throw error;
        }

        const manifestText = canonicalize(manifest);
        const contractText = canonicalize({ version: CONTENT_CONTRACT_VERSION });
        const generatedObjects = await Promise.all([
            makeGeneratedObject(RELEASE_MANIFEST_PATH, manifestText),
            makeGeneratedObject(CONTENT_CONTRACT_PATH, contractText),
        ]);
        const entries = await ContentAddressableIndex.buildIndex(files.concat(generatedObjects));
        assertValidIndexTable(entries);
        return {
            releaseId: getRootHash(entries),
            entries,
            generatedObjects,
            objectCount: new Set(files.map(({ hash }) => hash)).size,
            totalBytes: files.reduce((total, { size }) => total + size, 0),
            contractVersion: CONTENT_CONTRACT_VERSION,
        };
    }

    async #verifyObjectStats(context, files, error) {
        const uniqueHashes = [ ...new Set(files.map(({ hash }) => hash)) ];
        const stats = new Map();
        for (let offset = 0; offset < uniqueHashes.length; offset += BULK_FILE_LIMIT) {
            const hashes = uniqueHashes.slice(offset, offset + BULK_FILE_LIMIT);
            const results = await this.#store.statFiles(context, hashes);
            hashes.forEach((hash, index) => stats.set(hash, results[index]));
        }
        let missingCount = 0;
        files.forEach((file) => {
            const stat = stats.get(file.hash);
            if (!stat && missingCount < MISSING_OBJECT_REPORT_LIMIT) {
                error.push(`Object "${ file.hash }" is missing`, file.pathname);
                missingCount += 1;
            } else if (stat && stat.size !== file.size) {
                error.push(`Object "${ file.hash }" has size ${ stat.size }, not ${ file.size }`, file.pathname);
            }
        });
    }

    async #readStructuredContent(context, files, error) {
        const readable = files.filter(({ pathname }) => {
            return getStructuredKind(pathname) || isPageTemplatePath(pathname);
        });
        const content = new Map();
        for (let offset = 0; offset < readable.length; offset += BULK_FILE_LIMIT) {
            const batch = readable.slice(offset, offset + BULK_FILE_LIMIT);
            const results = await this.#store.getFiles(context, 'text', batch);
            results.forEach((text, index) => {
                const file = batch[index];
                if (text === null) {
                    return;
                }
                if (getStructuredKind(file.pathname)) {
                    try {
                        content.set(file.pathname, JSON.parse(text));
                    } catch {
                        error.push('Structured object must contain valid JSON', file.pathname);
                    }
                } else {
                    content.set(file.pathname, text);
                }
            });
        }
        return content;
    }

    #verifyStructuredContent(files, contentByPath, error) {
        for (const file of files) {
            const kind = getStructuredKind(file.pathname);
            if (!kind || !contentByPath.has(file.pathname)) {
                continue;
            }
            try {
                validateStructuredContent(kind, contentByPath.get(file.pathname), file.pathname);
            } catch (cause) {
                cause.errors.forEach((entry) => error.push(entry.message, entry.source));
            }
        }
    }

    #verifyTemplates(files, contentByPath, error) {
        const globals = collectTemplateIds(contentByPath.get('/templates/__template-partials-bundle'));
        const compiledByPath = new Map();
        for (const file of files) {
            const value = contentByPath.get(file.pathname);
            const kind = getStructuredKind(file.pathname);
            if (kind === 'globalTemplatePartials') {
                compileBundle(value, file.pathname, globals, error);
            } else if (kind === 'baseTemplates') {
                compileBundle(value, file.pathname, globals, error);
            } else if (kind === 'pagePartials') {
                const locals = collectTemplateIds(value);
                compileBundle(value, file.pathname, new Set([ ...globals, ...locals ]), error);
            } else if (kind === 'email') {
                compileEmail(value, file.pathname, globals, error);
            } else if (isPageTemplatePath(file.pathname)) {
                compiledByPath.set(file.pathname, this.#compileTemplate(file.pathname, value, error));
            }
        }
        for (const [ pathname, compiled ] of compiledByPath) {
            const directory = pathname.slice(0, pathname.lastIndexOf('/'));
            const locals = collectTemplateIds(contentByPath.get(`${ directory }/__page-partials-bundle`));
            verifyPartialIds(compiled, new Set([ ...globals, ...locals ]), pathname, error);
        }
    }

    #compileTemplate(pathname, source, error) {
        if (typeof source !== 'string') {
            return null;
        }
        try {
            return compileHyperviewTemplate(pathname, source);
        } catch (cause) {
            error.push(`Template does not compile: ${ cause.message }`, pathname);
            return null;
        }
    }
}

async function makeGeneratedObject(pathname, text) {
    const hash = await hashBlob(text);
    return { pathname, hash, size: new TextEncoder().encode(text).byteLength, text };
}

function releaseResult(prepared) {
    const { releaseId, objectCount, totalBytes, contractVersion } = prepared;
    return { releaseId, objectCount, totalBytes, contractVersion };
}

function getStructuredKind(pathname) {
    if (pathname === '/templates/__template-partials-bundle') {
        return 'globalTemplatePartials';
    }
    if (pathname === '/templates/__base-templates-bundle') {
        return 'baseTemplates';
    }
    if (pathname.endsWith('/page.json')) {
        return 'pageMetadata';
    }
    if (pathname.endsWith('/__page-partials-bundle')) {
        return 'pagePartials';
    }
    if (pathname.endsWith('/__page-includes-bundle')) {
        return 'pageIncludes';
    }
    if (pathname.endsWith('/__email-assets')) {
        return 'email';
    }
    return null;
}

function isPageTemplatePath(pathname) {
    return pathname.startsWith('/pages/') && !getStructuredKind(pathname);
}

function collectTemplateIds(bundle) {
    return new Set(Array.isArray(bundle) ? bundle.map(({ id }) => id) : []);
}

function compileBundle(bundle, pathname, available, error) {
    if (!Array.isArray(bundle)) {
        return;
    }
    for (const template of bundle) {
        compileAndVerify(template.id, template.source, pathname, available, error);
    }
}

function compileEmail(email, pathname, globals, error) {
    if (!isPlainObject(email)) {
        return;
    }
    const locals = collectTemplateIds(email.partials);
    const available = new Set([ ...globals, ...locals ]);
    for (const template of [ email.htmlTemplate, email.textTemplate, ...(email.partials ?? []) ]) {
        if (template) {
            compileAndVerify(template.id, template.source, pathname, available, error);
        }
    }
}

function compileAndVerify(id, source, pathname, available, error) {
    try {
        const compiled = compileHyperviewTemplate(id, source);
        verifyPartialIds(compiled, available, pathname, error);
    } catch (cause) {
        error.push(`Template does not compile: ${ cause.message }`, pathname);
    }
}

function verifyPartialIds(compiled, available, pathname, error) {
    if (!compiled) {
        return;
    }
    for (const partialId of compiled.partialIds) {
        if (!available.has(partialId)) {
            error.push(`Template references missing partial "${ partialId }"`, pathname);
        }
    }
}
