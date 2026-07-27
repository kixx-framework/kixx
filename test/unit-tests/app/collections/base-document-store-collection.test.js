import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
    assertUndefined,
} from 'kixx-assert';

import Collection from '../../../../src/app/collections/base-document-store-collection.js';
import Record from '../../../../src/app/collections/base-document-store-record.js';


const CONTEXT = { requestId: 'request-1' };
const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T03:04:05.000Z';


describe('Base DocumentStore Collection', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('exposes the configured type and Record class', () => {
            const collection = new TestCollection({ db: makeDb() });

            assertEqual('TestType', collection.type);
            assertEqual(Record, collection.Record);
        });

        it('uses the Record subclass declared on the collection', () => {
            const collection = new CustomRecordCollection({ db: makeDb() });

            assertEqual(TestRecord, collection.Record);
        });

        it('throws when the db is missing', () => {
            const caught = catchError(() => new TestCollection({}));

            assertAssertionError(caught, 'Collection constructor requires a "db" DocumentStore');
        });

        it('throws when the config is missing', () => {
            const caught = catchError(() => new TestCollection());

            assertAssertionError(caught, 'Collection constructor requires a "db" DocumentStore');
        });

        it('throws when TYPE has not been overridden', () => {
            const caught = catchError(() => new Collection({ db: makeDb() }));

            assertAssertionError(caught, 'Collection.TYPE must be overridden from the base class');
        });

        it('throws when TYPE is not a non-empty string', () => {
            class EmptyTypeCollection extends Collection {
                static TYPE = '';
            }

            const caught = catchError(() => new EmptyTypeCollection({ db: makeDb() }));

            assertAssertionError(caught, 'Collection.TYPE must be a non-empty string');
        });
    });

    describe('create()', ({ it }) => {
        it('coerces a plain object, writes it, and wraps the stored record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.create(CONTEXT, { id: 'test-id', title: 'Hello' });
            const call = db.calls[0];

            assertEqual('create', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType', call.args[1].type);
            assertEqual('test-id', call.args[1].id);
            assertEqual('Hello', call.args[1].title);
            assert(record instanceof Record);
            assertEqual('test-id', record.id);
            assertEqual(1, record.version);
            assertEqual('Hello', record.get('title'));
        });

        it('generates an id when the input does not provide one', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.create(CONTEXT, { title: 'Hello' });

            assertNonEmptyString(record.id);
            assertEqual(record.id, db.calls[0].args[1].id);
        });

        it('uses the generateUniqueId() override', async () => {
            const db = makeDb();
            const collection = new DerivedIdCollection({ db });

            const record = await collection.create(CONTEXT, { title: 'Hello' });

            assertEqual('derived-Hello', record.id);
        });

        it('does not copy input type, id, or sortKey into the attributes', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.create(CONTEXT, {
                type: 'IgnoredType',
                id: 'test-id',
                sortKey: 'sort-1',
                title: 'Hello',
            });

            assertEqual('TestType', db.calls[0].args[1].type);
            assertEqual('sort-1', db.calls[0].args[1].sortKey);
            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
            assertUndefined(record.get('sortKey'));
        });

        it('omits the sortKey when the input does not provide one', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            await collection.create(CONTEXT, { id: 'test-id' });

            assert(!Object.hasOwn(db.calls[0].args[1], 'sortKey'));
        });

        it('uses the generateSortKey() override', async () => {
            const db = makeDb();
            const collection = new SortKeyCollection({ db });

            const record = await collection.create(CONTEXT, { id: 'test-id', title: 'Hello' });

            assertEqual('title:Hello', db.calls[0].args[1].sortKey);
            assertEqual('title:Hello', record.sortKey);
        });

        it('throws when generateSortKey() returns an unsupported value', async () => {
            const db = makeDb();
            const collection = new InvalidSortKeyCollection({ db });

            const caught = await catchAsyncError(() => collection.create(CONTEXT, { id: 'test-id' }));

            assertAssertionError(caught, 'Collection#generateSortKey() must return a string, null, or undefined');
            assertEqual(0, db.calls.length);
        });

        it('accepts an instance of the configured Record class', async () => {
            const db = makeDb();
            const collection = new CustomRecordCollection({ db });
            const dto = TestRecord.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { title: 'Hello' },
            });

            const record = await collection.create(CONTEXT, dto);

            assertEqual('Hello', db.calls[0].args[1].title);
            assert(record instanceof TestRecord);
            assertEqual('Hello', record.title);
        });

        it('runs the Record validate() hook before the store call', async () => {
            const db = makeDb();
            const collection = new ValidatingCollection({ db });

            const caught = await catchAsyncError(() => collection.create(CONTEXT, { id: 'test-id' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationTestError', caught.name);
            assertEqual(0, db.calls.length);
        });

        it('throws when the input is not a plain object or Record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => collection.create(CONTEXT, 'nope'));

            assertAssertionError(caught, 'Collection#create() input must be a plain object');
            assertEqual(0, db.calls.length);
        });
    });

    describe('put()', ({ it }) => {
        it('coerces a plain object, writes it, and wraps the stored record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.put(CONTEXT, { id: 'test-id', title: 'Hello' });
            const call = db.calls[0];

            assertEqual('put', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType', call.args[1].type);
            assertEqual('test-id', call.args[1].id);
            assert(record instanceof Record);
            assertEqual('Hello', record.get('title'));
        });

        it('runs the Record validate() hook before the store call', async () => {
            const db = makeDb();
            const collection = new ValidatingCollection({ db });

            const caught = await catchAsyncError(() => collection.put(CONTEXT, { id: 'test-id' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationTestError', caught.name);
            assertEqual(0, db.calls.length);
        });

        it('throws when the input is not a plain object or Record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => collection.put(CONTEXT, null));

            assertAssertionError(caught, 'Collection#put() input must be a plain object');
            assertEqual(0, db.calls.length);
        });
    });

    describe('update()', ({ it }) => {
        it('passes the record version to the store and wraps the result', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });
            const dto = makeStoredDto({ version: 4 });

            const record = await collection.update(CONTEXT, dto);
            const call = db.calls[0];

            assertEqual('update', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('test-id', call.args[1].id);
            assertEqual(4, call.args[2]);
            assert(record instanceof Record);
            assertEqual(5, record.version);
        });

        it('throws when the dto is not an instance of the Record class', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => {
                return collection.update(CONTEXT, { type: 'TestType', id: 'test-id' });
            });

            assertAssertionError(caught, 'Collection#update() requires an instance of this.Record');
            assertEqual(0, db.calls.length);
        });

        it('throws when the dto type does not match the collection type', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });
            const dto = makeStoredDto({ type: 'OtherType' });

            const caught = await catchAsyncError(() => collection.update(CONTEXT, dto));

            assertAssertionError(caught, 'The Record type is expected to match the Collection type');
            assertEqual(0, db.calls.length);
        });

        it('runs the Record validate() hook before the store call', async () => {
            const db = makeDb();
            const collection = new ValidatingCollection({ db });
            const dto = ValidatingRecord.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: {},
            });

            const caught = await catchAsyncError(() => collection.update(CONTEXT, dto));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationTestError', caught.name);
            assertEqual(0, db.calls.length);
        });
    });

    describe('updateWithRetry()', ({ it }) => {
        it('does not invoke the callback when the first attempt succeeds', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });
            const callbackCalls = [];

            const record = await collection.updateWithRetry(CONTEXT, makeStoredDto(), (latest) => {
                callbackCalls.push(latest);
            });

            assertEqual(0, callbackCalls.length);
            assertEqual(1, db.calls.length);
            assertEqual('test-id', record.id);
        });

        it('refetches the latest record and retries with the callback result', async () => {
            const db = makeDb({
                update: failTimes(1, () => makeNamedError('VersionConflictError')),
            });
            const collection = new TestCollection({ db });
            const callbackCalls = [];

            const record = await collection.updateWithRetry(CONTEXT, makeStoredDto(), (latest, meta) => {
                callbackCalls.push({ latest, meta });
                return latest.set('title', 'Merged');
            });

            assertEqual(1, callbackCalls.length);
            assertEqual(1, callbackCalls[0].meta.attempt);
            assertEqual('VersionConflictError', callbackCalls[0].meta.conflict.name);
            assertEqual(9, callbackCalls[0].latest.version);
            assertEqual('get', db.calls[1].method);
            assertEqual('TestType', db.calls[1].args[1]);
            assertEqual('test-id', db.calls[1].args[2]);
            assertEqual(9, db.calls[2].args[2]);
            assertEqual('Merged', db.calls[2].args[1].title);
            assertEqual('Merged', record.get('title'));
        });

        it('uses the refetched record when the callback returns undefined', async () => {
            const db = makeDb({
                update: failTimes(1, () => makeNamedError('VersionConflictError')),
            });
            const collection = new TestCollection({ db });

            const record = await collection.updateWithRetry(CONTEXT, makeStoredDto(), (latest) => {
                latest.set('title', 'Refetched');
            });

            assertEqual(9, db.calls[2].args[2]);
            assertEqual('Refetched', record.get('title'));
        });

        it('throws RetryLimitExceededError when conflicts continue past the retry limit', async () => {
            const db = makeDb({
                update: () => {
                    throw makeNamedError('VersionConflictError');
                },
            });
            const collection = new TestCollection({ db });
            let callbackCount = 0;

            const caught = await catchAsyncError(() => {
                return collection.updateWithRetry(CONTEXT, makeStoredDto(), () => {
                    callbackCount += 1;
                }, { retryLimit: 2 });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('RetryLimitExceededError', caught.name);
            assertEqual('RetryLimitExceededError', caught.code);
            assertEqual('TestType', caught.type);
            assertEqual('test-id', caught.id);
            assertEqual(2, caught.retryLimit);
            assertEqual('VersionConflictError', caught.cause.name);
            assertEqual(2, callbackCount);
            assertEqual(3, db.calls.filter(isMethod('update')).length);
        });

        it('does not retry when the retry limit is zero', async () => {
            const db = makeDb({
                update: () => {
                    throw makeNamedError('VersionConflictError');
                },
            });
            const collection = new TestCollection({ db });
            let callbackCount = 0;

            const caught = await catchAsyncError(() => {
                return collection.updateWithRetry(CONTEXT, makeStoredDto(), () => {
                    callbackCount += 1;
                }, { retryLimit: 0 });
            });

            assertEqual('RetryLimitExceededError', caught.name);
            assertEqual(0, callbackCount);
            assertEqual(1, db.calls.length);
        });

        it('throws DocumentNotFoundError when the document disappears during a retry', async () => {
            const db = makeDb({
                update: () => {
                    throw makeNamedError('VersionConflictError');
                },
                get: () => null,
            });
            const collection = new TestCollection({ db });
            let callbackCount = 0;

            const caught = await catchAsyncError(() => {
                return collection.updateWithRetry(CONTEXT, makeStoredDto(), () => {
                    callbackCount += 1;
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('DocumentNotFoundError', caught.name);
            assertEqual('TestType', caught.type);
            assertEqual('test-id', caught.id);
            assertEqual(0, callbackCount);
        });

        it('rethrows errors which are not version conflicts', async () => {
            const db = makeDb({
                update: () => {
                    throw makeNamedError('DocumentUniqueIndexViolationError');
                },
            });
            const collection = new TestCollection({ db });
            let callbackCount = 0;

            const caught = await catchAsyncError(() => {
                return collection.updateWithRetry(CONTEXT, makeStoredDto(), () => {
                    callbackCount += 1;
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('DocumentUniqueIndexViolationError', caught.name);
            assertEqual(0, callbackCount);
        });

        it('throws when the callback is not a function', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => collection.updateWithRetry(CONTEXT, makeStoredDto()));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertEqual(0, db.calls.length);
        });

        it('throws when the retry limit is not a non-negative integer', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => {
                return collection.updateWithRetry(CONTEXT, makeStoredDto(), () => {}, { retryLimit: -1 });
            });

            assertAssertionError(caught, 'options.retryLimit must be an integer greater than or equal to zero');
            assertEqual(0, db.calls.length);
        });
    });

    describe('get()', ({ it }) => {
        it('scopes the read to the collection type and wraps the record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.get(CONTEXT, 'test-id');
            const call = db.calls[0];

            assertEqual('get', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType', call.args[1]);
            assertEqual('test-id', call.args[2]);
            assert(record instanceof Record);
            assertEqual('test-id', record.id);
        });

        it('returns null when the document does not exist', async () => {
            const db = makeDb({ get: () => null });
            const collection = new TestCollection({ db });

            assertEqual(null, await collection.get(CONTEXT, 'test-id'));
        });

        it('wraps the record in the configured Record subclass', async () => {
            const db = makeDb();
            const collection = new CustomRecordCollection({ db });

            const record = await collection.get(CONTEXT, 'test-id');

            assert(record instanceof TestRecord);
            assertEqual('Stored', record.title);
        });
    });

    describe('delete()', ({ it }) => {
        it('scopes the delete to the collection type and returns the store result', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const result = await collection.delete(CONTEXT, 'test-id');
            const call = db.calls[0];

            assertEqual('delete', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType', call.args[1]);
            assertEqual('test-id', call.args[2]);
            assertUndefined(call.args[3]);
            assertEqual(true, result);
        });

        it('returns false when the store reports no deletion', async () => {
            const db = makeDb({ delete: () => false });
            const collection = new TestCollection({ db });

            assertEqual(false, await collection.delete(CONTEXT, 'test-id'));
        });
    });

    describe('deleteStrict()', ({ it }) => {
        it('passes the record version to the store', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const result = await collection.deleteStrict(CONTEXT, makeStoredDto({ version: 4 }));
            const call = db.calls[0];

            assertEqual('delete', call.method);
            assertEqual('TestType', call.args[1]);
            assertEqual('test-id', call.args[2]);
            assertEqual(4, call.args[3]);
            assertEqual(true, result);
        });

        it('throws when the dto is not an instance of the Record class', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => {
                return collection.deleteStrict(CONTEXT, { type: 'TestType', id: 'test-id', version: 1 });
            });

            assertAssertionError(caught, 'Collection#deleteStrict() requires an instance of this.Record');
            assertEqual(0, db.calls.length);
        });

        it('throws when the dto type does not match the collection type', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => {
                return collection.deleteStrict(CONTEXT, makeStoredDto({ type: 'OtherType' }));
            });

            assertAssertionError(caught, 'The Record type is expected to match the Collection type');
            assertEqual(0, db.calls.length);
        });
    });

    describe('scan()', ({ it }) => {
        it('scopes the scan to the collection type and wraps each record', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });
            const options = { limit: 10, descending: true };

            const result = await collection.scan(CONTEXT, options);
            const call = db.calls[0];

            assertEqual('scan', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType', call.args[1]);
            assertEqual(options, call.args[2]);
            assertEqual(2, result.items.length);
            assert(result.items[0] instanceof Record);
            assertEqual('id-1', result.items[0].id);
            assertEqual('next-cursor', result.cursor);
        });

        it('returns a null cursor on the last page', async () => {
            const db = makeDb({
                scan: () => {
                    return { records: [], cursor: undefined };
                },
            });
            const collection = new TestCollection({ db });

            const result = await collection.scan(CONTEXT);

            assertEqual(0, result.items.length);
            assertEqual(null, result.cursor);
        });
    });

    describe('query()', ({ it }) => {
        it('scopes the query to the collection type and wraps each record', async () => {
            const db = makeDb();
            const collection = new CustomRecordCollection({ db });
            const options = { index: 'byTitle', equalTo: 'Stored' };

            const result = await collection.query(CONTEXT, options);
            const call = db.calls[0];

            assertEqual('query', call.method);
            assertEqual('TestType', call.args[1]);
            assertEqual(options, call.args[2]);
            assertEqual(2, result.items.length);
            assert(result.items[0] instanceof TestRecord);
            assertEqual('next-cursor', result.cursor);
        });

        it('returns a null cursor on the last page', async () => {
            const db = makeDb({
                query: () => {
                    return { records: [], cursor: null };
                },
            });
            const collection = new TestCollection({ db });

            const result = await collection.query(CONTEXT, { index: 'byTitle' });

            assertEqual(null, result.cursor);
        });
    });

    describe('generateUniqueId()', ({ it }) => {
        it('returns a unique string by default', () => {
            const collection = new TestCollection({ db: makeDb() });

            const id = collection.generateUniqueId({});

            assertNonEmptyString(id);
            assert(id !== collection.generateUniqueId({}));
        });
    });

    describe('generateSortKey()', ({ it }) => {
        it('passes through the sortKey emitted by the document', () => {
            const collection = new TestCollection({ db: makeDb() });

            assertEqual('sort-1', collection.generateSortKey({ sortKey: 'sort-1' }));
            assertUndefined(collection.generateSortKey({}));
            assertUndefined(collection.generateSortKey());
        });
    });
});

