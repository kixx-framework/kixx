import path from 'node:path';
import fsp from 'node:fs/promises';

import {
    AssertionError,
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';


/**
 * Reserved subtree, relative to a namespace root, that holds one metadata sidecar
 * per asset. The static file store keeps this prefix out of the servable key
 * space so the sidecars are never served as assets themselves.
 * @type {string}
 */
export const METADATA_DIRNAME = '.meta';

// Cache key fragment standing in for the flat, un-namespaced root (out-of-band
// deploys with no Build ID). A real namespace is always a non-empty string.
const NO_NAMESPACE = '';

/**
 * Reads and writes one metadata sidecar per static asset.
 *
 * Each asset's precomputed validators (`{ etag, contentType, lastModified }`) live
 * in their own JSON file under a reserved `.meta/` subtree that mirrors the asset
 * key layout: asset `css/main.css` in namespace `B` has its metadata at
 * `<root>/B/.meta/css/main.css.json`. This lets the Node.js static file store serve
 * a strong ETag, exact Content-Type, and replica-stable Last-Modified without
 * reading or hashing the asset at request time.
 *
 * Because each asset owns a separate file, there is no shared index to serialize:
 * the deploy-time write path writes disjoint files, so concurrent publishes never
 * race on an index, and two writers of the same key write byte-identical validators
 * (the ETag is derived from the content). Each asset's metadata is read at most
 * once and cached for the process lifetime.
 *
 * Deployments that copy files out-of-band (rsync, git) write no sidecar; a missing
 * or unreadable sidecar degrades to a null lookup so the store falls back to
 * on-the-fly hashing and extension-based content types for that one asset.
 */
export default class AssetMetadataStore {

    #logger = null;
    #directory = null;

    // `${namespace}\n${key}` -> Promise<Object|null> of the parsed metadata. The
    // Promise (not the resolved value) is cached so concurrent first reads of the
    // same asset share one filesystem read, and a later read avoids touching disk.
    #cache = new Map();

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Logger used to warn on an unreadable sidecar
     * @param {string} options.directory - Filesystem directory that roots the public files and their per-namespace `.meta` subtrees
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assertNonEmptyString(directory, 'AssetMetadataStore requires a directory');
        this.#logger = logger ?? null;
        this.#directory = directory;
    }

    /**
     * Looks up precomputed metadata for one asset key within a namespace.
     * @param {string|null} namespace - Build ID namespace, or null/empty for the flat root
     * @param {string} key - Logical file key, such as `css/main.css`
     * @returns {Promise<{etag: (string|null), contentType: (string|null), lastModified: (string|null)}|null>}
     *   The asset's metadata (fields null when absent), or null when no sidecar
     *   exists. `lastModified` is the raw ISO string; the caller parses it.
     */
    async lookup(namespace, key) {
        assertNonEmptyString(key, 'AssetMetadataStore.lookup requires a key');

        const metadata = await this.#load(namespace, key);

        if (!isPlainObject(metadata)) {
            return null;
        }

        return {
            etag: isNonEmptyString(metadata.etag) ? metadata.etag : null,
            contentType: isNonEmptyString(metadata.contentType) ? metadata.contentType : null,
            lastModified: isNonEmptyString(metadata.lastModified) ? metadata.lastModified : null,
        };
    }

    /**
     * Inserts or replaces one asset's metadata sidecar, persisting it atomically
     * and updating the in-process cache so a later `lookup()` observes it without a
     * process restart.
     *
     * Writes to different assets touch different files, so no cross-asset
     * serialization is needed; a concurrent write to the same asset writes the same
     * validators and is last-writer-wins on a single atomic rename.
     *
     * @param {string|null} namespace - Build ID namespace, or null/empty for the flat root
     * @param {string} key - Logical file key, such as `css/main.css`
     * @param {Object} metadata - Precomputed validators to store for the asset
     * @param {string} metadata.etag - Strong (quoted) validator for the file contents
     * @param {string} metadata.contentType - Resolved media type
     * @param {string} metadata.lastModified - ISO last-modified timestamp
     * @returns {Promise<void>}
     */
    async write(namespace, key, metadata) {
        assertNonEmptyString(key, 'AssetMetadataStore.write requires a key');

        const entry = {
            etag: metadata.etag ?? null,
            contentType: metadata.contentType ?? null,
            lastModified: metadata.lastModified ?? null,
        };

        await this.#writeMetadataAtomically(namespace, key, entry);

        // Publish the entry so a same-process lookup() observes it immediately,
        // matching the read-after-write a publishing client expects.
        this.#cache.set(this.#cacheKeyFor(namespace, key), Promise.resolve(entry));
    }

    #cacheKeyFor(namespace, key) {
        const namespaceKey = isNonEmptyString(namespace) ? namespace : NO_NAMESPACE;
        return `${ namespaceKey }\n${ key }`;
    }

    #resolveMetadataPath(namespace, key) {
        const namespaceRoot = isNonEmptyString(namespace)
            ? path.join(this.#directory, namespace)
            : this.#directory;

        const metadataRoot = path.join(namespaceRoot, METADATA_DIRNAME);
        const metadataPath = path.resolve(metadataRoot, `${ key }.json`);

        // Defense in depth: the store already rejects keys that escape the public
        // root, but the sidecar path also embeds the key, so confirm it stays within
        // the reserved .meta subtree. A violation here is a programmer error.
        if (metadataPath !== metadataRoot
            && !metadataPath.startsWith(metadataRoot + path.sep)) {
            throw new AssertionError(
                'AssetMetadataStore rejected a key that escapes the metadata root',
            );
        }

        return metadataPath;
    }

    #load(namespace, key) {
        const cacheKey = this.#cacheKeyFor(namespace, key);

        if (!this.#cache.has(cacheKey)) {
            // Drop a rejected read from the cache so a transient IO failure does
            // not permanently poison this asset.
            const promise = this.#readMetadata(namespace, key).catch((cause) => {
                this.#cache.delete(cacheKey);
                throw cause;
            });
            this.#cache.set(cacheKey, promise);
        }

        return this.#cache.get(cacheKey);
    }

    async #readMetadata(namespace, key) {
        const metadataPath = this.#resolveMetadataPath(namespace, key);

        let text;
        try {
            text = await fsp.readFile(metadataPath, 'utf8');
        } catch (cause) {
            // No sidecar is the normal case for out-of-band deployments and any
            // asset written without one.
            if (cause.code === 'ENOENT') {
                return null;
            }
            throw cause;
        }

        try {
            const parsed = JSON.parse(text);
            return isPlainObject(parsed) ? parsed : null;
        } catch (cause) {
            // A corrupt sidecar is a deployment fault, but the validators it carries
            // are optimizations: degrade to on-the-fly hashing for this one asset
            // rather than failing its request.
            if (this.#logger) {
                this.#logger.warn('ignoring unparseable static file metadata', {
                    path: metadataPath,
                    error: cause.message,
                });
            }
            return null;
        }
    }

    async #writeMetadataAtomically(namespace, key, entry) {
        const metadataPath = this.#resolveMetadataPath(namespace, key);
        const directory = path.dirname(metadataPath);

        // The sidecar's parent may not exist yet (first write into a staged build,
        // or a nested key), so ensure the directory tree is present.
        await fsp.mkdir(directory, { recursive: true });

        // Write to a uniquely named temp file in the same directory, then rename
        // over the target. rename is atomic within a filesystem, so a concurrent
        // reader never observes a half-written sidecar.
        const tempPath = `${ metadataPath }.${ crypto.randomUUID() }.tmp`;
        const json = JSON.stringify(entry, null, 4);

        try {
            await fsp.writeFile(tempPath, json, 'utf8');
            await fsp.rename(tempPath, metadataPath);
        } catch (cause) {
            // Best-effort cleanup if the write or rename failed partway through.
            await fsp.rm(tempPath, { force: true }).catch(() => {});
            throw cause;
        }
    }
}
