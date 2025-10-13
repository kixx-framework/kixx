import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNonEmptyString } from 'kixx-assert';
import sinon from 'sinon';
import KixxBaseUser from '../../lib/user/kixx-base-user.js';
import KixxBaseUserCollection from '../../lib/user/kixx-base-user.collection.js';
import KixxRootUser from '../../lib/user/kixx-root-user.js';
import KixxBaseUserSession from '../../lib/user/kixx-base-user-session.js';


class User extends KixxBaseUser { }
class RootUser extends KixxRootUser { }
class UserSession extends KixxBaseUserSession { }

class UserCollection extends KixxBaseUserCollection {
    static Model = User;
    static RootUser = RootUser;
    static UserSession = UserSession;
}


describe('KixxBaseUserCollection#getSession() when session exists', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockSessionRecord;

    before(async () => {
        // Create mock session record from datastore
        mockSessionRecord = {
            id: 'session-abc123',
            userId: 'user-456',
            createdAt: '2025-10-13T12:00:00.000Z',
            expiresAt: '2025-10-14T12:00:00.000Z',
        };

        // Mock datastore with stubbed getItem method
        datastore = {
            getItem: sinon.stub().resolves(mockSessionRecord),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new UserCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'sessionIdToPrimaryKey');
        sinon.spy(UserSession, 'fromRecord');

        // Call the method under test
        result = await collection.getSession('session-abc123');
    });

    after(() => {
        sinon.restore();
    });

    it('calls sessionIdToPrimaryKey()', () => {
        assertEqual(1, collection.sessionIdToPrimaryKey.callCount, 'sessionIdToPrimaryKey() was called once');
        assertEqual('session-abc123', collection.sessionIdToPrimaryKey.firstCall.args[0], 'sessionIdToPrimaryKey() called with session id');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('UserSession__session-abc123', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with namespaced key');
    });

    it('returns the result of UserSession.fromRecord()', () => {
        assertEqual(1, UserSession.fromRecord.callCount, 'UserSession.fromRecord() was called once');
        assertEqual(mockSessionRecord, UserSession.fromRecord.firstCall.args[0], 'UserSession.fromRecord() called with datastore record');
        assert(result instanceof UserSession, 'result is instance of UserSession');
        assertEqual('session-abc123', result.id, 'result has correct id');
        assertEqual('user-456', result.userId, 'result has correct userId');
    });
});

