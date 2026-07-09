import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
    AssertionError,
    isUndefined,
    isBoolean,
    isString,
    isNonEmptyString,
    isPlainObject,
    assert,
    assertNonEmptyString,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';
import { generateShortId } from '../../../kixx/utils/crypto.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectMeta} ObjectMeta
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectBody} ObjectBody
 * @typedef {import('../../../kixx/object-store/object-store-interface.js').ObjectList} ObjectList
 */

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex

// A bucket name or filesystem directory segment is restricted to a conservative
// filename-safe set so it maps onto a single directory without traversal.
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// R2 and S3 cap object keys at 1024 bytes; the contract adopts the same limit.
const MAX_KEY_BYTES = 1024;

// The values `list()` may be asked to populate beyond the guaranteed fields.
const INCLUDABLE_FIELDS = [ 'contentType', 'customMetadata' ];

const DEFAULT_LIST_LIMIT = 1000;
const MAX_LIST_LIMIT = 1000;

// Subdirectory of the object root that holds the SQLite manifest and staged
// temp files. Dot-prefixed so it never collides with a configured bucket
// directory (bucket names reject a leading dot).
const MANIFEST_FILENAME = '.manifest.sqlite';
const TEMP_DIRNAME = '.tmp';

// How long a write blocks waiting for another process's lock before SQLite
// raises SQLITE_BUSY. The manifest is shared across processes on the machine, so
// the busy timeout lets a contended writer retry rather than fail immediately.
const BUSY_TIMEOUT_MS = 5000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Node.js filesystem-backed object store.
 *
 * The Node.js port of the object store contract. Object bytes are stored as files
 * under `root/<bucket-directory>/<key>`, and per-object metadata
 * (`content_type`, `etag`, `content_length`, `uploaded`, `custom_metadata`) lives
 * in a SQLite manifest keyed by `(bucket, key)`, because a plain filesystem
 * cannot hold content type or custom metadata. The manifest is the authoritative
 * index: `head()` and `list()` read only the manifest, and `get()` consults the
 * manifest before opening the body file.
 *
 * Writes avoid exposing partial state: the body is streamed to a temp file while
 * its bytes are hashed and counted, the temp file is fsynced and atomically
 * renamed into place, and only then is the manifest row upserted. A crash between
 * the rename and the upsert leaves at most a benign orphan body file (no manifest
 * row, so it is invisible to the store). `delete()` removes the manifest row
 * first, then unlinks the body file, so a crash leaves at most an orphan file.
 *
 * The object root and bucket allow-list are resolved from immutable application
 * config during plugin registration and passed into the constructor. The
 * manifest connection is opened lazily in WAL mode with a busy timeout so
 * concurrent writers from other processes retry instead of failing with
 * `SQLITE_BUSY`. Body bytes never pass through SQLite, so only metadata writes
 * serialize on the manifest.
 *
 * Reads are read-after-write consistent on the local machine, satisfying the
 * contract's strong-consistency guarantee.
 *
 * @implements {import('../../../kixx/object-store/object-store-interface.js').ObjectStoreInterface}
 * @see ObjectStore in ../../cloudflare-object-store/lib/object-store.js for the Cloudflare R2 implementation
 */
export default class ObjectStore {

    #logger = null;

    #database = null;
    #ownsDatabase = false;
    #root = null;
    #buckets = null;
    #manifestPath = null;
    #tempDirectory = null;
    #sqliteOptions = null;

