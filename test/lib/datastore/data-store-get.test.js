import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import { DataStore } from '../../../lib/datastore/mod.js';


function createMockEngine(overrides) {
    return Object.assign({
        initialize: sinon.fake.resolves(),
        configureIndexes: sinon.fake.resolves(),
        put: sinon.fake.resolves({ doc: {}, version: 1, createdAt: 'ts', updatedAt: 'ts' }),
        get: sinon.fake.resolves(null),
        delete: sinon.fake.resolves(true),
        query: sinon.fake.resolves({ records: [], cursor: null }),
        close: sinon.fake.resolves(),
    }, overrides);
}


describe('DataStore#get() when document exists', ({ before, after, it }) => {
    const fakeRecord = { doc: { id: 'c1', type: 'Customer' }, version: 2, createdAt: 'ts', updatedAt: 'ts' };
    let engine;
    let result;
    before(async () => {
        engine = createMockEngine({ get: sinon.fake.resolves(fakeRecord) });
        const store = new DataStore(engine);
        await store.initialize();
        result = await store.get('Customer', 'c1');
    });
    after(() => sinon.restore());

    it('calls engine.get() with correct type and id', () => {
        assertEqual('Customer', engine.get.firstCall.args[0]);
        assertEqual('c1', engine.get.firstCall.args[1]);
    });
    it('returns the DocumentRecord', () => {
        assertEqual(fakeRecord, result);
    });
});

describe('DataStore#get() when document does not exist', ({ before, after, it }) => {
    let result;
    before(async () => {
        const engine = createMockEngine({ get: sinon.fake.resolves(null) });
        const store = new DataStore(engine);
        await store.initialize();
        result = await store.get('Customer', 'ghost');
    });
    after(() => sinon.restore());

    it('returns null', () => {
        assertEqual(null, result);
    });
});

describe('DataStore#get() when type is empty', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.get('', 'some_id');
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#get() when id is empty', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.get('Customer', '');
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#get() when id is not a string', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.get('Customer', 42);
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});
