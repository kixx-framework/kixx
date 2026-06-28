import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

import { getContentType } from '../../../kixx/static-file-server/mime-types.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';
import {
    AssertionError,
    assert,
    assertFunction,
    assertNonEmptyString,
    isNonEmptyString,
    isUndefined,
    isValidDate,
} from '../../../kixx/assertions/mod.js';
import ManifestStore from './manifest.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileResult} StaticFileResult
 */

/**
 * Node.js filesystem-backed static file store.
 *
 * The Node.js port of the static file store contract. Where the Cloudflare adapter
 * resolves a KV binding from each request `context`, this adapter resolves its
 * public root directory from `context.config.env.STATIC_FILE_STORE.directory`
 * and `context.config.resolveFilepath()` on first `read()` unless an explicit
 * constructor `directory` was supplied. The resolved root directory is fixed for
 * the lifetime of the store: a later request that resolves a different root is a
 * programmer error and throws an `AssertionError`. It maps a `key` (and optional
 * Build ID `namespace`) onto a real filesystem path.
 *
 * `read()` returns a {@link StaticFileResult} whose body streams the file from
 * disk. Content-Type and ETag come from the per-build `manifest.json` when present;
 * otherwise Content-Type is derived from the file extension and the ETag is hashed
 * on the fly (cached per file version) when the caller requests one. Missing files,
 * directories, and any path that resolves outside the public root resolve to `null`.
 *
 * @implements {import('../../../kixx/static-file-server/static-file-server-store-interface.js').StaticFileStoreInterface}
 * @see StaticFileStore in ../../cloudflare-static-file-server/lib/static-file-server-store.js for the Cloudflare Workers implementation
 */
export default class StaticFileStore {

    #logger = null;

    // An explicit constructor root (already path.resolve'd), or null when the
    // root comes from request config. Fixed for the lifetime of the store.
    #rootDirectory = null;

    // The root directory resolved from request config, locked on first read.
    // Only used when no explicit constructor `directory` was supplied.
    #resolvedRootDirectory = null;

    // The single manifest store for this store's (fixed) root, created lazily.
    #manifest = null;

