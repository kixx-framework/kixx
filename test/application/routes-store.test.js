import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual,
    assertArray,
    assertMatches
} from 'kixx-assert';
import RoutesStore from '../../lib/application/routes-store.js';

// Mock current working directory
const CURRENT_WORKING_DIRECTORY = path.dirname(fileURLToPath(new URL(import.meta.url)));

describe('RoutesStore#constructor with valid options', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
        });
    });

    it('should return correct routes config filepath', () => {
        const expected = path.join(CURRENT_WORKING_DIRECTORY, 'virtual-hosts.jsonc');
        assertEqual(expected, subject.getRoutesConfigFilepath());
    });

    it('should convert app:// URN to filesystem path', () => {
        const urn = 'app://api/v1/users.jsonc';
        const expected = path.join(CURRENT_WORKING_DIRECTORY, 'routes', 'api', 'v1', 'users.jsonc');
        assertEqual(expected, subject.resolveAppUrnToFilepath(urn));
    });
});

describe('RoutesStore#getRoutesConfigFilepath', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
        });
    });

    it('should return correct routes config filepath', () => {
        const expected = path.join('/test/app', 'virtual-hosts.jsonc');
        assertEqual(expected, subject.getRoutesConfigFilepath());
    });

    it('should use app_directory for path construction', () => {
        const customSubject = new RoutesStore({
            app_directory: '/custom/app/dir',
            routes_directory: '/test/routes',
        });
        const expected = path.join('/custom/app/dir', 'virtual-hosts.jsonc');
        assertEqual(expected, customSubject.getRoutesConfigFilepath());
    });
});

describe('RoutesStore#resolveAppUrnToFilepath with multiple path segments', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
        });
    });

    it('should handle URN with multiple path segments', () => {
        const urn = 'app://admin/users/list.json';
        const expected = path.join(CURRENT_WORKING_DIRECTORY, 'routes', 'admin', 'users', 'list.json');
        assertEqual(expected, subject.resolveAppUrnToFilepath(urn));
    });
});

describe('RoutesStore#attemptReadJSONFile with valid JSON file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testData = { name: 'Test', value: 42 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testData)),
        };

        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
            fileSystem: mockFileSystem,
        });

        result = await subject.attemptReadJSONFile(path.join(CURRENT_WORKING_DIRECTORY, 'file.json'));
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
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'file.json'), mockFileSystem.readUtf8File.getCall(0).args[0]);
    });
});

describe('RoutesStore#attemptReadJSONFile with empty file', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(null),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
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

describe('RoutesStore#attemptReadJSONFile with file read error', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const readError = new Error('Permission denied');
    readError.code = 'EACCES';

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().rejects(readError),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
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
        assertEqual('WrappedError', error.name);
        assertEqual('Unexpected error while reading config file at /test/forbidden.json', error.message);
        assertEqual(readError, error.cause);
    });
});

describe('RoutesStore#attemptReadJSONFile with invalid JSON', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    const invalidJson = '{ "name": "Test", port: 3000 }';

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(invalidJson),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
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
        assertArray(error.errors);
    });
});

describe('RoutesStore#loadJSONFile with JSONC file found', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(testConfig)),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });

        result = await subject.loadJSONFile('/test/config.jsonc');
    });

    after(() => {
        sinon.restore();
    });

    it('should return parsed config object', () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });

    it('should call readUtf8File once', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/config.jsonc', mockFileSystem.readUtf8File.getCall(0).args[0]);
    });
});

describe('RoutesStore#loadJSONFile with JSONC not found, JSON found', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .jsonc not found
                .onSecondCall().resolves(JSON.stringify(testConfig)), // .json found
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });

        result = await subject.loadJSONFile('/test/config.jsonc');
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSONC first, then fallback to JSON', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/config.jsonc', mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual('/test/config.json', mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should return parsed config object', () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });
});

