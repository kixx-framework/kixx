import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import ObjectStore from '../../../../../src/plugins/node-object-store/lib/object-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import objectStoreConformance from '../../../kixx/object-store/object-store-conformance.js';

async function makeStore() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-object-'));
    const store = new ObjectStore({
        logger: new Logger({ name: 'Test', level: 'NONE' }),
        path: root,
        buckets: { files: {} },
    });
    return {
        store,
        context: {},
        async close() {
            store.close();
            await fsp.rm(root, { recursive: true, force: true });
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('Node ObjectStore', ({ describe, it }) => {
    objectStoreConformance(describe, makeStore);

    it('rejects short and excessive streams before publication', async () => {
        const subject = await makeStore();
        const short = await catchAsyncError(() => subject.store.put(
            subject.context,
            'files',
            'short',
            new Blob([ 'ab' ]).stream(),
            { contentLength: 3 },
        ));
        const excess = await catchAsyncError(() => subject.store.put(
            subject.context,
            'files',
            'excess',
            new Blob([ 'abcd' ]).stream(),
            { contentLength: 3 },
        ));

        assert(short);
        assert(excess);
        assertEqual(null, await subject.store.head(subject.context, 'files', 'short'));
        assertEqual(null, await subject.store.head(subject.context, 'files', 'excess'));
        await subject.close();
    });
});