describe('KixxBaseUserCollection#getSession() when session does not exist', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;

    before(async () => {
        // Mock datastore with stubbed getItem that returns null (session not found)
        datastore = {
            getItem: sinon.stub().resolves(null),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new UserCollection(context);

        // Spy on the methods we want to verify are called (or not called)
        sinon.spy(collection, 'sessionIdToPrimaryKey');
        sinon.spy(UserSession, 'fromRecord');

        // Call the method under test
        result = await collection.getSession('nonexistent-session');
    });

    after(() => {
        sinon.restore();
    });

    it('calls sessionIdToPrimaryKey()', () => {
        assertEqual(1, collection.sessionIdToPrimaryKey.callCount, 'sessionIdToPrimaryKey() was called once');
        assertEqual('nonexistent-session', collection.sessionIdToPrimaryKey.firstCall.args[0], 'sessionIdToPrimaryKey() called with session id');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('UserSession__nonexistent-session', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with namespaced key');
    });

    it('does not call UserSession.fromRecord()', () => {
        assertEqual(0, UserSession.fromRecord.callCount, 'UserSession.fromRecord() was not called');
    });

    it('returns null', () => {
        assertEqual(null, result, 'result is null');
    });
});

describe('KixxBaseUserCollection#refreshSession()', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let oldSession;

    before(async () => {

        // Create old session
        oldSession = UserSession.fromRecord({
            id: 'session-old-abc',
            userId: 'user-456',
            creationDateTime: '2025-10-13T12:00:00.000Z',
            lastRefreshDateTime: '2025-10-13T12:00:00.000Z',
        });

        sinon.spy(oldSession, 'refresh');

        // Mock datastore with stubbed setItem and deleteItem methods
        datastore = {
            setItem: sinon.stub().resolves(),
            deleteItem: sinon.stub().resolves(),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new UserCollection(context);

        // Spy on sessionIdToPrimaryKey
        sinon.spy(collection, 'sessionIdToPrimaryKey');

        // Call the method under test
        result = await collection.refreshSession(oldSession);
    });

    after(() => {
        sinon.restore();
    });

    it('calls session.refresh()', () => {
        assertEqual(1, oldSession.refresh.callCount, 'session.refresh() was called once');
    });

    it('calls sessionIdToPrimaryKey()', () => {
        // Should be called twice: once for new session, once for old session
        assertEqual(2, collection.sessionIdToPrimaryKey.callCount, 'sessionIdToPrimaryKey() was called twice');
        assertNonEmptyString(collection.sessionIdToPrimaryKey.firstCall.args[0], 'first call with new session id');
        assertEqual('session-old-abc', collection.sessionIdToPrimaryKey.secondCall.args[0], 'second call with old session id');
    });

    it('calls datastore.setItem() with the result of newSession.toRecord()', () => {
        assertEqual(1, datastore.setItem.callCount, 'datastore.setItem() was called once');
        assertMatches(/^UserSession__/, datastore.setItem.firstCall.args[0], 'datastore.setItem() called with new session key');
        assertEqual('user-456', datastore.setItem.firstCall.args[1].userId, 'datastore.setItem() called with new session record');
    });

    it('calls datastore.deleteItem() with the result of sessionIdToPrimaryKey(session.id)', () => {
        assertEqual(1, datastore.deleteItem.callCount, 'datastore.deleteItem() was called once');
        assertEqual('UserSession__session-old-abc', datastore.deleteItem.firstCall.args[0], 'datastore.deleteItem() called with old session key');
    });

    it('returns the new session', () => {
        assert(result instanceof UserSession, 'returns the new session');
        assertNonEmptyString(result.id, 'result has new session id');
        assertEqual('user-456', result.userId, 'result has correct userId');
    });
});

describe('KixxBaseUserCollection#getUserFromSession()', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let session;
    let mockUserProps;
    let adminRole;
    let editorRole;

    before(async () => {
        // Create mock user props from datastore
        mockUserProps = {
            id: 'user-789',
            name: 'Alice',
            email: 'alice@example.com',
            roles: [ 'admin', 'editor', 'nonexistent' ],
        };

        // Create mock role objects
        adminRole = { name: 'admin', permissions: [ 'read', 'write', 'delete' ] };
        editorRole = { name: 'editor', permissions: [ 'read', 'write' ] };

        // Mock datastore with stubbed getItem method
        datastore = {
            getItem: sinon.stub().resolves(mockUserProps),
        };

        // Mock context that provides the datastore service and user roles
        context = {
            getService: sinon.stub().returns(datastore),
            getUserRole: sinon.stub().callsFake((roleName) => {
                if (roleName === 'admin') {
                    return adminRole;
                }
                if (roleName === 'editor') {
                    return editorRole;
                }
                // Return null for nonexistent roles
                return null;
            }),
        };

        // Create collection instance
        collection = new UserCollection(context);

        // Create session object
        session = {
            id: 'session-xyz',
            userId: 'user-789',
        };

        // Spy on idToPrimaryKey
        sinon.spy(collection, 'idToPrimaryKey');

        // Call the method under test
        result = await collection.getUserFromSession(session);
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('user-789', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with session.userId');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('User__user-789', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with user key');
    });

    it('calls context.getUserRole() for each role in the user.roles array', () => {
        assertEqual(3, context.getUserRole.callCount, 'getUserRole() was called 3 times');
        assertEqual('admin', context.getUserRole.getCall(0).args[0], 'first call with admin role');
        assertEqual('editor', context.getUserRole.getCall(1).args[0], 'second call with editor role');
        assertEqual('nonexistent', context.getUserRole.getCall(2).args[0], 'third call with nonexistent role');
    });

    it('filters out roles which do not exist', () => {
        // Result should have 2 roles (admin and editor), not 3
        assertEqual(2, result.roles.length, 'result has 2 roles');
    });

    it('returns a new instance of User with attached roles', () => {
        assert(result instanceof User, 'result is instance of User');
        assertEqual('user-789', result.id, 'result has correct id');
        assertEqual('Alice', result.name, 'result has correct name');
        assertEqual('alice@example.com', result.email, 'result has correct email');
    });
});

describe('KixxBaseUserCollection#getUserFromSession() when user does not exist', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let error;
    let session;

    before(async () => {
        // Mock datastore with stubbed getItem that returns null (user not found)
        datastore = {
            getItem: sinon.stub().resolves(null),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
            getUserRole: sinon.stub(),
        };

        // Create collection instance
        collection = new UserCollection(context);

        // Create session object
        session = {
            id: 'session-xyz',
            userId: 'nonexistent-user-id',
        };

        // Spy on idToPrimaryKey
        sinon.spy(collection, 'idToPrimaryKey');

        // Call the method under test and capture the error
        try {
            await collection.getUserFromSession(session);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('nonexistent-user-id', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with session.userId');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('User__nonexistent-user-id', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with user key');
    });

    it('does not call context.getUserRole()', () => {
        assertEqual(0, context.getUserRole.callCount, 'getUserRole() was not called');
    });

    it('throws a NotFoundError', () => {
        assert(error, 'error was thrown');
        assertEqual('NotFoundError', error.name, 'error.name');
        assertEqual('NOT_FOUND_ERROR', error.code, 'error.code');
        assertEqual(404, error.httpStatusCode, 'error.httpStatusCode');
        assertMatches('nonexistent-user-id', error.message, 'error message contains userId');
    });
});
