import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import KeyValueStore from '../../../kixx/adapters/node/key-value-store/lib/key-value-store.js';
import Logger from '../../../kixx/logger/logger.js';
import { createKeyCounter } from '../../../test-app/integration-probe/adapters/node/lib/key-counter.js';


// Over the Node.js key/value store's real SQLite file, while the store has
// it open, as in a running server.
describe('integration-probe: Node.js key counter', ({ before, after, it }) => {
    const logger = new Logger({ name: 'Test', level: 'NONE' });
    const context = { logger };

    let directory;
    let store;
    let countKeyValueKeys;

    before(async () => {
        directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-key-counter-'));

        const storePath = path.join(directory, 'key-value-store.sqlite');

        store = new KeyValueStore({ logger, path: storePath });
        countKeyValueKeys = createKeyCounter({ DatabaseSync, fileExists: fs.existsSync, path: storePath });
    });

    after(async () => {
        store.close();
        await fsp.rm(directory, { recursive: true, force: true });
    });

    // First: the store makes its file on first use.
    it('counts none while the store has no file', () => {
        assertEqual(0, countKeyValueKeys('cache#'));
    });

    it('counts the keys under a prefix, and no other', async () => {
        await store.put(context, 'cache#one', 'a');
        await store.put(context, 'cache#two', 'b');
        await store.put(context, 'other#one', 'c');
        await store.put(context, 'a-cache#one', 'd');

        assertEqual(2, countKeyValueKeys('cache#'));
        assertEqual(1, countKeyValueKeys('other#'));
        assertEqual(0, countKeyValueKeys('missing#'));
    });

    it('sees a key written after an earlier count', async () => {
        await store.put(context, 'cache#three', 'e');

        assertEqual(3, countKeyValueKeys('cache#'));
    });

    it('reads a prefix literally, never as a pattern', async () => {
        await store.put(context, 'percent%key', 'f');

        assertEqual(0, countKeyValueKeys('%'));
        assertEqual(0, countKeyValueKeys('cache_'));
        assertEqual(1, countKeyValueKeys('percent%'));
    });
}, { timeout: 5000 });
