import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNonEmptyString,
} from 'kixx-assert';
import CookieJar from '../test-helpers/cookies.js';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import {
    assertCsrfCookie,
    decodeCsrfToken,
    getRenderedRecordIds,
} from './helpers.js';
import { assertHtmlCsrfToken } from '../test-helpers/html.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


const ADMIN_SESSION_COOKIE = 'kixx_admin_session';
const CSRF_COOKIE = 'kixx_csrf_session';

let adminCookies;
let inviteUrl;
let inviteRevokeUrl;
let tokenUrl;
let tokenRevokeUrl;
let invalidTokenCreateResponses;
let tokenIdsBeforeInvalidCreates;
let tokenIdsAfterInvalidCreates;
let inviteIdsBeforeRejectedCreate;
let inviteIdsAfterRejectedCreate;
let inviteId;
let rejectedInviteRevokeResponse;
let inviteIdsAfterRejectedRevoke;
let inviteIdsAfterCleanup;
let tokenId;
let rejectedTokenRevokeResponse;
let tokenIdsAfterRejectedRevoke;
let tokenIdsAfterCleanup;


describe('CSRF admin mutations', ({ before, it }) => {

    before(async () => {
        adminCookies = await loginRootAdmin();
        inviteUrl = new URL(`${ getBaseUrl() }/admin/invites`);
        inviteRevokeUrl = new URL(`${ getBaseUrl() }/admin/invites/revoke`);
        tokenUrl = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);
        tokenRevokeUrl = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens/revoke`);

        tokenIdsBeforeInvalidCreates = getRenderedRecordIds(
            (await renderPage(tokenUrl, adminCookies)).body,
            'token_id',
        );
        invalidTokenCreateResponses = await submitInvalidTokenCreateMatrix();
        tokenIdsAfterInvalidCreates = getRenderedRecordIds(
            (await renderPage(tokenUrl, adminCookies)).body,
            'token_id',
        );

        const invitePage = await renderPage(inviteUrl, adminCookies);
        inviteIdsBeforeRejectedCreate = getRenderedRecordIds(invitePage.body, 'invite_id');
        const rejectedInviteCreate = await submitInviteCreate(
            adminCookies.cookieHeader(),
        );
        assertRejectedCreate(rejectedInviteCreate, assertCsrfCookie(adminCookies));
        inviteIdsAfterRejectedCreate = getRenderedRecordIds(rejectedInviteCreate.body, 'invite_id');

        inviteId = await createInvite();
        rejectedInviteRevokeResponse = await submitRevoke(
            inviteRevokeUrl,
            'invite_id',
            inviteId,
            adminCookies.cookieHeader([ ADMIN_SESSION_COOKIE, CSRF_COOKIE ]),
        );
        inviteIdsAfterRejectedRevoke = getRenderedRecordIds(
            (await renderPage(inviteUrl, adminCookies)).body,
            'invite_id',
        );
        await revokeRecord(inviteUrl, inviteRevokeUrl, 'invite_id', inviteId);
        inviteIdsAfterCleanup = getRenderedRecordIds(
            (await renderPage(inviteUrl, adminCookies)).body,
            'invite_id',
        );

        tokenId = await createToken();
        rejectedTokenRevokeResponse = await submitRevoke(
            tokenRevokeUrl,
            'token_id',
            tokenId,
            adminCookies.cookieHeader([ ADMIN_SESSION_COOKIE, CSRF_COOKIE ]),
        );
        tokenIdsAfterRejectedRevoke = getRenderedRecordIds(
            (await renderPage(tokenUrl, adminCookies)).body,
            'token_id',
        );
        await revokeRecord(tokenUrl, tokenRevokeUrl, 'token_id', tokenId);
        tokenIdsAfterCleanup = getRenderedRecordIds(
            (await renderPage(tokenUrl, adminCookies)).body,
            'token_id',
        );
    });

    it('fails closed for every attacker-controlled token variant', () => {
        for (const rejectedResponse of invalidTokenCreateResponses) {
            assertRejectedCreate(rejectedResponse, rejectedResponse.csrfSid);
        }
    });

    it('does not create a Publishing API token for rejected submissions', () => {
        assertSameRecordIds(tokenIdsBeforeInvalidCreates, tokenIdsAfterInvalidCreates);
    });

    it('rejects invite creation without a CSRF token before mutation', () => {
        assertSameRecordIds(inviteIdsBeforeRejectedCreate, inviteIdsAfterRejectedCreate);
    });

    it('redirects a rejected invite revoke and leaves its target intact', () => {
        assertEqual(303, rejectedInviteRevokeResponse.status);
        assertEqual('/admin/invites?notice=form_expired', rejectedInviteRevokeResponse.location);
        assert(inviteIdsAfterRejectedRevoke.includes(inviteId), 'rejected invite revoke target');
    });

    it('cleans up the invite created for revoke coverage', () => {
        assert(!inviteIdsAfterCleanup.includes(inviteId), 'revoked invite target');
    });

    it('redirects a rejected token revoke and leaves its target intact', () => {
        assertEqual(303, rejectedTokenRevokeResponse.status);
        assertEqual('/admin/publishing-api-tokens?notice=form_expired', rejectedTokenRevokeResponse.location);
        assert(tokenIdsAfterRejectedRevoke.includes(tokenId), 'rejected token revoke target');
    });

    it('cleans up the token created for revoke coverage', () => {
        assert(!tokenIdsAfterCleanup.includes(tokenId), 'revoked token target');
    });
});

async function submitInvalidTokenCreateMatrix() {
    const missingField = await submitTokenCreate(
        adminCookies.cookieHeader(),
        null,
        adminCookies,
    );

    const missingCookiePage = await renderPage(tokenUrl, adminCookies);
    const missingCookie = await submitTokenCreate(
        adminCookies.cookieHeader([ ADMIN_SESSION_COOKIE ]),
        assertHtmlCsrfToken(missingCookiePage.body),
        adminCookies,
    );

    const malformed = await submitTokenCreate(
        adminCookies.cookieHeader(),
        'not-a-signed-token',
        adminCookies,
    );

    const alteredTokenPage = await renderPage(tokenUrl, adminCookies);
    const alteredSignature = await submitTokenCreate(
        adminCookies.cookieHeader(),
        alterSignature(assertHtmlCsrfToken(alteredTokenPage.body)),
        adminCookies,
    );

    const tokenForFirstSidPage = await renderPage(tokenUrl, adminCookies);
    const tokenForFirstSid = assertHtmlCsrfToken(tokenForFirstSidPage.body);
    const secondSidCookies = new CookieJar();
    const tokenForSecondSidPage = await renderPage(
        tokenUrl,
        secondSidCookies,
        adminCookies.cookieHeader([ ADMIN_SESSION_COOKIE ]),
    );
    assertNotSameSid(tokenForFirstSid, assertHtmlCsrfToken(tokenForSecondSidPage.body));
    const sidMismatch = await submitTokenCreate(
        joinCookieHeaders(
            adminCookies.cookieHeader([ ADMIN_SESSION_COOKIE ]),
            secondSidCookies.cookieHeader([ CSRF_COOKIE ]),
        ),
        tokenForFirstSid,
        secondSidCookies,
    );

    return [ missingField, missingCookie, malformed, alteredSignature, sidMismatch ];
}

async function createInvite() {
    const beforeIds = getRenderedRecordIds((await renderPage(inviteUrl, adminCookies)).body, 'invite_id');
    const response = await submitInviteCreate(
        adminCookies.cookieHeader(),
        assertHtmlCsrfToken((await renderPage(inviteUrl, adminCookies)).body),
    );
    assertEqual(200, response.status);

    const createdId = findCreatedRecordId(
        beforeIds,
        getRenderedRecordIds(response.body, 'invite_id'),
        'invite',
    );
    return createdId;
}

async function createToken() {
    const beforeIds = getRenderedRecordIds((await renderPage(tokenUrl, adminCookies)).body, 'token_id');
    const response = await submitTokenCreate(
        adminCookies.cookieHeader(),
        assertHtmlCsrfToken((await renderPage(tokenUrl, adminCookies)).body),
        adminCookies,
    );
    assertEqual(200, response.status);

    return findCreatedRecordId(
        beforeIds,
        getRenderedRecordIds(response.body, 'token_id'),
        'Publishing API token',
    );
}

async function revokeRecord(listUrl, revokeUrl, fieldName, recordId) {
    const page = await renderPage(listUrl, adminCookies);
    const response = await submitRevoke(
        revokeUrl,
        fieldName,
        recordId,
        adminCookies.cookieHeader(),
        assertHtmlCsrfToken(page.body),
    );
    assertEqual(303, response.status);
}

async function renderPage(url, cookieJar, cookieHeader = cookieJar.cookieHeader()) {
    const response = await fetch(url, {
        redirect: 'manual',
        headers: { cookie: cookieHeader },
    });
    cookieJar.applyResponse(response);

    return {
        response,
        body: await response.text(),
    };
}

async function submitInviteCreate(cookieHeader, csrfToken = null) {
    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append('role_id', 'developer');

    const response = await fetch(inviteUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieHeader },
        body: form,
    });
    adminCookies.applyResponse(response);

    return {
        response,
        status: response.status,
        body: await response.text(),
    };
}

async function submitTokenCreate(cookieHeader, csrfToken, cookieJar) {
    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append('description', `CSRF rejection ${ crypto.randomUUID() }`);
    form.append('time_to_live_seconds', '2592000');

    const response = await fetch(tokenUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieHeader },
        body: form,
    });
    cookieJar.applyResponse(response);
    const csrfSid = assertCsrfCookie(cookieJar);

    return {
        response,
        csrfSid,
        status: response.status,
        body: await response.text(),
    };
}

async function submitRevoke(url, fieldName, recordId, cookieHeader, csrfToken = null) {
    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append(fieldName, recordId);

    const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookieHeader },
        body: form,
    });
    adminCookies.applyResponse(response);

    return {
        response,
        status: response.status,
        location: response.headers.get('location'),
    };
}

function assertRejectedCreate(rejectedResponse, csrfSid) {
    assertEqual(403, rejectedResponse.status);
    assertMatches('That form had expired', rejectedResponse.body);
    assert(!rejectedResponse.body.includes('InvalidCsrfTokenError'), 'CSRF error code disclosure');
    assert(!rejectedResponse.body.includes('signature'), 'CSRF signature disclosure');
    assert(!rejectedResponse.body.includes('id="new-token"'), 'rejected token plaintext');

    const token = assertHtmlCsrfToken(rejectedResponse.body);
    const payload = decodeCsrfToken(token);
    assertEqual(csrfSid, payload.sid);
}

function assertSameRecordIds(expectedIds, actualIds) {
    assertEqual(expectedIds.join(','), actualIds.join(','));
}

function assertNotSameSid(firstToken, secondToken) {
    const firstSid = decodeCsrfToken(firstToken).sid;
    const secondSid = decodeCsrfToken(secondToken).sid;
    assert(firstSid !== secondSid, 'distinct CSRF cookie SIDs');
}

function alterSignature(token) {
    const [ payload, signature ] = token.split('.');
    assertNonEmptyString(payload, 'CSRF token payload');
    assertNonEmptyString(signature, 'CSRF token signature');

    const lastCharacter = signature.at(-1);
    const alteredCharacter = lastCharacter === 'A' ? 'B' : 'A';
    return `${ payload }.${ signature.slice(0, -1) }${ alteredCharacter }`;
}

function findCreatedRecordId(previousIds, currentIds, recordName) {
    const createdId = currentIds.find((recordId) => !previousIds.includes(recordId));
    assertNonEmptyString(createdId, `created ${ recordName } id`);

    return createdId;
}

function joinCookieHeaders(...headers) {
    return headers.filter(Boolean).join('; ');
}
