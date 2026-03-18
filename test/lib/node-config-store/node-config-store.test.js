import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import NodeConfigStore from '../../../lib/node-config-store/node-config-store.js';
import { testConfigStoreConformance } from '../../conformance/config-store.js';


function createFileSystem(overrides = {}) {
    return {
        readJSONFile: sinon.stub(),
        ...overrides,
    };
}

testConfigStoreConformance(() => new NodeConfigStore({
    configFilepath: '/app/kixx-config.jsonc',
    secretsFilepath: '/app/.secrets.jsonc',
    fileSystem: createFileSystem({
        readJSONFile: sinon.stub().resolves({}),
    }),
}));


describe('NodeConfigStore#loadConfig() when the config file exists', ({ before, it }) => {
    let fileSystem;
    let emittedConfig;

    before(async () => {
        fileSystem = createFileSystem({
            readJSONFile: sinon.stub().resolves({ logger: { level: 'debug' } }),
        });
        const store = new NodeConfigStore({
            configFilepath: '/app/kixx-config.jsonc',
            secretsFilepath: '/app/.secrets.jsonc',
            fileSystem,
        });
        store.on('update:config', (value) => {
            emittedConfig = value;
        });
        await store.loadConfig();
    });

    it('reads the configured config filepath', () => {
        assertEqual('/app/kixx-config.jsonc', fileSystem.readJSONFile.firstCall.firstArg);
    });

    it('emits the loaded config object', () => {
        assertEqual('debug', emittedConfig.logger.level);
    });
});

describe('NodeConfigStore#loadSecrets() when the secrets file is missing', ({ before, it }) => {
    let emittedSecrets;

    before(async () => {
        const fileSystem = createFileSystem({
            readJSONFile: sinon.stub().resolves(null),
        });
        const store = new NodeConfigStore({
            configFilepath: '/app/kixx-config.jsonc',
            secretsFilepath: '/app/.secrets.jsonc',
            fileSystem,
        });
        store.on('update:secrets', (value) => {
            emittedSecrets = value;
        });
        await store.loadSecrets();
    });

    it('emits an empty object', () => {
        assertEqual(0, Object.keys(emittedSecrets).length);
    });
});
