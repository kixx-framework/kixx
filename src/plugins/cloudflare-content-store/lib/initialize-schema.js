import { assert } from '../../../kixx/assertions/mod.js';

const SCHEMA_VERSION = 3;

/**
 * Initializes the fresh format namespace or verifies its persisted schema version.
 * The caller owns the synchronous storage transaction covering initialization.
 * @param {{exec: Function}} sql - Durable Object SQL handle
 * @returns {void}
 */
export default function initializeSchema(sql) {
    const tables = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '__cf_*'").toArray();
    if (tables.length > 0) {
        assert(tables.some((row) => row.name === 'content_schema'), 'ContentAddressableIndexStore: incompatible unversioned schema; use the current content format namespace');
        const [ row ] = sql.exec('SELECT version FROM content_schema').toArray();
        assert(row?.version === SCHEMA_VERSION, 'ContentAddressableIndexStore: incompatible schema version');
        return;
    }

    sql.exec(`
        CREATE TABLE closure_entries (
            root_hash TEXT    NOT NULL,
            pathname  TEXT    NOT NULL,
            kind      TEXT    NOT NULL,
            hash      TEXT    NOT NULL,
            size      INTEGER,
            metadata  TEXT,
            PRIMARY KEY (root_hash, pathname)
        )
    `);

    sql.exec(`
        CREATE TABLE builds (
            build_id   TEXT    NOT NULL PRIMARY KEY,
            root_hash  TEXT    NOT NULL,
            assigned_at TEXT   NOT NULL,
            assignment_id TEXT NOT NULL UNIQUE
        )
    `);

    sql.exec(`
        CREATE TABLE objects (
            hash TEXT    NOT NULL PRIMARY KEY,
            size INTEGER NOT NULL
        )
    `);
    sql.exec(`
        CREATE TABLE pending_build_assignments (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id TEXT NOT NULL UNIQUE,
            build_id TEXT NOT NULL,
            root_hash TEXT NOT NULL,
            previous_root_hash TEXT,
            assigned_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT NOT NULL
        )
    `);
    sql.exec('CREATE INDEX pending_build_assignments_due ON pending_build_assignments (next_attempt_at, sequence)');
    sql.exec('CREATE TABLE content_schema (version INTEGER NOT NULL)');
    sql.exec('INSERT INTO content_schema (version) VALUES (?)', SCHEMA_VERSION);
}
