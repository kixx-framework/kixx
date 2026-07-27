import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import Record from '../../../../src/app/collections/base-key-value-store-record.js';


describe('Base KeyValueStore Record', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('assigns the type and id and retains the attributes object by reference', () => {
            const attributes = { token: 'abc' };
            const record = makeRecord({ attributes });

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);

            attributes.token = 'xyz';
            assertEqual('xyz', record.get('token'));
        });

        it('exposes the metadata properties as read only', () => {
            const record = makeRecord();

            const caught = catchError(() => {
                record.type = 'OtherType';
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertEqual('TestType', record.type);
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

        it('throws when spec.attributes is not a plain object', () => {
            const caught = catchError(() => makeRecord({ attributes: 'nope' }));

            assertAssertionError(caught, 'Record spec.attributes must be a plain object');
        });
    });

    describe('validate()', ({ it }) => {
        it('is a no-op on the base class', () => {
            assertUndefined(makeRecord().validate());
        });
    });

    describe('forWrite()', ({ it }) => {
        it('creates an instance from the write spec', () => {
            const record = Record.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { token: 'abc' },
            });

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual('abc', record.get('token'));
        });

        it('creates an instance of the receiving subclass', () => {
            const record = TestRecord.forWrite({
                type: 'TestType',
                id: 'test-id',
                attributes: { token: 'abc' },
            });

            assert(record instanceof TestRecord);
            assertEqual('abc', record.token);
        });

        it('throws when the spec is missing', () => {
            const caught = catchError(() => Record.forWrite());

            assertAssertionError(caught, 'Record spec.type must be a non-empty string');
        });
    });

    describe('get() and set()', ({ it }) => {
        it('reads and writes user-defined attributes', () => {
            const record = makeRecord({ attributes: { token: 'abc' } });

            assertEqual('abc', record.get('token'));
            assertUndefined(record.get('missing'));
            assertEqual(record, record.set('token', 'xyz'));
            assertEqual('xyz', record.get('token'));
        });

        it('does not read store metadata as attributes', () => {
            const record = makeRecord();

            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
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
                attributes: { token: 'abc', meta: { a: 1, b: 2 } },
            });

            assertEqual(record, record.merge({ token: 'xyz', meta: { a: 9 } }));
            assertEqual('xyz', record.get('token'));
            assertEqual(9, record.get('meta').a);
            assertUndefined(record.get('meta').b);
        });

        it('throws when the patch is not a plain object', () => {
            const caught = catchError(() => makeRecord().merge(null));

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
        it('returns a copy of the attributes with the type and id', () => {
            const record = makeRecord({ attributes: { token: 'abc' } });
            const doc = record.toDocument();

            assertEqual('TestType', doc.type);
            assertEqual('test-id', doc.id);
            assertEqual('abc', doc.token);
        });

        it('does not expose the internal attributes object', () => {
            const record = makeRecord({ attributes: { token: 'abc' } });
            const doc = record.toDocument();

            doc.token = 'mutated';

            assertEqual('abc', record.get('token'));
        });
    });

    describe('toObject()', ({ it }) => {
        it('returns a copy of the attributes with the type and id', () => {
            const record = makeRecord({ attributes: { token: 'abc' } });
            const obj = record.toObject();

            assertEqual('TestType', obj.type);
            assertEqual('test-id', obj.id);
            assertEqual('abc', obj.token);
        });

        it('does not expose the internal attributes object', () => {
            const record = makeRecord({ attributes: { token: 'abc' } });
            const obj = record.toObject();

            obj.token = 'mutated';

            assertEqual('abc', record.get('token'));
        });
    });

    describe('fromRecord()', ({ it }) => {
        it('wraps a stored JSON value and keeps metadata out of the attributes', () => {
            const record = Record.fromRecord(makeStoredValue());

            assertEqual('TestType', record.type);
            assertEqual('test-id', record.id);
            assertEqual('abc', record.get('token'));
            assertUndefined(record.get('type'));
            assertUndefined(record.get('id'));
        });

        it('copies the stored value so later mutation does not reach the record', () => {
            const stored = makeStoredValue();
            const record = Record.fromRecord(stored);

            stored.token = 'mutated';

            assertEqual('abc', record.get('token'));
        });

        it('creates an instance of the receiving subclass', () => {
            const record = TestRecord.fromRecord(makeStoredValue());

            assert(record instanceof TestRecord);
            assertEqual('abc', record.token);
        });

        it('throws when the stored value is missing the id', () => {
            const stored = makeStoredValue();
            delete stored.id;

            const caught = catchError(() => Record.fromRecord(stored));

            assertAssertionError(caught, 'Record spec.id must be a non-empty string');
        });
    });
});

class TestRecord extends Record {
    get token() {
        return this.get('token');
    }
}

function makeRecord(spec) {
    return new Record(Object.assign({
        type: 'TestType',
        id: 'test-id',
        attributes: {},
    }, spec));
}

function makeStoredValue() {
    return {
        type: 'TestType',
        id: 'test-id',
        token: 'abc',
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
