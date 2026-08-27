import { FastHTMLParser } from 'fast-html-dom-parser';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertNotEqual } from 'kixx-assert';
import { CSRF_TOKEN_TTL_SECONDS } from '../../../src/app/presentation/lib/csrf.js';
import { loginRootAdmin } from '../test-helpers/authenticate.js';
import {
    assertCsrfCookie,
    assertHtmlCsrfToken,
    decodeCsrfToken,
    getBaseUrl,
} from '../test-helpers/lib.js';


const CLOCK_TOLERANCE_SECONDS = 5;
const TOKEN_MINT_DELAY_MILLISECONDS = 1_100;

let userCookies;
let formUrl;
let firstRenderResponse;
let secondRenderResponse;
let firstRenderToken;
let secondRenderToken;
let firstRenderPayload;
let secondRenderPayload;
let firstRenderSid;
let secondRenderSid;
let firstRenderReceivedAt;
let secondRenderReceivedAt;
let firstValidationResponse;
let secondValidationResponse;
let firstValidationBody;
let secondValidationBody;
let firstValidationToken;
let secondValidationToken;
let firstValidationPayload;
let secondValidationPayload;
let firstValidationSid;
let secondValidationSid;


describe('CSRF form lifecycle', ({ before, it }) => {

    before(async () => {
        userCookies = await loginRootAdmin();
        formUrl = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);

        const firstRender = await renderTokenForm();
        firstRenderResponse = firstRender.response;
        firstRenderToken = firstRender.token;
        firstRenderPayload = decodeCsrfToken(firstRenderToken);
        firstRenderSid = assertCsrfCookie(userCookies);
        firstRenderReceivedAt = firstRender.receivedAt;

        await waitForNextTokenTimestamp();
        const secondRender = await renderTokenForm();
        secondRenderResponse = secondRender.response;
        secondRenderToken = secondRender.token;
        secondRenderPayload = decodeCsrfToken(secondRenderToken);
        secondRenderSid = assertCsrfCookie(userCookies);
        secondRenderReceivedAt = secondRender.receivedAt;

        const firstValidation = await submitInvalidTokenForm(firstRenderToken);
        firstValidationResponse = firstValidation.response;
        firstValidationBody = firstValidation.body;
        firstValidationToken = firstValidation.token;
        firstValidationPayload = decodeCsrfToken(firstValidationToken);
        firstValidationSid = assertCsrfCookie(userCookies);

        await waitForNextTokenTimestamp();
        const secondValidation = await submitInvalidTokenForm(firstRenderToken);
        secondValidationResponse = secondValidation.response;
        secondValidationBody = secondValidation.body;
        secondValidationToken = secondValidation.token;
        secondValidationPayload = decodeCsrfToken(secondValidationToken);
        secondValidationSid = assertCsrfCookie(userCookies);
    });

    it('renders a fresh signed token and a full-lifetime CSRF cookie', () => {
        assertEqual(200, firstRenderResponse.status);
        assertEqual(firstRenderSid, firstRenderPayload.sid);
        assertTokenExpiresNear(firstRenderPayload, firstRenderReceivedAt);
    });

    it('retains the browser SID while minting a distinct token for a second tab', () => {
        assertEqual(200, secondRenderResponse.status);
        assertEqual(firstRenderSid, secondRenderSid);
        assertEqual(secondRenderSid, secondRenderPayload.sid);
        assertNotEqual(firstRenderToken, secondRenderToken);
        assertTokenExpiresNear(secondRenderPayload, secondRenderReceivedAt);
    });

    it('accepts a token minted before a later render', () => {
        assertEqual(422, firstValidationResponse.status);
        assertEqual(firstRenderSid, firstValidationSid);
        assertEqual(firstValidationSid, firstValidationPayload.sid);
        assertNoPlaintextToken(firstValidationBody);
    });

    it('does not consume a valid token during ordinary validation', () => {
        assertEqual(422, secondValidationResponse.status);
        assertEqual(firstRenderSid, secondValidationSid);
        assertEqual(secondValidationSid, secondValidationPayload.sid);
        assertNoPlaintextToken(secondValidationBody);
    });

    it('mints a distinct fresh token for each 422 re-render', () => {
        assertNotEqual(firstValidationToken, secondValidationToken);
    });
});

async function renderTokenForm() {
    const response = await fetch(formUrl, {
        redirect: 'manual',
        headers: { cookie: userCookies.cookieHeader() },
    });
    const receivedAt = Date.now();
    userCookies.applyResponse(response);

    const body = await response.text();

    return {
        response,
        token: assertHtmlCsrfToken(body),
        receivedAt,
    };
}

async function submitInvalidTokenForm(csrfToken) {
    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('description', 'CSRF lifecycle validation');
    form.append('time_to_live_seconds', 'not-an-integer');

    const response = await fetch(formUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: userCookies.cookieHeader() },
        body: form,
    });
    userCookies.applyResponse(response);

    const body = await response.text();

    return {
        response,
        token: assertHtmlCsrfToken(body),
        body,
    };
}

function assertTokenExpiresNear(payload, receivedAt) {
    const expectedExpiration = Math.floor(receivedAt / 1000) + CSRF_TOKEN_TTL_SECONDS;
    const hasExpectedExpiration = payload.exp >= expectedExpiration - CLOCK_TOLERANCE_SECONDS
        && payload.exp <= expectedExpiration + CLOCK_TOLERANCE_SECONDS;

    assert(hasExpectedExpiration, 'CSRF token expiration');
}

function assertNoPlaintextToken(html) {
    const document = new FastHTMLParser(html);
    assert(!document.getElementById('new-token'), 'new-token field');
}

function waitForNextTokenTimestamp() {
    return new Promise((resolve) => {
        setTimeout(resolve, TOKEN_MINT_DELAY_MILLISECONDS);
    });
}
