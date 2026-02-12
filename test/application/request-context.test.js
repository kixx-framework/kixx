import { describe } from 'kixx-test';
import sinon from 'sinon';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';
import ApplicationContext from '../../lib/application/application-context.js';
import RequestContext from '../../lib/application/request-context.js';
import HttpTarget from '../../lib/http-server/http-target.js';


describe('RequestContext#constructor exposes read-only properties', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let mockRuntime;
    let mockConfig;
    let mockPaths;
    let mockLogger;

    before(() => {
        mockRuntime = {
            command: 'test-command',
            server: { name: 'test-server' },
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

        appContext = new ApplicationContext({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
        });

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('exposes logger from application context', () => {
        assertEqual(mockLogger, requestContext.logger);
    });

    it('exposes config from application context', () => {
        assertEqual(mockConfig, requestContext.config);
    });

    it('exposes runtime from application context', () => {
        assertEqual(mockRuntime, requestContext.runtime);
    });

    it('exposes paths from application context', () => {
        assertEqual(mockPaths, requestContext.paths);
    });
});


describe('RequestContext#constructor makes properties non-writable', ({ before, after, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        const mockRuntime = { command: 'test' };
        const mockConfig = { name: 'Test' };
        const mockPaths = { app_directory: '/test' };
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
        });

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('throws TypeError when attempting to modify logger', () => {
        let error;
        try {
            requestContext.logger = { info: sinon.stub() };
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });

    it('throws TypeError when attempting to modify config', () => {
        let error;
        try {
            requestContext.config = { name: 'New Config' };
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });

    it('throws TypeError when attempting to modify runtime', () => {
        let error;
        try {
            requestContext.runtime = { command: 'new-command' };
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });

    it('throws TypeError when attempting to modify paths', () => {
        let error;
        try {
            requestContext.paths = { app_directory: '/new/path' };
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('RequestContext#constructor does not expose registration methods', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        requestContext = new RequestContext(appContext);
    });

    it('does not expose registerService method', () => {
        assertEqual(undefined, requestContext.registerService);
    });

    it('does not expose registerCollection method', () => {
        assertEqual(undefined, requestContext.registerCollection);
    });

    it('application context has registerService method', () => {
        assertEqual('function', typeof appContext.registerService);
    });

    it('application context has registerCollection method', () => {
        assertEqual('function', typeof appContext.registerCollection);
    });
});


describe('RequestContext#getService() with registered service', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let testService;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        testService = {
            name: 'TestService',
            doSomething: sinon.stub().returns('test result'),
        };

        appContext.registerService('test.Service', testService);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the registered service', () => {
        const service = requestContext.getService('test.Service');
        assertEqual(testService, service);
    });

    it('returns the correct service instance', () => {
        const service = requestContext.getService('test.Service');
        assertEqual('TestService', service.name);
        assertEqual('function', typeof service.doSomething);
    });
});


describe('RequestContext#getService() with unregistered service', ({ before, after, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('throws AssertionError', () => {
        let error;
        try {
            requestContext.getService('nonexistent.Service');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('error message includes service name', () => {
        let error;
        try {
            requestContext.getService('missing.Service');
        } catch (err) {
            error = err;
        }
        assert(error.message.includes('missing.Service'));
    });
});


describe('RequestContext#getService() with multiple services', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let service1;
    let service2;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        service1 = { name: 'Service1', value: 'first' };
        service2 = { name: 'Service2', value: 'second' };

        appContext.registerService('app.Service1', service1);
        appContext.registerService('app.Service2', service2);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('returns correct service1', () => {
        const result = requestContext.getService('app.Service1');
        assertEqual(service1, result);
    });

    it('returns correct service2', () => {
        const result = requestContext.getService('app.Service2');
        assertEqual(service2, result);
    });
});


describe('RequestContext#getCollection() with registered collection', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let testCollection;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        testCollection = {
            name: 'TestCollection',
            findById: sinon.stub().returns({ id: 1 }),
        };

        appContext.registerCollection('app.User', testCollection);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('returns the registered collection', () => {
        const collection = requestContext.getCollection('app.User');
        assertEqual(testCollection, collection);
    });

    it('returns the correct collection instance', () => {
        const collection = requestContext.getCollection('app.User');
        assertEqual('TestCollection', collection.name);
        assertEqual('function', typeof collection.findById);
    });
});


describe('RequestContext#getCollection() with unregistered collection', ({ before, after, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('throws AssertionError', () => {
        let error;
        try {
            requestContext.getCollection('app.NonexistentCollection');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });

    it('error message includes collection name', () => {
        let error;
        try {
            requestContext.getCollection('app.MissingCollection');
        } catch (err) {
            error = err;
        }
        assert(error.message.includes('app.MissingCollection'));
    });
});


describe('RequestContext#getCollection() with multiple collections', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let userCollection;
    let postCollection;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        userCollection = { name: 'UserCollection', type: 'user' };
        postCollection = { name: 'PostCollection', type: 'post' };

        appContext.registerCollection('app.User', userCollection);
        appContext.registerCollection('app.Post', postCollection);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('returns correct user collection', () => {
        const result = requestContext.getCollection('app.User');
        assertEqual(userCollection, result);
    });

    it('returns correct post collection', () => {
        const result = requestContext.getCollection('app.Post');
        assertEqual(postCollection, result);
    });
});


describe('RequestContext delegates to application context', ({ before, after, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        // Spy on the application context methods
        sinon.spy(appContext, 'getService');
        sinon.spy(appContext, 'getCollection');

        const testService = { name: 'Service' };
        const testCollection = { name: 'Collection' };

        appContext.registerService('test.Service', testService);
        appContext.registerCollection('app.Test', testCollection);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('delegates getService to application context', () => {
        requestContext.getService('test.Service');
        assertEqual(1, appContext.getService.callCount);
        assertEqual('test.Service', appContext.getService.getCall(0).args[0]);
    });

    it('delegates getCollection to application context', () => {
        requestContext.getCollection('app.Test');
        assertEqual(1, appContext.getCollection.callCount);
        assertEqual('app.Test', appContext.getCollection.getCall(0).args[0]);
    });
});


describe('RequestContext prevents mutation of application context', ({ before, after, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        const mockLogger = { info: sinon.stub() };

        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: mockLogger,
        });

        const initialService = { name: 'InitialService' };
        appContext.registerService('test.Service', initialService);

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('cannot register new services through request context', () => {
        // Request context should not have registerService method
        assertFalsy(requestContext.registerService);
    });

    it('cannot register new collections through request context', () => {
        // Request context should not have registerCollection method
        assertFalsy(requestContext.registerCollection);
    });

    it('can still access services registered in application context', () => {
        const service = requestContext.getService('test.Service');
        assertEqual('InitialService', service.name);
    });
});


describe('RequestContext shares same instances with application context', ({ before, after, it }) => {
    let appContext;
    let requestContext;
    let mockLogger;
    let mockConfig;
    let mockRuntime;
    let mockPaths;

    before(() => {
        mockLogger = { info: sinon.stub() };
        mockConfig = { name: 'Test Config' };
        mockRuntime = { command: 'test' };
        mockPaths = { app_directory: '/test' };

        appContext = new ApplicationContext({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
        });

        requestContext = new RequestContext(appContext);
    });

    after(() => {
        sinon.restore();
    });

    it('shares same logger instance', () => {
        assertEqual(true, requestContext.logger === appContext.logger);
    });

    it('shares same config instance', () => {
        assertEqual(true, requestContext.config === appContext.config);
    });

    it('shares same runtime instance', () => {
        assertEqual(true, requestContext.runtime === appContext.runtime);
    });

    it('shares same paths instance', () => {
        assertEqual(true, requestContext.paths === appContext.paths);
    });
});


describe('RequestContext#constructor with no routes provided', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        requestContext = new RequestContext(appContext);
    });

    it('getAllHttpTargets returns empty array', () => {
        const targets = requestContext.getAllHttpTargets();
        assertEqual(0, targets.length);
    });

    it('getHttpTargetsByTag returns empty array', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assertEqual(0, targets.length);
    });
});


describe('RequestContext#getAllHttpTargets() with routes', ({ before, it }) => {
    let appContext;
    let requestContext;
    let target1;
    let target2;
    let target3;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        target1 = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            tags: [ 'public' ],
            middleware: [],
            errorHandlers: [],
        });

        target2 = new HttpTarget({
            name: 'Target2',
            allowedMethods: [ 'POST' ],
            tags: [ 'api' ],
            middleware: [],
            errorHandlers: [],
        });

        target3 = new HttpTarget({
            name: 'Target3',
            allowedMethods: [ 'DELETE' ],
            tags: [ 'admin' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: 'Route1', targets: [ target1, target2 ] },
            { name: 'Route2', targets: [ target3 ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns all targets from all routes', () => {
        const targets = requestContext.getAllHttpTargets();
        assertEqual(3, targets.length);
    });

    it('includes target1', () => {
        const targets = requestContext.getAllHttpTargets();
        assert(targets.includes(target1));
    });

    it('includes target2', () => {
        const targets = requestContext.getAllHttpTargets();
        assert(targets.includes(target2));
    });

    it('includes target3', () => {
        const targets = requestContext.getAllHttpTargets();
        assert(targets.includes(target3));
    });
});


describe('RequestContext#getAllHttpTargets() returns new array each time', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        const target = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: 'Route1', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns different array instances', () => {
        const targets1 = requestContext.getAllHttpTargets();
        const targets2 = requestContext.getAllHttpTargets();
        assertFalsy(targets1 === targets2);
    });
});


