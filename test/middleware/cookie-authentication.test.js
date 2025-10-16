import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';
import sinon from 'sinon';

import CookieAuthentication from '../../lib/middleware/cookie-authentication.js';

describe('cookieAuthentication without sessionId and allowAnonymous = false', ({ before, after, it }) => {

    const options = {}; // allowAnonymous defaults to false.
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};

    let error;
    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns('');

        try {
            result = await middleware(context, request, response);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an UnauthenticatedError', () => {
        assert(error);
        assertUndefined(result);
        assertEqual('UnauthenticatedError', error.name);
        assertEqual('UNAUTHENTICATED_NO_SESSION_ID', error.code);
    });
});

describe('cookieAuthentication without sessionId and allowAnonymous = true', ({ before, after, it }) => {

    const options = { allowAnonymous: true };
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};
    const anonymousUser = { id: 'anon-user-123', isAnonymous: true };
    const newSession = {
        id: 'new-session-456',
        creationDateTime: new Date(),
        lastRefreshDateTime: new Date(),
    };

    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns('');

        userCollection.createAnonymousUser = sinon.stub().resolves(anonymousUser);
        userCollection.createSessionFromUser = sinon.stub().resolves(newSession);

        response.setCookie = sinon.stub();

        result = await middleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls userCollection.createAnonymousUser()', () => {
        assertEqual(1, userCollection.createAnonymousUser.callCount);
    });

    it('calls userCollection.createSessionFromUser() with the anonymous user', () => {
        assertEqual(1, userCollection.createSessionFromUser.callCount);
        assertEqual(anonymousUser, userCollection.createSessionFromUser.firstCall.args[0]);
    });

    it('attaches the user to the request object', () => {
        assertEqual(anonymousUser, request.user);
    });

    it('calls response.setCookie()', () => {
        assertEqual(1, response.setCookie.callCount);
        assertEqual('sid', response.setCookie.firstCall.args[0], 'cookie name');
        assertEqual('new-session-456', response.setCookie.firstCall.args[1], 'session id');

        const cookieOptions = response.setCookie.firstCall.args[2];
        assertEqual('/', cookieOptions.path);
        assertEqual(true, cookieOptions.httpOnly);
        assertEqual(true, cookieOptions.secure);
        assertEqual('Strict', cookieOptions.sameSite);
        assertEqual(1555200, cookieOptions.maxAge);
    });

    it('returns the response as the result', () => {
        assertEqual(response, result);
    });
});

describe('cookieAuthentication with sessionId but session does not exist', ({ before, after, it }) => {

    const options = {};
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};
    const sessionId = 'existing-session-123';

    let error;
    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns(sessionId);

        userCollection.getSession = sinon.stub().resolves(null);

        try {
            result = await middleware(context, request, response);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls userCollection.getSession()', () => {
        assertEqual(1, userCollection.getSession.callCount);
        assertEqual(sessionId, userCollection.getSession.firstCall.args[0]);
    });

    it('throws an UnauthenticatedError', () => {
        assert(error);
        assertUndefined(result);
        assertEqual('UnauthenticatedError', error.name);
        assertEqual('UNAUTHENTICATED_INVALID_SESSION', error.code);
    });
});

describe('cookieAuthentication with sessionId and the session is expired', ({ before, after, it }) => {

    const options = {
        expirationWindowSeconds: 60, // 1 minute expiration
    };
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};
    const sessionId = 'expired-session-123';
    const expiredSession = {
        id: sessionId,
        creationDateTime: new Date(Date.now() - (120 * 1000)), // 2 minutes ago
        lastRefreshDateTime: new Date(Date.now() - (120 * 1000)),
    };

    let error;
    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns(sessionId);

        userCollection.getSession = sinon.stub().resolves(expiredSession);

        try {
            result = await middleware(context, request, response);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls userCollection.getSession()', () => {
        assertEqual(1, userCollection.getSession.callCount);
        assertEqual(sessionId, userCollection.getSession.firstCall.args[0]);
    });

    it('throws an UnauthenticatedError', () => {
        assert(error);
        assertUndefined(result);
        assertEqual('UnauthenticatedError', error.name);
        assertEqual('UNAUTHENTICATED_SESSION_EXPIRED', error.code);
    });
});

