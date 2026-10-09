import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { getCsrfToken } from '../../../../../src/app/presentation/lib/csrf.js';


describe('getCsrfToken()', ({ it }) => {
    it('mints a token and sets the CSRF cookie without requiring a Form', async () => {
        const context = {
            getService() {
                return {
                    async sign(sid, ttl) {
                        return `signed:${ sid }:${ ttl }`;
                    },
                };
            },
        };
        const request = {
            url: new URL('https://example.com/admin/files'),
            getCookie() {
                return 'existing-sid';
            },
        };
        const cookies = [];
        const response = {
            setCookie(name, value, options) {
                cookies.push({ name, value, options });
                return this;
            },
        };

        const csrf = await getCsrfToken(context, request, response);

        assertEqual('csrf_token', csrf.fieldName);
        assertEqual('signed:existing-sid:1800', csrf.token);
        assertEqual(1, cookies.length);
        assertEqual('kixx_csrf_session', cookies[0].name);
        assertEqual('existing-sid', cookies[0].value);
    });
});
