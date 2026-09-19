import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
    AssertionError,
    assert,
    assertArray,
    assertNonEmptyString,
    isBoolean,
    isPlainObject,
    isString,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';
import { BUILD_ASSIGNMENT_OUTCOME } from '../../../kixx/content-addressable-store/content-store-interface.js';
import TraceLogger from '../../../kixx/logger/trace-logger.js';

const BUSY_TIMEOUT_MS = 5000;
const SCHEMA_VERSION = 2;
const GET_FILE_TYPES = [ 'text', 'arrayBuffer', 'stream' ];
const GET_FILES_TYPES = [ 'text' ];
const BULK_FILE_LIMIT = 100;
const STREAM_CHUNK_SIZE = 64 * 1024;

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/; // eslint-disable-line no-control-regex

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Node.js filesystem and SQLite-backed content store.
 *
 * Blob bytes are immutable files under `format-<format>/blobs`, while SQLite
 * stores immutable index closures and mutable build pointers. Publication uses
 * an atomic hard-link and directory synchronization, so this adapter requires
 * local storage that supports both operations. Network filesystems are not
 * supported. The process umask controls filesystem permissions.
 *
 * @implements {import('../../../kixx/content-addressable-store/content-store-interface.js').ContentStoreInterface}
 * @see ContentStore in ../../cloudflare-content-store/lib/content-store.js for the Cloudflare implementation
 */
export default class ContentStore {

    #logger;
    #formatDirectory;
    #blobDirectory;
    #databasePath;
    #sqliteOptions;
    #database = null;
    #ownsDatabase;
    #initialized = false;
    #initialization = null;
    #closed = false;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create an adapter child logger
     * @param {string} options.rootDirectory - Resolved directory containing all content-store formats
     * @param {number} options.format - Positive integer content-addressing format
     * @param {Object} [options.sqliteOptions] - Options forwarded when opening SQLite
     * @param {import('node:sqlite').DatabaseSync} [options.database] - Pre-opened SQLite connection
     * @param {boolean} [options.ownsDatabase] - Whether close() closes an injected connection
     */
    constructor(options) {
        const {
            logger,
            rootDirectory,
            format,
            sqliteOptions,
            database,
            ownsDatabase,
        } = options ?? {};

        assert(logger, 'NodeContentStore requires a logger');
        assertNonEmptyString(rootDirectory, 'NodeContentStore requires a rootDirectory');
        assert(Number.isInteger(format) && format > 0, 'NodeContentStore requires a positive-integer format');

        this.#formatDirectory = path.join(rootDirectory, `format-${ format }`);
        this.#blobDirectory = path.join(this.#formatDirectory, 'blobs');
        this.#databasePath = path.join(this.#formatDirectory, 'index.sqlite');
        this.#sqliteOptions = sqliteOptions ?? {};
        this.#database = database ?? null;
        this.#ownsDatabase = isBoolean(ownsDatabase) ? ownsDatabase : !database;
        this.#logger = logger.createChild('NodeContentStore');
    }

    /**
     * Retrieves the closure currently assigned to a build.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string} buildId - Build identifier
     * @returns {Promise<{rootHash: string, entries: Object}|null>} The assigned root hash and its encoded index table, or null when the build is not registered
     */
    async getBuild(context, buildId) {
        this.#assertOpen();
        assertNonEmptyString(buildId, 'NodeContentStore#getBuild: buildId');

        const trace = new TraceLogger(context.logger, 'content-store-get-build', { buildId });
        const database = await this.#getTracedDatabase(context, trace);
        let row;
        try {
            row = database.prepare(`
                SELECT builds.root_hash AS root_hash, closures.entries_json
                FROM builds
                JOIN closures ON closures.root_hash = builds.root_hash
                WHERE builds.build_id = ?
            `).get(buildId);
            trace.ok();
        } catch (cause) {
            trace.error();
            throw new OperationalError(`NodeContentStore failed to load build "${ buildId }"`, { cause });
        }

        if (!row) {
            return null;
        }

        let entries;
        try {
            entries = JSON.parse(row.entries_json);
        } catch (cause) {
            throw new AssertionError(`NodeContentStore stored corrupt index JSON for BUILD_ID ${ buildId }`, { cause });
        }

        return { rootHash: row.root_hash, entries };
    }