describe('cookieAuthentication with sessionId and the session is fresh', ({ before, after, it }) => {
    // The session is fresh: authSession.shouldRefreshSession() returns false.

    const options = {}; // Use defaults: refreshWindowStartSeconds = 900 (15 min)
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};
    const sessionId = 'fresh-session-123';
    const freshSession = {
        id: sessionId,
        creationDateTime: new Date(Date.now() - (5 * 60 * 1000)), // 5 minutes ago
        lastRefreshDateTime: new Date(Date.now() - (5 * 60 * 1000)),
    };
    const user = { id: 'user-456', username: 'testuser' };

    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns(sessionId);

        userCollection.getSession = sinon.stub().resolves(freshSession);
        userCollection.getUserFromSession = sinon.stub().resolves(user);

        response.setCookie = sinon.stub();

        result = await middleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls userCollection.getSession()', () => {
        assertEqual(1, userCollection.getSession.callCount);
        assertEqual(sessionId, userCollection.getSession.firstCall.args[0]);
    });

    it('calls userCollection.getUserFromSession()', () => {
        assertEqual(1, userCollection.getUserFromSession.callCount);
        assertEqual(freshSession, userCollection.getUserFromSession.firstCall.args[0]);
    });

    it('attaches the user to the request object', () => {
        assertEqual(user, request.user);
    });

    it('does NOT call response.setCookie()', () => {
        assertEqual(0, response.setCookie.callCount);
    });

    it('returns the response as the result', () => {
        assertEqual(response, result);
    });
});

describe('cookieAuthentication with sessionId and the session should be refreshed', ({ before, after, it }) => {
    // The session is within refresh window: authSession.shouldRefreshSession() returns true.

    const options = {}; // Use defaults: refreshWindowStartSeconds = 900 (15 min)
    // eslint-disable-next-line new-cap
    const middleware = CookieAuthentication(options);

    const config = {};
    const userCollection = {};
    const context = { config };
    const request = {};
    const response = {};

    const configSettings = {};
    const sessionId = 'old-session-123';
    const originalSession = {
        id: sessionId,
        creationDateTime: new Date(Date.now() - (20 * 60 * 1000)), // 20 minutes ago
        lastRefreshDateTime: new Date(Date.now() - (20 * 60 * 1000)),
    };
    const refreshedSession = {
        id: 'refreshed-session-789',
        creationDateTime: originalSession.creationDateTime,
        lastRefreshDateTime: new Date(), // Just refreshed
    };
    const user = { id: 'user-456', username: 'testuser' };

    let result;

    before(async () => {
        config.getNamespace = sinon.stub().returns(configSettings);
        context.getCollection = sinon.stub().returns(userCollection);

        request.getCookie = sinon.stub().returns(sessionId);

        userCollection.getSession = sinon.stub().resolves(originalSession);
        userCollection.refreshSession = sinon.stub().resolves(refreshedSession);
        userCollection.getUserFromSession = sinon.stub().resolves(user);

        response.setCookie = sinon.stub();

        result = await middleware(context, request, response);
    });

    after(() => {
        sinon.restore();
    });

    it('calls userCollection.getSession()', () => {
        assertEqual(1, userCollection.getSession.callCount);
        assertEqual(sessionId, userCollection.getSession.firstCall.args[0]);
    });

    it('calls userCollection.refreshSession()', () => {
        assertEqual(1, userCollection.refreshSession.callCount);
        assertEqual(originalSession, userCollection.refreshSession.firstCall.args[0]);
    });

    it('calls userCollection.getUserFromSession()', () => {
        assertEqual(1, userCollection.getUserFromSession.callCount);
        assertEqual(refreshedSession, userCollection.getUserFromSession.firstCall.args[0]);
    });

    it('attaches the user to the request object', () => {
        assertEqual(user, request.user);
    });

    it('calls response.setCookie()', () => {
        assertEqual(1, response.setCookie.callCount);
        assertEqual('sid', response.setCookie.firstCall.args[0], 'cookie name');
        assertEqual('refreshed-session-789', response.setCookie.firstCall.args[1], 'session id');

        const cookieOptions = response.setCookie.firstCall.args[2];
        assertEqual('/', cookieOptions.path);
        assertEqual(true, cookieOptions.httpOnly);
        assertEqual(true, cookieOptions.secure);
        assertEqual('Strict', cookieOptions.sameSite);
        assert(cookieOptions.maxAge > 0, 'maxAge should be positive');
    });

    it('returns the response as the result', () => {
        assertEqual(response, result);
    });
});
