import { describe } from 'kixx-test';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertEqual, assertNonEmptyString } from 'kixx-assert';
import CookieJar from '../test-helpers/cookies.js';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { assertHtmlCsrfToken } from '../test-helpers/html.js';
import {
    FileFixtures,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    openUploadPage,
    postFileAction,
    sendUpload,
} from './helpers.js';


const ADMIN_SESSION_COOKIE = 'kixx_admin_session';
const LOGIN_PATHNAME = '/login/admin/new';

let rootCookies;
let uploadPage;
let fixtures;


describe('Admin files access control', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();
        uploadPage = await openUploadPage(rootCookies);
        fixtures = new FileFixtures(rootCookies, uploadPage.csrfToken);
    });

    after(async () => {
        await fixtures?.cleanup();
    });

    describe('anonymous requests', ({ before, it }) => {
        const unknownFileId = crypto.randomUUID();
        let pageResponses;
        let anonymousUpload;
        let anonymousPartialAction;
        let anonymousFormAction;

        before(async () => {
            const pathnames = [
                '/admin/files',
                '/admin/files/new',
                `/admin/files/${ unknownFileId }`,
                `/admin/files/${ unknownFileId }/download`,
            ];
            pageResponses = await Promise.all(pathnames.map((pathname) => fetchPathname(null, pathname)));

            anonymousUpload = await sendUpload(null, {
                csrfToken: uploadPage.csrfToken,
                filename: createFixtureFilename('anonymous', 'txt'),
                body: 'anonymous bytes',
            });

            const anonymousCookies = new CookieJar();
            anonymousPartialAction = await postFileAction(
                anonymousCookies,
                uploadPage.csrfToken,
                unknownFileId,
                'publish',
                { isPartial: true },
            );
            anonymousFormAction = await postFileAction(anonymousCookies, uploadPage.csrfToken, unknownFileId, 'publish');
        });

        it('redirects page and download requests to the login page', () => {
            for (const result of pageResponses) {
                assertEqual(303, result.status, result.response.url);
                assertEqual(LOGIN_PATHNAME, result.response.headers.get('location'));
            }
        });

        it('rejects an anonymous upload with a machine-readable 401', () => {
            assertEqual(401, anonymousUpload.status);
            assertEqual('UNAUTHENTICATED_ERROR', anonymousUpload.json?.error?.code);
        });

        it('rejects an anonymous row action with a machine-readable 401', () => {
            assertEqual(401, anonymousPartialAction.status);
            assertEqual('UNAUTHENTICATED_ERROR', anonymousPartialAction.json?.error?.code);
        });

        it('redirects an anonymous form action to the login page', () => {
            assertEqual(303, anonymousFormAction.status);
            assertEqual(LOGIN_PATHNAME, anonymousFormAction.location);
        });
    });

    describe('uploads without a valid header CSRF token', ({ before, it }) => {
        let rowsBefore;
        let rowsAfter;
        let rejectedUploads;

        before(async () => {
            rowsBefore = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);

            // A fresh page render mints a second token bound to the same sid,
            // so the altered-signature case tampers with a token that would
            // otherwise be valid.
            const freshPage = await openUploadPage(rootCookies);

            // The last attempt carries a valid token but omits the CSRF cookie
            // it is bound to.
            const attempts = [
                { csrfToken: null, cookieNames: null },
                { csrfToken: 'not-a-signed-token', cookieNames: null },
                { csrfToken: alterSignature(freshPage.csrfToken), cookieNames: null },
                { csrfToken: freshPage.csrfToken, cookieNames: [ ADMIN_SESSION_COOKIE ] },
            ];

            rejectedUploads = [];
            for (const { csrfToken, cookieNames } of attempts) {
                // eslint-disable-next-line no-await-in-loop
                rejectedUploads.push(await sendUpload(rootCookies, {
                    csrfToken,
                    cookieNames,
                    filename: createFixtureFilename('csrf', 'txt'),
                    body: 'must never be stored',
                }));
            }

            rowsAfter = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);
        });

        it('rejects every variant with a machine-readable 403', () => {
            for (const result of rejectedUploads) {
                assertEqual(403, result.status);
                assertEqual('InvalidCsrfTokenError', result.json?.error?.code);
            }
        });

        it('does not create a file record', () => {
            assertEqual(
                rowsBefore.map(({ id }) => id).join(','),
                rowsAfter.map(({ id }) => id).join(','),
            );
        });
    });

    describe('row actions without a valid form CSRF token', ({ before, it }) => {
        let fileId;
        let rejectedPartial;
        let rejectedForm;
        let fileAfter;

        before(async () => {
            const file = await fixtures.upload(createFixtureFilename('csrf-action', 'txt'), 'unchanged');
            fileId = file.id;

            rejectedPartial = await postFileAction(rootCookies, '', fileId, 'publish', { isPartial: true });
            rejectedForm = await postFileAction(rootCookies, 'not-a-signed-token', fileId, 'publish');

            const detail = await fetchPathname(rootCookies, `/admin/files/${ fileId }`);
            fileAfter = detail.text;
        });

        it('rejects a JavaScript row action with a machine-readable 403', () => {
            assertEqual(403, rejectedPartial.status);
            assertEqual('InvalidCsrfTokenError', rejectedPartial.json?.error?.code);
        });

        it('rejects a plain form action with the admin error page', () => {
            assertEqual(403, rejectedForm.status);
            assertEqual('text/html; charset=utf-8', rejectedForm.response.headers.get('content-type'));
        });

        it('leaves the file unpublished', () => {
            assert(fileAfter.includes('Unpublished'), 'file remains unpublished');
        });
    });

    describe('Publishing API tokens on the admin file surface', ({ before, after, it }) => {
        let bearerToken;
        let tokenId;
        let listResponse;
        let uploadResult;

        before(async () => {
            ({ bearerToken, tokenId } = await createPublishingApiToken(rootCookies));

            const authorization = { authorization: `Bearer ${ bearerToken }` };
            listResponse = await fetchPathname(null, '/admin/files', { headers: authorization });
            uploadResult = await sendUpload(null, {
                csrfToken: null,
                filename: createFixtureFilename('bearer', 'txt'),
                body: 'bytes',
                headers: authorization,
            });
        });

        after(async () => {
            if (tokenId) {
                await revokePublishingApiToken(rootCookies, tokenId);
            }
        });

        it('does not authenticate admin pages', () => {
            assertEqual(303, listResponse.status);
            assertEqual(LOGIN_PATHNAME, listResponse.response.headers.get('location'));
        });

        it('does not authenticate uploads', () => {
            assertEqual(401, uploadResult.status);
            assertEqual('UNAUTHENTICATED_ERROR', uploadResult.json?.error?.code);
        });
    });
});

