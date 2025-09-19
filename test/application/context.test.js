import { describe } from 'kixx-test';
import sinon from 'sinon';
import {
    assert,
    assertEqual
} from 'kixx-assert';
import Context from '../../lib/application/context.js';

describe('Context#constructor with valid input', ({ before, it }) => {
    let subject;
    let mockRuntime;
    let mockConfig;
    let mockPaths;
    let mockLogger;

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

        subject = new Context({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
        });
    });

    it('should set the runtime property correctly', () => {
        assertEqual(mockRuntime, subject.runtime);
    });

    it('should set the config property correctly', () => {
        assertEqual(mockConfig, subject.config);
    });

    it('should set the paths property correctly', () => {
        assertEqual(mockPaths, subject.paths);
    });

    it('should set the logger property correctly', () => {
        assertEqual(mockLogger, subject.logger);
    });

    it('should make the context object immutable', () => {
        let error;
        try {
            subject.runtime = null;
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('TypeError', error.name);
    });
});

describe('Context#registerService() with valid input', ({ before, it }) => {
    let subject;
    let testService;

    before(() => {
        subject = new Context({
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

    it('should register a service with a string name', () => {
        subject.registerService('test-service', testService);

        const retrievedService = subject.getService('test-service');
        assertEqual(testService, retrievedService);
    });

    it('should register multiple services with different names', () => {
        const service1 = { name: 'Service1' };
        const service2 = { name: 'Service2' };

        subject.registerService('service-1', service1);
        subject.registerService('service-2', service2);

        assertEqual(service1, subject.getService('service-1'));
        assertEqual(service2, subject.getService('service-2'));
    });

    it('should allow overwriting an existing service', () => {
        const originalService = { name: 'Original' };
        const newService = { name: 'New' };

        subject.registerService('overwrite-test', originalService);
        subject.registerService('overwrite-test', newService);

        assertEqual(newService, subject.getService('overwrite-test'));
    });
});

describe('Context#registerService() with invalid input', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an AssertionError when name is undefined', () => {
        let error;
        try {
            subject.registerService(undefined, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is null', () => {
        let error;
        try {
            subject.registerService(null, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is an empty string', () => {
        let error;
        try {
            subject.registerService('', {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is a number', () => {
        let error;
        try {
            subject.registerService(123, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is an object', () => {
        let error;
        try {
            subject.registerService({}, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is an array', () => {
        let error;
        try {
            subject.registerService([], {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });

    it('should throw an AssertionError when name is a boolean', () => {
        let error;
        try {
            subject.registerService(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getService() when service exists', ({ before, it }) => {
    let subject;
    let testService;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testService = {
            name: 'TestService',
            doSomething: sinon.stub().returns('test result'),
        };
        subject.registerService('test-service', testService);
    });

    it('should return the registered service', () => {
        const retrievedService = subject.getService('test-service');
        assertEqual(testService, retrievedService);
    });

    it('should return the same service instance on multiple calls', () => {
        const firstCall = subject.getService('test-service');
        const secondCall = subject.getService('test-service');
        assertEqual(firstCall, secondCall);
    });

    it('should return services with different names', () => {
        const service1 = { name: 'Service1' };

        subject.registerService('service-1', service1);
        subject.registerService('service-2', service1);

        assertEqual(service1, subject.getService('service-1'));
        assertEqual(service1, subject.getService('service-2'));
    });
});

describe('Context#getService() when service does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an Error when service name does not exist', () => {
        let error;
        try {
            subject.getService('nonexistent-service');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The service "nonexistent-service" is not registered', error.message);
    });
});
