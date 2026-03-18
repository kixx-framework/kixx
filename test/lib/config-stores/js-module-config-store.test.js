import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import JSModuleConfigStore from '../../../lib/config-stores/js-module-config-store.js';
import { testConfigStoreConformance } from '../../conformance/config-store.js';


testConfigStoreConformance(() => new JSModuleConfigStore({ config: {}, secrets: {} }));


describe('JSModuleConfigStore constructor when config is not provided', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new JSModuleConfigStore({});
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('JSModuleConfigStore#loadConfig() when config is provided', ({ before, it }) => {
    let emittedConfig;

    before(async () => {
        const store = new JSModuleConfigStore({ config: { database: { host: 'localhost' } } });
        store.on('update:config', (v) => {
            emittedConfig = v;
        });
        await store.loadConfig();
    });

    it('emits the provided config object', () => {
        assertEqual('localhost', emittedConfig.database.host);
    });
});

describe('JSModuleConfigStore#loadSecrets() when secrets is provided', ({ before, it }) => {
    let emittedSecrets;

    before(async () => {
        const store = new JSModuleConfigStore({ config: {}, secrets: { apiKey: 'abc123' } });
        store.on('update:secrets', (v) => {
            emittedSecrets = v;
        });
        await store.loadSecrets();
    });

    it('emits the provided secrets object', () => {
        assertEqual('abc123', emittedSecrets.apiKey);
    });
});