describe('RoutesStore#loadJSONFile with JSON not found, JSONC found', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const testConfig = { name: 'Test App', port: 3000 };

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(null) // .json not found
                .onSecondCall().resolves(JSON.stringify(testConfig)), // .jsonc found
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });

        result = await subject.loadJSONFile('/test/config.json');
    });

    after(() => {
        sinon.restore();
    });

    it('should try JSON first, then fallback to JSONC', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual('/test/config.json', mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual('/test/config.jsonc', mockFileSystem.readUtf8File.getCall(1).args[0]);
    });

    it('should return parsed config object', () => {
        assertEqual('Test App', result.name);
        assertEqual(3000, result.port);
    });
});

describe('RoutesStore#loadJSONFile with invalid file extension', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
        });
    });

    it('should throw AssertionError for invalid file extension', async () => {
        let error;
        try {
            await subject.loadJSONFile('/test/config.txt');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('Invalid routes config file extension: /test/config.txt (expected .jsonc or .json)', error.message);
    });
});

describe('RoutesStore#resolveRoutesConfigUrn with app:// scheme', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const mockRoutes = [
        { pattern: '/users', targets: [] },
        { pattern: '/users/:id', targets: [] },
    ];

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify(mockRoutes)),
        };

        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
            fileSystem: mockFileSystem,
        });

        const vhostConfig = { name: 'test-vhost', routes: [] };
        result = await subject.resolveRoutesConfigUrn(vhostConfig, 'app://api/users.jsonc');
    });

    after(() => {
        sinon.restore();
    });

    it('should load routes from app:// URN', () => {
        assertEqual(1, mockFileSystem.readUtf8File.callCount);
        const expectedPath = path.join(CURRENT_WORKING_DIRECTORY, 'routes', 'api', 'users.jsonc');
        assertEqual(expectedPath, mockFileSystem.readUtf8File.getCall(0).args[0]);
    });

    it('should return parsed route configs', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('/users', result[0].pattern);
        assertEqual('/users/:id', result[1].pattern);
    });
});

describe('RoutesStore#resolveRoutesConfigUrn with invalid URN scheme', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
        });
    });

    it('should throw AssertionError for invalid URN scheme', async () => {
        let error;
        try {
            const vhostConfig = { name: 'test-vhost', routes: [] };
            await subject.resolveRoutesConfigUrn(vhostConfig, 'invalid://routes');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('Invalid routes config URN: invalid://routes (expected app://)', error.message);
    });
});

describe('RoutesStore#resolveRoutesConfigUrn with non-array routes config', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify({ routes: [] })), // Object instead of array
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw AssertionError for non-array routes config', async () => {
        let error;
        try {
            const vhostConfig = { name: 'test-vhost', routes: [] };
            await subject.resolveRoutesConfigUrn(vhostConfig, 'app://routes.jsonc');
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertMatches(/^routes config must be an array/, error.message);
    });
});

describe('RoutesStore#loadRoutesConfigs with multiple URNs', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const mockRoutes1 = [{ pattern: '/api', targets: [] }];
    const mockRoutes2 = [{ pattern: '/admin', targets: [] }];

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(mockRoutes1))
                .onSecondCall().resolves(JSON.stringify(mockRoutes2)),
        };

        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
            fileSystem: mockFileSystem,
        });

        const vhostConfig = {
            name: 'test-vhost',
            routes: [ 'app://public.json', 'app://admin.jsonc' ],
        };

        result = await subject.loadRoutesConfigs(vhostConfig);
    });

    after(() => {
        sinon.restore();
    });

    it('should resolve all URNs and flatten results', () => {
        assertArray(result.routes);
        assertEqual('/api', result.routes[0].pattern);
        assertEqual('/admin', result.routes[1].pattern);
    });

    it('should call readUtf8File for each URN', () => {
        assertEqual(2, mockFileSystem.readUtf8File.callCount);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'routes', 'public.json'), mockFileSystem.readUtf8File.getCall(0).args[0]);
        assertEqual(path.join(CURRENT_WORKING_DIRECTORY, 'routes', 'admin.jsonc'), mockFileSystem.readUtf8File.getCall(1).args[0]);
    });
});