class TestRecord extends Record {
    get title() {
        return this.get('title');
    }
}

class ValidationTestError extends Error {
    name = 'ValidationTestError';
}

class ValidatingRecord extends Record {
    validate() {
        throw new ValidationTestError('invalid record');
    }
}

class TestCollection extends Collection {
    static TYPE = 'TestType';
}

class CustomRecordCollection extends Collection {
    static TYPE = 'TestType';
    static Record = TestRecord;
}

class ValidatingCollection extends Collection {
    static TYPE = 'TestType';
    static Record = ValidatingRecord;
}

class DerivedIdCollection extends Collection {
    static TYPE = 'TestType';

    generateUniqueId(attributes) {
        return `derived-${ attributes.title }`;
    }
}

class SortKeyCollection extends Collection {
    static TYPE = 'TestType';

    generateSortKey(doc) {
        return `title:${ doc.title }`;
    }
}

class InvalidSortKeyCollection extends Collection {
    static TYPE = 'TestType';

    generateSortKey() {
        return 42;
    }
}

/**
 * Creates a DocumentStore test double which records every call and returns
 * stored records derived from the written document by default.
 */
function makeDb(overrides) {
    const calls = [];
    const db = { calls };

    const defaults = {
        create(_context, doc) {
            return makeStoreRecord({ doc, version: 1 });
        },
        update(_context, doc) {
            return makeStoreRecord({ doc, version: 5 });
        },
        put(_context, doc) {
            return makeStoreRecord({ doc, version: 2 });
        },
        get(_context, type, id) {
            return makeStoreRecord({ doc: { type, id, title: 'Stored' }, version: 9 });
        },
        delete() {
            return true;
        },
        scan() {
            return makePage();
        },
        query() {
            return makePage();
        },
    };

    for (const method of Object.keys(defaults)) {
        const implementation = overrides?.[method] || defaults[method];

        db[method] = async function dbMethod(...args) {
            calls.push({ method, args });
            return implementation(...args);
        };
    }

    return db;
}

