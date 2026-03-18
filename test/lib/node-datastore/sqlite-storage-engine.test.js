import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import { testStorageEngineConformance } from '../../conformance/storage-engine.js';
import { SQLiteStorageEngine } from '../../../lib/node-datastore/mod.js';


// Run the full StorageEngine conformance suite using in-memory SQLite databases.
// In-memory databases are isolated per engine instance and require no cleanup.
testStorageEngineConformance(async () => {
    const engine = new SQLiteStorageEngine({ path: ':memory:' });
    await engine.initialize();
    return engine;
});


// --- SQLite-specific tests --------------------------------------------------

describe('SQLiteStorageEngine#initialize() creates the database file', ({ before, after, it }) => {
    let tmpDir;
    let dbPath;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        dbPath = join(tmpDir, 'app.db');
        const engine = new SQLiteStorageEngine({ path: dbPath });
        await engine.initialize();
        await engine.close();
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('database file exists after initialize()', async () => {
        let accessible = false;
        try {
            await access(dbPath);
            accessible = true;
        } catch {
            accessible = false;
        }
        assertEqual(true, accessible);
    });
});

describe('SQLiteStorageEngine#initialize() creates parent directories recursively', ({ before, after, it }) => {
    let tmpDir;
    let dbPath;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        // Nested directory that does not exist yet.
        dbPath = join(tmpDir, 'nested', 'deep', 'app.db');
        const engine = new SQLiteStorageEngine({ path: dbPath });
        await engine.initialize();
        await engine.close();
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('database file is created inside nested directories', async () => {
        let accessible = false;
        try {
            await access(dbPath);
            accessible = true;
        } catch {
            accessible = false;
        }
        assertEqual(true, accessible);
    });
});

describe('SQLiteStorageEngine#initialize() enables WAL journal mode', ({ before, after, it }) => {
    let tmpDir;
    let journalMode;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        const dbPath = join(tmpDir, 'wal.db');
        const engine = new SQLiteStorageEngine({ path: dbPath });
        await engine.initialize();
        // Read the journal mode directly from the database.
        const db = new DatabaseSync(dbPath);
        journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
        db.close();
        await engine.close();
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('journal_mode is wal', () => {
        assertEqual('wal', journalMode);
    });
});

describe('SQLiteStorageEngine#initialize() is idempotent on existing database', ({ before, after, it }) => {
    let tmpDir;
    let error;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        const dbPath = join(tmpDir, 'idem.db');
        const engine = new SQLiteStorageEngine({ path: dbPath });
        await engine.initialize();
        await engine.close();
        // Re-open and initialize on the same file.
        const engine2 = new SQLiteStorageEngine({ path: dbPath });
        try {
            await engine2.initialize();
            await engine2.close();
        } catch (err) {
            error = err;
        }
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('does not throw when called on an existing database', () => {
        assertEqual(undefined, error);
    });
});

describe('SQLiteStorageEngine#configureIndexes() adding then removing an index does not throw', ({ before, after, it }) => {
    let engine;
    let error;
    before(async () => {
        engine = new SQLiteStorageEngine({ path: ':memory:' });
        await engine.initialize();
        try {
            await engine.configureIndexes([{ type: 'T', attribute: 'email' }]);
            await engine.configureIndexes([]);
        } catch (err) {
            error = err;
        }
    });
    after(async () => {
        await engine.close();
    });

    it('does not throw', () => {
        assertEqual(undefined, error);
    });
});

describe('SQLiteStorageEngine cursor pagination with null sort_key', ({ before, after, it }) => {
    let engine;
    let page1;
    let page2;
    before(async () => {
        engine = new SQLiteStorageEngine({ path: ':memory:' });
        await engine.initialize();
        // Insert docs with no sortKey (null sort_key).
        await engine.put({ id: 'null_a', type: 'NullSort' });
        await engine.put({ id: 'null_b', type: 'NullSort' });
        await engine.put({ id: 'null_c', type: 'NullSort' });
        page1 = await engine.query('NullSort', { limit: 2 });
        page2 = await engine.query('NullSort', { limit: 2, cursor: page1.cursor });
    });
    after(async () => {
        await engine.close();
    });

    it('page1 has 2 records', () => {
        assertEqual(2, page1.records.length);
    });
    it('page1 has a cursor', () => {
        assert(typeof page1.cursor === 'string' && page1.cursor.length > 0);
    });
    it('page2 has 1 record', () => {
        assertEqual(1, page2.records.length);
    });
    it('page2 cursor is null', () => {
        assertEqual(null, page2.cursor);
    });
    it('all 3 docs are returned across pages', () => {
        const ids = [
            ...page1.records.map((r) => r.doc.id),
            ...page2.records.map((r) => r.doc.id),
        ];
        assertEqual(3, new Set(ids).size);
    });
});
