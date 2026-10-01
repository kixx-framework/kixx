import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { createInvitedAdmin, loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import {
    JSON_API,
    apiRequest,
    createDataToken,
    fileCreateDocument,
    openTokenPage,
    revokeDataToken,
    submitTokenForm,
} from './helpers.js';


// A complete, well-formed content reference. Every write below is rejected
// before storage, so it never needs to name real bytes.
const UNUSED_CONTENT = {
    key: 'e2e-never-stored/generation',
    filename: 'never-stored.txt',
    contentType: 'text/plain',
    etag: 'etag',
    generation: crypto.randomUUID(),
    length: 0,
};

let rootCookies;
let readOnly;


describe('Admin Data API tokens', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();
        readOnly = await createDataToken(rootCookies, [ 'File:list', 'File:get' ]);
    });

    after(async () => {
        // Tests below may already have revoked it; a repeat revoke is harmless.
        if (readOnly) {
            await revokeDataToken(rootCookies, readOnly.id);
        }
    });

    describe('creation through the admin panel', ({ before, it }) => {
        let revisit;

        before(async () => {
            revisit = await openTokenPage(rootCookies);
        });

        it('shows the secret on the creation response only', () => {
            assert(readOnly.html.includes(readOnly.token), 'creation page shows the token');
            assertEqual(false, revisit.html.includes(readOnly.token), 'revisited page omits the token');
        });

        it('lists the token by its public grants', () => {
            assertMatches('files: list, get', revisit.html);
        });

        it('rejects grants for Collections that are not registered', async () => {
            const result = await submitTokenForm(rootCookies, { grants: [ 'AdminUser:list' ] });

            assertEqual(422, result.status);
            assertEqual(false, /kxadt_[0-9a-f]{64}/u.test(result.html), 'no token minted');
        });

        it('rejects a submission without a CSRF token', async () => {
            const result = await submitTokenForm(rootCookies, { grants: [ 'File:list' ], csrfToken: null });

            assert(result.status >= 400, `status ${ result.status }`);
            assertEqual(false, /kxadt_[0-9a-f]{64}/u.test(result.html), 'no token minted');
        });

        it('is limited to administrators allowed to manage data tokens', async () => {
            const adminCookies = await createInvitedAdmin(rootCookies, { roleId: 'admin' });

            const page = await fetch(`${ getBaseUrl() }/admin/admin-data-api-tokens`, {
                redirect: 'manual',
                headers: { cookie: adminCookies.cookieHeader() },
            });
            await page.arrayBuffer();
            assertEqual(403, page.status);

            const developerCookies = await createInvitedAdmin(rootCookies, { roleId: 'developer' });
            const developerToken = await createDataToken(developerCookies, [ 'File:list' ]);
            assertEqual(303, await revokeDataToken(developerCookies, developerToken.id));
        });
    });

    describe('scoped access', ({ it }) => {

        it('describes only the granted actions in discovery', async () => {
            const result = await apiRequest(readOnly.token, 'GET', '/');

            assertEqual(200, result.status);
            assertEqual(JSON_API, result.response.headers.get('content-type'));
            assertEqual('private, no-store', result.response.headers.get('cache-control'));

            const [ files ] = result.document.meta.resources;
            assertEqual(1, result.document.meta.resources.length);
            assertEqual('files', files.type);
            assertEqual('File', files.collection);
            assertEqual('list,get', files.actions.join(','));
            assertEqual(false, Object.hasOwn(files, 'create'));
        });

        it('refuses writes the token was not granted', async () => {
            const created = await apiRequest(readOnly.token, 'POST', '/files', {
                body: fileCreateDocument(UNUSED_CONTENT),
            });
            assertEqual(403, created.status);
            assertEqual('AdminDataActionNotGranted', created.document.errors[0].code);

            const deleted = await apiRequest(readOnly.token, 'DELETE', `/files/${ crypto.randomUUID() }`, {
                headers: { 'kixx-expected-version': '1' },
            });
            assertEqual(403, deleted.status);
        });

        it('exposes no unregistered Collection', async () => {
            const result = await apiRequest(readOnly.token, 'GET', '/admin-users');

            assertEqual(404, result.status);
            assertEqual('AdminDataResourceTypeNotFound', result.document.errors[0].code);
        });

        it('rejects missing, Publishing API, and Basic credentials', async () => {
            const missing = await apiRequest(null, 'GET', '/');
            assertEqual(401, missing.status);
            assertEqual('Bearer realm="admin-data-api"', missing.response.headers.get('www-authenticate'));

            const publishing = await apiRequest(`kxpat_${ 'a'.repeat(64) }`, 'GET', '/');
            assertEqual(401, publishing.status);
            assertMatches('error="invalid_token"', publishing.response.headers.get('www-authenticate'));

            const basic = await apiRequest(null, 'GET', '/', {
                headers: { authorization: `Basic ${ btoa('root:password') }` },
            });
            assertEqual(401, basic.status);
        });
    });

    describe('revocation', ({ it }) => {

        it('rejects every request after the token is revoked', async () => {
            const beforeRevoke = await apiRequest(readOnly.token, 'GET', '/files?page[size]=1');
            assertEqual(200, beforeRevoke.status);

            assertEqual(303, await revokeDataToken(rootCookies, readOnly.id));

            const afterRevoke = await apiRequest(readOnly.token, 'GET', '/files?page[size]=1');
            assertEqual(401, afterRevoke.status);
            assertEqual('AdminDataApiTokenInactive', afterRevoke.document.errors[0].code);

            const page = await openTokenPage(rootCookies);
            assertMatches('revoked', page.html);
        });
    });
});
