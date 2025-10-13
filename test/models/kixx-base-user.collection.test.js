import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
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