    async getIndex(context, rootHash) {
        this.#assertOpen();
        this.#assertValidHash(rootHash, 'NodeContentStore#getIndex: rootHash');

        const trace = new TraceLogger(context.logger, 'content-store-get-index', { rootHash });
        const database = await this.#getTracedDatabase(context, trace);
        let row;
        try {
            row = database.prepare('SELECT entries_json FROM closures WHERE root_hash = ?').get(rootHash);
            trace.ok();
        } catch (err) {
            trace.error();
            throw err;
        }
        return row ? JSON.parse(row.entries_json) : null;
    }

    /**
     * Retrieves build pointer metadata without loading closure entries.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string} buildId - Build identifier
     * @returns {Promise<({rootHash: string, assignedAt: string}|null)>} Pointer metadata, or null when unassigned
     */
    async getBuildPointer(context, buildId) {
        this.#assertOpen();
        assertNonEmptyString(buildId, 'NodeContentStore#getBuildPointer: buildId');

        const trace = new TraceLogger(context.logger, 'content-store-get-build-pointer', { buildId });
        const database = await this.#getTracedDatabase(context, trace);
        try {
            const row = database.prepare('SELECT root_hash, assigned_at FROM builds WHERE build_id = ?').get(buildId);
            trace.ok();
            return row ? { rootHash: row.root_hash, assignedAt: row.assigned_at } : null;
        } catch (cause) {
            trace.error();
            throw new OperationalError(`NodeContentStore failed to load build pointer "${ buildId }"`, { cause });
        }
    }

    /**
     * Lists every build pointer newest assignment first.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @returns {Promise<Array<{buildId: string, rootHash: string, assignedAt: string}>>} Registered build pointers
     */
    async listBuilds(context) {
        this.#assertOpen();

        const trace = new TraceLogger(context.logger, 'content-store-list-builds');
        const database = await this.#getTracedDatabase(context, trace);
        try {
            const rows = database.prepare(`
                SELECT build_id, root_hash, assigned_at
                FROM builds
                ORDER BY assigned_at DESC, build_id ASC
            `).all();
            trace.ok();
            return rows.map((row) => ({
                buildId: row.build_id,
                rootHash: row.root_hash,
                assignedAt: row.assigned_at,
            }));
        } catch (cause) {
            trace.error();
            throw new OperationalError('NodeContentStore failed to list build pointers', { cause });
        }
    }

    /**
     * Retrieves a content-addressed blob in the requested representation.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {'text'|'arrayBuffer'|'stream'} type - Representation to return
     * @param {string} _pathname - Logical pathname ignored because hash is the address
     * @param {string} hash - Content hash
     * @returns {Promise<string|ArrayBuffer|ReadableStream|null>} Blob value, or null when absent
     */
    async getFile(context, type, pathname, hash) {
        this.#assertOpen();
        assertValidType(type, 'getFile', GET_FILE_TYPES);
        this.#assertValidHash(hash, 'NodeContentStore#getFile: hash');
        const filePath = this.#filePathForHash(hash);

        const trace = new TraceLogger(context.logger, 'content-store-get-file', { pathname, hash });
        await this.#initialize(context);

        if (type === 'stream') {
            const res = await this.#openStream(filePath, hash);
            trace.ok();
            return res;
        }

        let bytes;
        try {
            bytes = await fsp.readFile(filePath);
            trace.ok();
        } catch (cause) {
            trace.error();
            if (cause.code === 'ENOENT') {
                return null;
            }
            throw new OperationalError(`NodeContentStore failed to read blob "${ hash }"`, { cause });
        }

        if (type === 'text') {
            return textDecoder.decode(bytes);
        }
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }

