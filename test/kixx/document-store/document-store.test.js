import { describe, MockTracker } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import DocumentStore, {
    MAX_SORT_KEY_CHAR,
    sortKeyPrefixRange,
} from '../../../src/kixx/document-store/document-store.js';


const CURSOR_SIGNING_SECRET = 'document-store-test-signing-secret';
const INDEXES = [
    { name: 'by_email', jsonPath: '$.email', unique: true },
    { name: 'by_name', jsonPath: '$.name' },
];


function makeEngine(tracker, implementations) {
    implementations = implementations ?? {};

    return {
        setIndexDefinitions: tracker.fn(implementations.setIndexDefinitions),
        query: tracker.fn(implementations.query ?? (async () => {
            return { records: [], cursor: null };
        })),
        scan: tracker.fn(implementations.scan ?? (async () => {
            return { records: [], cursor: null };
        })),
        get: tracker.fn(implementations.get ?? (async () => null)),
        create: tracker.fn(implementations.create ?? (async (_context, doc) => doc)),
        put: tracker.fn(implementations.put ?? (async (_context, doc) => doc)),
        update: tracker.fn(implementations.update ?? (async () => ({}))),
        delete: tracker.fn(implementations.delete ?? (async () => false)),
        close: tracker.fn(implementations.close),
    };
}

