import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import {
    getStateFilepath,
    readWorkerVersionState,
    writeWorkerVersionState,
} from '../../../lib/cloudflare/worker-version-state.js';

const VALID_STATE = {
    workerName: 'kixx-test-app',
    buildId: '2026-08-29T16-49-32Z',
    versionId: 'a1b2c3d4-versionid',
    createdAt: '2026-08-29T16:49:32.000Z',
    deployed: false,
    modulesHash: '4f2a',
    bindingsHash: '9c1e',
    configHash: '77bd',
};

describe('cloudflare/worker-version-state', ({ it }) => {
    it('returns the documented filepath for an environment', () => {
        const filepath = getStateFilepath({ projectDirectory: '/app', environment: 'production' });

        assertEqual('/app/.kixx/cloudflare-state.production.json', filepath);
    });

    it('resolves to null when the file is absent', async () => {
        const fileSystem = makeFileSystem({});

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        assertEqual(null, state);
    });

    it('returns the parsed object for a valid file', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({ [filepath]: JSON.stringify(VALID_STATE) });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        assertEqual(VALID_STATE.workerName, state.workerName);
        assertEqual(VALID_STATE.versionId, state.versionId);
        assertEqual(VALID_STATE.configHash, state.configHash);
    });

    it('throws a UsageError naming the path for invalid JSON', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({ [filepath]: '{not json' });

        const caught = await catchAsyncError(() => {
            return readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes(filepath), 'expected the message to name the path');
    });

    it('throws a UsageError naming the path for a non-object top level', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({ [filepath]: JSON.stringify([ 1, 2, 3 ]) });

        const caught = await catchAsyncError(() => {
            return readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes(filepath), 'expected the message to name the path');
    });

    it('throws a UsageError naming a wrong-typed known field', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({
            [filepath]: JSON.stringify({ ...VALID_STATE, modulesHash: 42 }),
        });

        const caught = await catchAsyncError(() => {
            return readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('modulesHash'), 'expected the message to name the field');
    });

    it('lets a hash field be null', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({
            [filepath]: JSON.stringify({ ...VALID_STATE, modulesHash: null }),
        });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        assertEqual(null, state.modulesHash);
    });

    it('ignores a legacy secretNames field, whatever its shape', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({
            [filepath]: JSON.stringify({ ...VALID_STATE, secretNames: [ 'SIGNING_SECRET', 'API_KEY', '' ] }),
        });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        assertEqual(VALID_STATE.versionId, state.versionId);
    });

    it('reads a file still carrying the removed Durable Object fields', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const legacy = {
            ...VALID_STATE,
            migrationTag: 'v1',
            durableObjectClasses: [ 'ContentAddressableIndexStore' ],
        };
        const fileSystem = makeFileSystem({ [filepath]: JSON.stringify(legacy) });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        assertEqual('kixx-test-app', state.workerName);
    });

    it('round trips the surviving fields through a write and a read', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({});

        await writeWorkerVersionState({
            projectDirectory: '/app',
            environment: 'production',
            state: VALID_STATE,
            fileSystem,
        });

        const reread = makeFileSystem({ [filepath]: fileSystem.written[filepath] });
        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem: reread });

        for (const field of Object.keys(VALID_STATE)) {
            const expected = Array.isArray(VALID_STATE[field])
                ? VALID_STATE[field].join(',')
                : VALID_STATE[field];
            const actual = Array.isArray(state[field]) ? state[field].join(',') : state[field];
            assertEqual(expected, actual);
        }
    });

    it('preserves an unknown key through a read-then-write round trip', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const withUnknownField = { ...VALID_STATE, futureField: 'kept' };
        const fileSystem = makeFileSystem({ [filepath]: JSON.stringify(withUnknownField) });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });

        await writeWorkerVersionState({ projectDirectory: '/app', environment: 'production', state, fileSystem });

        const written = JSON.parse(fileSystem.written[filepath]);
        assertEqual('kept', written.futureField);
    });

    it('writes four-space indented text ending with exactly one newline', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({});

        await writeWorkerVersionState({ projectDirectory: '/app', environment: 'production', state: VALID_STATE, fileSystem });

        const text = fileSystem.written[filepath];
        assertEqual(`${ JSON.stringify(VALID_STATE, null, 4) }\n`, text);
        assert(!text.endsWith('\n\n'), 'expected exactly one trailing newline');
    });

    it('creates .kixx/ when it does not exist, via the filesystem adapter', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const fileSystem = makeFileSystem({});

        await writeWorkerVersionState({ projectDirectory: '/app', environment: 'production', state: VALID_STATE, fileSystem });

        assert(Object.prototype.hasOwnProperty.call(fileSystem.written, filepath), 'expected the state file to be written');
    });

    it('produces identical text on a read-then-write round trip of a valid state', async () => {
        const filepath = '/app/.kixx/cloudflare-state.production.json';
        const originalText = `${ JSON.stringify(VALID_STATE, null, 4) }\n`;
        const fileSystem = makeFileSystem({ [filepath]: originalText });

        const state = await readWorkerVersionState({ projectDirectory: '/app', environment: 'production', fileSystem });
        await writeWorkerVersionState({ projectDirectory: '/app', environment: 'production', state, fileSystem });

        assertEqual(originalText, fileSystem.written[filepath]);
    });
});

function makeFileSystem(files) {
    const written = {};

    return {
        written,
        async isFile(filepath) {
            return Object.prototype.hasOwnProperty.call(files, filepath);
        },
        async readFile(filepath) {
            return files[filepath];
        },
        async writeFile(filepath, contents) {
            written[filepath] = contents;
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
