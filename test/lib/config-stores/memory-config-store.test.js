import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import MemoryConfigStore from '../../../lib/config-stores/memory-config-store.js';
import { testConfigStoreConformance } from '../../conformance/config-store.js';


testConfigStoreConformance(() => new MemoryConfigStore({ config: {}, secrets: {} }));


describe('MemoryConfigStore constructor when config is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new MemoryConfigStore({});
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('MemoryConfigStore#loadConfig() when config is provided', ({ before, it }) => {
    let emittedConfig;

    before(async () => {
        const store = new MemoryConfigStore({ config: { database: { host: 'localhost' } } });
        store.on('update:config', (v) => {
            emittedConfig = v;
        });
        await store.loadConfig();
    });

    it('emits the provided config object', () => {
        assertEqual('localhost', emittedConfig.database.host);
    });
});

describe('MemoryConfigStore#loadSecrets() when secrets is provided', ({ before, it }) => {
    let emittedSecrets;

    before(async () => {
        const store = new MemoryConfigStore({ config: {}, secrets: { apiKey: 'abc123' } });
        store.on('update:secrets', (v) => {
            emittedSecrets = v;
        });
        await store.loadSecrets();
    });

    it('emits the provided secrets object', () => {
        assertEqual('abc123', emittedSecrets.apiKey);
    });
});
