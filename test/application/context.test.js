import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual
} from 'kixx-assert';
import Context from '../../lib/application/context.js';

describe('Context#constructor with valid input', ({ before, it }) => {
    let context;
    let mockRuntime;
    let mockConfig;
    let mockPaths;
    let mockLogger;
    let mockRootUser;

    before(() => {
        mockRuntime = {
            command: 'test-command',
            server: {
                name: 'test-server',
            },
        };
        mockConfig = {
            name: 'Test App',
            getNamespace: sinon.stub().returns({}),
        };
        mockPaths = {
            app_directory: '/test/app/path',
            routes_directory: '/test/app/path/routes',
        };
        mockLogger = {
            info: sinon.stub(),
            error: sinon.stub(),
        };
        mockRootUser = {
            name: 'Test Root User',
            hasPermission: sinon.stub().returns(true),
        };

        context = new Context({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
            rootUser: mockRootUser,
        });
    });

    it('sets the runtime property correctly', () => {
        assertEqual(mockRuntime, context.runtime);
    });

    it('sets the config property correctly', () => {
        assertEqual(mockConfig, context.config);
    });

    it('sets the paths property correctly', () => {
        assertEqual(mockPaths, context.paths);
    });

    it('sets the logger property correctly', () => {
        assertEqual(mockLogger, context.logger);
    });
});

describe('Context#registerService() with valid input', ({ before, it }) => {
    let context;
    let testService;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testService = {
            name: 'TestService',
            doSomething: sinon.stub().returns('test result'),
        };
    });

    it('registers a service with a string name', () => {
        context.registerService('test-service', testService);

        const retrievedService = context.getService('test-service');
        assertEqual(testService, retrievedService);
    });

    it('registers multiple services with different names', () => {
        const service1 = { name: 'Service1' };
        const service2 = { name: 'Service2' };

        context.registerService('service-1', service1);
        context.registerService('service-2', service2);

        assertEqual(service1, context.getService('service-1'));
        assertEqual(service2, context.getService('service-2'));
    });

    it('allows overwriting an existing service', () => {
        const originalService = { name: 'Original' };
        const newService = { name: 'New' };

        context.registerService('overwrite-test', originalService);
        context.registerService('overwrite-test', newService);

        assertEqual(newService, context.getService('overwrite-test'));
    });
});

describe('Context#registerService() with invalid input', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an AssertionError when name is undefined', () => {
        let error;
        try {
            context.registerService(undefined, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is null', () => {
        let error;
        try {
            context.registerService(null, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an empty string', () => {
        let error;
        try {
            context.registerService('', {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is a number', () => {
        let error;
        try {
            context.registerService(123, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an object', () => {
        let error;
        try {
            context.registerService({}, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an array', () => {
        let error;
        try {
            context.registerService([], {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is a boolean', () => {
        let error;
        try {
            context.registerService(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getService() when service exists', ({ before, it }) => {
    let context;
    let testService;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testService = {
            name: 'TestService',
            doSomething: sinon.stub().returns('test result'),
        };
        context.registerService('test-service', testService);
    });

    it('returns the registered service', () => {
        const retrievedService = context.getService('test-service');
        assertEqual(testService, retrievedService);
    });

    it('returns the same service instance on multiple calls', () => {
        const firstCall = context.getService('test-service');
        const secondCall = context.getService('test-service');
        assertEqual(firstCall, secondCall);
    });

    it('returns services with different names', () => {
        const service1 = { name: 'Service1' };

        context.registerService('service-1', service1);
        context.registerService('service-2', service1);

        assertEqual(service1, context.getService('service-1'));
        assertEqual(service1, context.getService('service-2'));
    });
});

describe('Context#getService() when service does not exist', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an Error when service name does not exist', () => {
        let error;
        try {
            context.getService('nonexistent-service');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The service "nonexistent-service" is not registered', error.message);
    });
});

describe('Context#registerCollection() with valid input', ({ before, it }) => {
    let context;
    let testCollection;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testCollection = {
            name: 'TestCollection',
            find: sinon.stub().returns([]),
        };
    });

    it('registers a collection with a string name', () => {
        context.registerCollection('test-collection', testCollection);

        const retrievedCollection = context.getCollection('test-collection');
        assertEqual(testCollection, retrievedCollection);
    });

    it('registers multiple collections with different names', () => {
        const collection1 = { name: 'Collection1' };
        const collection2 = { name: 'Collection2' };

        context.registerCollection('collection-1', collection1);
        context.registerCollection('collection-2', collection2);

        assertEqual(collection1, context.getCollection('collection-1'));
        assertEqual(collection2, context.getCollection('collection-2'));
    });

    it('allows overwriting an existing collection', () => {
        const originalCollection = { name: 'Original' };
        const newCollection = { name: 'New' };

        context.registerCollection('overwrite-test', originalCollection);
        context.registerCollection('overwrite-test', newCollection);

        assertEqual(newCollection, context.getCollection('overwrite-test'));
    });
});

describe('Context#registerCollection() with invalid input', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an AssertionError when name is undefined', () => {
        let error;
        try {
            context.registerCollection(undefined, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is null', () => {
        let error;
        try {
            context.registerCollection(null, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an empty string', () => {
        let error;
        try {
            context.registerCollection('', {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is a number', () => {
        let error;
        try {
            context.registerCollection(123, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an object', () => {
        let error;
        try {
            context.registerCollection({}, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is an array', () => {
        let error;
        try {
            context.registerCollection([], {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('throws an AssertionError when name is a boolean', () => {
        let error;
        try {
            context.registerCollection(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getCollection() when collection exists', ({ before, it }) => {
    let context;
    let testCollection;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testCollection = {
            name: 'TestCollection',
            find: sinon.stub().returns([]),
        };
        context.registerCollection('test-collection', testCollection);
    });

    it('returns the registered collection', () => {
        const retrievedCollection = context.getCollection('test-collection');
        assertEqual(testCollection, retrievedCollection);
    });

    it('returns the same collection instance on multiple calls', () => {
        const firstCall = context.getCollection('test-collection');
        const secondCall = context.getCollection('test-collection');
        assertEqual(firstCall, secondCall);
    });

    it('returns collections with different names', () => {
        const collection1 = { name: 'Collection1' };

        context.registerCollection('collection-1', collection1);
        context.registerCollection('collection-2', collection1);

        assertEqual(collection1, context.getCollection('collection-1'));
        assertEqual(collection1, context.getCollection('collection-2'));
    });
});

describe('Context#getCollection() when collection does not exist', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an Error when collection name does not exist', () => {
        let error;
        try {
            context.getCollection('nonexistent-collection');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The collection "nonexistent-collection" is not registered', error.message);
    });
});