describe('RequestContext#getHttpTarget() with valid route and target', ({ before, it }) => {
    let appContext;
    let requestContext;
    let target1;
    let target2;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        target1 = new HttpTarget({
            name: 'ViewUser',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        target2 = new HttpTarget({
            name: 'CreateUser',
            allowedMethods: [ 'POST' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/users', targets: [ target1, target2 ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns the correct target for ViewUser', () => {
        const target = requestContext.getHttpTarget('/users', 'ViewUser');
        assertEqual(target1, target);
    });

    it('returns the correct target for CreateUser', () => {
        const target = requestContext.getHttpTarget('/users', 'CreateUser');
        assertEqual(target2, target);
    });
});


describe('RequestContext#getHttpTarget() with non-existent route', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        const target = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/users', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('throws AssertionError', () => {
        let error;
        try {
            requestContext.getHttpTarget('/posts', 'Target1');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('error message includes route name', () => {
        let error;
        try {
            requestContext.getHttpTarget('/posts', 'Target1');
        } catch (err) {
            error = err;
        }
        assert(error.message.includes('/posts'));
    });
});


describe('RequestContext#getHttpTarget() with non-existent target', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        const target = new HttpTarget({
            name: 'ViewUser',
            allowedMethods: [ 'GET' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/users', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('throws AssertionError', () => {
        let error;
        try {
            requestContext.getHttpTarget('/users', 'DeleteUser');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
    });

    it('error message includes target name', () => {
        let error;
        try {
            requestContext.getHttpTarget('/users', 'DeleteUser');
        } catch (err) {
            error = err;
        }
        assert(error.message.includes('DeleteUser'));
    });

    it('error message includes route name', () => {
        let error;
        try {
            requestContext.getHttpTarget('/users', 'DeleteUser');
        } catch (err) {
            error = err;
        }
        assert(error.message.includes('/users'));
    });
});


describe('RequestContext#getHttpTargetsByTag() with matching targets', ({ before, it }) => {
    let appContext;
    let requestContext;
    let publicTarget1;
    let publicTarget2;
    let privateTarget;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        publicTarget1 = new HttpTarget({
            name: 'PublicTarget1',
            allowedMethods: [ 'GET' ],
            tags: [ 'public', 'cacheable' ],
            middleware: [],
            errorHandlers: [],
        });

        publicTarget2 = new HttpTarget({
            name: 'PublicTarget2',
            allowedMethods: [ 'GET' ],
            tags: [ 'public' ],
            middleware: [],
            errorHandlers: [],
        });

        privateTarget = new HttpTarget({
            name: 'PrivateTarget',
            allowedMethods: [ 'POST' ],
            tags: [ 'private', 'admin' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/route1', targets: [ publicTarget1 ] },
            { name: '/route2', targets: [ publicTarget2, privateTarget ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns targets with matching tag', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assertEqual(2, targets.length);
    });

    it('includes publicTarget1', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assert(targets.includes(publicTarget1));
    });

    it('includes publicTarget2', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assert(targets.includes(publicTarget2));
    });

    it('does not include privateTarget', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assertFalsy(targets.includes(privateTarget));
    });

    it('returns targets with cacheable tag', () => {
        const targets = requestContext.getHttpTargetsByTag('cacheable');
        assertEqual(1, targets.length);
        assertEqual(publicTarget1, targets[0]);
    });

    it('returns targets with admin tag', () => {
        const targets = requestContext.getHttpTargetsByTag('admin');
        assertEqual(1, targets.length);
        assertEqual(privateTarget, targets[0]);
    });
});


describe('RequestContext#getHttpTargetsByTag() with no matching targets', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        const target = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            tags: [ 'public' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/route1', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns empty array for non-existent tag', () => {
        const targets = requestContext.getHttpTargetsByTag('nonexistent');
        assertEqual(0, targets.length);
    });

    it('returns an array', () => {
        const targets = requestContext.getHttpTargetsByTag('nonexistent');
        assertEqual(true, Array.isArray(targets));
    });
});


describe('RequestContext#getHttpTargetsByTag() returns new array each time', ({ before, it }) => {
    let appContext;
    let requestContext;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        const target = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            tags: [ 'public' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/route1', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns different array instances', () => {
        const targets1 = requestContext.getHttpTargetsByTag('public');
        const targets2 = requestContext.getHttpTargetsByTag('public');
        assertFalsy(targets1 === targets2);
    });
});


describe('RequestContext#getHttpTargetsByTag() is case-sensitive', ({ before, it }) => {
    let appContext;
    let requestContext;
    let target;

    before(() => {
        appContext = new ApplicationContext({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });

        target = new HttpTarget({
            name: 'Target1',
            allowedMethods: [ 'GET' ],
            tags: [ 'Public' ],
            middleware: [],
            errorHandlers: [],
        });

        const routes = [
            { name: '/route1', targets: [ target ] },
        ];

        requestContext = new RequestContext(appContext, routes);
    });

    it('returns empty array for lowercase when tag is uppercase', () => {
        const targets = requestContext.getHttpTargetsByTag('public');
        assertEqual(0, targets.length);
    });

    it('returns target for exact case match', () => {
        const targets = requestContext.getHttpTargetsByTag('Public');
        assertEqual(1, targets.length);
        assertEqual(target, targets[0]);
    });
});
