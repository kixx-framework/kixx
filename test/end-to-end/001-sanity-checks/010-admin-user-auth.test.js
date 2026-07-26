import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';


describe('GET /admin without a cookie', ({ before, it }) => {

    let url;
    let response;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/admin`);
        response = await fetch(url, { redirect: 'manual' });
    });

    it('redirects to the login page', () => {
        assert(response);
        assertEqual(303, response.status);
        assertEqual(url.href, response.url);
        assertEqual('/login/admin/new', response.headers.get('location'));
    });
});
