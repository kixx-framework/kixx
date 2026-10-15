import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import provideAdminLogoutForm from '../../../../../app/presentation/middleware/provide-admin-logout-form.js';


function makeContext() {
    return {
        user: { emailAddress: 'admin@example.com' },
        getService: () => ({ sign: async () => 'signed-token' }),
        getHttpTarget(name) {
            assertEqual('admin-logout/logout', name);
            return { compilePathname: () => ({ pathname: '/logout/admin' }) };
        },
    };
}

function makeRequest(method) {
    return {
        method,
        url: new URL('https://example.com/admin'),
        getCookie: () => 'browser-sid',
    };
}

function makeResponse() {
    return {
        props: {},
        cookies: [],
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        setCookie(name) {
            this.cookies.push(name);
        },
    };
}


describe('provideAdminLogoutForm middleware', ({ it }) => {
    it('adds the signed-in email and a CSRF-protected logout form on GET', async () => {
        const response = makeResponse();

        const result = await provideAdminLogoutForm(makeContext(), makeRequest('GET'), response);

        assertEqual(response, result);
        assertEqual('admin@example.com', response.props.adminAccount.emailAddress);
        assertEqual('/logout/admin', response.props.adminAccount.logoutForm.url);
        assertEqual('csrf_token', response.props.adminAccount.logoutForm.csrf.fieldName);
        assertEqual('signed-token', response.props.adminAccount.logoutForm.csrf.token);
        assertEqual('kixx_csrf_session', response.cookies.join(','));
    });

    it('adds the logout form on HEAD', async () => {
        const response = makeResponse();

        await provideAdminLogoutForm(makeContext(), makeRequest('HEAD'), response);

        assertEqual('/logout/admin', response.props.adminAccount.logoutForm.url);
    });

    it('skips non-rendering methods without minting a token', async () => {
        const response = makeResponse();

        const result = await provideAdminLogoutForm(makeContext(), makeRequest('POST'), response);

        assertEqual(response, result);
        assertEqual(undefined, response.props.adminAccount);
        assertEqual(0, response.cookies.length);
    });
});