    #directoriesReady = false;
    #prepared = false;
    #closed = false;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create an ObjectStore child logger
     * @param {string} options.path - Object root directory
     * @param {Object} options.buckets - Bucket allow-list (`{ [bucketName]: { directory } }`)
     * @param {Object} [options.sqliteOptions] - Options forwarded to the `DatabaseSync` constructor when opening the manifest
     * @param {import('node:sqlite').DatabaseSync} [options.database] - Pre-opened manifest connection to use instead of opening one
     * @param {boolean} [options.ownsDatabase] - Whether `close()` should close the connection. Defaults to false when
     *   `database` is supplied and true otherwise.
     * @throws {AssertionError} When logger, path, or buckets are missing or invalid
     */
    constructor(options) {
        const {
            logger,
            path: root,
            buckets,
            sqliteOptions,
            database,
            ownsDatabase,
        } = options ?? {};

        assert(logger, 'ObjectStore requires a logger');
        assertNonEmptyString(root, 'ObjectStore requires a path');
        assert(isPlainObject(buckets), 'ObjectStore requires buckets');

        if (database) {
            // An injected connection is owned by the caller unless explicitly claimed.
            this.#database = database;
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : false;
        } else {
            this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : true;
        }

        this.#root = root;
        this.#buckets = this.#resolveBuckets(root, buckets);
        this.#manifestPath = path.join(root, MANIFEST_FILENAME);
        this.#tempDirectory = path.join(root, TEMP_DIRNAME);
        this.#sqliteOptions = sqliteOptions ?? {};
        this.#logger = logger.createChild('ObjectStore');
    }

    /**
     * Stores a body under `bucket`/`key`, creating or overwriting any existing
     * object.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @param {ReadableStream|ArrayBuffer|ArrayBufferView|string|Blob} body - Object body; must be non-null
     * @param {import('../../../kixx/object-store/object-store-interface.js').ObjectPutOptions} [options] - Write options
     * @returns {Promise<ObjectMeta>} Metadata for the stored object
     * @throws {AssertionError} When the bucket, key, body, or options are invalid
     */
    async put(_context, bucket, key, body, options) {
        const bucketDirectory = this.#resolveBucketDirectory(bucket);
        this.#assertValidKey(key);

        let readable;
        if (body instanceof ReadableStream) {
            readable = Readable.fromWeb(body);
        } else if (body instanceof Blob) {
            readable = Readable.fromWeb(body.stream());
        } else if (isString(body)) {
            // A single-element array yields the whole byte view as one stream
            // chunk; passing the typed array directly would stream it as bytes.
            readable = Readable.from([ textEncoder.encode(body) ]);
        } else if (body instanceof ArrayBuffer) {
            readable = Readable.from([ new Uint8Array(body) ]);
        } else if (ArrayBuffer.isView(body)) {
            // Copy only the view's own region so unrelated bytes from a shared
            // buffer are not persisted.
            readable = Readable.from([ new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) ]);
        } else {
            throw new AssertionError(
                'ObjectStore body must be a ReadableStream, Blob, ArrayBuffer, ArrayBufferView, or string',
            );
        }

        const contentType = this.#resolveContentType(options);
        const customMetadata = this.#resolveCustomMetadata(options);
        this.#logger.debug('put() writing object', { bucket, key });

        const db = this.#getDatabase();
        const filePath = this.#resolveFilePath(bucketDirectory, key);

        // Stage the body to a temp file (hashing and counting as it streams), then
        // atomically move it into place before the manifest row references it.
        const { tempPath, etag, contentLength } = await this.#writeBodyToTemp(readable);

        const uploaded = Date.now();
        try {
            await fsp.mkdir(path.dirname(filePath), { recursive: true });
            await fsp.rename(tempPath, filePath);
        } catch (cause) {
            await this.#unlinkQuietly(tempPath);
            throw new OperationalError(
                `ObjectStore failed to store object "${ bucket }/${ key }"`,
                { cause },
            );
        }