describe('RoutesStore#loadVhostsConfigs with valid config', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const mockVhostsConfig = [
        {
            name: 'api.example.com',
            routes: [ 'app://api.jsonc' ],
        },
        {
            name: 'www.example.com',
            routes: [ 'app://pages.jsonc' ],
        },
    ];
    const mockRoutes1 = [{ pattern: '/api', targets: [] }];
    const mockRoutes2 = [{ pattern: '/admin', targets: [] }];

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(mockVhostsConfig))
                .onSecondCall().resolves(JSON.stringify(mockRoutes1))
                .onThirdCall().resolves(JSON.stringify(mockRoutes2)),
        };

        subject = new RoutesStore({
            app_directory: CURRENT_WORKING_DIRECTORY,
            routes_directory: path.join(CURRENT_WORKING_DIRECTORY, 'routes'),
            fileSystem: mockFileSystem,
        });

        result = await subject.loadVhostsConfigs();
    });

    after(() => {
        sinon.restore();
    });

    it('should load and return vhost configs', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual('api.example.com', result[0].name);
        assertEqual('www.example.com', result[1].name);
    });

    it('should call readUtf8File with correct path', () => {
        assertEqual(3, mockFileSystem.readUtf8File.callCount);
        const expectedPath = path.join(CURRENT_WORKING_DIRECTORY, 'virtual-hosts.jsonc');
        assertEqual(expectedPath, mockFileSystem.readUtf8File.getCall(0).args[0]);
    });
});

describe('RoutesStore#loadVhostsConfigs with non-array config', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub().resolves(JSON.stringify({ vhosts: [] })), // Object instead of array
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should throw AssertionError for non-array vhosts config', async () => {
        let error;
        try {
            await subject.loadVhostsConfigs();
        } catch (e) {
            error = e;
        }

        assert(error);
        assertEqual('AssertionError', error.name);
        assertMatches(/^vhosts config must be an array/, error.message);
    });
});

describe('RoutesStore#loadVhostSpecs with valid configs', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const mockVhostsConfig = [
        {
            hostname: 'com.example',
            routes: [ 'app://default' ],
        },
    ];
    const mockRoutes = [{ pattern: '/api', targets: [] }];

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(mockVhostsConfig))
                .onSecondCall().resolves(JSON.stringify(mockRoutes)),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });

        result = await subject.loadVhostSpecs();
    });

    after(() => {
        sinon.restore();
    });

    it('should return array of VirtualHostSpec objects', () => {
        assertArray(result);
        assertEqual(1, result.length);
        // Note: We can't test the exact type without importing VirtualHostSpec,
        // but we can verify it's an object with expected properties
        assert(result[0]);
        assertEqual('com.example', result[0].hostname);
    });
});

describe('RoutesStore#loadVirtualHosts with valid config', ({ before, after, it }) => {
    let subject;
    let mockFileSystem;
    let result;
    const mockVhostsConfig = [
        {
            hostname: 'com.example.api',
            routes: [ 'app://default' ],
        },
    ];
    const mockRoutes = [{ pattern: '/api', targets: [] }];

    before(async () => {
        mockFileSystem = {
            readUtf8File: sinon.stub()
                .onFirstCall().resolves(JSON.stringify(mockVhostsConfig))
                .onSecondCall().resolves(JSON.stringify(mockRoutes)),
        };

        subject = new RoutesStore({
            app_directory: '/test/app',
            routes_directory: '/test/routes',
            fileSystem: mockFileSystem,
        });

        const middleware = [];
        const handlers = { apiHandler: sinon.stub() };
        const errorHandlers = { errorHandler: sinon.stub() };

        result = await subject.loadVirtualHosts(middleware, handlers, errorHandlers);
    });

    after(() => {
        sinon.restore();
    });

    it('should return array of VirtualHost objects', () => {
        assertArray(result);
        assertEqual(1, result.length);
        // Note: We can't test the exact type without importing VirtualHost,
        // but we can verify it's an object
        assert(result[0]);
    });
});
