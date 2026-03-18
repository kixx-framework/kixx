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


// --- basic delegation -------------------------------------------------------

describe('DataStore#query() with no options delegates to engine', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer');
    });
    after(() => sinon.restore());

    it('calls engine.query() once', () => {
        assertEqual(1, engine.query.callCount);
    });
    it('passes the type', () => {
        assertEqual('Customer', engine.query.firstCall.args[0]);
    });
});

describe('DataStore#query() applies default limit 100', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer');
    });
    after(() => sinon.restore());

    it('engine receives limit 100', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual(100, opts.limit);
    });
});

describe('DataStore#query() applies default reverse false', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer');
    });
    after(() => sinon.restore());

    it('engine receives reverse false', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual(false, opts.reverse);
    });
});

// --- alias resolution -------------------------------------------------------

describe('DataStore#query() resolves startKey alias to greaterThanOrEqualTo', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer', { startKey: '2026-01-01' });
    });
    after(() => sinon.restore());

    it('engine receives greaterThanOrEqualTo', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual('2026-01-01', opts.greaterThanOrEqualTo);
    });
    it('engine does not receive startKey', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual(undefined, opts.startKey);
    });
});

describe('DataStore#query() resolves endKey alias to lessThanOrEqualTo', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer', { endKey: '2026-12-31' });
    });
    after(() => sinon.restore());

    it('engine receives lessThanOrEqualTo', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual('2026-12-31', opts.lessThanOrEqualTo);
    });
    it('engine does not receive endKey', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual(undefined, opts.endKey);
    });
});

// --- beginsWith expansion ---------------------------------------------------

describe('DataStore#query() expands beginsWith into gte + lt range', ({ before, after, it }) => {
    let engine;
    before(async () => {
        engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.query('Customer', { beginsWith: 'foo' });
    });
    after(() => sinon.restore());

    it('engine receives greaterThanOrEqualTo as the prefix', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual('foo', opts.greaterThanOrEqualTo);
    });
    it('engine receives lessThan as the incremented upper bound', () => {
        const opts = engine.query.firstCall.args[1];
        // 'o' is the last char of 'foo', next codepoint is 'p'
        assertEqual('fop', opts.lessThan);
    });
    it('engine does not receive beginsWith', () => {
        const opts = engine.query.firstCall.args[1];
        assertEqual(undefined, opts.beginsWith);
    });
});

// --- custom index validation ------------------------------------------------

describe('DataStore#query() with unconfigured index throws IndexNotConfiguredError', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { index: 'email' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws IndexNotConfiguredError', () => {
        assert(error);
        assertEqual('IndexNotConfiguredError', error.name);
    });
    it('code is INDEX_NOT_CONFIGURED', () => {
        assertEqual('INDEX_NOT_CONFIGURED', error.code);
    });
});

describe('DataStore#query() with configured index does not throw', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        await store.configureIndexes([{ type: 'Customer', attribute: 'email' }]);
        try {
            await store.query('Customer', { index: 'email' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('does not throw', () => {
        assertEqual(undefined, error);
    });
});

// --- limit validation -------------------------------------------------------

describe('DataStore#query() with limit below 1', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { limit: 0 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() with limit above 1000', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { limit: 1001 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- mutual exclusivity validation ------------------------------------------

describe('DataStore#query() when startKey and greaterThanOrEqualTo both provided', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', {
                startKey: 'a',
                greaterThanOrEqualTo: 'b',
            });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
    it('errors array mentions mutual exclusivity', () => {
        assert(error.errors.some((e) => assertMatches !== null && e.message.includes('mutually exclusive')));
    });
});

describe('DataStore#query() when endKey and lessThanOrEqualTo both provided', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { endKey: 'z', lessThanOrEqualTo: 'y' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when greaterThan and startKey both provided', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { greaterThan: 'a', startKey: 'b' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when lessThan and endKey both provided', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { lessThan: 'z', endKey: 'y' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when beginsWith combined with greaterThan', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { beginsWith: 'foo', greaterThan: 'bar' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when beginsWith combined with startKey', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { beginsWith: 'foo', startKey: 'bar' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when beginsWith is an empty string', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { beginsWith: '' });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

describe('DataStore#query() when beginsWith is not a string', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('Customer', { beginsWith: 42 });
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});

// --- type validation --------------------------------------------------------

describe('DataStore#query() when type has invalid format', ({ before, after, it }) => {
    let error;
    before(async () => {
        const engine = createMockEngine();
        const store = new DataStore(engine);
        await store.initialize();
        try {
            await store.query('1BadType');
        } catch (err) {
            error = err;
        }
    });
    after(() => sinon.restore());

    it('throws ValidationError', () => {
        assertEqual('ValidationError', error.name);
    });
});