        try {
            db.prepare(`
                INSERT INTO objects (bucket, key, content_type, etag, content_length, uploaded, custom_metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bucket, key) DO UPDATE SET
                    content_type = excluded.content_type,
                    etag = excluded.etag,
                    content_length = excluded.content_length,
                    uploaded = excluded.uploaded,
                    custom_metadata = excluded.custom_metadata
            `).run(
                bucket,
                key,
                contentType ?? null,
                etag,
                contentLength,
                uploaded,
                isUndefined(customMetadata) ? null : JSON.stringify(customMetadata),
            );
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore failed to index object "${ bucket }/${ key }"`,
                { cause },
            );
        }

        return {
            key,
            contentType,
            contentLength,
            etag,
            uploaded: new Date(uploaded),
            customMetadata,
        };
    }

    /**
     * Retrieves the object body and metadata for `bucket`/`key`.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<ObjectBody|null>} The object body and metadata, or null when absent
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async get(_context, bucket, key) {
        const bucketDirectory = this.#resolveBucketDirectory(bucket);
        this.#assertValidKey(key);
        this.#logger.debug('get() loading object', { bucket, key });

        const db = this.#getDatabase();
        const row = db
            .prepare('SELECT key, content_type, etag, content_length, uploaded, custom_metadata FROM objects WHERE bucket = ? AND key = ?')
            .get(bucket, key);

        if (!row) {
            return null;
        }

        const filePath = this.#resolveFilePath(bucketDirectory, key);

        let nodeStream;
        try {
            // The manifest is authoritative; a missing body file means the store is
            // in an inconsistent state, surfaced as an operational failure.
            await fsp.stat(filePath);
            nodeStream = fs.createReadStream(filePath);
        } catch (cause) {
            throw new OperationalError(
                `ObjectStore could not open the body for "${ bucket }/${ key }"`,
                { cause },
            );
        }

        const meta = this.#rowToMeta(row);
        meta.body = Readable.toWeb(nodeStream);
        return meta;
    }

    /**
     * Retrieves only the metadata for `bucket`/`key`, without the body.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<ObjectMeta|null>} The object metadata, or null when absent
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async head(_context, bucket, key) {
        this.#resolveBucketDirectory(bucket);
        this.#assertValidKey(key);
        this.#logger.debug('head() loading metadata', { bucket, key });

        const db = this.#getDatabase();
        const row = db
            .prepare('SELECT key, content_type, etag, content_length, uploaded, custom_metadata FROM objects WHERE bucket = ? AND key = ?')
            .get(bucket, key);

        return row ? this.#rowToMeta(row) : null;
    }

    /**
     * Deletes `bucket`/`key`. Resolves with no value, and deleting an absent key
     * is a successful no-op.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} bucket - Configured bucket name
     * @param {string} key - Object key
     * @returns {Promise<void>}
     * @throws {AssertionError} When the bucket or key is invalid
     */
    async delete(_context, bucket, key) {
        const bucketDirectory = this.#resolveBucketDirectory(bucket);
        this.#assertValidKey(key);
        this.#logger.debug('delete() removing object', { bucket, key });

        const db = this.#getDatabase();
        // Remove the manifest row first so the object becomes invisible immediately;
        // a crash before the unlink leaves at most a benign orphan body file.
        db.prepare('DELETE FROM objects WHERE bucket = ? AND key = ?').run(bucket, key);

        const filePath = this.#resolveFilePath(bucketDirectory, key);
        try {
            await fsp.unlink(filePath);
        } catch (cause) {
            if (cause.code !== 'ENOENT') {
                throw new OperationalError(
                    `ObjectStore failed to delete the body for "${ bucket }/${ key }"`,
                    { cause },
                );
            }
        }
    }

    /**
     * Lists objects in `bucket`, ordered lexicographically by key.
     *
     * @param {RequestContext} _context - Request context accepted for store interface compatibility
     * @param {string} bucket - Configured bucket name
     * @param {import('../../../kixx/object-store/object-store-interface.js').ObjectListOptions} [options] - List options
     * @returns {Promise<ObjectList>} A keyset-paginated page of objects
     * @throws {AssertionError} When the bucket or options are invalid
     */
    async list(_context, bucket, options) {
        this.#resolveBucketDirectory(bucket);
        const {
            prefix,
            cursor,
            limit,
            delimiter,
            include: requestedInclude,
        } = options ?? {};

        if (!isUndefined(prefix)) {
            assert(isString(prefix), 'ObjectStore list "prefix" must be a string when provided');
        }
        if (!isUndefined(delimiter)) {
            assertNonEmptyString(delimiter, 'ObjectStore list "delimiter" must be a non-empty string when provided');
        }

        let resolvedLimit = DEFAULT_LIST_LIMIT;
        if (!isUndefined(limit)) {
            assert(
                Number.isInteger(limit) && limit > 0,
                'ObjectStore list "limit" must be a positive integer',
            );
            resolvedLimit = Math.min(limit, MAX_LIST_LIMIT);
        }

        const include = { contentType: false, customMetadata: false };
        if (!isUndefined(requestedInclude)) {
            assert(Array.isArray(requestedInclude), 'ObjectStore list "include" must be an array when provided');
            for (const field of requestedInclude) {
                assert(
                    INCLUDABLE_FIELDS.includes(field),
                    `ObjectStore list "include" must contain only ${ INCLUDABLE_FIELDS.join(', ') }`,
                );
                include[field] = true;
            }
        }

        const resolvedPrefix = prefix ?? '';
        const resolvedDelimiter = isUndefined(delimiter) ? null : delimiter;
        const startAfter = isUndefined(cursor) ? null : decodeCursor(cursor);

        this.#logger.debug('list() listing objects', {
            bucket,
            prefix: resolvedPrefix,
            delimiter: resolvedDelimiter,
        });

        const db = this.#getDatabase();

        // The query path is synchronous SQLite work; the async signature keeps the
        // method portable with the streaming adapters.
        return resolvedDelimiter
            ? this.#listGrouped(db, bucket, {
                prefix: resolvedPrefix,
                delimiter: resolvedDelimiter,
                limit: resolvedLimit,
                include,
                startAfter,
            })
            : this.#listSimple(db, bucket, {
                prefix: resolvedPrefix,
                limit: resolvedLimit,
                include,
                startAfter,
            });
    }

    /**
     * Releases the SQLite manifest connection when the store owns it. Safe to call
     * more than once.
     *
     * @returns {void}
     */
    close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;

        if (this.#ownsDatabase && this.#database) {
            this.#database.close();
        }
        this.#database = null;
        this.#prepared = false;
    }

    // Lists objects without delimiter grouping, paginating with a single
    // keyset query that over-fetches by one row to detect truncation.
    #listSimple(db, bucket, args) {
        const { prefix, limit, include, startAfter } = args;

        const conditions = [ 'bucket = ?' ];
        const params = [ bucket ];
        if (prefix) {
            conditions.push("key LIKE ? ESCAPE '\\'");
            params.push(escapeLikePrefix(prefix) + '%');
        }
        if (startAfter !== null) {
            conditions.push('key > ?');
            params.push(startAfter);
        }
        params.push(limit + 1);

        const rows = db.prepare(`
            SELECT key, content_type, etag, content_length, uploaded, custom_metadata
            FROM objects
            WHERE ${ conditions.join(' AND ') }
            ORDER BY key ASC
            LIMIT ?
        `).all(...params);

        const truncated = rows.length > limit;
        const page = truncated ? rows.slice(0, limit) : rows;

        return {
            objects: page.map((row) => this.#rowToListEntry(row, include)),
            truncated,
            cursor: truncated ? encodeCursor(page[page.length - 1].key) : undefined,
            delimitedPrefixes: [],
        };
    }

    // Lists objects with delimiter grouping. Keys sharing a prefix up to the
    // delimiter collapse into a single common prefix that counts toward `limit`.
    // Rows are scanned in key order in batches; because group members are
    // contiguous, the cursor anchor naturally advances to the last key of the
    // current group as duplicate-group members are skipped, so a resumed page
    // never re-emits a common prefix.
    #listGrouped(db, bucket, args) {
        const { prefix, delimiter, limit, include, startAfter } = args;

        const objects = [];
        const delimitedPrefixes = [];
        const seenPrefixes = new Set();
        let entryCount = 0;
        let lastAcceptedAnchor = null;
        let lowerBound = startAfter;
        let truncated = false;
        let cursor;
        let done = false;

        while (!done) {
            const rows = this.#queryListBatch(db, bucket, prefix, lowerBound, MAX_LIST_LIMIT);
            if (rows.length === 0) {
                break;
            }

            for (const row of rows) {
                const key = row.key;
                lowerBound = key;

                const remainder = key.slice(prefix.length);
                const delimiterIndex = remainder.indexOf(delimiter);

                if (delimiterIndex === -1) {
                    // A plain object entry (no delimiter after the prefix).
                    if (entryCount === limit) {
                        truncated = true;
                        cursor = encodeCursor(lastAcceptedAnchor);
                        done = true;
                        break;
                    }
                    objects.push(this.#rowToListEntry(row, include));
                    entryCount += 1;
                    lastAcceptedAnchor = key;
                    continue;
                }

                const commonPrefix = prefix + remainder.slice(0, delimiterIndex + delimiter.length);
                if (seenPrefixes.has(commonPrefix)) {
                    // Still inside an already-emitted group: extend the anchor so a
                    // resumed page starts past the whole group.
                    lastAcceptedAnchor = key;
                    continue;
                }

                if (entryCount === limit) {
                    truncated = true;
                    cursor = encodeCursor(lastAcceptedAnchor);
                    done = true;
                    break;
                }
                seenPrefixes.add(commonPrefix);
                delimitedPrefixes.push(commonPrefix);
                entryCount += 1;
                lastAcceptedAnchor = key;
            }

            // A short batch means the bucket is exhausted for this prefix.
            if (!done && rows.length < MAX_LIST_LIMIT) {
                done = true;
            }
        }

        return {
            objects,
            truncated,
            cursor,
            delimitedPrefixes,
        };
    }

    #queryListBatch(db, bucket, prefix, lowerBound, batchSize) {
        const conditions = [ 'bucket = ?' ];
        const params = [ bucket ];
        if (prefix) {
            conditions.push("key LIKE ? ESCAPE '\\'");
            params.push(escapeLikePrefix(prefix) + '%');
        }
        if (lowerBound !== null) {
            conditions.push('key > ?');
            params.push(lowerBound);
        }
        params.push(batchSize);

        return db.prepare(`
            SELECT key, content_type, etag, content_length, uploaded, custom_metadata
            FROM objects
            WHERE ${ conditions.join(' AND ') }
            ORDER BY key ASC
            LIMIT ?
        `).all(...params);
    }

    #rowToMeta(row) {
        return {
            key: row.key,
            contentType: isNonEmptyString(row.content_type) ? row.content_type : undefined,
            contentLength: row.content_length,
            etag: row.etag,
            uploaded: new Date(row.uploaded),
            customMetadata: this.#decodeCustomMetadata(row.custom_metadata),
        };
    }

    #rowToListEntry(row, include) {
        const entry = {
            key: row.key,
            contentLength: row.content_length,
            etag: row.etag,
            uploaded: new Date(row.uploaded),
        };
        if (include.contentType && isNonEmptyString(row.content_type)) {
            entry.contentType = row.content_type;
        }
        if (include.customMetadata) {
            const customMetadata = this.#decodeCustomMetadata(row.custom_metadata);
            if (!isUndefined(customMetadata)) {
                entry.customMetadata = customMetadata;
            }
        }
        return entry;
    }

    #decodeCustomMetadata(text) {
        if (!isNonEmptyString(text)) {
            return undefined;
        }
        try {
            return JSON.parse(text);
        } catch (cause) {
            // Custom metadata is written by this store, so a parse failure is a
            // manifest corruption rather than a recoverable condition.
            throw new OperationalError('ObjectStore manifest holds invalid custom metadata JSON', { cause });
        }
    }

    /**
     * Validates an object key: a non-empty string of at most 1024 bytes with no
     * control characters, no leading `/`, and no `"."` or `".."` path segment.
     * @param {string} key - Object key to validate
     * @throws {AssertionError} When the key is invalid
     */
    #assertValidKey(key) {
        assertNonEmptyString(key, 'ObjectStore key must be a non-empty string');
        if (CONTROL_CHAR_PATTERN.test(key)) {
            throw new AssertionError('ObjectStore key contains illegal control characters');
        }
        if (key.startsWith('/')) {
            throw new AssertionError('ObjectStore key must not begin with "/"');
        }
        // The limit is measured against the key's byte length, not its character length.
        if (textEncoder.encode(key).byteLength > MAX_KEY_BYTES) {
            throw new AssertionError(`ObjectStore key must not exceed ${ MAX_KEY_BYTES } bytes`);
        }
        for (const segment of key.split('/')) {
            if (segment === '.' || segment === '..') {
                throw new AssertionError('ObjectStore key must not contain a "." or ".." path segment');
            }
        }
    }

    #resolveContentType(options) {
        const contentType = options?.contentType;
        if (isUndefined(contentType)) {
            return undefined;
        }
        assertNonEmptyString(contentType, 'ObjectStore "contentType" must be a non-empty string when provided');
        return contentType;
    }

    #resolveCustomMetadata(options) {
        const customMetadata = options?.customMetadata;
        if (isUndefined(customMetadata)) {
            return undefined;
        }
        assert(isPlainObject(customMetadata), 'ObjectStore "customMetadata" must be a plain object when provided');
        for (const value of Object.values(customMetadata)) {
            assert(isString(value), 'ObjectStore "customMetadata" values must be strings');
        }
        return customMetadata;
    }

    // Streams the body to a uniquely named temp file in the object root, hashing
    // and counting bytes as it goes, then fsyncs the file. Returns the temp path
    // for the caller to rename into place or clean up.
    async #writeBodyToTemp(readable) {
        const tempPath = path.join(this.#tempDirectory, generateShortId());

        const hash = createHash('sha256');
        let contentLength = 0;

        try {
            await pipeline(
                readable,
                async function* hashAndCount(source) {
                    for await (const chunk of source) {
                        hash.update(chunk);
                        contentLength += chunk.length;
                        yield chunk;
                    }
                },
                fs.createWriteStream(tempPath),
            );

            // fsync the staged bytes before the rename so a crash cannot leave a
            // renamed-but-empty file visible to readers.
            const handle = await fsp.open(tempPath, 'r+');
            try {
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch (cause) {
            await this.#unlinkQuietly(tempPath);
            throw new OperationalError('ObjectStore failed to stage the object body', { cause });
        }

        return { tempPath, etag: hash.digest('hex'), contentLength };
    }

    async #unlinkQuietly(filePath) {
        try {
            await fsp.unlink(filePath);
        } catch {
            // Best-effort cleanup; the file may never have been created.
        }
    }

    #resolveFilePath(bucketDirectory, key) {
        const filePath = path.join(bucketDirectory, ...key.split('/'));
        // Defense in depth: even though key validation rejects traversal segments,
        // confirm the resolved path stays inside the bucket directory.
        const root = bucketDirectory + path.sep;
        if (filePath !== bucketDirectory && !filePath.startsWith(root)) {
            throw new AssertionError(`ObjectStore key "${ key }" resolves outside its bucket directory`);
        }
        return filePath;
    }

    /**
     * Resolves the configured directory for a bucket.
     * @param {string} bucket - Configured bucket name
     * @returns {string} Absolute bucket directory
     * @throws {AssertionError} When the bucket is unknown
     */
    #resolveBucketDirectory(bucket) {
        assertNonEmptyString(bucket, 'ObjectStore bucket must be a non-empty string');
        const directory = this.#buckets.get(bucket);
        assert(directory, `ObjectStore bucket "${ bucket }" is not configured`);
        return directory;
    }

    /**
     * Returns the manifest connection, opening and preparing the schema on first use.
     * @returns {import('node:sqlite').DatabaseSync} The prepared connection
     * @throws {AssertionError} When the store has been closed
     */
    #getDatabase() {
        if (this.#closed) {
            throw new AssertionError('ObjectStore has been closed');
        }

        if (!this.#directoriesReady) {
            this.#ensureStoreDirectories();
            this.#directoriesReady = true;
        }

        if (!this.#database) {
            this.#database = new DatabaseSync(this.#manifestPath, this.#sqliteOptions);
        }

        if (!this.#prepared) {
            // WAL lets readers proceed during a write and is the journaling mode
            // that makes concurrent multi-process access on local disk practical.
            this.#database.exec('PRAGMA journal_mode = WAL');
            this.#database.exec(`PRAGMA busy_timeout = ${ BUSY_TIMEOUT_MS }`);
            this.#database.exec(`
                CREATE TABLE IF NOT EXISTS objects (
                    bucket          TEXT NOT NULL,
                    key             TEXT NOT NULL,
                    content_type    TEXT,
                    etag            TEXT NOT NULL,
                    content_length  INTEGER NOT NULL,
                    uploaded        INTEGER NOT NULL,
                    custom_metadata TEXT,
                    PRIMARY KEY (bucket, key)
                )
            `);
            this.#logger.debug('prepared object store manifest database');
            this.#prepared = true;
        }
        return this.#database;
    }

    #resolveBuckets(root, bucketsConfig) {
        const buckets = new Map();
        for (const [ name, conf ] of Object.entries(bucketsConfig)) {
            this.#assertSafeSegment(name, `ObjectStore bucket name "${ name }"`);
            const directoryName = (isPlainObject(conf) && isNonEmptyString(conf.directory))
                ? conf.directory
                : name;
            this.#assertSafeSegment(directoryName, `ObjectStore bucket directory "${ directoryName }"`);
            buckets.set(name, path.join(root, directoryName));
        }
        return buckets;
    }

    #ensureStoreDirectories() {
        // The root, temp, and bucket directories must exist before the manifest
        // is opened or a body is staged. Creation is idempotent.
        try {
            fs.mkdirSync(this.#tempDirectory, { recursive: true });
            for (const directory of this.#buckets.values()) {
                fs.mkdirSync(directory, { recursive: true });
            }
        } catch (cause) {
            throw new OperationalError(`Unable to create object store directory under ${ this.#root }`, { cause });
        }
    }

