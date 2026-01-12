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

describe('Context#registerForm() with valid input', ({ before, it }) => {
    let context;
    let testForm;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testForm = {
            name: 'TestForm',
            validate: sinon.stub().returns(true),
            submit: sinon.stub().returns({}),
        };
    });

    it('registers a form with a string name', () => {
        context.registerForm('test-form', testForm);

        const retrievedForm = context.getForm('test-form');
        assertEqual(testForm, retrievedForm);
    });

    it('registers multiple forms with different names', () => {
        const form1 = { name: 'Form1' };
        const form2 = { name: 'Form2' };

        context.registerForm('form-1', form1);
        context.registerForm('form-2', form2);

        assertEqual(form1, context.getForm('form-1'));
        assertEqual(form2, context.getForm('form-2'));
    });

    it('allows overwriting an existing form', () => {
        const originalForm = { name: 'Original' };
        const newForm = { name: 'New' };

        context.registerForm('overwrite-test', originalForm);
        context.registerForm('overwrite-test', newForm);

        assertEqual(newForm, context.getForm('overwrite-test'));
    });
});

describe('Context#registerForm() with invalid input', ({ before, it }) => {
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
            context.registerForm(undefined, {});
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
            context.registerForm(null, {});
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
            context.registerForm('', {});
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
            context.registerForm(123, {});
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
            context.registerForm({}, {});
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
            context.registerForm([], {});
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
            context.registerForm(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getForm() when form exists', ({ before, it }) => {
    let context;
    let testForm;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testForm = {
            name: 'TestForm',
            validate: sinon.stub().returns(true),
            submit: sinon.stub().returns({}),
        };
        context.registerForm('test-form', testForm);
    });

    it('returns the registered form', () => {
        const retrievedForm = context.getForm('test-form');
        assertEqual(testForm, retrievedForm);
    });

    it('returns the same form instance on multiple calls', () => {
        const firstCall = context.getForm('test-form');
        const secondCall = context.getForm('test-form');
        assertEqual(firstCall, secondCall);
    });

    it('returns forms with different names', () => {
        const form1 = { name: 'Form1' };

        context.registerForm('form-1', form1);
        context.registerForm('form-2', form1);

        assertEqual(form1, context.getForm('form-1'));
        assertEqual(form1, context.getForm('form-2'));
    });
});

describe('Context#getForm() when form does not exist', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an Error when form name does not exist', () => {
        let error;
        try {
            context.getForm('nonexistent-form');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The form "nonexistent-form" is not registered', error.message);
    });
});

describe('Context#registerView() with valid input', ({ before, it }) => {
    let context;
    let testView;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testView = {
            name: 'TestView',
            render: sinon.stub().returns('<html></html>'),
            getData: sinon.stub().returns({}),
        };
    });

    it('registers a view with a string name', () => {
        context.registerView('test-view', testView);

        const retrievedView = context.getView('test-view');
        assertEqual(testView, retrievedView);
    });

    it('registers multiple views with different names', () => {
        const view1 = { name: 'View1' };
        const view2 = { name: 'View2' };

        context.registerView('view-1', view1);
        context.registerView('view-2', view2);

        assertEqual(view1, context.getView('view-1'));
        assertEqual(view2, context.getView('view-2'));
    });

    it('allows overwriting an existing view', () => {
        const originalView = { name: 'Original' };
        const newView = { name: 'New' };

        context.registerView('overwrite-test', originalView);
        context.registerView('overwrite-test', newView);

        assertEqual(newView, context.getView('overwrite-test'));
    });
});

