import path from 'node:path';
import fsp from 'node:fs/promises';

import { assertNonEmptyString, isNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';


const MANIFEST_FILENAME = 'manifest.json';

// Cache key standing in for the flat, un-namespaced root (out-of-band deploys
// with no Build ID). A real namespace is always a non-empty string.
const NO_NAMESPACE = '';

/**
 * Reads and caches the per-build `manifest.json` that Kixx build tooling writes
 * alongside deployed static files.
 *
 * A manifest maps a logical file key to its precomputed metadata
 * (`{ etag, contentType }`), letting the Node.js static file store serve a strong
 * ETag and exact Content-Type without reading or hashing the file at request time.
 * Manifests are immutable within a build, so each namespace's manifest is read at
 * most once and cached for the process lifetime.
 *
 * Deployments that copy files out-of-band (rsync, git) have no manifest; a missing
 * or unreadable manifest degrades to an empty lookup so the store falls back to
 * on-the-fly hashing and extension-based content types.
 */
export default class ManifestStore {

    #logger = null;
    #directory = null;

    // namespace cache key -> Promise<Object> of the parsed manifest map. The
    // Promise (not the resolved value) is cached so concurrent first reads of the
    // same namespace share one filesystem read.
    #cache = new Map();

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Logger used to warn on an unreadable manifest
     * @param {string} options.directory - Filesystem directory that roots the public files and their per-namespace manifests
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assertNonEmptyString(directory, 'ManifestStore requires a directory');
        this.#logger = logger ?? null;
        this.#directory = directory;
    }

    /**
     * Looks up precomputed metadata for one file key within a namespace.
     * @param {string|null} namespace - Build ID namespace, or null/empty for the flat root
     * @param {string} key - Logical file key, such as `css/main.css`
     * @returns {Promise<{etag: (string|null), contentType: (string|null), lastModified: (string|null)}|null>}
     *   The entry's metadata (fields null when absent), or null when the manifest
     *   has no entry for the key. `lastModified` is the raw ISO string from build
     *   tooling; the caller parses it.
     */
    async lookup(namespace, key) {
        const manifest = await this.#load(namespace);
        const entry = manifest[key];

        if (!isPlainObject(entry)) {
            return null;
        }

        return {
            etag: isNonEmptyString(entry.etag) ? entry.etag : null,
            contentType: isNonEmptyString(entry.contentType) ? entry.contentType : null,
            lastModified: isNonEmptyString(entry.lastModified) ? entry.lastModified : null,
        };
    }

    #load(namespace) {
        const cacheKey = isNonEmptyString(namespace) ? namespace : NO_NAMESPACE;

        if (!this.#cache.has(cacheKey)) {
            // Drop a rejected read from the cache so a transient IO failure does
            // not permanently poison this namespace.
            const promise = this.#readManifest(cacheKey).catch((cause) => {
                this.#cache.delete(cacheKey);
                throw cause;
            });
            this.#cache.set(cacheKey, promise);
        }

        return this.#cache.get(cacheKey);
    }

    async #readManifest(cacheKey) {
        const manifestPath = path.join(this.#directory, cacheKey, MANIFEST_FILENAME);

        let text;
        try {
            text = await fsp.readFile(manifestPath, 'utf8');
        } catch (cause) {
            // No manifest is the normal case for out-of-band deployments.
            if (cause.code === 'ENOENT') {
                return {};
            }
            throw cause;
        }

        try {
            const parsed = JSON.parse(text);
            return isPlainObject(parsed) ? parsed : {};
        } catch (cause) {
            // A corrupt manifest is a deployment fault, but the ETag/Content-Type it
            // carries are optimizations: degrade to an empty lookup (on-the-fly
            // hashing) rather than failing every static request for this build.
            if (this.#logger) {
                this.#logger.warn('ignoring unparseable static file manifest', {
                    path: manifestPath,
                    error: cause.message,
                });
            }
            return {};
        }
    }
}