    #assertSafeSegment(segment, label) {
        assertNonEmptyString(segment, `${ label } must be a non-empty string`);
        if (segment === '.' || segment === '..' || !SAFE_SEGMENT_PATTERN.test(segment)) {
            throw new AssertionError(`${ label } must be a safe directory name`);
        }
    }

}

// Escapes the LIKE wildcards (`%`, `_`) and the escape character itself so a
// caller-supplied prefix is matched literally under `ESCAPE '\'`.
function escapeLikePrefix(prefix) {
    return prefix.replace(/[\\%_]/g, (char) => '\\' + char);
}

// Cursors are opaque resume tokens: the last returned key encoded as URL-safe
// base64. btoa/atob operate on binary strings, so the key's UTF-8 bytes are
// mapped to and from a latin1 string around them.
function encodeCursor(key) {
    const bytes = textEncoder.encode(key);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor) {
    assertNonEmptyString(cursor, 'ObjectStore list "cursor" must be a non-empty string when provided');
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');

    let binary;
    try {
        binary = atob(base64);
    } catch {
        throw new AssertionError('ObjectStore list "cursor" is not a valid cursor');
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    const decoded = textDecoder.decode(bytes);
    if (decoded.length === 0) {
        throw new AssertionError('ObjectStore list "cursor" is not a valid cursor');
    }
    return decoded;
}
