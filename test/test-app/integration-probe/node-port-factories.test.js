import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import KeyValueStore from '../../../kixx/adapters/node/key-value-store/lib/key-value-store.js';
import Logger from '../../../kixx/logger/logger.js';
import { PROBE_SUITES } from '../../../test-app/probe/probe-suites.js';
import { createPortFactories } from '../../../test-app/integration-probe/adapters/node/lib/port-factories.js';


// The four port suites, run through the factories the test app's probe
// hands them on Node.js and Deno, over real SQLite in a temporary directory.
describe('integration-probe: Node.js port factories', ({ before, after, describe, it }) => {
    let dataDirectory;
    let keyValueStore;
    let context;
    let ids = 0;

    // The builders are called here as the probe calls them on a run request.
    // `context` is read when a factory runs, inside a test: it isn't set yet.
    const portFactories = createPortFactories({
        resolveFilepath: (relativePath) => path.join(dataDirectory, ...relativePath.split('/')),
        createId: () => `id-${ ids += 1 }`,
    });

    const lateContext = {
        get logger() {
            return context.logger;
        },
        getService: (name) => context.getService(name),
    };

    before(async () => {
        dataDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-integration-probe-'));

        const logger = new Logger({ name: 'Test', level: 'NONE' });

        keyValueStore = new KeyValueStore({ logger, path: path.join(dataDirectory, 'key-value-store.sqlite') });

        // As boot leaves the app's logger: it takes no new child, so a
        // factory can't hand it to a store it builds during a request.
        logger.finalize();

        context = {
            logger,
            getService(name) {
                assertEqual('KeyValueStore', name);
                return keyValueStore;
            },
        };
    });

    after(async () => {
        keyValueStore.close();
        await fsp.rm(dataDirectory, { recursive: true, force: true });
    });

    it('has a factory builder for each port suite, and no other', () => {
        assertEqual(
            'content-store,key-value-store,logger-writer,server-request',
            Object.keys(portFactories).sort().join(','),
        );
    });

    // A block's own tests run before its child blocks: no store exists yet.
    it('touches no storage when a builder is called', () => {
        for (const build of Object.values(portFactories)) {
            assertEqual('function', typeof build(lateContext));
        }

        assertEqual('', fs.readdirSync(dataDirectory).join(','));
    });

    for (const name of [ 'key-value-store', 'content-store', 'logger-writer', 'server-request' ]) {
        describe(name, ({ describe }) => {
            PROBE_SUITES[name](describe, portFactories[name](lateContext));
        });
    }

    // A block's own tests run before its child blocks, so what the suites
    // left behind is checked in a block after them.
    describe('after the suites', ({ it }) => {
        it('has built each content store in its own directory under the data directory', () => {
            const directory = path.join(dataDirectory, 'integration-probe', 'content-store');
            const names = fs.readdirSync(directory);

            assert(names.length > 1, 'expected one directory per content store test');
            assertFalsy(names.some((name) => !name.startsWith('id-')));
        });
    });
});
