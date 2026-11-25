import { assert } from '../../../../assertions/mod.js';

const SCHEMA_VERSION = 4;

/**
 * Initializes the fresh format namespace or verifies its persisted schema version.
 * A storage at any other version is refused, not upgraded.
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
            assignment_id TEXT NOT NULL UNIQUE,
            code_revision TEXT,
            code_fingerprint TEXT
        )
    `);

    sql.exec(`
        CREATE TABLE objects (
            hash TEXT    NOT NULL PRIMARY KEY,
            size INTEGER NOT NULL
        )
    `);

    // History rows are never deleted, so each new row's sequence (the SQLite
    // row id) is larger than every earlier one. "Newest first" orders by it.
    sql.exec(`
        CREATE TABLE releases (
            sequence         INTEGER PRIMARY KEY,
            release_id       TEXT    NOT NULL UNIQUE,
            created_at       TEXT    NOT NULL,
            created_by_type  TEXT    NOT NULL,
            created_by_id    TEXT    NOT NULL,
            created_by_name  TEXT,
            object_count     INTEGER NOT NULL,
            total_bytes      INTEGER NOT NULL,
            contract_version INTEGER NOT NULL,
            provenance_json  TEXT    NOT NULL
        )
    `);

    sql.exec(`
        CREATE TABLE activations (
            sequence        INTEGER PRIMARY KEY,
            build_id        TEXT NOT NULL,
            assignment_id   TEXT NOT NULL UNIQUE,
            from_release_id TEXT,
            to_release_id   TEXT NOT NULL,
            activated_at    TEXT NOT NULL,
            reason          TEXT NOT NULL,
            actor_type      TEXT NOT NULL,
            actor_id        TEXT NOT NULL,
            actor_name      TEXT,
            source_revision TEXT,
            summary         TEXT,
            force_reason    TEXT
        )
    `);

    sql.exec('CREATE INDEX activations_build ON activations (build_id, sequence)');

    sql.exec('CREATE TABLE content_schema (version INTEGER NOT NULL)');
    sql.exec('INSERT INTO content_schema (version) VALUES (?)', SCHEMA_VERSION);
}
