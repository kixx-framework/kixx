import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import Record from '../../../../src/app/collections/base-document-store-record.js';


const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T03:04:05.000Z';
const EPOCH = '1970-01-01T00:00:00.000Z';


describe('Base DocumentStore Record', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('assigns store metadata and retains the attributes object by reference', () => {
            const attributes = { title: 'Hello' };
            const record = makeRecord({ attributes });

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual('sort-1', record.sortKey);
            assertEqual(3, record.version);
            assertEqual(new Date(CREATED_AT).toISOString(), record.createdAt.toISOString());
            assertEqual(new Date(UPDATED_AT).toISOString(), record.updatedAt.toISOString());

            attributes.title = 'Mutated';
            assertEqual('Mutated', record.get('title'));
        });

        it('accepts Date instances for the timestamps', () => {
            const record = makeRecord({
                createdAt: new Date(CREATED_AT),
                updatedAt: new Date(UPDATED_AT),
            });

            assertEqual(new Date(CREATED_AT).toISOString(), record.createdAt.toISOString());
            assertEqual(new Date(UPDATED_AT).toISOString(), record.updatedAt.toISOString());
        });

        it('accepts a null sortKey', () => {
            const record = makeRecord({ sortKey: null });
            assertEqual(null, record.sortKey);
        });

        it('exposes the metadata properties as read only', () => {
            const record = makeRecord();

            const caught = catchError(() => {
                record.id = 'new-id';
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertEqual('test-id', record.id);
        });

        it('throws when the spec is not an object', () => {
            const caught = catchError(() => new Record(null));

            assertAssertionError(caught, 'Record constructor requires a spec object');
        });

        it('throws when spec.type is not a non-empty string', () => {
            const caught = catchError(() => makeRecord({ type: '' }));

            assertAssertionError(caught, 'Record spec.type must be a non-empty string');
        });

        it('throws when spec.id is not a non-empty string', () => {
            const caught = catchError(() => makeRecord({ id: null }));

            assertAssertionError(caught, 'Record spec.id must be a non-empty string');
        });

        it('throws when spec.sortKey is neither a string nor null', () => {
            const caught = catchError(() => makeRecord({ sortKey: 7 }));

            assertAssertionError(caught, 'Record spec.sortKey must be a string or null');
        });

        it('throws when spec.version is not an integer', () => {
            const caught = catchError(() => makeRecord({ version: 1.5 }));

            assertAssertionError(caught, 'Record spec.version must be an integer');
        });

        it('throws when spec.attributes is not a plain object', () => {
            const caught = catchError(() => makeRecord({ attributes: [] }));

            assertAssertionError(caught, 'Record spec.attributes must be a plain object');
        });

        it('throws when spec.createdAt cannot be parsed as a date', () => {
            const caught = catchError(() => makeRecord({ createdAt: 'not-a-date' }));

            assertAssertionError(caught, 'Record spec.createdAt must be a parsable date string');
        });

        it('throws when spec.updatedAt cannot be parsed as a date', () => {
            const caught = catchError(() => makeRecord({ updatedAt: 'not-a-date' }));

            assertAssertionError(caught, 'Record spec.updatedAt must be a parsable date string');
        });
    });

    describe('validate()', ({ it }) => {
        it('is a no-op on the base class', () => {
            const record = makeRecord();
            assertUndefined(record.validate());
        });
    });

    describe('forWrite()', ({ it }) => {
        it('creates an instance with placeholder store metadata', () => {
            const record = Record.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { title: 'Hello' },
            });

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual(null, record.sortKey);
            assertEqual(0, record.version);
            assertEqual(EPOCH, record.createdAt.toISOString());
            assertEqual(EPOCH, record.updatedAt.toISOString());
            assertEqual('Hello', record.get('title'));
        });

        it('uses the provided sortKey', () => {
            const record = Record.forWrite({
                type: 'TestType',
                id: 'test-id',
                sortKey: 'sort-1',
                attributes: {},
            });

            assertEqual('sort-1', record.sortKey);
        });

        it('creates an instance of the receiving subclass', () => {
            const record = TestRecord.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { title: 'Hello' },
            });

            assert(record instanceof TestRecord);
            assertEqual('Hello', record.title);
        });

        it('throws when the spec is missing', () => {
            const caught = catchError(() => Record.forWrite());

            assertAssertionError(caught, 'Record spec.type must be a non-empty string');
        });
    });

    describe('get() and set()', ({ it }) => {
        it('reads and writes user-defined attributes', () => {
            const record = makeRecord({ attributes: { title: 'Hello' } });

            assertEqual('Hello', record.get('title'));
            assertUndefined(record.get('missing'));
            assertEqual(record, record.set('title', 'Updated'));
            assertEqual('Updated', record.get('title'));
        });

        it('does not read store metadata as attributes', () => {
            const record = makeRecord();

            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
            assertUndefined(record.get('version'));
        });

        it('throws when the attribute name for get() is invalid', () => {
            const caught = catchError(() => makeRecord().get(''));

            assertAssertionError(caught, 'Record#get() attribute name must be a non-empty string');
        });

        it('throws when the attribute name for set() is invalid', () => {
            const caught = catchError(() => makeRecord().set(null, 'value'));

            assertAssertionError(caught, 'Record#set() attribute name must be a non-empty string');
        });
    });

    describe('merge()', ({ it }) => {
        it('shallowly assigns the patch over existing attributes', () => {
            const record = makeRecord({
                attributes: { title: 'Hello', meta: { a: 1, b: 2 } },
            });

            assertEqual(record, record.merge({ title: 'Updated', meta: { a: 9 } }));
            assertEqual('Updated', record.get('title'));
            assertEqual(9, record.get('meta').a);
            assertUndefined(record.get('meta').b);
        });

        it('throws when the patch is not a plain object', () => {
            const caught = catchError(() => makeRecord().merge('nope'));

            assertAssertionError(caught, 'Record#merge() patch must be a plain object');
        });
    });

    describe('deepMerge()', ({ it }) => {
        it('recursively merges nested plain objects', () => {
            const record = makeRecord({
                attributes: { meta: { a: 1, b: 2 } },
            });

            assertEqual(record, record.deepMerge({ meta: { a: 9 }, added: true }));
            assertEqual(9, record.get('meta').a);
            assertEqual(2, record.get('meta').b);
            assertEqual(true, record.get('added'));
        });

        it('throws a TypeError when the patch is not a plain object', () => {
            const caught = catchError(() => makeRecord().deepMerge('nope'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('toDocument()', ({ it }) => {
        it('returns a copy of the attributes with type, id, and sortKey', () => {
            const record = makeRecord({ attributes: { title: 'Hello' } });
            const doc = record.toDocument();

            assertEqual('TestType', doc.type);
            assertEqual('test-id', doc.id);
            assertEqual('sort-1', doc.sortKey);
            assertEqual('Hello', doc.title);
        });

        it('omits the sortKey when it is null', () => {
            const doc = makeRecord({ sortKey: null }).toDocument();

            assert(!Object.hasOwn(doc, 'sortKey'));
        });

        it('does not expose the internal attributes object', () => {
            const record = makeRecord({ attributes: { title: 'Hello' } });
            const doc = record.toDocument();

            doc.title = 'Mutated';

            assertEqual('Hello', record.get('title'));
        });
    });

    describe('toObject()', ({ it }) => {
        it('flattens attributes and nests store metadata under meta', () => {
            const record = makeRecord({ attributes: { title: 'Hello' } });
            const obj = record.toObject();

            assertEqual('TestType', obj.type);
            assertEqual('test-id', obj.id);
            assertEqual('Hello', obj.title);
            assertEqual('sort-1', obj.meta.sortKey);
            assertEqual(3, obj.meta.version);
            assertEqual(record.createdAt, obj.meta.createdAt);
            assertEqual(record.updatedAt, obj.meta.updatedAt);
        });

        it('does not expose the internal attributes object', () => {
            const record = makeRecord({ attributes: { title: 'Hello' } });
            const obj = record.toObject();

            obj.title = 'Mutated';

            assertEqual('Hello', record.get('title'));
        });
    });

    describe('fromRecord()', ({ it }) => {
        it('wraps a raw store record and keeps document metadata out of the attributes', () => {
            const record = Record.fromRecord(makeStoreRecord());

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual('sort-1', record.sortKey);
            assertEqual(3, record.version);
            assertEqual(new Date(CREATED_AT).toISOString(), record.createdAt.toISOString());
            assertEqual('Hello', record.get('title'));
            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
            assertUndefined(record.get('sortKey'));
        });

        it('copies the doc so later mutation does not reach the record', () => {
            const storeRecord = makeStoreRecord();
            const record = Record.fromRecord(storeRecord);

            storeRecord.doc.title = 'Mutated';

            assertEqual('Hello', record.get('title'));
        });

        it('creates an instance of the receiving subclass', () => {
            const record = TestRecord.fromRecord(makeStoreRecord());

            assert(record instanceof TestRecord);
            assertEqual('Hello', record.title);
        });

        it('throws when the raw record has an invalid shape', () => {
            const storeRecord = makeStoreRecord();
            storeRecord.version = null;

            const caught = catchError(() => Record.fromRecord(storeRecord));

            assertAssertionError(caught, 'Record spec.version must be an integer');
        });
    });
});

class TestRecord extends Record {
    get title() {
        return this.get('title');
    }
}

function makeRecord(spec) {
    return new Record(Object.assign({
        type: 'TestType',
        id: 'test-id',
        sortKey: 'sort-1',
        version: 3,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        attributes: {},
    }, spec));
}

function makeStoreRecord() {
    return {
        type: 'TestType',
        id: 'test-id',
        sortKey: 'sort-1',
        version: 3,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        doc: {
            type: 'TestType',
            id: 'test-id',
            sortKey: 'sort-1',
            title: 'Hello',
        },
    };
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