function makePage() {
    return {
        records: [
            makeStoreRecord({ doc: { type: 'TestType', id: 'id-1', title: 'Stored' } }),
            makeStoreRecord({ doc: { type: 'TestType', id: 'id-2', title: 'Stored' } }),
        ],
        cursor: 'next-cursor',
    };
}

function makeStoreRecord(spec) {
    const { doc, version = 1 } = spec;

    return {
        type: doc.type,
        id: doc.id,
        sortKey: doc.sortKey ?? null,
        version,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        doc,
    };
}

function makeStoredDto(spec) {
    const { type = 'TestType', version = 1 } = spec ?? {};

    return new Record({
        type,
        id: 'test-id',
        sortKey: null,
        version,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        attributes: { title: 'Hello' },
    });
}

/**
 * Builds a store method implementation which throws for the first `count`
 * calls, then falls back to the default write behavior.
 */
function failTimes(count, makeError) {
    let failures = 0;

    return function failingUpdate(_context, doc) {
        if (failures < count) {
            failures += 1;
            throw makeError();
        }
        return makeStoreRecord({ doc, version: 10 });
    };
}

function isMethod(name) {
    return function matchMethod(call) {
        return call.method === name;
    };
}

function makeNamedError(name) {
    const error = new Error(name);
    error.name = name;
    return error;
}

function assertAssertionError(error, messagePart) {
    assert(error, 'expected an error to be thrown');
    assertEqual('AssertionError', error.name);
    assertMatches(messagePart, error.message);
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
