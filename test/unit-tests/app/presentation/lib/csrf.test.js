import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import CsrfTokenSigner from '../../../../../src/app/presentation/lib/csrf-token-signer.js';
import {
    CSRF_COOKIE_NAME,
    CSRF_FIELD_NAME,
    CSRF_TOKEN_TTL_SECONDS,
    INVALID_CSRF_TOKEN_CODE,
    clearCsrfToken,
    getCsrfFormContext,
    renderWithFreshCsrf,
    validateCsrfFormData,
} from '../../../../../src/app/presentation/lib/csrf.js';


const TEST_SECRET = 'csrf-test-signing-secret';


describe('CSRF helpers', ({ describe }) => {

    describe('getCsrfFormContext()', ({ it }) => {

        it('merges csrf.fieldName and csrf.token onto the form context', async () => {
            const harness = makeHarness();
            const form = makeForm();

            const formContext = await getCsrfFormContext(harness.context, harness.request, harness.response, form);

            assertEqual(CSRF_FIELD_NAME, formContext.csrf.fieldName);
            assert(formContext.csrf.token.includes('.'));
            assertEqual('bar', formContext.fields.foo);
        });

        it('sets the cookie with path, httpOnly, sameSite, and the full TTL', async () => {
            const harness = makeHarness();

            await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            const cookie = harness.response.cookies[0];
            assertEqual(CSRF_COOKIE_NAME, cookie.name);
            assertEqual('/', cookie.options.path);
            assertEqual(true, cookie.options.httpOnly);
            assertEqual('Lax', cookie.options.sameSite);
            assertEqual(CSRF_TOKEN_TTL_SECONDS, cookie.options.maxAge);
        });

        it('sets Secure when the request is HTTPS', async () => {
            const harness = makeHarness({ url: 'https://example.com/admin/invites' });

            await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            assertEqual(true, harness.response.cookies[0].options.secure);
        });

        it('omits Secure when the request is plain HTTP', async () => {
            const harness = makeHarness({ url: 'http://localhost:2026/admin/invites' });

            await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            assertEqual(false, harness.response.cookies[0].options.secure);
        });

        it('reuses an existing sid rather than minting a new one, so a second tab does not invalidate an open form', async () => {
            const harness = makeHarness({ sid: 'existing-sid' });

            const formContext = await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            assertEqual('existing-sid', harness.response.cookies[0].value);
            assertEqual(true, await harness.signer.verify(formContext.csrf.token, 'existing-sid'));
        });

        it('mints a fresh sid when the request carries no cookie', async () => {
            const harness = makeHarness({ sid: null });

            const formContext = await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            const sid = harness.response.cookies[0].value;
            assert(sid.length > 0);
            assertEqual(true, await harness.signer.verify(formContext.csrf.token, sid));
        });

        it('produces independently valid tokens on successive renders against the same cookie', async () => {
            const harness = makeHarness({ sid: 'existing-sid' });

            const first = await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());
            const second = await getCsrfFormContext(harness.context, harness.request, harness.response, makeForm());

            assertEqual(true, await harness.signer.verify(first.csrf.token, 'existing-sid'));
            assertEqual(true, await harness.signer.verify(second.csrf.token, 'existing-sid'));
        });
    });

    describe('validateCsrfFormData()', ({ it }) => {

        it('returns the parsed form data when the token matches the cookie', async () => {
            const harness = await makeSubmittedHarness();

            const formData = await validateCsrfFormData(harness.context, harness.request);

            assertEqual(harness.token, formData.get(CSRF_FIELD_NAME));
        });

        it('rejects a missing cookie', async () => {
            const harness = await makeSubmittedHarness({ dropCookie: true });
            const caught = await catchAsyncError(() => validateCsrfFormData(harness.context, harness.request));

            assertForbiddenCsrf(caught);
        });

        it('rejects a missing csrf_token field', async () => {
            const harness = await makeSubmittedHarness({ dropField: true });
            const caught = await catchAsyncError(() => validateCsrfFormData(harness.context, harness.request));

            assertForbiddenCsrf(caught);
        });

        it('rejects a forged token', async () => {
            const harness = await makeSubmittedHarness();
            harness.formData.set(CSRF_FIELD_NAME, `${ harness.token }-tampered`);
            const caught = await catchAsyncError(() => validateCsrfFormData(harness.context, harness.request));

            assertForbiddenCsrf(caught);
        });

        it('rejects an expired token', async () => {
            const harness = await makeSubmittedHarness({ ttlSeconds: 0 });
            const caught = await catchAsyncError(() => validateCsrfFormData(harness.context, harness.request));

            assertForbiddenCsrf(caught);
        });

        it('rejects a token minted for a different sid', async () => {
            const harness = await makeSubmittedHarness({ mintedForSid: 'other-sid' });
            const caught = await catchAsyncError(() => validateCsrfFormData(harness.context, harness.request));

            assertForbiddenCsrf(caught);
        });

        it('performs no storage access', async () => {
            const harness = await makeSubmittedHarness();

            assertUndefined(harness.context.getCollection);
            await validateCsrfFormData(harness.context, harness.request);
        });
    });

    describe('INVALID_CSRF_TOKEN_CODE', ({ it }) => {

        it('is the wire code handlers compare against', () => {
            assertEqual('InvalidCsrfTokenError', INVALID_CSRF_TOKEN_CODE);
        });
    });

    describe('renderWithFreshCsrf()', ({ it }) => {

        it('merges the caller props with a form context carrying a fresh token', async () => {
            const harness = makeHarness();
            const form = makeForm();

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form,
                props: { invites: [ 'a' ], showPagination: false },
                error: 'form_expired',
                status: 403,
            });

            const props = harness.response.props;
            assertEqual('a', props.invites[0]);
            assertEqual(false, props.showPagination);
            assertEqual(CSRF_FIELD_NAME, props.form.csrf.fieldName);
            assert(props.form.csrf.token.includes('.'));
        });

        it('passes the error through to the form context so field errors render', async () => {
            const harness = makeHarness();
            const form = makeForm();
            const error = new Error('invalid');
            error.httpStatusCode = 422;

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form,
                props: {},
                error,
            });

            assertEqual(error, form.receivedError);
        });

        it('takes the explicit status when one is given', async () => {
            const harness = makeHarness();

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error: 'form_expired',
                status: 403,
            });

            assertEqual(403, harness.response.status);
        });

        it('falls back to the error status when no explicit status is given', async () => {
            const harness = makeHarness();
            const error = new Error('invalid');
            error.httpStatusCode = 422;

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error,
            });

            assertEqual(422, harness.response.status);
        });

        it('falls back to 500 when neither a status nor an error status is available', async () => {
            const harness = makeHarness();

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error: 'form_expired',
            });

            assertEqual(500, harness.response.status);
        });

        it('does not mutate the caller props object', async () => {
            const harness = makeHarness();
            const props = { invites: [] };

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props,
                error: 'form_expired',
                status: 403,
            });

            assertUndefined(props.form);
        });
    });

    describe('clearCsrfToken()', ({ it }) => {

        it('sets the cookie to an empty value with maxAge 0', () => {
            const request = makeRequest({ url: 'https://example.com/admin', sid: 'existing-sid' });
            const response = makeResponse();

            clearCsrfToken(request, response);

            const cookie = response.cookies[0];
            assertEqual(CSRF_COOKIE_NAME, cookie.name);
            assertEqual('', cookie.value);
            assertEqual(0, cookie.options.maxAge);
            assertEqual(true, cookie.options.secure);
        });

        it('omits Secure over plain HTTP', () => {
            const request = makeRequest({ url: 'http://localhost:2026/admin', sid: 'existing-sid' });
            const response = makeResponse();

            clearCsrfToken(request, response);

            assertEqual(false, response.cookies[0].options.secure);
        });
    });
});