    /**
     * Stores immutable blob bytes under their caller-provided hash.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string} _pathname - Logical pathname ignored because hash is the address
     * @param {string} hash - Content hash
     * @param {string|ArrayBuffer} blob - UTF-8 text or bytes to store
     * @returns {Promise<number>} Payload byte length
     */
    async putFile(context, pathname, hash, blob) {
        this.#assertOpen();
        this.#assertValidHash(hash, 'NodeContentStore#putFile: hash');
        assert(isString(blob) || blob instanceof ArrayBuffer, 'NodeContentStore#putFile: blob must be a string or an ArrayBuffer');

        const bytes = isString(blob) ? textEncoder.encode(blob) : new Uint8Array(blob);
        const shardDirectory = this.#shardDirectoryForHash(hash);
        const filePath = this.#filePathForHash(hash);

        const trace = new TraceLogger(context.logger, 'content-store-put-file', { pathname, hash });
        await this.#initialize(context);

        try {
            await fsp.mkdir(shardDirectory, { recursive: true });
        } catch (cause) {
            trace.error();
            throw new OperationalError(`NodeContentStore failed to create blob shard for "${ hash }"`, { cause });
        }

        if (await this.#fileExists(filePath, hash)) {
            await this.#syncDirectory(shardDirectory, hash);
            trace.ok();
            return bytes.byteLength;
        }

        const temporaryPath = path.join(shardDirectory, `.${ hash }.${ randomUUID() }.tmp`);
        try {
            const handle = await fsp.open(temporaryPath, 'wx');
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }

            try {
                await fsp.link(temporaryPath, filePath);
            } catch (cause) {
                if (cause.code !== 'EEXIST') {
                    throw cause;
                }
            }

            await this.#syncDirectory(shardDirectory, hash);
        } catch (cause) {
            trace.error();
            await this.#removeTemporaryFile(temporaryPath, hash);
            if (cause.name === 'OperationalError') {
                throw cause;
            }
            throw new OperationalError(`NodeContentStore failed to publish blob "${ hash }"`, { cause });
        }

