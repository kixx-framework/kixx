import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import MigrationRecord from '../../../../src/app/collections/migration-record.js';
import { migrations } from '../../../../src/app/migrations/mod.js';
import { runMigration } from '../../../../src/app/transaction-scripts/migrations/run-migration.js';


const MIGRATION_ID = '2026-07-17-runner-test';
const NOW = '2026-07-17T12:10:00.000Z';
const STARTED_AT = '2026-07-17T12:00:00.000Z';


describe('runMigration Transaction Script', ({ it }) => {
    it('creates and commits the first real batch while ignoring the caller cursor', async () => {
        let invocation;
        await withMigration(async (_context, params) => {
            invocation = params;
            return { done: false, cursor: 'ledger-next', stats: { scanned: 5 } };
        }, async () => {
            const harness = makeHarness();
            const result = await runMigration(harness.context, makeParams({ cursor: 'caller-cursor' }));

            assertEqual(null, invocation.cursor);
            assertEqual(false, invocation.dryRun);
            assertEqual(1, harness.calls.create.length);
            assertEqual(null, harness.calls.create[0].attributes.cursor);
            assertEqual('running', harness.calls.update[0].status);
            assertEqual('ledger-next', harness.calls.update[0].cursor);
            assertEqual(5, result.stats.scanned);
            assertEqual('running', result.status);
            assertEqual(false, result.done);
        });
    });

    it('commits terminal state and derives the response from the committed record', async () => {
        await withMigration(async () => {
            return { done: true, cursor: null, stats: { updated: 2 } };
        }, async () => {
            const harness = makeHarness({ record: makeRecord() });
            const result = await runMigration(harness.context, makeParams());
            const committed = harness.calls.update[1];

            assertEqual('applied', committed.status);
            assertEqual(null, committed.cursor);
            assertEqual(NOW, committed.completedAt);
            assertEqual(1, committed.batchCount);
            assertEqual('applied', result.status);
            assertEqual(true, result.done);
            assertEqual(null, result.cursor);
        });
    });

    it('rejects an applied migration without force before invocation', async () => {
        let invocationCount = 0;
        await withMigration(async () => {
            invocationCount += 1;
        }, async () => {
            const harness = makeHarness({ record: makeRecord({
                status: 'applied',
                completedAt: NOW,
            }) });
            const caught = await catchAsyncError(() => runMigration(harness.context, makeParams()));

            assertEqual('MigrationAlreadyAppliedError', caught.code);
            assertEqual(409, caught.httpStatusCode);
            assertEqual(0, invocationCount);
            assertEqual(0, harness.calls.update.length);
        });
    });

    it('resumes failed state without force while retaining run attribution', async () => {
        let invocation;
        await withMigration(async (_context, params) => {
            invocation = params;
            return { done: false, cursor: 'next-cursor', stats: { scanned: 2 } };
        }, async () => {
            const harness = makeHarness({ record: makeRecord({
                status: 'failed',
                cursor: 'stored-cursor',
                stats: { scanned: 3 },
                batchCount: 1,
                lastBatchAt: STARTED_AT,
                completedAt: STARTED_AT,
                error: 'Previous failure.',
            }) });
            const result = await runMigration(harness.context, makeParams({ startedBy: 'admin-2' }));

            assertEqual('stored-cursor', invocation.cursor);
            assertEqual('admin-1', harness.calls.update[0].startedBy);
            assertEqual(STARTED_AT, harness.calls.update[0].startedAt);
            assertEqual(5, result.stats.scanned);
            assertEqual(2, harness.calls.update[1].batchCount);
        });
    });

    it('force-resets failed and applied state before running', async () => {
        for (const status of [ 'failed', 'applied' ]) {
            await withMigration(async (_context, params) => {
                assertEqual(null, params.cursor);
                return { done: true, cursor: null, stats: { scanned: 1 } };
            }, async () => {
                const terminal = status === 'failed'
                    ? { error: 'Failed safely.' }
                    : { error: null };
                const harness = makeHarness({ record: makeRecord({
                    status,
                    cursor: null,
                    stats: { old: 9 },
                    batchCount: 1,
                    lastBatchAt: STARTED_AT,
                    completedAt: STARTED_AT,
                    ...terminal,
                }) });
                await runMigration(harness.context, makeParams({ force: true, startedBy: 'admin-2' }));

                const reset = harness.calls.update[0];
                assertEqual('running', reset.status);
                assertEqual(0, reset.batchCount);
                assertEqual(undefined, reset.stats.old);
                assertEqual('admin-2', reset.startedBy);
                assertEqual(NOW, reset.startedAt);
            });
        }
    });

    it('translates create and commit races into migration concurrency conflicts', async () => {
        await withMigration(async () => {
            return { done: false, cursor: 'next', stats: {} };
        }, async () => {
            const createHarness = makeHarness({ createError: makeNamedError('DocumentAlreadyExistsError') });
            const createCaught = await catchAsyncError(() => {
                return runMigration(createHarness.context, makeParams());
            });
            assertEqual('MigrationConcurrencyError', createCaught.code);

            const commitHarness = makeHarness({
                record: makeRecord(),
                updateErrors: new Map([ [ 1, makeNamedError('VersionConflictError') ] ]),
            });
            const commitCaught = await catchAsyncError(() => {
                return runMigration(commitHarness.context, makeParams());
            });
            assertEqual('MigrationConcurrencyError', commitCaught.code);
        });
    });

    it('records failed state for migration throws without masking the original error', async () => {
        const original = new Error('internal secret detail');
        await withMigration(async () => {
            throw original;
        }, async () => {
            const harness = makeHarness({
                record: makeRecord(),
                updateErrors: new Map([ [ 1, makeNamedError('VersionConflictError') ] ]),
            });
            const caught = await catchAsyncError(() => runMigration(harness.context, makeParams()));

            assertEqual('AssertionError', caught.name);
            assertEqual(original, caught.cause);
            assertEqual('failed', harness.calls.update[1].status);
            assertEqual('The migration batch failed.', harness.calls.update[1].error);
        });
    });

    it('records failed state for a broken batch result and propagates an assertion', async () => {
        await withMigration(async () => {
            return { done: false, cursor: null, stats: {} };
        }, async () => {
            const harness = makeHarness({ record: makeRecord() });
            const caught = await catchAsyncError(() => runMigration(harness.context, makeParams()));

            assertEqual('AssertionError', caught.name);
            assertEqual('InvalidMigrationBatchResultError', caught.cause.name);
            assertEqual('failed', harness.calls.update[1].status);
        });
    });

    it('translates an invalid stored cursor after best-effort failed bookkeeping', async () => {
        const invalidCursor = makeNamedError('InvalidCursorError');
        await withMigration(async () => {
            throw invalidCursor;
        }, async () => {
            const harness = makeHarness({ record: makeRecord({ cursor: 'invalid-stored-cursor' }) });
            const caught = await catchAsyncError(() => runMigration(harness.context, makeParams()));

            assertEqual('MigrationCursorConflictError', caught.code);
            assertEqual(invalidCursor, caught.cause);
            assertEqual('failed', harness.calls.update[1].status);
        });
    });

    it('runs dry batches without ledger access and preserves invalid cursor errors', async () => {
        let shouldThrow = false;
        const invalidCursor = makeNamedError('InvalidCursorError');
        await withMigration(async (_context, params) => {
            assertEqual('caller-cursor', params.cursor);
            assertEqual(true, params.dryRun);
            if (shouldThrow) {
                throw invalidCursor;
            }
            return { done: false, cursor: 'next-dry-cursor', stats: { scanned: 4 } };
        }, async () => {
            const harness = makeHarness();
            const result = await runMigration(harness.context, makeParams({
                dryRun: true,
                cursor: 'caller-cursor',
            }));

            assertEqual('dry-run', result.status);
            assertEqual(true, result.dryRun);
            assertEqual(4, result.stats.scanned);
            assertEqual(0, harness.calls.collectionAccess);

            shouldThrow = true;
            const caught = await catchAsyncError(() => runMigration(harness.context, makeParams({
                dryRun: true,
                cursor: 'caller-cursor',
            })));
            assertEqual(invalidCursor, caught);
            assertEqual(0, harness.calls.collectionAccess);
        });
    });
});

