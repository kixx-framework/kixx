import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from '../../../lib/vendor/kixx-assert/mod.js';
import { buildDurableObjectExports } from '../../../lib/cloudflare/durable-object-exports.js';
import { parseJsonc } from '../../../lib/parse-jsonc.js';


describe('cloudflare/durable-object-exports', ({ describe }) => {

    describe('projection', ({ it }) => {
        it('projects a configured class to a single live sqlite entry', () => {
            const { exports, liveClasses } = build({
                CONTENT_STORE: { durableObjectClassName: 'ContentStore' },
            });

            assertEqual(1, Object.keys(exports).length);
            assertEqual('durable-object', exports.ContentStore.type);
            assertEqual('sqlite', exports.ContentStore.storage);
            assertUndefined(exports.ContentStore.state);
            assertEqual('ContentStore', liveClasses[0]);
            assertEqual(1, liveClasses.length);
        });

        it('projects a JOB_QUEUE class to a live sqlite entry beside CONTENT_STORE', () => {
            const { exports, liveClasses } = build({
                CONTENT_STORE: { durableObjectClassName: 'ContentStore' },
                JOB_QUEUE: { durableObjectClassName: 'JobQueueStore' },
            });

            assertEqual('durable-object', exports.JobQueueStore.type);
            assertEqual('sqlite', exports.JobQueueStore.storage);
            assertUndefined(exports.JobQueueStore.state);
            assertEqual('ContentStore,JobQueueStore', liveClasses.join(','));
        });

        it('applies rename declarations to a JOB_QUEUE class', () => {
            const { exports, liveClasses } = build({
                JOB_QUEUE: { durableObjectClassName: 'NewQueue' },
                DURABLE_OBJECT_MIGRATIONS: [ { action: 'rename', from: 'OldQueue', to: 'NewQueue' } ],
            });

            assertEqual('renamed', exports.OldQueue.state);
            assertEqual('NewQueue', exports.OldQueue.renamed_to);
            assertEqual('NewQueue', liveClasses.join(','));
        });

        it('yields an empty map when nothing is configured or declared', () => {
            const { exports, liveClasses } = build({});

            assertEqual(0, Object.keys(exports).length);
            assertEqual(0, liveClasses.length);
        });

        it('projects a rename declaration to a renamed tombstone', () => {
            const { exports, liveClasses } = build({
                CONTENT_STORE: { durableObjectClassName: 'NewName' },
                DURABLE_OBJECT_MIGRATIONS: [ { action: 'rename', from: 'OldName', to: 'NewName' } ],
            });

            assertEqual('renamed', exports.OldName.state);
            assertEqual('NewName', exports.OldName.renamed_to);
            assertEqual('durable-object', exports.OldName.type);
            assertUndefined(exports.OldName.storage);
            assertEqual('NewName', liveClasses.join(','));
        });

        it('projects a delete declaration to a deleted tombstone', () => {
            const { exports, liveClasses } = build({
                DURABLE_OBJECT_MIGRATIONS: [ { action: 'delete', className: 'Abandoned' } ],
            });

            assertEqual('deleted', exports.Abandoned.state);
            assertUndefined(exports.Abandoned.storage);
            assertEqual(0, liveClasses.length);
        });

        it('projects a transfer declaration to the receiving side', () => {
            const { exports, liveClasses } = build({
                DURABLE_OBJECT_MIGRATIONS: [
                    { action: 'transfer', from: 'Counter', fromScript: 'old-worker', to: 'Counter' },
                ],
            });

            assertEqual('expecting-transfer', exports.Counter.state);
            assertEqual('old-worker', exports.Counter.transfer_from);
            assertEqual('sqlite', exports.Counter.storage);
            assertEqual('Counter', liveClasses.join(','));
        });

        it('projects a transfer-away declaration to the sending side', () => {
            const { exports, liveClasses } = build({
                DURABLE_OBJECT_MIGRATIONS: [
                    { action: 'transfer-away', className: 'Counter', toScript: 'new-worker' },
                ],
            });

            assertEqual('transferred', exports.Counter.state);
            assertEqual('new-worker', exports.Counter.transferred_to);
            assertUndefined(exports.Counter.storage);
            assertEqual(0, liveClasses.length);
        });

        it('returns a live class set matching the live entries in the map', () => {
            const { liveClasses } = build({
                CONTENT_STORE: { durableObjectClassName: 'ContentStore' },
                DURABLE_OBJECT_MIGRATIONS: [
                    { action: 'delete', className: 'Abandoned' },
                    { action: 'rename', from: 'OldName', to: 'ContentStore' },
                    { action: 'transfer', from: 'Counter', fromScript: 'old-worker', to: 'Counter' },
                    { action: 'transfer-away', className: 'Departed', toScript: 'new-worker' },
                ],
            });

            assertEqual('ContentStore,Counter', liveClasses.join(','));
        });

        it('is a pure projection: the same config yields the same map twice', () => {
            const config = {
                CONTENT_STORE: { durableObjectClassName: 'ContentStore' },
                DURABLE_OBJECT_MIGRATIONS: [ { action: 'delete', className: 'Abandoned' } ],
            };

            assertEqual(
                JSON.stringify(build(config).exports),
                JSON.stringify(build(config).exports),
            );
        });
    });

    describe('validation', ({ it }) => {
        it('rejects a declaration colliding with a configured live class', () => {
            const caught = catchError(() => build({
                CONTENT_STORE: { durableObjectClassName: 'ContentStore' },
                DURABLE_OBJECT_MIGRATIONS: [ { action: 'delete', className: 'ContentStore' } ],
            }));

            assert(caught, 'expected a colliding declaration to be rejected');
            assertMatches('DURABLE_OBJECT_MIGRATIONS[0]', caught.message);
            assertMatches('"ContentStore"', caught.message);
        });

        it('rejects a declaration colliding with an earlier declaration', () => {
            const caught = catchError(() => build({
                DURABLE_OBJECT_MIGRATIONS: [
                    { action: 'delete', className: 'Abandoned' },
                    { action: 'rename', from: 'Abandoned', to: 'Other' },
                ],
            }));

            assert(caught, 'expected a duplicate target to be rejected');
            assertMatches('DURABLE_OBJECT_MIGRATIONS[1]', caught.message);
        });

        it('rejects a malformed declaration naming its index and field', () => {
            const cases = [
                [ 'not an object', 'DURABLE_OBJECT_MIGRATIONS[0] must be an object' ],
                [ { action: 'nope' }, 'action must be one of: rename, delete, transfer, transfer-away' ],
                [ { action: 'rename', to: 'New' }, 'DURABLE_OBJECT_MIGRATIONS[0].from must be a non-empty string' ],
                [ { action: 'rename', from: 'Old' }, 'DURABLE_OBJECT_MIGRATIONS[0].to must be a non-empty string' ],
                [ { action: 'delete', className: '' }, 'DURABLE_OBJECT_MIGRATIONS[0].className must be' ],
                [
                    { action: 'transfer', from: 'A', to: 'B' },
                    'DURABLE_OBJECT_MIGRATIONS[0].fromScript must be',
                ],
                [
                    { action: 'transfer-away', className: 'A' },
                    'DURABLE_OBJECT_MIGRATIONS[0].toScript must be',
                ],
            ];

            for (const [ declaration, message ] of cases) {
                const caught = catchError(() => build({ DURABLE_OBJECT_MIGRATIONS: [ declaration ] }));

                assert(caught, `expected ${ JSON.stringify(declaration) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });

        it('rejects a non-array DURABLE_OBJECT_MIGRATIONS naming its full config path', () => {
            const caught = catchError(() => build({ DURABLE_OBJECT_MIGRATIONS: {} }));

            assert(caught, 'expected a non-array to be rejected');
            assertEqual('UsageError', caught.name);
            assertMatches('environments.production.DURABLE_OBJECT_MIGRATIONS must be an array', caught.message);
        });

        it('names the offending index, not the first index', () => {
            const caught = catchError(() => build({
                DURABLE_OBJECT_MIGRATIONS: [
                    { action: 'delete', className: 'Abandoned' },
                    { action: 'delete' },
                ],
            }));

            assert(caught, 'expected the second declaration to be rejected');
            assertMatches('DURABLE_OBJECT_MIGRATIONS[1].className', caught.message);
        });
    });
});


function build(environmentConfig) {
    return buildDurableObjectExports({ environmentConfig, environment: 'production' });
}


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}


describe('cloudflare/durable-object-exports with the lib production config', ({ it }) => {
    it('exports ContentAddressableIndexStore and JobQueueStore as live sqlite classes', async () => {
        const url = new URL('../../fixtures/lib-cloudflare-config.jsonc', import.meta.url);
        const environmentConfig = parseJsonc(await fsp.readFile(url, 'utf8')).environments.production;

        const { exports, liveClasses } = build(environmentConfig);

        assertEqual('ContentAddressableIndexStore,JobQueueStore', liveClasses.join(','));
        assertEqual('ContentAddressableIndexStore,JobQueueStore', Object.keys(exports).sort().join(','));
        assertEqual('sqlite', exports.JobQueueStore.storage);
        assertEqual('sqlite', exports.ContentAddressableIndexStore.storage);
    });
});
