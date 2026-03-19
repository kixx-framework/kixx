import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';
import {
    DataStore,
    DataStoreClosedError,
    DataStoreNotInitializedError
} from '../../../lib/datastore/mod.js';


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


describe('DataStore#query() before initialize()', ({ before, after, it }) => {
    let engine;
    let error;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        try {
            await store.query('Customer');
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws DataStoreNotInitializedError', () => {
        assert(error);
        assert(error instanceof DataStoreNotInitializedError);
        assertEqual('DATASTORE_NOT_INITIALIZED', error.code);
    });
    it('includes the attempted operation', () => {
        assertEqual('query', error.operation);
    });
    it('does not call engine.query()', () => {
        assertEqual(0, engine.query.callCount);
    });
});

describe('DataStore#initialize() when called twice', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.initialize();
    });
    after(() => sinon.restore());

    it('calls engine.initialize() once', () => {
        assertEqual(1, engine.initialize.callCount);
    });
});

describe('DataStore#close() after initialize()', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.close();
        await store.close();
    });
    after(() => sinon.restore());

    it('calls engine.close() once', () => {
        assertEqual(1, engine.close.callCount);
    });
});

describe('DataStore#get() after close()', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.close();
        try {
            await store.get('Customer', 'cust_001');
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws DataStoreClosedError', () => {
        assert(error);
        assert(error instanceof DataStoreClosedError);
        assertEqual('DATASTORE_CLOSED', error.code);
    });
    it('includes the attempted operation', () => {
        assertEqual('get', error.operation);
    });
});