async function createPublishingApiToken(cookies) {
    const tokensPage = await fetchPathname(cookies, '/admin/publishing-api-tokens');
    const idsBefore = getTokenIds(tokensPage.text);

    const form = new FormData();
    form.append('csrf_token', assertHtmlCsrfToken(tokensPage.text));
    form.append('description', `admin files boundary ${ crypto.randomUUID() }`);
    form.append('time_to_live_seconds', '2592000');

    const created = await fetchPathname(cookies, '/admin/publishing-api-tokens', { method: 'POST', body: form });
    assertEqual(200, created.status, 'create Publishing API token');

    const bearerToken = new FastHTMLParser(created.text).getElementById('new-token')?.getAttribute('value');
    assertNonEmptyString(bearerToken, 'new Publishing API token');

    const tokenId = getTokenIds(created.text).find((id) => !idsBefore.includes(id));
    assertNonEmptyString(tokenId, 'new Publishing API token id');

    return { bearerToken, tokenId };
}

async function revokePublishingApiToken(cookies, tokenId) {
    const tokensPage = await fetchPathname(cookies, '/admin/publishing-api-tokens');

    const form = new FormData();
    form.append('csrf_token', assertHtmlCsrfToken(tokensPage.text));
    form.append('token_id', tokenId);

    const revoked = await fetchPathname(cookies, '/admin/publishing-api-tokens/revoke', { method: 'POST', body: form });
    assertEqual(303, revoked.status, 'revoke Publishing API token');
}

function getTokenIds(html) {
    return new FastHTMLParser(html).getElementsByName('token_id')
        .map((field) => field.getAttribute('value'));
}

function alterSignature(token) {
    const [ payload, signature ] = token.split('.');
    const alteredCharacter = signature.at(-1) === 'A' ? 'B' : 'A';
    return `${ payload }.${ signature.slice(0, -1) }${ alteredCharacter }`;
}
