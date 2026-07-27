import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
    assertUndefined,
} from 'kixx-assert';

import Collection from '../../../../src/app/collections/base-key-value-store-collection.js';
import Record from '../../../../src/app/collections/base-key-value-store-record.js';


const CONTEXT = { requestId: 'request-1' };


describe('Base KeyValueStore Collection', ({ describe }) => {

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

            assertAssertionError(caught, 'Collection constructor requires a "db" KeyValueStore');
        });

        it('throws when the config is missing', () => {
            const caught = catchError(() => new TestCollection());

            assertAssertionError(caught, 'Collection constructor requires a "db" KeyValueStore');
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

    describe('get()', ({ it }) => {
        it('reads the type-scoped key as JSON and wraps the stored value', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.get(CONTEXT, 'test-id');
            const call = db.calls[0];

            assertEqual('get', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType_test-id', call.args[1]);
            assertEqual('json', call.args[2].type);
            assert(record instanceof Record);
            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual('abc', record.get('token'));
        });

        it('returns null when the key is absent or expired', async () => {
            const db = makeDb({ get: () => null });
            const collection = new TestCollection({ db });

            assertEqual(null, await collection.get(CONTEXT, 'test-id'));
        });

        it('wraps the stored value in the configured Record subclass', async () => {
            const db = makeDb();
            const collection = new CustomRecordCollection({ db });

            const record = await collection.get(CONTEXT, 'test-id');

            assert(record instanceof TestRecord);
            assertEqual('abc', record.token);
        });

        it('throws when the id is not a non-empty string', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => collection.get(CONTEXT, ''));

            assertAssertionError(caught, 'Collection#get() invalid id for Key Value Collection (type:TestType)');
            assertEqual(0, db.calls.length);
        });
    });

    describe('put()', ({ it }) => {
        it('writes the JSON record under the type-scoped key', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.put(CONTEXT, { id: 'test-id', token: 'abc' });
            const call = db.calls[0];

            assertEqual('put', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType_test-id', call.args[1]);
            assertEqual('TestType', call.args[2].type);
            assertEqual('test-id', call.args[2].id);
            assertEqual('abc', call.args[2].token);
            assert(record instanceof Record);
            assertEqual('test-id', record.id);
            assertEqual('abc', record.get('token'));
        });

        it('forwards expiration options and forces the json value type', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            await collection.put(CONTEXT, { id: 'test-id' }, { expirationTtl: 60, type: 'text' });

            assertEqual(60, db.calls[0].args[3].expirationTtl);
            assertEqual('json', db.calls[0].args[3].type);
        });

        it('defaults the options to the json value type', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            await collection.put(CONTEXT, { id: 'test-id' });

            assertEqual('json', db.calls[0].args[3].type);
        });

        it('generates an id when the input does not provide one', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.put(CONTEXT, { token: 'abc' });

            assertNonEmptyString(record.id);
            assertEqual(`TestType_${ record.id }`, db.calls[0].args[1]);
        });

        it('uses the generateUniqueId() override', async () => {
            const db = makeDb();
            const collection = new DerivedIdCollection({ db });

            const record = await collection.put(CONTEXT, { token: 'abc' });

            assertEqual('derived-abc', record.id);
            assertEqual('TestType_derived-abc', db.calls[0].args[1]);
        });

        it('does not copy input type or id into the attributes', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const record = await collection.put(CONTEXT, {
                type: 'IgnoredType',
                id: 'test-id',
                token: 'abc',
            });

            assertEqual('TestType', db.calls[0].args[2].type);
            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
        });

        it('accepts an instance of the configured Record class', async () => {
            const db = makeDb();
            const collection = new CustomRecordCollection({ db });
            const dto = TestRecord.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { token: 'abc' },
            });

            const record = await collection.put(CONTEXT, dto);

            assertEqual(dto, record);
            assertEqual('abc', db.calls[0].args[2].token);
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

            const caught = await catchAsyncError(() => collection.put(CONTEXT, 'nope'));

            assertAssertionError(caught, 'Collection#put() input must be a plain object');
            assertEqual(0, db.calls.length);
        });
    });

    describe('delete()', ({ it }) => {
        it('deletes the type-scoped key', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const result = await collection.delete(CONTEXT, 'test-id');
            const call = db.calls[0];

            assertEqual('delete', call.method);
            assertEqual(CONTEXT, call.args[0]);
            assertEqual('TestType_test-id', call.args[1]);
            assertUndefined(result);
        });

        it('throws when the id is not a non-empty string', async () => {
            const db = makeDb();
            const collection = new TestCollection({ db });

            const caught = await catchAsyncError(() => collection.delete(CONTEXT, null));

            assertAssertionError(caught, 'Collection#delete() invalid id for Key Value Collection (type:TestType)');
            assertEqual(0, db.calls.length);
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
});

class TestRecord extends Record {
    get token() {
        return this.get('token');
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
        return `derived-${ attributes.token }`;
    }
}

/**
 * Creates a KeyValueStore test double which records every call and returns a
 * stored JSON value for reads by default.
 */
function makeDb(overrides) {
    const calls = [];
    const db = { calls };

    const defaults = {
        get() {
            return {
                type: 'TestType',
                id: 'test-id',
                token: 'abc',
            };
        },
        put() {
            return undefined;
        },
        delete() {
            return undefined;
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
