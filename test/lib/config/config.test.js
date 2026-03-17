import { EventEmitter } from 'node:events';
import { describe } from 'kixx-test';
import { assertEqual, assert, isPlainObject } from 'kixx-assert';
import sinon from 'sinon';
import Config from '../../../lib/config/config.js';


function createMockStore({ config = {}, secrets = {} } = {}) {
    const emitter = new EventEmitter();
    return {
        on(eventName, listener) {
            emitter.on(eventName, listener);
            return this;
        },
        loadConfig: sinon.fake(async () => {
            emitter.emit('update:config', config);
        }),
        loadSecrets: sinon.fake(async () => {
            emitter.emit('update:secrets', secrets);
        }),
    };
}


describe('Config constructor() when store is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Config(null, 'production', '/app');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('Config constructor() when environment is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Config(createMockStore(), null, '/app');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('Config constructor() when applicationDirectory is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new Config(createMockStore(), 'production', null);
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('Config#environment', ({ it }) => {
    const subject = new Config(createMockStore(), 'production', '/app');

    it('returns the environment string', () => {
        assertEqual('production', subject.environment);
    });
});

describe('Config#on() return value', ({ it }) => {
    const subject = new Config(createMockStore(), 'development', '/app');

    it('returns this for chaining', () => {
        assertEqual(subject, subject.on('update:config', () => {}));
    });
});

describe('Config#name getter when config has no name', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({ config: {} });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('returns default KixxApp', () => {
        assertEqual('KixxApp', subject.name);
    });
});

describe('Config#name getter when config has a name', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({ config: { name: 'MyApp' } });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('returns the name from config', () => {
        assertEqual('MyApp', subject.name);
    });
});

describe('Config#processName getter when config has no processName', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({ config: {} });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('returns default kixxapp', () => {
        assertEqual('kixxapp', subject.processName);
    });
});

describe('Config#processName getter when config has a processName', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({ config: { processName: 'my-api' } });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('returns the processName from config', () => {
        assertEqual('my-api', subject.processName);
    });
});

describe('Config#getNamespace() with invalid namespace argument', ({ it }) => {
    const subject = new Config(createMockStore(), 'development', '/app');

    it('throws an AssertionError', () => {
        let error;
        try {
            subject.getNamespace(null);
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('Config#getNamespace() when namespace is not in config', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({ config: {} });
        const subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getNamespace('database');
    });

    it('returns a plain object', () => {
        assert(isPlainObject(result));
    });

    it('returns an empty object', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#getNamespace() when namespace exists in config', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({
            config: { database: { host: 'localhost', port: 5432 } },
        });
        const subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getNamespace('database');
    });

    it('returns the namespace host', () => {
        assertEqual('localhost', result.host);
    });

    it('returns the namespace port', () => {
        assertEqual(5432, result.port);
    });
});

describe('Config#getNamespace() returns an independent deep copy', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({
            config: { database: { host: 'localhost' } },
        });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('mutations to the returned copy do not affect internal state', () => {
        const copy = subject.getNamespace('database');
        copy.host = 'mutated';
        assertEqual('localhost', subject.getNamespace('database').host);
    });
});

describe('Config#getSecrets() with invalid namespace argument', ({ it }) => {
    const subject = new Config(createMockStore(), 'development', '/app');

    it('throws an AssertionError', () => {
        let error;
        try {
            subject.getSecrets(null);
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('Config#getSecrets() when namespace is not in secrets', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({ secrets: {} });
        const subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getSecrets('api');
    });

    it('returns a plain object', () => {
        assert(isPlainObject(result));
    });

    it('returns an empty object', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config#getSecrets() when namespace exists in secrets', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({
            secrets: { api: { key: 'abc123', endpoint: 'https://api.example.com' } },
        });
        const subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getSecrets('api');
    });

    it('returns the namespace key', () => {
        assertEqual('abc123', result.key);
    });

    it('returns the namespace endpoint', () => {
        assertEqual('https://api.example.com', result.endpoint);
    });
});

describe('Config merges environment config overrides into root config', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({
            config: {
                database: { host: 'localhost', port: 5432 },
                environments: {
                    production: {
                        database: { host: 'prod-db.example.com' },
                    },
                },
            },
        });
        subject = new Config(store, 'production', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('overrides root values with environment-specific values', () => {
        assertEqual('prod-db.example.com', subject.getNamespace('database').host);
    });

    it('preserves root values not overridden by environment', () => {
        assertEqual(5432, subject.getNamespace('database').port);
    });
});

describe('Config when environment has no matching config override', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({
            config: {
                database: { host: 'localhost', port: 5432 },
                environments: {
                    production: {
                        database: { host: 'prod-db.example.com' },
                    },
                },
            },
        });
        subject = new Config(store, 'development', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('uses root config host unchanged', () => {
        assertEqual('localhost', subject.getNamespace('database').host);
    });

    it('uses root config port unchanged', () => {
        assertEqual(5432, subject.getNamespace('database').port);
    });
});

describe('Config removes the environments key from merged config', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({
            config: {
                environments: {
                    production: {},
                },
            },
        });
        const subject = new Config(store, 'production', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getNamespace('environments');
    });

    it('returns an empty object for the environments namespace', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('Config merges environment secrets overrides into root secrets', ({ before, it }) => {
    let subject;

    before(async () => {
        const store = createMockStore({
            secrets: {
                api: { key: 'dev-key', endpoint: 'https://dev.example.com' },
                environments: {
                    production: {
                        api: { key: 'prod-key' },
                    },
                },
            },
        });
        subject = new Config(store, 'production', '/app');
        await store.loadConfig();
        await store.loadSecrets();
    });

    it('overrides root values with environment-specific values', () => {
        assertEqual('prod-key', subject.getSecrets('api').key);
    });

    it('preserves root values not overridden by environment', () => {
        assertEqual('https://dev.example.com', subject.getSecrets('api').endpoint);
    });
});

describe('Config removes the environments key from merged secrets', ({ before, it }) => {
    let result;

    before(async () => {
        const store = createMockStore({
            secrets: {
                environments: {
                    production: {},
                },
            },
        });
        const subject = new Config(store, 'production', '/app');
        await store.loadConfig();
        await store.loadSecrets();
        result = subject.getSecrets('environments');
    });

    it('returns an empty object for the environments namespace', () => {
        assertEqual(0, Object.keys(result).length);
    });
});
