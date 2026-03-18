import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual, assert, assertMatches } from 'kixx-assert';
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


// --- valid create -----------------------------------------------------------

describe('DataStore#put() when creating a valid document', ({ before, after, it }) => {
    let engine;
    let store;
    let result;
    before(async () => {
        engine = createMockEngine();
        store = new DataStore(engine);
        await store.initialize();
        result = await store.put({ id: 'cust_001', type: 'Customer', name: 'Alice' });
    });
    after(() => sinon.restore());

    it('delegates to engine.put()', () => {
        assertEqual(1, engine.put.callCount);
    });
    it('passes the doc as first argument', () => {
        assertEqual('cust_001', engine.put.firstCall.firstArg.id);
        assertEqual('Customer', engine.put.firstCall.firstArg.type);
    });
    it('passes undefined options when no version provided', () => {
        assertEqual(undefined, engine.put.firstCall.args[1]);
    });
    it('returns the engine result', () => {
        assertEqual(1, result.version);
    });
});

// --- valid update -----------------------------------------------------------

describe('DataStore#put() when updating with a version', ({ before, after, it }) => {
    let engine;
    let store;
    before(async () => {
        engine = createMockEngine();
        store = new DataStore(engine);
        await store.initialize();
        await store.put({ id: 'cust_001', type: 'Customer' }, { version: 2 });
    });
    after(() => sinon.restore());

    it('passes options with version to engine.put()', () => {
        assertEqual(2, engine.put.firstCall.args[1].version);
    });
});

// --- validation: doc is not a plain object ----------------------------------

describe('DataStore#put() when doc is null', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put(null);
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

describe('DataStore#put() when doc is an array', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put([ 'not', 'an', 'object' ]);
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: invalid type -----------------------------------------------

describe('DataStore#put() when doc.type is missing', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
        assertEqual('VALIDATION_ERROR', error.code);
    });
    it('errors array includes a doc.type entry', () => {
        assert(error.errors.some((e) => e.source === 'doc.type'));
    });
});

describe('DataStore#put() when doc.type starts with a digit', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: '1Invalid' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: invalid id -------------------------------------------------

describe('DataStore#put() when doc.id is missing', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ type: 'Customer' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError mentioning id', () => {
        assertEqual('ValidationError', error.name);
        assertMatches('id', error.message);
    });
});

describe('DataStore#put() when doc.id is an empty string', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: '', type: 'Customer' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#put() when doc.id contains a control character', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'bad\x00id', type: 'Customer' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: sortKey ----------------------------------------------------

describe('DataStore#put() when doc.sortKey is a number', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer', sortKey: 12345 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: reserved attributes ----------------------------------------

describe('DataStore#put() when doc contains reserved attribute "version"', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer', version: 1 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
    it('errors array includes a doc.version entry', () => {
        assert(error.errors.some((e) => e.source === 'doc.version'));
    });
});

describe('DataStore#put() when doc contains reserved attribute "createdAt"', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer', createdAt: 'ts' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#put() when doc contains reserved attribute "updatedAt"', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer', updatedAt: 'ts' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: version option ---------------------------------------------

describe('DataStore#put() when options.version is a float', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer' }, { version: 1.5 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#put() when options.version is zero', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.put({ id: 'x', type: 'Customer' }, { version: 0 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- validation: non-serializable doc ---------------------------------------

describe('DataStore#put() when doc contains a circular reference', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        const circular = { id: 'x', type: 'Customer' };
        circular.self = circular;
        try {
            await store.put(circular);
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});
