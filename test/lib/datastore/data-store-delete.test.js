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


describe('DataStore#delete() with version', ({ before, after, it }) => {
    let engine;
    let result;
    before(async () => {
        engine = createMockEngine({ delete: sinon.fake.resolves(true) });
        const store = new DataStore(engine);
        await store.initialize();
        result = await store.delete('Customer', 'cust_001', { version: 3 });
    });
    after(() => sinon.restore());

    it('calls engine.delete() with type, id, and version', () => {
        assertEqual('Customer', engine.delete.firstCall.args[0]);
        assertEqual('cust_001', engine.delete.firstCall.args[1]);
        assertEqual(3, engine.delete.firstCall.args[2]);
    });
    it('returns the engine result (true)', () => {
        assertEqual(true, result);
    });
});

describe('DataStore#delete() without version', ({ before, after, it }) => {
    let engine;
    let result;
    before(async () => {
        engine = createMockEngine({ delete: sinon.fake.resolves(true) });
        const store = new DataStore(engine);
        await store.initialize();
        result = await store.delete('Customer', 'cust_001');
    });
    after(() => sinon.restore());

    it('calls engine.delete() with undefined version', () => {
        assertEqual('Customer', engine.delete.firstCall.args[0]);
        assertEqual('cust_001', engine.delete.firstCall.args[1]);
        assertEqual(undefined, engine.delete.firstCall.args[2]);
    });
    it('returns the engine result (true)', () => {
        assertEqual(true, result);
    });
});

describe('DataStore#delete() when document does not exist', ({ before, after, it }) => {
    let result;
    before(async () => {
        const engine = createMockEngine({ delete: sinon.fake.resolves(false) });
        const store = new DataStore(engine);
        await store.initialize();
        result = await store.delete('Customer', 'ghost');
    });
    after(() => sinon.restore());

    it('returns false', () => {
        assertEqual(false, result);
    });
});

describe('DataStore#delete() when type is empty', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.delete('', 'cust_001', { version: 1 });
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

describe('DataStore#delete() when id is empty', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.delete('Customer', '', { version: 1 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#delete() when options.version is a float', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.delete('Customer', 'cust_001', { version: 1.5 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#delete() when options.version is zero', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.delete('Customer', 'cust_001', { version: 0 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});
