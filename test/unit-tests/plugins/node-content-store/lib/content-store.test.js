import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentStore from '../../../../../src/plugins/node-content-store/lib/content-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import contentStoreConformance from '../../../kixx/content-addressable-store/content-store-conformance.js';


const temporaryDirectories = [];

async function makeTemporaryDirectory() {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-content-store-'));
    temporaryDirectories.push(directory);
    return directory;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeStore(rootDirectory, options = {}) {
    return new ContentStore({
        logger: makeLogger(),
        rootDirectory,
        format: 1,
        ...options,
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Node ContentStore', ({ after, describe }) => {

    after(async () => {
        for (const directory of temporaryDirectories) {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    });

    contentStoreConformance(describe, () => {
        const rootDirectory = path.join(os.tmpdir(), `kixx-content-store-contract-${ randomUUID() }`);
        temporaryDirectories.push(rootDirectory);
        return {
            store: makeStore(rootDirectory),
            context: {},
            createStoreWithoutLogger: () => new ContentStore({ rootDirectory, format: 1 }),
        };
    });

    describe('construction', ({ it }) => {
        it('requires a logger, root directory, and positive format', () => {
            const missingLogger = catchError(() => new ContentStore({ rootDirectory: '/tmp', format: 1 }));
            const missingDirectory = catchError(() => new ContentStore({ logger: makeLogger(), format: 1 }));
            const invalidFormat = catchError(() => new ContentStore({ logger: makeLogger(), rootDirectory: '/tmp', format: 0 }));

            assertEqual('AssertionError', missingLogger.name);
            assertEqual('AssertionError', missingDirectory.name);
            assertEqual('AssertionError', invalidFormat.name);
        });
    });

    describe('durable storage', ({ it }) => {
        it('uses the format namespace and two-character blob shard', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory, { format: 7 });

            await store.putFile({}, '/ignored.txt', 'abcdef', 'content');

            const filePath = path.join(rootDirectory, 'format-7', 'blobs', 'ab', 'abcdef');
            assertEqual('content', await fsp.readFile(filePath, 'utf8'));
            assertEqual(1, (await fsp.readdir(path.dirname(filePath))).length);
            store.close();
        });

        it('removes its staged temporary file after publishing a blob', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.putFile({}, '/', 'abcdef', 'content');

            const shardDirectory = path.join(rootDirectory, 'format-1', 'blobs', 'ab');
            assertEqual(JSON.stringify([ 'abcdef' ]), JSON.stringify(await fsp.readdir(shardDirectory)));
            store.close();
        });

        it('closes a blob stream when a caller cancels it', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.putFile({}, '/', 'stream', 'content');
            const stream = await store.getFile({}, 'stream', '/', 'stream');
            await stream.cancel();

            assertEqual('content', await store.getFile({}, 'text', '/', 'stream'));
            store.close();
        });

        it('persists closures and makes reassignment immediately visible across instances', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const first = makeStore(rootDirectory);
            const second = makeStore(rootDirectory);
            const firstEntries = { '/': [ 'tree', 'first' ] };
            const secondEntries = { '/': [ 'tree', 'second' ] };

            await first.saveIndex({}, 'first', firstEntries);
            await first.saveIndex({}, 'second', secondEntries);
            await first.assignBuild({}, 'current', { rootHash: 'first' });
            await second.assignBuild({}, 'current', { rootHash: 'second' });

            const build = await first.getBuild({}, 'current');
            assertEqual('second', build.rootHash);
            assertEqual(JSON.stringify(secondEntries), JSON.stringify(build.entries));
            first.close();
            second.close();
        });

        it('conditionally assigns across instances using a stale-pointer conflict as the CAS proof', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const first = makeStore(rootDirectory);
            const second = makeStore(rootDirectory);

            await first.saveIndex({}, 'first', { '/': [ 'tree', 'first' ] });
            await first.saveIndex({}, 'second', { '/': [ 'tree', 'second' ] });
            await first.assignBuild({}, 'current', { rootHash: 'first' });

            // A second instance moves the pointer between when a caller could
            // have observed "first" and when it tries to restore it, the same
            // way a concurrent deploy or test run would.
            await second.assignBuild({}, 'current', { rootHash: 'second' });

            const conflicted = await first.assignBuild({}, 'current', {
                rootHash: 'first',
                expectedRootHash: 'first',
            });
            assertEqual('conflict', conflicted);
            assertEqual('second', (await first.getBuild({}, 'current')).rootHash);

            const assigned = await first.assignBuild({}, 'current', {
                rootHash: 'first',
                expectedRootHash: 'second',
            });
            assertEqual('assigned', assigned);
            assertEqual('first', (await second.getBuild({}, 'current')).rootHash);

            first.close();
            second.close();
        });

        it('initializes schema version two with required SQLite pragmas', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.getFile({}, 'text', '/', 'missing');

            const database = new DatabaseSync(path.join(rootDirectory, 'format-1', 'index.sqlite'));
            assertEqual(2, database.prepare('PRAGMA user_version').get().user_version);
            assertEqual(1, database.prepare('PRAGMA foreign_keys').get().foreign_keys);
            assertEqual('wal', database.prepare('PRAGMA journal_mode').get().journal_mode);
            database.close();
            store.close();
        });

        it('preserves an injected database for its caller by default', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const database = new DatabaseSync(':memory:');
            const store = makeStore(rootDirectory, { database });

            await store.saveIndex({}, 'root', { '/': [ 'tree', 'root' ] });
            store.close();

            assertEqual(1, database.prepare('SELECT COUNT(*) AS count FROM closures').get().count);
            database.close();
        });
    });

    describe('error boundaries and lifecycle', ({ it }) => {
        it('rejects hashes that cannot be used as a filesystem path segment', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            for (const hash of [ '.', '..', 'a/b', 'a\\b', 'a\u0000b' ]) {
                const caught = await catchAsyncError(() => store.getFile({}, 'text', '/', hash));
                assertEqual('AssertionError', caught.name);
            }
            store.close();
        });

        it('classifies corrupt stored JSON and newer schemas as assertion failures', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            await store.saveIndex({}, 'root', { '/': [ 'tree', 'root' ] });
            await store.assignBuild({}, 'build', { rootHash: 'root' });
            const database = new DatabaseSync(path.join(rootDirectory, 'format-1', 'index.sqlite'));
            database.prepare('UPDATE closures SET entries_json = ? WHERE root_hash = ?').run('{', 'root');
            database.close();

            const corrupt = await catchAsyncError(() => store.getBuild({}, 'build'));
            assertEqual('AssertionError', corrupt.name);
            assert(corrupt.cause);
            store.close();

            const newerDatabase = new DatabaseSync(':memory:');
            newerDatabase.exec('PRAGMA user_version = 3');
            const newerStore = makeStore(rootDirectory, { database: newerDatabase });
            const newer = await catchAsyncError(() => newerStore.getBuild({}, 'build'));
            assertEqual('AssertionError', newer.name);
            assertMatches('newer than supported', newer.message);
            newerStore.close();
            newerDatabase.close();
        });

        it('rejects an older schema instead of using columns it does not have', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const database = new DatabaseSync(':memory:');
            database.exec('PRAGMA user_version = 1');
            const store = makeStore(rootDirectory, { database });

            const caught = await catchAsyncError(() => store.listBuilds({}));

            assertEqual('AssertionError', caught.name);
            assertMatches('does not migrate schema version 1 to 2', caught.message);
            store.close();
            database.close();
        });

        it('translates thrown index serialization failures to assertion errors', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);
            const entries = { '/': [ 'tree', 'root' ] };
            entries.self = entries;

            const caught = await catchAsyncError(() => store.saveIndex({}, 'root', entries));
            assertEqual('AssertionError', caught.name);
            assert(caught.cause);
            store.close();
        });

        it('permanently rejects operations after close', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const store = makeStore(rootDirectory);

            store.close();
            store.close();

            const caught = await catchAsyncError(() => store.getFile({}, 'text', '/', 'hash'));
            assertEqual('AssertionError', caught.name);
            assertMatches('has been closed', caught.message);
        });

        it('wraps filesystem initialization failures as operational errors', async () => {
            const rootDirectory = await makeTemporaryDirectory();
            const rootFile = path.join(rootDirectory, 'not-a-directory');
            await fsp.writeFile(rootFile, 'file');
            const store = makeStore(rootFile);

            const caught = await catchAsyncError(() => store.getFile({}, 'text', '/', 'hash'));
            assertEqual('OperationalError', caught.name);
            assert(caught.cause);
            store.close();
        });
    });
});
