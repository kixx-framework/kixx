import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual,
    assertUndefined,
    assertArray,
    assertFunction
} from 'kixx-assert';
import ConfigStore from '../../lib/application/config-store.js';

// Mock current working directory
const CURRENT_WORKING_DIRECTORY = path.dirname(fileURLToPath(new URL(import.meta.url)));

describe('ConfigStore#constructor with valid input', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({
            currentWorkingDirectory: process.cwd(),
            applicationDirectory: CURRENT_WORKING_DIRECTORY,
        });
    });

    it('should set currentWorkingDirectory property', () => {
        assertEqual(process.cwd(), subject.currentWorkingDirectory);
    });

    it('should set applicationDirectory property', () => {
        assertEqual(CURRENT_WORKING_DIRECTORY, subject.applicationDirectory);
    });
});

describe('ConfigStore#constructor with minimal input', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({});
    });

    it('should have null currentWorkingDirectory', () => {
        assertEqual(null, subject.currentWorkingDirectory);
    });

    it('should have null applicationDirectory', () => {
        assertEqual(null, subject.applicationDirectory);
    });
});

describe('ConfigStore#constructor with only currentWorkingDirectory', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
        });
    });

    it('should set currentWorkingDirectory property', () => {
        assertEqual(CURRENT_WORKING_DIRECTORY, subject.currentWorkingDirectory);
    });

    it('should have null applicationDirectory', () => {
        assertEqual(null, subject.applicationDirectory);
    });
});

describe('ConfigStore#constructor with only applicationDirectory', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({
            applicationDirectory: CURRENT_WORKING_DIRECTORY,
        });
    });

    it('should set currentWorkingDirectory property', () => {
        assertEqual(null, subject.currentWorkingDirectory);
    });

    it('should have null applicationDirectory', () => {
        assertEqual(CURRENT_WORKING_DIRECTORY, subject.applicationDirectory);
    });
});

describe('ConfigStore#loadLatestConfigJSON with specified filepath', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const filepath = path.join(CURRENT_WORKING_DIRECTORY, 'config.jsonc');
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testConfig))
        };

        subject = new ConfigStore({
            currentWorkingDirectory: process.cwd(),
        });

        result = await subject.loadLatestConfigJSON(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('should read the specified config file', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual(filepath, mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should set application directory from filepath', () => {
        assertEqual(path.dirname(filepath), subject.applicationDirectory);
    });

    it('should return parsed config object', async () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });
});

describe('ConfigStore#loadLatestConfigJSON with specified filepath that does not exist', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const filepath = path.join(CURRENT_WORKING_DIRECTORY, 'nonexistent.jsonc');

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(null)
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw WrappedError when specified file does not exist', async () => {
        let error;
        try {
            await subject.loadLatestConfigJSON(filepath);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('NotFoundError', error.name);
        assertEqual('ENOENT', error.code);
        assertEqual(`Specified config file does not exist ${ filepath }`, error.message);
    });
});

describe('ConfigStore#loadLatestConfigJSON with JSONC file in application directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(testConfig)) // kixx-config.jsonc
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestConfigJSON();
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSONC format first', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'kixx-config.jsonc'), mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should return parsed config object', async () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });
});

describe('ConfigStore#loadLatestConfigJSON with .json file fallback', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // kixx-config.jsonc not found
                .onSecondCall().resolves(JSON.stringify(testConfig)) // kixx-config.json found
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestConfigJSON();
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSONC format first, then fallback to JSON', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'kixx-config.jsonc'), mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'kixx-config.json'), mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should return parsed config object', async () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });
});

describe('ConfigStore#loadLatestConfigJSON with no config files found', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // kixx-config.jsonc not found
                .onSecondCall().resolves(null) // kixx-config.json not found
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw WrappedError when no config files are found', async () => {
        let error;
        try {
            await subject.loadLatestConfigJSON();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('NotFoundError', error.name);
        assertEqual('ENOENT', error.code);
        assertEqual(`Could not find kixx-config.jsonc or kixx-config.json in ${ CURRENT_WORKING_DIRECTORY }`, error.message);
    });
});