function makeParams(overrides) {
    return {
        id: MIGRATION_ID,
        dryRun: false,
        force: false,
        cursor: null,
        startedBy: 'admin-1',
        now: NOW,
        ...overrides,
    };
}

function makeHarness(options) {
    const {
        record: initialRecord = null,
        createError = null,
        updateErrors = new Map(),
    } = options ?? {};
    let currentRecord = initialRecord;
    let version = initialRecord?.version ?? 0;
    const calls = {
        collectionAccess: 0,
        get: 0,
        create: [],
        update: [],
    };
    const collection = {
        async getByMigrationId() {
            calls.get += 1;
            return currentRecord;
        },
        async createLedgerRecord(_context, id, attributes) {
            calls.create.push({ id, attributes: structuredClone(attributes) });
            if (createError) {
                throw createError;
            }
            version += 1;
            currentRecord = makeRecord(attributes, version);
            return currentRecord;
        },
        async updateLedgerRecord(_context, record) {
            const attributes = getAttributes(record);
            const callIndex = calls.update.length;
            calls.update.push(structuredClone(attributes));
            if (updateErrors.has(callIndex)) {
                throw updateErrors.get(callIndex);
            }
            version += 1;
            currentRecord = makeRecord(attributes, version);
            return currentRecord;
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            assertEqual('Migration', name);
            return collection;
        },
    };

    return { context, calls };
}

function makeRecord(overrides, version = 1) {
    const attributes = {
        status: 'running',
        cursor: null,
        stats: {},
        batchCount: 0,
        startedBy: 'admin-1',
        startedAt: STARTED_AT,
        lastBatchAt: null,
        completedAt: null,
        error: null,
        ...overrides,
    };

    return new MigrationRecord({
        type: 'Migration',
        id: MIGRATION_ID,
        version,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
        attributes,
    });
}

function getAttributes(record) {
    const document = record.toDocument();
    delete document.type;
    delete document.id;
    return document;
}

function makeNamedError(name) {
    const error = new Error(name);
    error.name = name;
    return error;
}

async function withMigration(migrate, fn) {
    const originalEntries = Array.from(migrations.entries());
    migrations.clear();
    migrations.set(MIGRATION_ID, {
        id: MIGRATION_ID,
        description: 'Runner test migration.',
        migrate,
    });

    try {
        await fn();
    } finally {
        migrations.clear();
        for (const [ id, entry ] of originalEntries) {
            migrations.set(id, entry);
        }
    }
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
