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