describe('ConfigStore#loadLatestConfigJSON with invalid filepath parameter', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({
            currentWorkingDirectory: '/test/cwd'
        });
    });

    it('should throw AssertionError for undefined filepath', async () => {
        let error;
        try {
            await subject.loadLatestConfigJSON();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });

    it('should throw AssertionError for null filepath', async () => {
        let error;
        try {
            await subject.loadLatestConfigJSON(null);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });

    it('should throw AssertionError for empty string filepath', async () => {
        let error;
        try {
            await subject.loadLatestConfigJSON('');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with specified filepath', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const filepath = path.join(CURRENT_WORKING_DIRECTORY, 'secrets.jsonc');
    let result;
    const testSecrets = { database: { password: 'secret123' } };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testSecrets))
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestSecretsJSON(filepath);
    });

    after(() => {
        sinon.restore();
    });

    it('should read the specified secrets file', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual(filepath, mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should set application directory from filepath', () => {
        assertEqual(path.dirname(filepath), subject.applicationDirectory);
    });

    it('should return parsed secrets object', async () => {
        assertEqual('secret123', result.database.password);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with JSONC file in application directory', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testSecrets = { database: { password: 'secret123' } };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(testSecrets)) // .secrets.jsonc
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestSecretsJSON();
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSONC format first', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, '.secrets.jsonc'), mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should return parsed secrets object', async () => {
        assertEqual('secret123', result.database.password);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with .json file fallback', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testSecrets = { database: { password: 'secret123' } };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .secrets.jsonc not found
                .onSecondCall().resolves(JSON.stringify(testSecrets)) // .secrets.json found
        };

        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestSecretsJSON();
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSONC format first, then fallback to JSON', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, '.secrets.jsonc'), mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, '.secrets.json'), mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should return parsed secrets object', async () => {
        assertEqual('secret123', result.database.password);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with no secrets files found', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .secrets.jsonc not found
                .onSecondCall().resolves(null) // .secrets.json not found
        };

        subject = new ConfigStore({
            currentWorkingDirectory: '/test/cwd',
            applicationDirectory: '/test/app',
            fileSystem: mockFileSystem
        });

        result = await subject.loadLatestSecretsJSON();
    });

    after(() => {
        sinon.restore();
    });

    it('should return empty object when no secrets files are found', () => {
        assertEqual(0, Object.keys(result).length);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with invalid filepath parameter', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
        });
    });

    it('should throw AssertionError for undefined filepath', async () => {
        let error;
        try {
            await subject.loadLatestSecretsJSON();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });

    it('should throw AssertionError for null filepath', async () => {
        let error;
        try {
            await subject.loadLatestSecretsJSON(null);
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });

    it('should throw AssertionError for empty string filepath', async () => {
        let error;
        try {
            await subject.loadLatestSecretsJSON('');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('foo', error.message);
    });
});

describe('ConfigStore#attemptReadJSONFile with valid JSON file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testData = { name: 'Test', value: 42 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testData))
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });

        result = await subject.attemptReadJSONFile('/test/file.json');
    });

    after(() => {
        sinon.restore();
    });

    it('should return parsed JSON object', () => {
        assertEqual('Test', result.name);
        assertEqual(42, result.value);
    });

    it('should call readUtf8File with correct path', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/file.json', mockFileSystem.readUtf8File.getCall(0).args[0]);
    });
});

describe('ConfigStore#attemptReadJSONFile with JSONC file containing comments', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const jsoncContent = `{
        // This is a comment
        "name": "Test App",
        "port": 3000,
        "features": [
            "auth",
            "api",
            // "legacy", // commented out feature
        ]
    }`;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(jsoncContent)
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });

        result = await subject.attemptReadJSONFile('/test/file.jsonc');
    });

    after(() => {
        sinon.restore();
    });

    it('should parse JSONC with comments and trailing commas', () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
        assertArray(result.features);
        assertEqual(2, result.features.length);
        assertEqual('auth', result.features[0]);
        assertEqual('api', result.features[1]);
    });
});

describe('ConfigStore#attemptReadJSONFile with empty file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(null)
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });

        result = await subject.attemptReadJSONFile('/test/empty.json');
    });

    after(() => {
        sinon.restore();
    });

    it('should return null for empty file', () => {
        assertEqual(null, result);
    });
});

describe('ConfigStore#attemptReadJSONFile with file read error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const readError = new Error('Permission denied');
    readError.code = 'EACCES';

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().rejects(readError)
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw WrappedError with cause', async () => {
        let error;
        try {
            await subject.attemptReadJSONFile('/test/forbidden.json');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('Unexpected error while reading config file at /test/forbidden.json', error.message);
        assertEqual('EACCES', error.code);
        assertEqual(readError, error.cause);
    });
});

describe('ConfigStore#attemptReadJSONFile with invalid JSON', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const invalidJson = '{ "name": "Test", "port": 3000, }'; // trailing comma

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(invalidJson)
        };

        subject = new ConfigStore({
            fileSystem: mockFileSystem
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw ValidationError for invalid JSON', async () => {
        let error;
        try {
            await subject.attemptReadJSONFile('/test/invalid.json');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('JSON parsing errors in config file /test/invalid.json', error.message);
        assertEqual('/test/invalid.json', error.filepath);
    });
});

describe('ConfigStore#loadLatestConfigJSON with application directory determination', ({ before, after, it }) => {
    let mockFileSystem;
    const testConfig = { name: 'Test App' };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testConfig))
        };
    });

    after(() => {
        sinon.restore();
    });

    it('should set application directory to current working directory when not set', async () => {
        const subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });
        await subject.loadLatestConfigJSON();
        assertEqual(CURRENT_WORKING_DIRECTORY, subject.applicationDirectory);
    });

    it('should not override existing application directory', async () => {
        // Set application directory first
        const subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            applicationDirectory: path.join(CURRENT_WORKING_DIRECTORY, 'app'),
            fileSystem: mockFileSystem
        });

        await subject.loadLatestConfigJSON();
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'app'), subject.applicationDirectory);
    });
});

describe('ConfigStore#loadLatestSecretsJSON with application directory determination', ({ before, after, it }) => {
    let mockFileSystem;
    const testSecrets = { database: { password: 'secret' } };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testSecrets))
        };
    });

    after(() => {
        sinon.restore();
    });

    it('should set application directory to current working directory when not set', async () => {
        const subject = new ConfigStore({
            currentWorkingDirectory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem
        });
        await subject.loadLatestSecretsJSON();
        assertEqual(CURRENT_WORKING_DIRECTORY, subject.applicationDirectory);
    });

    it('should not override existing application directory', async () => {
        // Set application directory first
        const subject = new ConfigStore({
            currentWorkingDirectory: '/test/cwd',
            applicationDirectory: '/existing/app',
            fileSystem: mockFileSystem
        });

        await subject.loadLatestSecretsJSON();
        assertEqual('/existing/app', subject.applicationDirectory);
    });
});
