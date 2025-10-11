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

        subject = new Context({
            runtime: mockRuntime,
            config: mockConfig,
            paths: mockPaths,
            logger: mockLogger,
            rootUser: mockRootUser,
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

describe('Context#registerCollection() with valid input', ({ before, it }) => {
    let subject;
    let testCollection;

    before(() => {
        subject = new Context({
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

    it('should register a collection with a string name', () => {
        subject.registerCollection('test-collection', testCollection);

        const retrievedCollection = subject.getCollection('test-collection');
        assertEqual(testCollection, retrievedCollection);
    });

    it('should register multiple collections with different names', () => {
        const collection1 = { name: 'Collection1' };
        const collection2 = { name: 'Collection2' };

        subject.registerCollection('collection-1', collection1);
        subject.registerCollection('collection-2', collection2);

        assertEqual(collection1, subject.getCollection('collection-1'));
        assertEqual(collection2, subject.getCollection('collection-2'));
    });

    it('should allow overwriting an existing collection', () => {
        const originalCollection = { name: 'Original' };
        const newCollection = { name: 'New' };

        subject.registerCollection('overwrite-test', originalCollection);
        subject.registerCollection('overwrite-test', newCollection);

        assertEqual(newCollection, subject.getCollection('overwrite-test'));
    });
});

describe('Context#registerCollection() with invalid input', ({ before, it }) => {
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
            subject.registerCollection(undefined, {});
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
            subject.registerCollection(null, {});
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
            subject.registerCollection('', {});
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
            subject.registerCollection(123, {});
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
            subject.registerCollection({}, {});
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
            subject.registerCollection([], {});
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
            subject.registerCollection(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getCollection() when collection exists', ({ before, it }) => {
    let subject;
    let testCollection;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testCollection = {
            name: 'TestCollection',
            find: sinon.stub().returns([]),
        };
        subject.registerCollection('test-collection', testCollection);
    });

    it('should return the registered collection', () => {
        const retrievedCollection = subject.getCollection('test-collection');
        assertEqual(testCollection, retrievedCollection);
    });

    it('should return the same collection instance on multiple calls', () => {
        const firstCall = subject.getCollection('test-collection');
        const secondCall = subject.getCollection('test-collection');
        assertEqual(firstCall, secondCall);
    });

    it('should return collections with different names', () => {
        const collection1 = { name: 'Collection1' };

        subject.registerCollection('collection-1', collection1);
        subject.registerCollection('collection-2', collection1);

        assertEqual(collection1, subject.getCollection('collection-1'));
        assertEqual(collection1, subject.getCollection('collection-2'));
    });
});

describe('Context#getCollection() when collection does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an Error when collection name does not exist', () => {
        let error;
        try {
            subject.getCollection('nonexistent-collection');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The collection "nonexistent-collection" is not registered', error.message);
    });
});

describe('Context#registerForm() with valid input', ({ before, it }) => {
    let subject;
    let testForm;

    before(() => {
        subject = new Context({
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

    it('should register a form with a string name', () => {
        subject.registerForm('test-form', testForm);

        const retrievedForm = subject.getForm('test-form');
        assertEqual(testForm, retrievedForm);
    });

    it('should register multiple forms with different names', () => {
        const form1 = { name: 'Form1' };
        const form2 = { name: 'Form2' };

        subject.registerForm('form-1', form1);
        subject.registerForm('form-2', form2);

        assertEqual(form1, subject.getForm('form-1'));
        assertEqual(form2, subject.getForm('form-2'));
    });

    it('should allow overwriting an existing form', () => {
        const originalForm = { name: 'Original' };
        const newForm = { name: 'New' };

        subject.registerForm('overwrite-test', originalForm);
        subject.registerForm('overwrite-test', newForm);

        assertEqual(newForm, subject.getForm('overwrite-test'));
    });
});

describe('Context#registerForm() with invalid input', ({ before, it }) => {
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
            subject.registerForm(undefined, {});
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
            subject.registerForm(null, {});
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
            subject.registerForm('', {});
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
            subject.registerForm(123, {});
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
            subject.registerForm({}, {});
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
            subject.registerForm([], {});
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
            subject.registerForm(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getForm() when form exists', ({ before, it }) => {
    let subject;
    let testForm;

    before(() => {
        subject = new Context({
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
        subject.registerForm('test-form', testForm);
    });

    it('should return the registered form', () => {
        const retrievedForm = subject.getForm('test-form');
        assertEqual(testForm, retrievedForm);
    });

    it('should return the same form instance on multiple calls', () => {
        const firstCall = subject.getForm('test-form');
        const secondCall = subject.getForm('test-form');
        assertEqual(firstCall, secondCall);
    });

    it('should return forms with different names', () => {
        const form1 = { name: 'Form1' };

        subject.registerForm('form-1', form1);
        subject.registerForm('form-2', form1);

        assertEqual(form1, subject.getForm('form-1'));
        assertEqual(form1, subject.getForm('form-2'));
    });
});

describe('Context#getForm() when form does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an Error when form name does not exist', () => {
        let error;
        try {
            subject.getForm('nonexistent-form');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The form "nonexistent-form" is not registered', error.message);
    });
});

describe('Context#registerView() with valid input', ({ before, it }) => {
    let subject;
    let testView;

    before(() => {
        subject = new Context({
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

    it('should register a view with a string name', () => {
        subject.registerView('test-view', testView);

        const retrievedView = subject.getView('test-view');
        assertEqual(testView, retrievedView);
    });

    it('should register multiple views with different names', () => {
        const view1 = { name: 'View1' };
        const view2 = { name: 'View2' };

        subject.registerView('view-1', view1);
        subject.registerView('view-2', view2);

        assertEqual(view1, subject.getView('view-1'));
        assertEqual(view2, subject.getView('view-2'));
    });

    it('should allow overwriting an existing view', () => {
        const originalView = { name: 'Original' };
        const newView = { name: 'New' };

        subject.registerView('overwrite-test', originalView);
        subject.registerView('overwrite-test', newView);

        assertEqual(newView, subject.getView('overwrite-test'));
    });
});

describe('Context#registerView() with invalid input', ({ before, it }) => {
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
            subject.registerView(undefined, {});
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
            subject.registerView(null, {});
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
            subject.registerView('', {});
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
            subject.registerView(123, {});
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
            subject.registerView({}, {});
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
            subject.registerView([], {});
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
            subject.registerView(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getView() when view exists', ({ before, it }) => {
    let subject;
    let testView;

    before(() => {
        subject = new Context({
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
        subject.registerView('test-view', testView);
    });

    it('should return the registered view', () => {
        const retrievedView = subject.getView('test-view');
        assertEqual(testView, retrievedView);
    });

    it('should return the same view instance on multiple calls', () => {
        const firstCall = subject.getView('test-view');
        const secondCall = subject.getView('test-view');
        assertEqual(firstCall, secondCall);
    });

    it('should return views with different names', () => {
        const view1 = { name: 'View1' };

        subject.registerView('view-1', view1);
        subject.registerView('view-2', view1);

        assertEqual(view1, subject.getView('view-1'));
        assertEqual(view1, subject.getView('view-2'));
    });
});

describe('Context#getView() when view does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an Error when view name does not exist', () => {
        let error;
        try {
            subject.getView('nonexistent-view');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The view "nonexistent-view" is not registered', error.message);
    });
});

describe('Context#registerUserRole() with valid input', ({ before, it }) => {
    let subject;
    let testUserRole;

    before(() => {
        subject = new Context({
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

    it('should register a user role with a string name', () => {
        subject.registerUserRole('test-user-role', testUserRole);

        const retrievedUserRole = subject.getUserRole('test-user-role');
        assertEqual(testUserRole, retrievedUserRole);
    });

    it('should register multiple user roles with different names', () => {
        const userRole1 = { name: 'UserRole1' };
        const userRole2 = { name: 'UserRole2' };

        subject.registerUserRole('user-role-1', userRole1);
        subject.registerUserRole('user-role-2', userRole2);

        assertEqual(userRole1, subject.getUserRole('user-role-1'));
        assertEqual(userRole2, subject.getUserRole('user-role-2'));
    });

    it('should allow overwriting an existing user role', () => {
        const originalUserRole = { name: 'Original' };
        const newUserRole = { name: 'New' };

        subject.registerUserRole('overwrite-test', originalUserRole);
        subject.registerUserRole('overwrite-test', newUserRole);

        assertEqual(newUserRole, subject.getUserRole('overwrite-test'));
    });
});

describe('Context#registerUserRole() with invalid input', ({ before, it }) => {
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
            subject.registerUserRole(undefined, {});
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
            subject.registerUserRole(null, {});
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
            subject.registerUserRole('', {});
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
            subject.registerUserRole(123, {});
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
            subject.registerUserRole({}, {});
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
            subject.registerUserRole([], {});
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
            subject.registerUserRole(false, {});
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('ASSERTION_ERROR', error.code);
        assertEqual('AssertionError', error.name);
    });
});

describe('Context#getUserRole() when user role exists', ({ before, it }) => {
    let subject;
    let testUserRole;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
        testUserRole = {
            name: 'TestUserRole',
            permissions: [ 'read', 'write' ],
        };
        subject.registerUserRole('test-user-role', testUserRole);
    });

    it('should return the registered user role', () => {
        const retrievedUserRole = subject.getUserRole('test-user-role');
        assertEqual(testUserRole, retrievedUserRole);
    });

    it('should return the same user role instance on multiple calls', () => {
        const firstCall = subject.getUserRole('test-user-role');
        const secondCall = subject.getUserRole('test-user-role');
        assertEqual(firstCall, secondCall);
    });

    it('should return user roles with different names', () => {
        const userRole1 = { name: 'UserRole1' };

        subject.registerUserRole('user-role-1', userRole1);
        subject.registerUserRole('user-role-2', userRole1);

        assertEqual(userRole1, subject.getUserRole('user-role-1'));
        assertEqual(userRole1, subject.getUserRole('user-role-2'));
    });
});

describe('Context#getUserRole() when user role does not exist', ({ before, it }) => {
    let subject;

    before(() => {
        subject = new Context({
            runtime: null,
            config: null,
            paths: null,
            logger: null,
        });
    });

    it('should throw an Error when user role name does not exist', () => {
        let error;
        try {
            subject.getUserRole('nonexistent-user-role');
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('The user role "nonexistent-user-role" is not registered', error.message);
    });
});
