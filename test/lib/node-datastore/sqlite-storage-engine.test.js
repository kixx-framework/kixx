import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import { testStorageEngineConformance } from '../../conformance/storage-engine.js';
import { IndexNotConfiguredError } from '../../../lib/datastore/mod.js';
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

describe('SQLiteStorageEngine cursor pagination with null sort_key and a lower range bound', ({ before, after, it }) => {
    let engine;
    let page1;
    let page2;
    before(async () => {
        engine = new SQLiteStorageEngine({ path: ':memory:' });
        await engine.initialize();
        await engine.put({ id: 'null_range_a', type: 'NullRange' });
        await engine.put({ id: 'null_range_b', type: 'NullRange' });
        await engine.put({ id: 'null_range_c', type: 'NullRange', sortKey: '2026-02-01' });
        await engine.put({ id: 'other_type_001', type: 'OtherType', sortKey: '2026-03-01' });
        page1 = await engine.query('NullRange', { limit: 1 });
        page2 = await engine.query('NullRange', {
            greaterThanOrEqualTo: '2026-02-01',
            limit: 5,
            cursor: page1.cursor,
        });
    });
    after(async () => {
        await engine.close();
    });

    it('page2 excludes earlier null sort_key rows outside the range', () => {
        assertEqual(1, page2.records.length);
    });
    it('page2 returns only records from the requested type and range', () => {
        assertEqual('null_range_c', page2.records[0].doc.id);
    });
});

describe('SQLiteStorageEngine configured indexes persist across engine instances', ({ before, after, it }) => {
    let tmpDir;
    let result;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        const dbPath = join(tmpDir, 'catalog.db');

        const engine1 = new SQLiteStorageEngine({ path: dbPath });
        await engine1.initialize();
        await engine1.put({ id: 'cust_001', type: 'Customer', email: 'alice@example.com' });
        await engine1.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
        await engine1.close();

        const engine2 = new SQLiteStorageEngine({ path: dbPath });
        await engine2.initialize();
        result = await engine2.query('Customer', { index: 'email', greaterThanOrEqualTo: 'a' });
        await engine2.close();
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('re-opened engine can query the configured index', () => {
        assertEqual(1, result.records.length);
        assertEqual('alice@example.com', result.records[0].doc.email);
    });
});

describe('SQLiteStorageEngine custom indexes remain type-specific across engine instances', ({ before, after, it }) => {
    let tmpDir;
    let error;
    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'kixx-datastore-'));
        const dbPath = join(tmpDir, 'type-scope.db');

        const engine1 = new SQLiteStorageEngine({ path: dbPath });
        await engine1.initialize();
        await engine1.put({ id: 'cust_001', type: 'Customer', email: 'alice@example.com' });
        await engine1.put({ id: 'admin_001', type: 'Admin', email: 'ops@example.com' });
        await engine1.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
        await engine1.close();

        const engine2 = new SQLiteStorageEngine({ path: dbPath });
        await engine2.initialize();
        try {
            await engine2.query('Admin', { index: 'email', greaterThanOrEqualTo: 'a' });
        } catch (err) {
            error = err;
        }
        await engine2.close();
    });
    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('throws IndexNotConfiguredError for the unconfigured type', () => {
        assert(error);
        assert(error instanceof IndexNotConfiguredError);
        assertEqual('Admin', error.type);
        assertEqual('email', error.attribute);
    });
});

describe('SQLiteStorageEngine custom indexes support hyphenated attribute names', ({ before, after, it }) => {
    let engine;
    let result;
    before(async () => {
        engine = new SQLiteStorageEngine({ path: ':memory:' });
        await engine.initialize();
        await engine.put({ id: 'cust_001', type: 'Customer', 'signup-date': '2026-03-19' });
        await engine.configureIndexes([{ type: 'Customer', attribute: 'signup-date' }]);
        result = await engine.query('Customer', {
            index: 'signup-date',
            greaterThanOrEqualTo: '2026-03-01',
        });
    });
    after(async () => {
        await engine.close();
    });

    it('returns records ordered by the hyphenated attribute', () => {
        assertEqual(1, result.records.length);
        assertEqual('2026-03-19', result.records[0].doc['signup-date']);
    });
});