function makeStore(args) {
    const {
        indexes = INDEXES,
        cursorSigningSecret = CURSOR_SIGNING_SECRET,
        implementations,
    } = args ?? {};
    const tracker = new MockTracker();
    const engine = makeEngine(tracker, implementations);
    const store = new DocumentStore();

    store.initialize({ engine, indexes, cursorSigningSecret });

    return { store, engine, tracker };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertAssertionError(error, message) {
    assert(error, 'expected an error to be thrown');
    assertEqual('AssertionError', error.name);
    assertMatches(message, error.message);
}

function assertInvalidCursorError(error) {
    assert(error, 'expected an error to be thrown');
    assertEqual('InvalidCursorError', error.name);
    assertEqual('InvalidCursorError', error.code);
    assertEqual(true, error.expected);
    assertEqual('Invalid document store cursor', error.message);
}


describe('DocumentStore', ({ describe }) => {

    describe('initialize', ({ it }) => {
        it('passes validated index definitions to the engine', () => {
            const tracker = new MockTracker();
            const engine = makeEngine(tracker);
            const store = new DocumentStore();

            store.initialize({
                engine,
                indexes: INDEXES,
                cursorSigningSecret: CURSOR_SIGNING_SECRET,
            });

            assertEqual(1, engine.setIndexDefinitions.mock.callCount());
            assertEqual(INDEXES, engine.setIndexDefinitions.mock.getCall(0).arguments[0]);
            tracker.reset();
        });

        it('rejects missing configuration values before configuring the engine', () => {
            const cases = [
                {
                    config: null,
                    message: 'requires a DocumentStoreEngine',
                },
                {
                    config: { indexes: [], cursorSigningSecret: CURSOR_SIGNING_SECRET },
                    message: 'requires a DocumentStoreEngine',
                },
                {
                    config: { engine: true, cursorSigningSecret: CURSOR_SIGNING_SECRET },
                    message: 'requires an Array as "indexes"',
                },
                {
                    config: { engine: true, indexes: [] },
                    message: 'requires a non-empty cursorSigningSecret',
                },
                {
                    config: { engine: true, indexes: [], cursorSigningSecret: '' },
                    message: 'requires a non-empty cursorSigningSecret',
                },
            ];

            for (const testCase of cases) {
                const store = new DocumentStore();
                const caught = catchError(() => store.initialize(testCase.config));

                assertAssertionError(caught, testCase.message);
            }
        });

        it('rejects invalid index definitions before configuring the engine', () => {
            const cases = [
                {
                    index: { name: '', jsonPath: '$.value' },
                    message: 'name must be a non-empty string',
                },
                {
                    index: { name: 'a'.repeat(81), jsonPath: '$.value' },
                    message: 'must not be more than 80 characters',
                },
                {
                    index: { name: '1st_index', jsonPath: '$.value' },
                    message: 'must start with a letter from a-z',
                },
                {
                    index: { name: 'ByName', jsonPath: '$.value' },
                    message: 'must start with a letter from a-z',
                },
                {
                    index: { name: 'by-name', jsonPath: '$.value' },
                    message: 'may only contain characters',
                },
                {
                    index: { name: 'by_name', jsonPath: '' },
                    message: 'jsonPath must be a non-empty string',
                },
                {
                    index: { name: 'by_name', jsonPath: '$.' },
                    message: 'must start with "$." followed by at least one character',
                },
                {
                    index: { name: 'by_name', jsonPath: 'name' },
                    message: 'must start with "$." followed by at least one character',
                },
                {
                    index: { name: 'by_name', jsonPath: '$.name', unique: 'yes' },
                    message: 'unique must be a boolean when present',
                },
            ];

            for (const testCase of cases) {
                const tracker = new MockTracker();
                const engine = makeEngine(tracker);
                const store = new DocumentStore();
                const caught = catchError(() => store.initialize({
                    engine,
                    indexes: [ testCase.index ],
                    cursorSigningSecret: CURSOR_SIGNING_SECRET,
                }));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.setIndexDefinitions.mock.callCount());
                tracker.reset();
            }
        });
    });

    describe('initialization requirement', ({ it }) => {
        it('rejects every engine-backed operation before initialization', async () => {
            const store = new DocumentStore();
            const operations = [
                () => store.put({}, { type: 'Note', id: '1' }),
                () => store.create({}, { type: 'Note', id: '1' }),
                () => store.update({}, { type: 'Note', id: '1' }, 1),
                () => store.get({}, 'Note', '1'),
                () => store.delete({}, 'Note', '1'),
                () => store.scan({}, 'Note'),
                () => store.query({}, 'Note', { index: 'by_name' }),
            ];

            for (const operation of operations) {
                const caught = await catchAsyncError(operation);

                assertAssertionError(caught, 'DocumentStore has not been initialized');
            }
        });
    });

    describe('put', ({ it }) => {
        it('passes the context and document through and returns the engine record', async () => {
            const context = { requestId: 'put-request' };
            const doc = { type: 'Note', id: 'note-1', sortKey: '', title: 'Hello' };
            const record = { ...doc, version: 1 };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    put: async () => record,
                },
            });

            const result = await store.put(context, doc);

            assertEqual(record, result);
            assertEqual(1, engine.put.mock.callCount());
            assertEqual(context, engine.put.mock.getCall(0).arguments[0]);
            assertEqual(doc, engine.put.mock.getCall(0).arguments[1]);
            tracker.reset();
        });

        it('rejects invalid input without calling the engine', async () => {
            const validDoc = { type: 'Note', id: 'note-1' };
            const cases = [
                { context: null, doc: validDoc, message: 'requires a context object' },
                { context: {}, doc: null, message: 'requires a doc object' },
                { context: {}, doc: { id: 'note-1' }, message: 'doc.type must be a non-empty string' },
                { context: {}, doc: { type: 'Bad-Type', id: 'note-1' }, message: 'must match' },
                { context: {}, doc: { type: 'Note', id: '' }, message: 'doc.id must be a non-empty string' },
                { context: {}, doc: { type: 'Note', id: 'bad\nid' }, message: 'illegal control characters' },
                { context: {}, doc: { type: 'Note', id: 'note-1', sortKey: 42 }, message: 'sortKey must be a string' },
            ];

            for (const testCase of cases) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.put(testCase.context, testCase.doc));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.put.mock.callCount());
                tracker.reset();
            }
        });

        it('preserves an error rejected by the engine', async () => {
            const engineError = new Error('put failed');
            const { store, tracker } = makeStore({
                implementations: {
                    put: async () => {
                        throw engineError;
                    },
                },
            });

            const caught = await catchAsyncError(() => store.put({}, { type: 'Note', id: 'note-1' }));

            assertEqual(engineError, caught);
            tracker.reset();
        });
    });

    describe('create', ({ it }) => {
        it('passes the context and document through and returns the engine record', async () => {
            const context = { requestId: 'create-request' };
            const doc = { type: 'Note', id: 'note-1', title: 'Hello' };
            const record = { ...doc, version: 1 };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    create: async () => record,
                },
            });

            const result = await store.create(context, doc);

            assertEqual(record, result);
            assertEqual(context, engine.create.mock.getCall(0).arguments[0]);
            assertEqual(doc, engine.create.mock.getCall(0).arguments[1]);
            tracker.reset();
        });

        it('validates the document before calling the engine', async () => {
            const { store, engine, tracker } = makeStore();
            const caught = await catchAsyncError(() => store.create(
                {},
                { type: 'Note', id: 'note-1', sortKey: null },
            ));

            assertAssertionError(caught, 'sortKey must be a string');
            assertEqual(0, engine.create.mock.callCount());
            tracker.reset();
        });
    });

    describe('update', ({ it }) => {
        it('passes optimistic concurrency arguments and adds identity fields to the engine patch', async () => {
            const context = { requestId: 'update-request' };
            const doc = { type: 'Note', id: 'note-1', title: 'Updated' };
            const patch = {
                version: 2,
                updatedAt: '2026-07-17T12:00:00.000Z',
                doc: { title: 'Updated' },
            };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    update: async () => patch,
                },
            });

            const result = await store.update(context, doc, 1);

            assertEqual(patch, result);
            assertEqual('Note', result.type);
            assertEqual('note-1', result.id);
            assertEqual(context, engine.update.mock.getCall(0).arguments[0]);
            assertEqual(doc, engine.update.mock.getCall(0).arguments[1]);
            assertEqual(1, engine.update.mock.getCall(0).arguments[2]);
            tracker.reset();
        });

        it('requires a positive integer version before calling the engine', async () => {
            const invalidVersions = [ undefined, null, 0, -1, 1.5, '1' ];

            for (const version of invalidVersions) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.update(
                    {},
                    { type: 'Note', id: 'note-1' },
                    version,
                ));

                assertAssertionError(caught, 'version must be an integer greater than zero');
                assertEqual(0, engine.update.mock.callCount());
                tracker.reset();
            }
        });

        it('applies the same document validation used by other write operations', async () => {
            const { store, engine, tracker } = makeStore();
            const caught = await catchAsyncError(() => store.update(
                {},
                { type: 'Note', id: 'bad\u0000id' },
                1,
            ));

            assertAssertionError(caught, 'illegal control characters');
            assertEqual(0, engine.update.mock.callCount());
            tracker.reset();
        });
    });

    describe('get', ({ it }) => {
        it('passes lookup arguments through and returns the engine result', async () => {
            const context = { requestId: 'get-request' };
            const record = { type: 'Note', id: 'note-1', version: 1 };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    get: async () => record,
                },
            });

            const result = await store.get(context, 'Note', 'note-1');

            assertEqual(record, result);
            assertEqual(context, engine.get.mock.getCall(0).arguments[0]);
            assertEqual('Note', engine.get.mock.getCall(0).arguments[1]);
            assertEqual('note-1', engine.get.mock.getCall(0).arguments[2]);
            tracker.reset();
        });

        it('returns null when the engine reports no document', async () => {
            const { store, tracker } = makeStore();

            const result = await store.get({}, 'Note', 'missing');

            assertEqual(null, result);
            tracker.reset();
        });

        it('rejects invalid lookup arguments without calling the engine', async () => {
            const cases = [
                { context: null, type: 'Note', id: 'note-1', message: 'requires a context object' },
                { context: {}, type: '', id: 'note-1', message: 'type must be a non-empty string' },
                { context: {}, type: 'Bad-Type', id: 'note-1', message: 'must match' },
                { context: {}, type: 'Note', id: '', message: 'id must be a non-empty string' },
                { context: {}, type: 'Note', id: 'bad\tid', message: 'illegal control characters' },
            ];

            for (const testCase of cases) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.get(
                    testCase.context,
                    testCase.type,
                    testCase.id,
                ));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.get.mock.callCount());
                tracker.reset();
            }
        });
    });

    describe('delete', ({ it }) => {
        it('passes an omitted version through to the engine', async () => {
            const context = { requestId: 'delete-request' };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    delete: async () => true,
                },
            });

            const result = await store.delete(context, 'Note', 'note-1');

            assertEqual(true, result);
            assertEqual(context, engine.delete.mock.getCall(0).arguments[0]);
            assertEqual('Note', engine.delete.mock.getCall(0).arguments[1]);
            assertEqual('note-1', engine.delete.mock.getCall(0).arguments[2]);
            assertUndefined(engine.delete.mock.getCall(0).arguments[3]);
            tracker.reset();
        });

        it('passes a valid optimistic concurrency version through to the engine', async () => {
            const { store, engine, tracker } = makeStore({
                implementations: {
                    delete: async () => true,
                },
            });

            await store.delete({}, 'Note', 'note-1', 3);

            assertEqual(3, engine.delete.mock.getCall(0).arguments[3]);
            tracker.reset();
        });

        it('rejects invalid arguments without calling the engine', async () => {
            const cases = [
                { context: null, type: 'Note', id: 'note-1', version: undefined, message: 'requires a context object' },
                { context: {}, type: 'Bad-Type', id: 'note-1', version: undefined, message: 'must match' },
                { context: {}, type: 'Note', id: '', version: undefined, message: 'id must be a non-empty string' },
                { context: {}, type: 'Note', id: 'bad\rid', version: undefined, message: 'illegal control characters' },
                { context: {}, type: 'Note', id: 'note-1', version: 0, message: 'version must be an integer greater than zero' },
                { context: {}, type: 'Note', id: 'note-1', version: 2.5, message: 'version must be an integer greater than zero' },
            ];

            for (const testCase of cases) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.delete(
                    testCase.context,
                    testCase.type,
                    testCase.id,
                    testCase.version,
                ));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.delete.mock.callCount());
                tracker.reset();
            }
        });
    });

    describe('scan', ({ it }) => {
        it('normalizes default pagination options and preserves a terminal engine result', async () => {
            const records = [ { type: 'Note', id: 'note-1' } ];
            const engineResult = { records, cursor: null };
            const context = { requestId: 'scan-request' };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    scan: async () => engineResult,
                },
            });

            const result = await store.scan(context, 'Note');
            const options = engine.scan.mock.getCall(0).arguments[2];

            assertEqual(engineResult, result);
            assertEqual(context, engine.scan.mock.getCall(0).arguments[0]);
            assertEqual('Note', engine.scan.mock.getCall(0).arguments[1]);
            assertEqual(false, options.descending);
            assertEqual(100, options.limit);
            assertUndefined(options.cursor);
            assertUndefined(options.equalTo);
            assertUndefined(options.greaterThan);
            assertUndefined(options.greaterThanOrEqualTo);
            assertUndefined(options.lessThan);
            assertUndefined(options.lessThanOrEqualTo);
            tracker.reset();
        });

        it('passes pagination bounds and treats a non-boolean descending value as false', async () => {
            const { store, engine, tracker } = makeStore();

            await store.scan({}, 'Note', {
                descending: 'yes',
                limit: 25,
                equalTo: 'exact',
                greaterThan: 'a',
                greaterThanOrEqualTo: 'b',
                lessThan: 'z',
                lessThanOrEqualTo: 'y',
            });
            const options = engine.scan.mock.getCall(0).arguments[2];

            assertEqual(false, options.descending);
            assertEqual(25, options.limit);
            assertEqual('exact', options.equalTo);
            assertEqual('a', options.greaterThan);
            assertEqual('b', options.greaterThanOrEqualTo);
            assertEqual('z', options.lessThan);
            assertEqual('y', options.lessThanOrEqualTo);
            tracker.reset();
        });

        it('signs an engine continuation and unseals it for the next page', async () => {
            const engineCursor = { sortKey: '2026-07-17', id: 'note-1' };
            let callCount = 0;
            const { store, engine, tracker } = makeStore({
                implementations: {
                    scan: async () => {
                        callCount += 1;
                        if (callCount === 1) {
                            return { records: [ { id: 'note-1' } ], cursor: engineCursor };
                        }
                        return { records: [ { id: 'note-2' } ], cursor: null };
                    },
                },
            });

            const firstPage = await store.scan({}, 'Note', {
                descending: true,
                limit: 10,
                greaterThanOrEqualTo: '2026',
            });
            const secondPage = await store.scan({}, 'Note', {
                descending: true,
                limit: 5,
                greaterThanOrEqualTo: '2026',
                cursor: firstPage.cursor,
            });
            const secondOptions = engine.scan.mock.getCall(1).arguments[2];

            assertEqual('string', typeof firstPage.cursor);
            assertMatches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, firstPage.cursor);
            assertEqual('2026-07-17', secondOptions.cursor.sortKey);
            assertEqual('note-1', secondOptions.cursor.id);
            assertEqual(5, secondOptions.limit);
            assertEqual('note-2', secondPage.records[0].id);
            assertEqual(null, secondPage.cursor);
            tracker.reset();
        });

        it('rejects malformed or tampered cursors before calling the engine', async () => {
            const { store, engine, tracker } = makeStore({
                implementations: {
                    scan: async () => {
                        return { records: [], cursor: { id: 'note-1' } };
                    },
                },
            });
            const page = await store.scan({}, 'Note');
            const replacement = page.cursor.endsWith('A') ? 'B' : 'A';
            const tamperedCursor = `${ page.cursor.slice(0, -1) }${ replacement }`;
            const cursors = [
                'not-a-cursor',
                `${ page.cursor }.extra`,
                tamperedCursor,
            ];

            for (const cursor of cursors) {
                const caught = await catchAsyncError(() => store.scan({}, 'Note', { cursor }));

                assertInvalidCursorError(caught);
            }
            assertEqual(1, engine.scan.mock.callCount());
            tracker.reset();
        });

        it('rejects a cursor replayed with a different scan scope but allows a new page limit', async () => {
            const { store, engine, tracker } = makeStore({
                implementations: {
                    scan: async () => {
                        return { records: [], cursor: { id: 'note-1' } };
                    },
                },
            });
            const page = await store.scan({}, 'Note', {
                descending: true,
                limit: 10,
                greaterThan: 'a',
            });
            const invalidOperations = [
                () => store.scan({}, 'OtherType', {
                    descending: true,
                    greaterThan: 'a',
                    cursor: page.cursor,
                }),
                () => store.scan({}, 'Note', {
                    descending: false,
                    greaterThan: 'a',
                    cursor: page.cursor,
                }),
                () => store.scan({}, 'Note', {
                    descending: true,
                    greaterThan: 'b',
                    cursor: page.cursor,
                }),
                () => store.query({}, 'Note', {
                    index: 'by_name',
                    descending: true,
                    greaterThan: 'a',
                    cursor: page.cursor,
                }),
            ];

            for (const operation of invalidOperations) {
                const caught = await catchAsyncError(operation);

                assertInvalidCursorError(caught);
            }

            await store.scan({}, 'Note', {
                descending: true,
                limit: 1,
                greaterThan: 'a',
                cursor: page.cursor,
            });

            assertEqual(2, engine.scan.mock.callCount());
            assertEqual(0, engine.query.mock.callCount());
            tracker.reset();
        });

        it('rejects non-string public cursors and invalid engine continuations', async () => {
            const invalidPublicCursors = [ null, '', {} ];

            for (const cursor of invalidPublicCursors) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.scan({}, 'Note', { cursor }));

                assertAssertionError(caught, 'options.cursor must be a non-empty string');
                assertEqual(0, engine.scan.mock.callCount());
                tracker.reset();
            }

            const invalidEngineCursors = [ undefined, [], 'private-cursor' ];

            for (const cursor of invalidEngineCursors) {
                const { store, tracker } = makeStore({
                    implementations: {
                        scan: async () => ({ records: [], cursor }),
                    },
                });
                const caught = await catchAsyncError(() => store.scan({}, 'Note'));

                assertAssertionError(caught, 'engine result cursor must be a plain object or null');
                tracker.reset();
            }
        });

        it('rejects missing context, type, and invalid limits before calling the engine', async () => {
            const cases = [
                { context: null, type: 'Note', options: undefined, message: 'requires a context object' },
                { context: {}, type: '', options: undefined, message: 'requires a type string' },
                { context: {}, type: 'Note', options: { limit: 0 }, message: 'limit must be an integer greater than zero' },
                { context: {}, type: 'Note', options: { limit: 1.5 }, message: 'limit must be an integer greater than zero' },
            ];

            for (const testCase of cases) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.scan(
                    testCase.context,
                    testCase.type,
                    testCase.options,
                ));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.scan.mock.callCount());
                tracker.reset();
            }
        });
    });

    describe('query', ({ it }) => {
        it('passes index and pagination options to the engine', async () => {
            const records = [ { type: 'User', id: 'user-1', key: 'a@example.com' } ];
            const engineResult = { records, cursor: null };
            const context = { requestId: 'query-request' };
            const { store, engine, tracker } = makeStore({
                implementations: {
                    query: async () => engineResult,
                },
            });

            const result = await store.query(context, 'User', {
                index: 'by_email',
                descending: true,
                limit: 20,
                equalTo: 'a@example.com',
            });
            const options = engine.query.mock.getCall(0).arguments[2];

            assertEqual(engineResult, result);
            assertEqual(context, engine.query.mock.getCall(0).arguments[0]);
            assertEqual('User', engine.query.mock.getCall(0).arguments[1]);
            assertEqual('by_email', options.index);
            assertEqual(true, options.descending);
            assertEqual(20, options.limit);
            assertEqual('a@example.com', options.equalTo);
            assertUndefined(options.cursor);
            tracker.reset();
        });

        it('round trips an engine continuation through a signed query cursor', async () => {
            let callCount = 0;
            const { store, engine, tracker } = makeStore({
                implementations: {
                    query: async () => {
                        callCount += 1;
                        if (callCount === 1) {
                            return {
                                records: [],
                                cursor: { key: 'm', type: 'User', id: 'user-1' },
                            };
                        }
                        return { records: [], cursor: null };
                    },
                },
            });

            const firstPage = await store.query({}, 'User', {
                index: 'by_name',
                lessThan: 'z',
            });
            await store.query({}, 'User', {
                index: 'by_name',
                lessThan: 'z',
                cursor: firstPage.cursor,
            });
            const cursor = engine.query.mock.getCall(1).arguments[2].cursor;

            assertEqual('m', cursor.key);
            assertEqual('User', cursor.type);
            assertEqual('user-1', cursor.id);
            tracker.reset();
        });

        it('binds a query cursor to its index and range options', async () => {
            const { store, engine, tracker } = makeStore({
                implementations: {
                    query: async () => {
                        return { records: [], cursor: { key: 'a@example.com', id: 'user-1' } };
                    },
                },
            });
            const page = await store.query({}, 'User', {
                index: 'by_email',
                equalTo: 'a@example.com',
            });
            const operations = [
                () => store.query({}, 'User', {
                    index: 'by_name',
                    equalTo: 'a@example.com',
                    cursor: page.cursor,
                }),
                () => store.query({}, 'User', {
                    index: 'by_email',
                    equalTo: 'b@example.com',
                    cursor: page.cursor,
                }),
                () => store.query({}, 'OtherType', {
                    index: 'by_email',
                    equalTo: 'a@example.com',
                    cursor: page.cursor,
                }),
            ];

            for (const operation of operations) {
                const caught = await catchAsyncError(operation);

                assertInvalidCursorError(caught);
            }
            assertEqual(1, engine.query.mock.callCount());
            tracker.reset();
        });

        it('rejects cursors signed with a different runtime secret', async () => {
            const first = makeStore({
                implementations: {
                    query: async () => {
                        return { records: [], cursor: { key: 'a', id: 'user-1' } };
                    },
                },
            });
            const second = makeStore({ cursorSigningSecret: 'different-signing-secret' });
            const page = await first.store.query({}, 'User', { index: 'by_name' });

            const caught = await catchAsyncError(() => second.store.query({}, 'User', {
                index: 'by_name',
                cursor: page.cursor,
            }));

            assertInvalidCursorError(caught);
            assertEqual(0, second.engine.query.mock.callCount());
            first.tracker.reset();
            second.tracker.reset();
        });

        it('rejects missing arguments and invalid pagination options before calling the engine', async () => {
            const cases = [
                { context: null, type: 'User', options: { index: 'by_name' }, message: 'requires a context object' },
                { context: {}, type: '', options: { index: 'by_name' }, message: 'requires a type' },
                { context: {}, type: 'User', options: undefined, message: 'requires an index' },
                { context: {}, type: 'User', options: { index: '' }, message: 'requires an index' },
                { context: {}, type: 'User', options: { index: 'by_name', limit: -1 }, message: 'limit must be an integer greater than zero' },
                { context: {}, type: 'User', options: { index: 'by_name', cursor: '' }, message: 'cursor must be a non-empty string' },
            ];

            for (const testCase of cases) {
                const { store, engine, tracker } = makeStore();
                const caught = await catchAsyncError(() => store.query(
                    testCase.context,
                    testCase.type,
                    testCase.options,
                ));

                assertAssertionError(caught, testCase.message);
                assertEqual(0, engine.query.mock.callCount());
                tracker.reset();
            }
        });
    });

    describe('sortKeyPrefixRange', ({ it }) => {
        it('builds inclusive lower and exclusive upper bounds for a prefix', () => {
            const range = sortKeyPrefixRange('account:123:');

            assertEqual('account:123:', range.greaterThanOrEqualTo);
            assertEqual(`account:123:${ MAX_SORT_KEY_CHAR }`, range.lessThan);
            assertEqual('\uFFFF', MAX_SORT_KEY_CHAR);
        });

        it('rejects an empty prefix', () => {
            const caught = catchError(() => sortKeyPrefixRange(''));

            assertAssertionError(caught, 'prefix must be a non-empty string');
        });
    });
});