    // `${namespace}\n${key}\n${mtimeMs}\n${size}` -> etag. Keyed by file version
    // so a redeploy never serves a stale hash, while repeat reads of an unchanged
    // file avoid re-hashing. The root directory is fixed, so it is not part of the key.
    #etagCache = new Map();

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a StaticFileStore child logger
     * @param {string} [options.directory] - Filesystem directory override that roots the public files
     * @throws {AssertionError} When logger is not provided, or when `directory` is supplied but empty
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assert(logger, 'StaticFileStore requires a logger');
        if (!isUndefined(directory)) {
            assertNonEmptyString(directory, 'StaticFileStore directory must be a non-empty string when provided');
        }
        this.#logger = logger.createChild('StaticFileStore');
        // Resolve explicit constructor roots once; request-config roots are
        // resolved in read() because the request context owns that configuration.
        this.#rootDirectory = isUndefined(directory) ? null : path.resolve(directory);
    }

    /**
     * Reads one file by its key within an optional Build ID namespace.
     *
     * @param {RequestContext} context - Request context used to resolve Node request config
     * @param {Object} options - Lookup options
     * @param {string} options.key - File key relative to the namespace root, such as `css/main.css`
     * @param {string|null} options.namespace - Build ID namespace, or null for the flat root
     * @param {boolean} options.computeEtag - Whether to hash the file for an ETag when the manifest has none
     * @returns {Promise<StaticFileResult|null>} The file parts, or `null` when no file exists
     */
    async read(context, options) {
        const { key, namespace, computeEtag } = options ?? {};
        assertNonEmptyString(key, 'StaticFileStore read requires a key');
        const rootDirectory = this.#resolveRootDirectory(context);

        // Namespace (Build ID) selects a subtree; an absent namespace serves from
        // the flat root, supporting out-of-band deploys with no Build ID.
        const namespaceRoot = isNonEmptyString(namespace)
            ? path.join(rootDirectory, namespace)
            : rootDirectory;

        const resolvedPath = path.resolve(namespaceRoot, key);

        // Defense in depth: even though callers validate the key, refuse to serve
        // anything that resolves outside the public root. A path is in-root only if
        // it equals the root or sits beneath it past a separator.
        if (resolvedPath !== rootDirectory
            && !resolvedPath.startsWith(rootDirectory + path.sep)) {
            this.#logger.debug('read() rejected path outside public root', { key, namespace });
            return null;
        }

        let stats;
        try {
            stats = await fsp.stat(resolvedPath);
        } catch (cause) {
            // A missing file, or a path segment that is not a directory, is an
            // ordinary "not found" — every other stat failure is a real fault and
            // is left to propagate.
            if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') {
                this.#logger.debug('read() file not found', { key, namespace });
                return null;
            }
            throw cause;
        }

        // Only regular files are served; directories and special files are misses.
        if (!stats.isFile()) {
            this.#logger.debug('read() path is not a file', { key, namespace });
            return null;
        }

        const manifestEntry = await this.#getManifest(rootDirectory).lookup(namespace, key);

        // Manifest Content-Type wins (it was chosen at build time); fall back to
        // extension-based detection for out-of-band deploys.
        const contentType = manifestEntry?.contentType ?? getContentType(key);

        const { etag, body } = await this.#resolveEtagAndBody({
            resolvedPath,
            key,
            namespace,
            stats,
            manifestEtag: manifestEntry?.etag ?? null,
            computeEtag: computeEtag === true,
        });

        return {
            body,
            contentType,
            // Content-Length is the file's byte size from stat, so the value is
            // exact even for multi-byte file contents.
            contentLength: stats.size,
            etag,
            lastModified: resolveLastModified(manifestEntry?.lastModified, stats.mtime),
        };
    }

    #resolveRootDirectory(context) {
        // An explicit constructor root is fixed and never read from config.
        if (this.#rootDirectory) {
            return this.#rootDirectory;
        }

        const rootDirectory = this.#resolveRootDirectoryFromConfig(context);

        if (this.#resolvedRootDirectory === null) {
            // First read locks the root directory for the lifetime of the store.
            this.#resolvedRootDirectory = rootDirectory;
        } else if (rootDirectory !== this.#resolvedRootDirectory) {
            // The configured root is expected to be constant; a change means the
            // application is misconfigured, which is a programmer error.
            throw new AssertionError(
                `StaticFileStore root directory must not change after it is set (was "${ this.#resolvedRootDirectory }", got "${ rootDirectory }")`,
            );
        }

        return this.#resolvedRootDirectory;
    }

    #resolveRootDirectoryFromConfig(context) {
        const config = context?.config;
        const storeConfig = config?.env?.STATIC_FILE_STORE;
        assertNonEmptyString(
            storeConfig?.directory,
            'StaticFileStore requires context.config.env.STATIC_FILE_STORE.directory',
        );
        assertFunction(
            config?.resolveFilepath,
            'StaticFileStore requires context.config.resolveFilepath',
        );

        const rootDirectory = config.resolveFilepath(storeConfig.directory);
        assertNonEmptyString(
            rootDirectory,
            'StaticFileStore context.config.resolveFilepath() must return a non-empty string',
        );

        return path.resolve(rootDirectory);
    }

    #getManifest(rootDirectory) {
        // The root directory is fixed for the store's lifetime, so a single
        // manifest store is created lazily on first use and reused thereafter.
        if (!this.#manifest) {
            this.#manifest = new ManifestStore({
                logger: this.#logger,
                directory: rootDirectory,
            });
        }
        return this.#manifest;
    }

    async #resolveEtagAndBody(args) {
        const {
            resolvedPath,
            key,
            namespace,
            stats,
            manifestEtag,
            computeEtag,
        } = args;

        // A build-tool-provided ETag is authoritative and needs no file read.
        if (manifestEtag) {
            return { etag: manifestEtag, body: streamFromDisk(resolvedPath) };
        }

        if (!computeEtag) {
            return { etag: null, body: streamFromDisk(resolvedPath) };
        }

        const cacheKey = `${ namespace ?? '' }\n${ key }\n${ stats.mtimeMs }\n${ stats.size }`;
        const cachedEtag = this.#etagCache.get(cacheKey);

        // With a cached hash there is no need to buffer the file just to hash it;
        // stream straight from disk and reuse the validator.
        if (cachedEtag) {
            return { etag: cachedEtag, body: streamFromDisk(resolvedPath) };
        }

        // No cached hash: read the bytes once, hash them, and serve those same
        // bytes as the body so the file is not read twice on a cache miss.
        const bytes = await fsp.readFile(resolvedPath);
        const etag = `"${ await sha256Hex(bytes) }"`;
        this.#etagCache.set(cacheKey, etag);

        return { etag, body: streamFromBytes(bytes) };
    }
}

function resolveLastModified(manifestLastModified, mtime) {
    // Prefer the build tool's canonical timestamp so every replica reports the
    // same Last-Modified; file mtimes diverge across servers (git checkout and
    // untimed rsync rewrite them), which would thrash conditional-request caches.
    // Fall back to the file mtime for out-of-band deploys and a malformed value.
    if (manifestLastModified) {
        const parsed = new Date(manifestLastModified);
        if (isValidDate(parsed)) {
            return parsed;
        }
    }

    return mtime;
}

function streamFromDisk(resolvedPath) {
    // Stream the file rather than buffering it so large assets do not load fully
    // into memory. Readable.toWeb adapts the Node stream to the Web ReadableStream
    // body that a StaticFileResult requires.
    return Readable.toWeb(fs.createReadStream(resolvedPath));
}

function streamFromBytes(bytes) {
    return Readable.toWeb(Readable.from(bytes));
}