        await this.#removePublishedTemporaryFile(temporaryPath, hash);
        trace.ok();
        return bytes.byteLength;
    }

    /**
     * Retrieves text blobs in the exact order requested.
     * @param {Object} context - Request context accepted for interface compatibility
     * @param {'text'} type - Required text representation
     * @param {Array<{hash: string}>} files - Blob descriptors
     * @returns {Promise<Array<string|null>>} Positional text results
     */
    async getFiles(context, type, files) {
        this.#assertOpen();
        assertValidType(type, 'getFiles', GET_FILES_TYPES);
        assertArray(files, 'NodeContentStore#getFiles: files');
        for (const [ index, file ] of files.entries()) {
            assert(isPlainObject(file), `NodeContentStore#getFiles: files[${ index }] must be a plain object`);
            this.#assertValidHash(file.hash, `NodeContentStore#getFiles: files[${ index }].hash`);
        }
        assert(files.length <= BULK_FILE_LIMIT, `NodeContentStore#getFiles() accepts at most ${ BULK_FILE_LIMIT } files; received ${ files.length }`);

        const trace = new TraceLogger(context.logger, 'content-store-get-files', { type });
        const promises = files.map(({ hash }) => this.getFile(context, type, '', hash));

        try {
            const res = await Promise.all(promises);
            trace.ok();
            return res;
        } catch (err) {
            trace.error();
            throw err;
        }
    }

    /**
     * Reports stored blob sizes without reading their payloads.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string[]} hashes - Content hashes to inspect
     * @returns {Promise<Array<({size: number}|null)>>} Positional metadata results
     */
    async statFiles(context, hashes) {
        this.#assertOpen();
        assertArray(hashes, 'NodeContentStore#statFiles: hashes');
        for (const [ index, hash ] of hashes.entries()) {
            this.#assertValidHash(hash, `NodeContentStore#statFiles: hashes[${ index }]`);
        }
        assert(hashes.length <= BULK_FILE_LIMIT, `NodeContentStore#statFiles() accepts at most ${ BULK_FILE_LIMIT } hashes; received ${ hashes.length }`);

        const trace = new TraceLogger(context.logger, 'content-store-stat-files');
        await this.#initialize(context);

        const promises = hashes.map(async (hash) => {
            try {
                const stat = await fsp.stat(this.#filePathForHash(hash));
                return { size: stat.size };
            } catch (cause) {
                if (cause.code === 'ENOENT') {
                    return null;
                }
                throw new OperationalError(`NodeContentStore failed to inspect blob "${ hash }"`, { cause });
            }
        });

        try {
            const res = await Promise.all(promises);
            trace.ok();
            return res;
        } catch (err) {
            trace.error();
            throw err;
        }
    }

    /**
     * Saves an immutable encoded index closure if its root is not already present.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string} rootHash - Root hash identifying the closure
     * @param {Object} entries - Framework-validated encoded index table
     * @returns {Promise<void>}
     */
    async saveIndex(context, rootHash, entries) {
        this.#assertOpen();
        this.#assertValidHash(rootHash, 'NodeContentStore#saveIndex: rootHash');
        assert(isPlainObject(entries), 'NodeContentStore#saveIndex: entries must be a plain object');

        let entriesJson;
        try {
            entriesJson = JSON.stringify(entries);
        } catch (cause) {
            throw new AssertionError('NodeContentStore#saveIndex: entries must be JSON serializable', { cause });
        }

        const trace = new TraceLogger(context.logger, 'content-store-save-index', { rootHash });
        const database = await this.#getTracedDatabase(context, trace);
        try {
            database.prepare('INSERT OR IGNORE INTO closures (root_hash, entries_json) VALUES (?, ?)').run(rootHash, entriesJson);
            trace.ok();
        } catch (cause) {
            trace.error();
            throw new OperationalError(`NodeContentStore failed to save closure "${ rootHash }"`, { cause });
        }
    }

    /**
     * Atomically assigns a build to a previously saved closure, optionally
     * only when the build's stored pointer still equals `expectedRootHash`.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string} buildId - Build identifier
     * @param {{rootHash: string, expectedRootHash?: (string|null)}} assignment - Desired closure and optional pointer precondition
     * @returns {Promise<import('../../../kixx/content-addressable-store/content-store-interface.js').ContentBuildAssignmentResult>}
     */
    async assignBuild(context, buildId, assignment) {
        this.#assertOpen();
        assertNonEmptyString(buildId, 'NodeContentStore#assignBuild: buildId');
        assert(isPlainObject(assignment), 'NodeContentStore#assignBuild: assignment must be a plain object');

        const { rootHash, expectedRootHash } = assignment;
        this.#assertValidHash(rootHash, 'NodeContentStore#assignBuild: rootHash');
        if (expectedRootHash !== undefined && expectedRootHash !== null) {
            this.#assertValidHash(expectedRootHash, 'NodeContentStore#assignBuild: expectedRootHash');
        }

        const trace = new TraceLogger(context.logger, 'content-store-assign-build', { buildId, rootHash, expectedRootHash });
        const database = await this.#getTracedDatabase(context, trace);
        try {

            const res = this.#assignBuildAtomically(database, buildId, rootHash, expectedRootHash);
            trace.ok();
            return res;
        } catch (err) {
            trace.error();
            throw err;
        }
    }

    #assignBuildAtomically(database, buildId, rootHash, expectedRootHash) {
        let began = false;
        try {
            database.exec('BEGIN IMMEDIATE');
            began = true;

            const closure = database.prepare('SELECT 1 FROM closures WHERE root_hash = ?').get(rootHash);
            if (!closure) {
                database.exec('COMMIT');
                began = false;
                return { outcome: BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE };
            }

            const current = database.prepare(
                'SELECT root_hash, assigned_at FROM builds WHERE build_id = ?',
            ).get(buildId);
            const currentRootHash = current?.root_hash ?? null;
            if (expectedRootHash !== undefined && expectedRootHash !== currentRootHash) {
                database.exec('COMMIT');
                began = false;
                return { outcome: BUILD_ASSIGNMENT_OUTCOME.CONFLICT };
            }

            if (currentRootHash === rootHash) {
                const pointer = { rootHash: current.root_hash, assignedAt: current.assigned_at };
                database.exec('COMMIT');
                began = false;
                return {
                    outcome: BUILD_ASSIGNMENT_OUTCOME.UNCHANGED,
                    pointer,
                    previousRootHash: pointer.rootHash,
                };
            }

            const assignedAt = new Date().toISOString();
            database.prepare(`
                INSERT INTO builds (build_id, root_hash, assigned_at)
                VALUES (?, ?, ?)
                ON CONFLICT(build_id) DO UPDATE SET
                    root_hash = excluded.root_hash,
                    assigned_at = excluded.assigned_at
            `).run(buildId, rootHash, assignedAt);
            const result = {
                outcome: BUILD_ASSIGNMENT_OUTCOME.ASSIGNED,
                pointer: { rootHash, assignedAt },
                previousRootHash: currentRootHash,
            };
            database.exec('COMMIT');
            began = false;
            return result;
        } catch (cause) {
            if (began) {
                try {
                    database.exec('ROLLBACK');
                } catch {
                    // SQLite may have rolled the transaction back already.
                }
            }
            throw new OperationalError(`NodeContentStore failed to assign build "${ buildId }"`, { cause });
        }
    }

    /**
     * Releases an owned SQLite connection and permanently closes this adapter.
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
    }

    #assertOpen() {
        if (this.#closed) {
            throw new AssertionError('NodeContentStore has been closed');
        }
    }

    #assertValidHash(hash, label) {
        assertNonEmptyString(hash, label);
        if (hash === '.' || hash === '..' || CONTROL_CHAR_PATTERN.test(hash) || hash.includes('/') || hash.includes('\\')) {
            throw new AssertionError(`${ label } must be a filesystem-safe hash segment`);
        }
    }

    #shardDirectoryForHash(hash) {
        return path.join(this.#blobDirectory, hash.slice(0, 2));
    }

    #filePathForHash(hash) {
        return path.join(this.#shardDirectoryForHash(hash), hash);
    }

    async #initialize(context) {
        if (this.#initialized) {
            return;
        }
        let trace;
        if (!this.#initialization) {
            trace = new TraceLogger(context.logger, 'content-store-initialize');
            this.#initialization = this.#initializeStore(context);
        }

        try {
            await this.#initialization;
            if (trace) {
                trace.ok();
            }
            this.#initialized = true;
        } catch (cause) {
            if (trace) {
                trace.error();
            }
            this.#initialization = null;
            throw cause;
        }
    }

    async #initializeStore(context) {
        try {
            await fsp.mkdir(this.#blobDirectory, { recursive: true });
        } catch (cause) {
            throw new OperationalError(`NodeContentStore failed to create directory "${ this.#formatDirectory }"`, { cause });
        }

        if (!this.#database) {
            try {
                this.#database = new DatabaseSync(this.#databasePath, this.#sqliteOptions);
            } catch (cause) {
                throw new OperationalError(`NodeContentStore failed to open database "${ this.#databasePath }"`, { cause });
            }
        }

        const trace = new TraceLogger(context.logger, 'content-store-prepare-database');
        try {
            this.#prepareDatabase(this.#database);
            trace.ok();
        } catch (cause) {
            trace.error();
            if (cause.name === 'AssertionError') {
                throw cause;
            }
            throw new OperationalError('NodeContentStore failed to initialize database schema', { cause });
        }
    }

    async #getDatabase(context) {
        await this.#initialize(context);
        return this.#database;
    }

    // Opens the database inside an operation's trace so its duration includes
    // connection and schema setup. The error is rethrown untouched: wrapping it
    // here would misclassify schema AssertionErrors as OperationalErrors.
    async #getTracedDatabase(context, trace) {
        try {
            return await this.#getDatabase(context);
        } catch (cause) {
            trace.error();
            throw cause;
        }
    }

    #prepareDatabase(database) {
        database.exec('PRAGMA foreign_keys = ON');
        database.exec('PRAGMA journal_mode = WAL');
        database.exec(`PRAGMA busy_timeout = ${ BUSY_TIMEOUT_MS }`);
        database.exec('PRAGMA synchronous = FULL');

        const { user_version: currentVersion } = database.prepare('PRAGMA user_version').get();
        if (currentVersion > SCHEMA_VERSION) {
            throw new AssertionError(`NodeContentStore database schema version ${ currentVersion } is newer than supported version ${ SCHEMA_VERSION }`);
        }
        if (currentVersion === SCHEMA_VERSION) {
            return;
        }

        database.exec('BEGIN IMMEDIATE');
        try {
            const { user_version: lockedVersion } = database.prepare('PRAGMA user_version').get();
            this.#logger.info('checked locked user version', { version: SCHEMA_VERSION, lockedVersion });
            if (lockedVersion > SCHEMA_VERSION) {
                throw new AssertionError(`NodeContentStore database schema version ${ lockedVersion } is newer than supported version ${ SCHEMA_VERSION }`);
            }
            if (lockedVersion === 0) {
                database.exec(`
                    CREATE TABLE closures (
                        root_hash   TEXT PRIMARY KEY,
                        entries_json TEXT NOT NULL
                    );
                    CREATE TABLE builds (
                        build_id   TEXT PRIMARY KEY,
                        root_hash  TEXT NOT NULL REFERENCES closures(root_hash),
                        assigned_at TEXT NOT NULL
                    );
                    PRAGMA user_version = ${ SCHEMA_VERSION };
                `);
                this.#logger.info('migrated content store database', { version: SCHEMA_VERSION });
            } else if (lockedVersion < SCHEMA_VERSION) {
                throw new AssertionError(`NodeContentStore does not migrate schema version ${ lockedVersion } to ${ SCHEMA_VERSION }; use the current content format directory`);
            }
            database.exec('COMMIT');
        } catch (cause) {
            try {
                database.exec('ROLLBACK');
            } catch {
                // The transaction may already have been rolled back by SQLite.
            }
            throw cause;
        }
    }

    async #fileExists(filePath, hash) {
        try {
            await fsp.access(filePath);
            return true;
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return false;
            }
            throw new OperationalError(`NodeContentStore failed to inspect blob "${ hash }"`, { cause });
        }
    }

    async #syncDirectory(directory, hash) {
        let handle;
        try {
            handle = await fsp.open(directory, fs.constants.O_RDONLY);
            await handle.sync();
        } catch (cause) {
            throw new OperationalError(`NodeContentStore failed to synchronize blob shard for "${ hash }"`, { cause });
        } finally {
            await handle?.close();
        }
    }

    async #removeTemporaryFile(temporaryPath, hash) {
        try {
            await fsp.unlink(temporaryPath);
        } catch (cause) {
            if (cause.code !== 'ENOENT') {
                this.#logger.warn('failed to remove temporary blob file', { hash });
            }
        }
    }

    async #removePublishedTemporaryFile(temporaryPath, hash) {
        try {
            await fsp.unlink(temporaryPath);
        } catch (cause) {
            if (cause.code !== 'ENOENT') {
                this.#logger.warn('failed to remove published temporary blob file', { hash });
            }
        }
    }

    async #openStream(filePath, hash) {
        let handle;
        try {
            handle = await fsp.open(filePath, 'r');
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return null;
            }
            throw new OperationalError(`NodeContentStore failed to open blob stream "${ hash }"`, { cause });
        }

        let offset = 0;
        let closed = false;
        const close = async () => {
            if (!closed) {
                closed = true;
                await handle.close();
            }
        };

        return new ReadableStream({
            async pull(controller) {
                const buffer = new Uint8Array(STREAM_CHUNK_SIZE);
                try {
                    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
                    if (bytesRead === 0) {
                        await close();
                        controller.close();
                        return;
                    }
                    offset += bytesRead;
                    controller.enqueue(buffer.subarray(0, bytesRead));
                } catch (cause) {
                    try {
                        await close();
                    } catch {
                        // The original read failure is more useful to callers.
                    }
                    controller.error(new OperationalError(`NodeContentStore failed to read blob stream "${ hash }"`, { cause }));
                }
            },
            async cancel() {
                await close();
            },
        });
    }
}

function assertValidType(type, method, acceptedTypes) {
    if (!acceptedTypes.includes(type)) {
        throw new AssertionError(`Invalid type "${ type }" passed into NodeContentStore#${ method }`);
    }
}
