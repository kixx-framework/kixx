import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import adminErrorHandler from '../../../../../src/app/presentation/error-handlers/admin-error-handler.js';
import ServerResponse from '../../../../../src/kixx/http-router/server-response.js';


function makeContext() {
    return {
        getHttpTarget(name) {
            assertEqual('admin-login-form/render-form', name);
            return {
                compilePathname() {
                    return { pathname: '/login/admin/new' };
                },
            };
        },
    };
}

function makeRequest(pathname) {
    return {
        getCookie() {
            return null;
        },
        url: new URL(pathname, 'https://www.example.com'),
    };
}


describe('adminErrorHandler', ({ it }) => {

    it('redirects an unauthenticated HTML request to the login page', async () => {
        const response = new ServerResponse();
        const result = await adminErrorHandler(
            makeContext(),
            makeRequest('/admin'),
            response,
            { name: 'UnauthenticatedError' },
        );

        assertEqual(response, result);
        assertEqual(303, response.status);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });

    it('leaves an unauthenticated JSON request for the JSON error handler', async () => {
        const result = await adminErrorHandler(
            makeContext(),
            makeRequest('/admin.JSON'),
            new ServerResponse(),
            { name: 'UnauthenticatedError' },
        );

        assertEqual(false, result);
    });
});