describe('Context#registerView() with invalid input', ({ before, it }) => {
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
            context.registerView(undefined, {});
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
            context.registerView(null, {});
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
            context.registerView('', {});
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
            context.registerView(123, {});
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
            context.registerView({}, {});
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
            context.registerView([], {});
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
            context.registerView(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getView() when view exists', ({ before, it }) => {
    let context;
    let testView;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testView = {
            name: 'TestView',
            render: sinon.stub().returns('<html></html>'),
            getData: sinon.stub().returns({}),
        };
        context.registerView('test-view', testView);
    });

    it('returns the registered view', () => {
        const retrievedView = context.getView('test-view');
        assertEqual(testView, retrievedView);
    });

    it('returns the same view instance on multiple calls', () => {
        const firstCall = context.getView('test-view');
        const secondCall = context.getView('test-view');
        assertEqual(firstCall, secondCall);
    });

    it('returns views with different names', () => {
        const view1 = { name: 'View1' };

        context.registerView('view-1', view1);
        context.registerView('view-2', view1);

        assertEqual(view1, context.getView('view-1'));
        assertEqual(view1, context.getView('view-2'));
    });
});

describe('Context#getView() when view does not exist', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('throws an Error when view name does not exist', () => {
        let error;
        try {
            context.getView('nonexistent-view');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The view "nonexistent-view" is not registered', error.message);
    });
});

describe('Context#registerUserRole() with valid input', ({ before, it }) => {
    let context;
    let testUserRole;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testUserRole = {
            name: 'TestUserRole',
            permissions: [ 'read', 'write' ],
        };
    });

    it('registers a user role with a string name', () => {
        context.registerUserRole('test-user-role', testUserRole);
        assert(context.getUserRole('test-user-role'));
    });

    it('registers multiple user roles with different names', () => {
        const userRole1 = { name: 'UserRole1', permissions: [ 'read', 'write' ] };
        const userRole2 = { name: 'UserRole2', permissions: [ 'read', 'write' ] };

        context.registerUserRole('user-role-1', userRole1);
        context.registerUserRole('user-role-2', userRole2);

        assert(context.getUserRole('user-role-1'));
        assert(context.getUserRole('user-role-2'));
    });

    it('allows overwriting an existing user role', () => {
        const originalUserRole = { name: 'Original', permissions: [ 'read', 'write' ] };
        const newUserRole = { name: 'New', permissions: [ 'read', 'write' ] };

        context.registerUserRole('overwrite-test', originalUserRole);
        context.registerUserRole('overwrite-test', newUserRole);

        assert(context.getUserRole('overwrite-test'));
    });
});

describe('Context#registerUserRole() with invalid input', ({ before, it }) => {
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
            context.registerUserRole(undefined, {});
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
            context.registerUserRole(null, {});
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
            context.registerUserRole('', {});
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
            context.registerUserRole(123, {});
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
            context.registerUserRole({}, {});
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
            context.registerUserRole([], {});
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
            context.registerUserRole(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getUserRole() when user role exists', ({ before, it }) => {
    let context;
    let testUserRole;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testUserRole = {
            name: 'TestUserRole',
            permissions: [ 'read', 'write' ],
        };
        context.registerUserRole('test-user-role', testUserRole);
    });

    it('returns the registered user role', () => {
        const retrievedUserRole = context.getUserRole('test-user-role');
        assert(retrievedUserRole);
    });

    it('returns the same user role instance on multiple calls', () => {
        const firstCall = context.getUserRole('test-user-role');
        const secondCall = context.getUserRole('test-user-role');
        assertEqual(firstCall, secondCall);
    });

    it('returns user roles with different names', () => {
        const userRole1 = { name: 'UserRole1', permissions: [ 'read' ] };

        context.registerUserRole('user-role-1', userRole1);
        context.registerUserRole('user-role-2', userRole1);

        assert(context.getUserRole('user-role-1'));
        assert(context.getUserRole('user-role-2'));
    });
});

describe('Context#getUserRole() when user role does not exist', ({ before, it }) => {
    let context;

    before(() => {
        context = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('returns null when user role name does not exist', () => {
        const result = context.getUserRole('nonexistent-user-role');
        assertEqual(null, result);
    });
});