function assertForbiddenCsrf(caught) {
    assert(caught, 'expected an error to be thrown');
    assertEqual('ForbiddenError', caught.name);
    assertEqual(403, caught.httpStatusCode);
    assertEqual(INVALID_CSRF_TOKEN_CODE, caught.code);
}

function makeForm() {
    return {
        receivedError: undefined,
        getFormContext(_context, error) {
            this.receivedError = error;
            return { fields: { foo: 'bar' }, errorCode: typeof error === 'string' ? error : null };
        },
    };
}

// sid: pass null to simulate no cookie present; defaults to no cookie.
function makeHarness(options) {
    const { url = 'https://example.com/admin/invites', sid = null } = options ?? {};
    const signer = new CsrfTokenSigner(TEST_SECRET);

    const context = {
        getService(name) {
            assertEqual('CsrfTokenSigner', name);
            return signer;
        },
    };

    const request = makeRequest({ url, sid });
    const response = makeResponse();

    return {
        signer, context, request, response,
    };
}

function makeRequest(options) {
    const { url, sid } = options ?? {};

    return {
        url: new URL(url),
        getCookie(name) {
            return name === CSRF_COOKIE_NAME ? sid : null;
        },
    };
}

function makeResponse() {
    const cookies = [];

    return {
        status: undefined,
        props: null,
        cookies,
        setCookie(name, value, options) {
            cookies.push({ name, value, options });
        },
        updateProps(props) {
            this.props = props;
            return this;
        },
    };
}

// Builds a harness whose request already carries a submitted csrf_token field
// and matching cookie, as validateCsrfFormData() expects to receive them.
async function makeSubmittedHarness(options) {
    const {
        dropCookie = false,
        dropField = false,
        ttlSeconds = CSRF_TOKEN_TTL_SECONDS,
        mintedForSid = 'submission-sid',
    } = options ?? {};

    const signer = new CsrfTokenSigner(TEST_SECRET);
    const token = await signer.sign(mintedForSid, ttlSeconds);

    const formData = new FormData();
    if (!dropField) {
        formData.set(CSRF_FIELD_NAME, token);
    }

    const context = {
        getService(name) {
            assertEqual('CsrfTokenSigner', name);
            return signer;
        },
    };

    const request = {
        url: new URL('https://example.com/admin/invites'),
        formData() {
            return Promise.resolve(formData);
        },
        getCookie(name) {
            if (name !== CSRF_COOKIE_NAME || dropCookie) {
                return null;
            }
            return 'submission-sid';
        },
    };

    return {
        context, request, formData, token,
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
