import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import MigrationRecord from '../../../../../src/app/collections/migration-record.js';
import { migrations } from '../../../../../src/app/migrations/mod.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../src/app/presentation/lib/json-api.js';
import { runMigration } from '../../../../../src/app/presentation/request-handlers/admin-api/run-migration.js';


const MIGRATION_ID = '2026-07-17-handler-test';
const STARTED_AT = '2026-07-17T12:00:00.000Z';


describe('runMigration admin API handler', ({ it }) => {
    it('runs one real batch from ledger state and returns committed JSON API attributes', async () => {
        let invocation;
        await withMigration(async (_context, params) => {
            invocation = params;
            return { done: true, cursor: null, stats: { scanned: 3 } };
        }, async () => {
            const ledger = makeLedgerHarness();
            const context = makeContext(ledger.collection);
            const response = makeResponse();
            await runMigration(
                context,
                makeRequest({ cursor: 'caller-cursor' }),
                response,
            );

            assertEqual(null, invocation.cursor);
            assertEqual(false, invocation.dryRun);
            assertEqual(1, ledger.createCount);
            assertEqual(200, response.status);
            assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
            assertEqual('MigrationRun', response.document.data.type);
            assertEqual(MIGRATION_ID, response.document.data.id);
            assertEqual(true, response.document.data.attributes.done);
            assertEqual('applied', response.document.data.attributes.status);
            assertEqual(false, response.document.data.attributes.dryRun);
            assertEqual(3, response.document.data.attributes.stats.scanned);
        });
    });

    it('runs a dry batch with caller cursor and never accesses the ledger', async () => {
        let invocation;
        await withMigration(async (_context, params) => {
            invocation = params;
            return { done: false, cursor: 'next-dry-cursor', stats: { scanned: 2 } };
        }, async () => {
            const context = makeContext(null);
            const response = makeResponse();
            await runMigration(
                context,
                makeRequest({ dryRun: true, cursor: 'dry-cursor' }),
                response,
            );

            assertEqual('dry-cursor', invocation.cursor);
            assertEqual(true, invocation.dryRun);
            assertEqual(0, context.collectionAccessCount);
            assertEqual('dry-run', response.document.data.attributes.status);
            assertEqual('next-dry-cursor', response.document.data.attributes.cursor);
            assertEqual(2, response.document.data.attributes.stats.scanned);
        });
    });

    it('translates an invalid client dry-run cursor into a safe bad request with cause', async () => {
        const invalidCursor = makeNamedError('InvalidCursorError');
        await withMigration(async () => {
            throw invalidCursor;
        }, async () => {
            const context = makeContext(null);
            const caught = await catchAsyncError(() => {
                return runMigration(
                    context,
                    makeRequest({ dryRun: true, cursor: 'invalid-cursor' }),
                    makeResponse(),
                );
            });

            assert(caught, 'expected invalid cursor to be translated');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual(invalidCursor, caught.cause);
            assertEqual('The dry-run cursor is invalid.', caught.message);
            assertEqual(0, context.collectionAccessCount);
        });
    });

    it('rejects unsupported content, invalid form fields, and unknown ids at their boundaries', async () => {
        const unsupported = await catchAsyncError(() => {
            return runMigration(
                makeContext(null),
                makeRequest({}, { contentType: 'application/json' }),
                makeResponse(),
            );
        });
        assertEqual('UnsupportedMediaTypeError', unsupported.name);
        assertEqual(415, unsupported.httpStatusCode);

        const invalidForm = await catchAsyncError(() => {
            return runMigration(
                makeContext(null),
                makeRequest({ dryRun: 'yes' }),
                makeResponse(),
            );
        });
        assertEqual('ValidationError', invalidForm.name);
        assertEqual(422, invalidForm.httpStatusCode);

        const unknown = await catchAsyncError(() => {
            return runMigration(
                makeContext(null),
                makeRequest({}, { id: '2026-07-17-not-registered' }),
                makeResponse(),
            );
        });
        assertEqual('NotFoundError', unknown.name);
        assertEqual(404, unknown.httpStatusCode);
    });
});

function makeContext(collection) {
    return {
        user: { id: 'admin-1' },
        collectionAccessCount: 0,
        getCollection(name) {
            this.collectionAccessCount += 1;
            assertEqual('Migration', name);
            assert(collection, 'expected a migration collection');
            return collection;
        },
    };
}

function makeRequest(attributes, options) {
    const {
        contentType = JSON_API_CONTENT_TYPE,
        id = MIGRATION_ID,
    } = options ?? {};

    return {
        pathnameParams: { id },
        getContentMediaType() {
            return contentType;
        },
        async json() {
            return {
                data: {
                    type: 'MigrationRun',
                    attributes,
                },
            };
        },
    };
}

function makeResponse() {
    return {
        respondWithJSON(status, document, options) {
            this.status = status;
            this.document = document;
            this.options = options;
            return this;
        },
    };
}

function makeLedgerHarness() {
    let currentRecord = null;
    let version = 0;
    const harness = { createCount: 0 };
    const collection = {
        async getByMigrationId() {
            return currentRecord;
        },
        async createLedgerRecord(_context, id, attributes) {
            harness.createCount += 1;
            version += 1;
            currentRecord = makeRecord(id, attributes, version);
            return currentRecord;
        },
        async updateLedgerRecord(_context, record) {
            version += 1;
            currentRecord = makeRecord(record.id, record.toDocument(), version);
            return currentRecord;
        },
    };

    harness.collection = collection;
    return harness;
}

function makeRecord(id, attributes, version) {
    const document = structuredClone(attributes);
    delete document.type;
    delete document.id;

    return new MigrationRecord({
        type: 'Migration',
        id,
        version,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
        attributes: document,
    });
}

async function withMigration(migrate, fn) {
    const originalEntries = Array.from(migrations.entries());
    migrations.clear();
    migrations.set(MIGRATION_ID, {
        id: MIGRATION_ID,
        description: 'Handler test migration.',
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

function makeNamedError(name) {
    const error = new Error(name);
    error.name = name;
    return error;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
