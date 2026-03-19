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


describe('DataStore#configureIndexes() with valid definitions', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.configureIndexes([
            { type: 'Customer', attribute: 'email' },
            { type: 'Customer', attribute: 'region' },
        ]);
    });
    after(() => sinon.restore());

    it('calls engine.configureIndexes() once', () => {
        assertEqual(1, engine.configureIndexes.callCount);
    });
    it('passes the full index list to the engine', () => {
        const indexes = engine.configureIndexes.firstCall.firstArg;
        assertEqual(2, indexes.length);
    });
});

describe('DataStore#configureIndexes() calling twice replaces the index set', ({ before, after, it }) => {
    let engine;
    let store;
    before(async () => {
        engine = createMockEngine();
        store = new DataStore(engine);
        await store.initialize();
        await store.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
        await store.configureIndexes([{ type: 'Customer', attribute: 'region' }]);
    });
    after(() => sinon.restore());

    it('engine.configureIndexes() called twice', () => {
        assertEqual(2, engine.configureIndexes.callCount);
    });
    it('second call passes only the new index', () => {
        const indexes = engine.configureIndexes.secondCall.firstArg;
        assertEqual(1, indexes.length);
        assertEqual('region', indexes[0].attribute);
    });
});

describe('DataStore#configureIndexes() with an empty array', ({ before, after, it }) => {
    let engine;
    let store;
    before(async () => {
        engine = createMockEngine();
        store = new DataStore(engine);
        await store.initialize();
        await store.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
        await store.configureIndexes([]);
    });
    after(() => sinon.restore());

    it('passes empty array to engine', () => {
        const indexes = engine.configureIndexes.secondCall.firstArg;
        assertEqual(0, indexes.length);
    });
});

describe('DataStore#configureIndexes() when indexes is not an array', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.configureIndexes('not an array');
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

describe('DataStore#configureIndexes() when type is invalid', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.configureIndexes([{ type: '1BadType', attribute: 'email' }]);
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#configureIndexes() when attribute contains a hyphen', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.configureIndexes([{ type: 'Customer', attribute: 'my-attr' }]);
    });
    after(() => sinon.restore());

    it('passes the hyphenated attribute through to the engine', () => {
        const indexes = engine.configureIndexes.firstCall.firstArg;
        assertEqual('my-attr', indexes[0].attribute);
    });
});
