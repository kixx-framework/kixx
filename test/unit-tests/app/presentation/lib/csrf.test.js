import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertNonEmptyString,
} from 'kixx-assert';

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


describe('csrf', ({ describe }) => {
    describe('getCsrfFormContext', ({ it }) => {
        it('mints a token for a new sid and sets the HTTPS cookie policy', async () => {
            const signer = makeSigner();
            const context = makeContext(signer);
            const request = makeRequest({ url: 'https://example.com/form' });
            const response = makeResponse();
            const form = makeForm();

            const result = await getCsrfFormContext(context, request, response, form, 'form-error');

            assertNonEmptyString(signer.calls.sign[0].sid);
            assertEqual(CSRF_TOKEN_TTL_SECONDS, signer.calls.sign[0].ttlSeconds);
            assertEqual(CSRF_COOKIE_NAME, response.cookies[0].name);
            assertEqual(signer.calls.sign[0].sid, response.cookies[0].value);
            assertEqual('/', response.cookies[0].options.path);
            assertEqual(CSRF_TOKEN_TTL_SECONDS, response.cookies[0].options.maxAge);
            assertEqual(true, response.cookies[0].options.secure);
            assertEqual(true, response.cookies[0].options.httpOnly);
            assertEqual('Lax', response.cookies[0].options.sameSite);
            assertEqual(CSRF_FIELD_NAME, result.csrf.fieldName);
            assertEqual('signed-csrf-token', result.csrf.token);
            assertEqual('form-error', form.calls.getFormContext[0].error);
        });

        it('reuses the existing sid and disables Secure over HTTP', async () => {
            const signer = makeSigner();
            const request = makeRequest({
                csrfSid: 'existing-browser-session',
                url: 'http://localhost/form',
            });
            const response = makeResponse();

            await getCsrfFormContext(makeContext(signer), request, response, makeForm());

            assertEqual('existing-browser-session', signer.calls.sign[0].sid);
            assertEqual('existing-browser-session', response.cookies[0].value);
            assertEqual(false, response.cookies[0].options.secure);
        });
    });

    describe('validateCsrfFormData', ({ it }) => {
        it('returns the parsed FormData after verifying its cookie-bound token', async () => {
            const formData = new FormData();
            formData.set(CSRF_FIELD_NAME, 'submitted-token');
            const signer = makeSigner({ isValid: true });
            const request = makeRequest({ csrfSid: 'browser-session', formData });

            const result = await validateCsrfFormData(makeContext(signer), request);

            assertEqual(formData, result);
            assertEqual(1, request.calls.formData);
            assertEqual('submitted-token', signer.calls.verify[0].token);
            assertEqual('browser-session', signer.calls.verify[0].sid);
        });

        it('rejects a missing cookie without calling the signer', async () => {
            const formData = new FormData();
            formData.set(CSRF_FIELD_NAME, 'submitted-token');
            const signer = makeSigner();

            const caught = await catchAsyncError(() => {
                return validateCsrfFormData(
                    makeContext(signer),
                    makeRequest({ formData }),
                );
            });

            assertInvalidCsrfError(caught);
            assertEqual(0, signer.calls.verify.length);
        });

        it('rejects a missing form token without calling the signer', async () => {
            const signer = makeSigner();

            const caught = await catchAsyncError(() => {
                return validateCsrfFormData(
                    makeContext(signer),
                    makeRequest({ csrfSid: 'browser-session' }),
                );
            });

            assertInvalidCsrfError(caught);
            assertEqual(0, signer.calls.verify.length);
        });

        it('rejects a token the signer cannot verify', async () => {
            const formData = new FormData();
            formData.set(CSRF_FIELD_NAME, 'forged-token');
            const signer = makeSigner({ isValid: false });

            const caught = await catchAsyncError(() => {
                return validateCsrfFormData(
                    makeContext(signer),
                    makeRequest({ csrfSid: 'browser-session', formData }),
                );
            });

            assertInvalidCsrfError(caught);
            assertEqual(1, signer.calls.verify.length);
        });
    });

    describe('renderWithFreshCsrf', ({ it }) => {
        it('preserves an Error status and merges a fresh form into page props', async () => {
            const error = { httpStatusCode: 422 };
            const response = makeResponse();
            const form = makeForm();

            const result = await renderWithFreshCsrf(
                makeContext(makeSigner()),
                makeRequest({ csrfSid: 'browser-session' }),
                response,
                { form, props: { items: [ 'one' ] }, error },
            );

            assertEqual(response, result);
            assertEqual(422, response.status);
            assertEqual('one', response.props.items[0]);
            assertEqual('signed-csrf-token', response.props.form.csrf.token);
            assertEqual(error, form.calls.getFormContext[0].error);
        });

        it('uses the explicit status for a notice code', async () => {
            const response = makeResponse();

            await renderWithFreshCsrf(
                makeContext(makeSigner()),
                makeRequest(),
                response,
                { form: makeForm(), props: {}, error: 'form_expired', status: 403 },
            );

            assertEqual(403, response.status);
        });
    });

    describe('clearCsrfToken', ({ it }) => {
        it('expires the CSRF cookie with the HTTPS cookie policy', () => {
            const response = makeResponse();

            clearCsrfToken(makeRequest({ url: 'https://example.com/' }), response);

            assertEqual(CSRF_COOKIE_NAME, response.cookies[0].name);
            assertEqual('', response.cookies[0].value);
            assertEqual('/', response.cookies[0].options.path);
            assertEqual(0, response.cookies[0].options.maxAge);
            assertEqual(true, response.cookies[0].options.secure);
            assertEqual(true, response.cookies[0].options.httpOnly);
            assertEqual('Lax', response.cookies[0].options.sameSite);
        });

        it('disables Secure when expiring the cookie over HTTP', () => {
            const response = makeResponse();

            clearCsrfToken(makeRequest({ url: 'http://localhost/' }), response);

            assertEqual(false, response.cookies[0].options.secure);
        });
    });
});


function makeSigner(options) {
    const { isValid = true } = options ?? {};
    const calls = { sign: [], verify: [] };

    return {
        calls,
        async sign(sid, ttlSeconds) {
            calls.sign.push({ sid, ttlSeconds });
            return 'signed-csrf-token';
        },
        async verify(token, sid) {
            calls.verify.push({ token, sid });
            return isValid;
        },
    };
}

function makeContext(signer) {
    return {
        getService(name) {
            assertEqual('CsrfTokenSigner', name);
            return signer;
        },
    };
}

function makeRequest(options) {
    const {
        csrfSid = null,
        formData = new FormData(),
        url = 'https://example.com/form',
    } = options ?? {};

    return {
        calls: { formData: 0 },
        url: new URL(url),
        getCookie(name) {
            assertEqual(CSRF_COOKIE_NAME, name);
            return csrfSid;
        },
        async formData() {
            this.calls.formData += 1;
            return formData;
        },
    };
}

function makeResponse() {
    return {
        cookies: [],
        props: {},
        status: 200,
        setCookie(name, value, options) {
            this.cookies.push({ name, value, options });
            return this;
        },
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
    };
}

function makeForm() {
    const calls = { getFormContext: [] };

    return {
        calls,
        getFormContext(context, error) {
            calls.getFormContext.push({ context, error });
            return { method: 'POST', url: '/form' };
        },
    };
}

function assertInvalidCsrfError(error) {
    assert(error, 'expected an error to be thrown');
    assertEqual('ForbiddenError', error.name);
    assertEqual(INVALID_CSRF_TOKEN_CODE, error.code);
    assertEqual(403, error.httpStatusCode);
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
