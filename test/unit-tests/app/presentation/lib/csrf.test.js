import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import {
    CSRF_COOKIE_NAME,
    CSRF_FIELD_NAME,
    INVALID_CSRF_TOKEN_CODE,
    renderWithFreshCsrf,
    validateCsrfFormData,
} from '../../../../../src/app/presentation/lib/csrf.js';


describe('CSRF helpers', ({ describe }) => {

    describe('validateCsrfFormData()', ({ it }) => {

        it('returns the parsed form data when the token validates', async () => {
            const harness = makeHarness({ isValidToken: true });
            const formData = await validateCsrfFormData(harness.context, harness.request);

            assertEqual('submitted-token', formData.get(CSRF_FIELD_NAME));
        });

        it('consumes only the submitted token, leaving the pre-session alive', async () => {
            const harness = makeHarness({ isValidToken: true });
            await validateCsrfFormData(harness.context, harness.request);

            assertEqual(1, harness.collection.consumed.length);
            assertEqual('csrf-session-1', harness.collection.consumed[0].csrfSessionId);
            assertEqual('submitted-token', harness.collection.consumed[0].token);
            assertEqual(0, harness.collection.deleted.length);
        });

        it('rejects an invalid token with the exported code, so handlers can recover', async () => {
            const harness = makeHarness({ isValidToken: false });
            const caught = await catchAsyncError(() => {
                return validateCsrfFormData(harness.context, harness.request);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('ForbiddenError', caught.name);
            assertEqual(403, caught.httpStatusCode);
            assertEqual(INVALID_CSRF_TOKEN_CODE, caught.code);
        });

        it('does not consume the token when validation fails', async () => {
            const harness = makeHarness({ isValidToken: false });
            await catchAsyncError(() => {
                return validateCsrfFormData(harness.context, harness.request);
            });

            assertEqual(0, harness.collection.consumed.length);
        });
    });

    describe('INVALID_CSRF_TOKEN_CODE', ({ it }) => {

        it('is the wire code handlers compare against', () => {
            assertEqual('InvalidCsrfTokenError', INVALID_CSRF_TOKEN_CODE);
        });
    });

    describe('renderWithFreshCsrf()', ({ it }) => {

        it('merges the caller props with a form context carrying a fresh token', async () => {
            const harness = makeHarness({ isValidToken: true });
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
            assertEqual('fresh-token', props.form.csrf.token);
        });

        it('passes the error through to the form context so field errors render', async () => {
            const harness = makeHarness({ isValidToken: true });
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
            const harness = makeHarness({ isValidToken: true });

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error: 'form_expired',
                status: 403,
            });

            assertEqual(403, harness.response.status);
        });

        it('falls back to the error status when no explicit status is given', async () => {
            const harness = makeHarness({ isValidToken: true });
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
            const harness = makeHarness({ isValidToken: true });

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error: 'form_expired',
            });

            assertEqual(500, harness.response.status);
        });

        it('does not mutate the caller props object', async () => {
            const harness = makeHarness({ isValidToken: true });
            const props = { invites: [] };

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props,
                error: 'form_expired',
                status: 403,
            });

            assertUndefined(props.form);
        });

        it('sets the pre-session cookie so the fresh token is submittable', async () => {
            const harness = makeHarness({ isValidToken: true });

            await renderWithFreshCsrf(harness.context, harness.request, harness.response, {
                form: makeForm(),
                props: {},
                error: 'form_expired',
                status: 403,
            });

            const cookie = harness.response.cookies[0];
            assertEqual(CSRF_COOKIE_NAME, cookie.name);
            assertEqual(true, cookie.options.httpOnly);
            assertEqual('Lax', cookie.options.sameSite);
        });
    });
});

function makeForm() {
    return {
        receivedError: undefined,
        getFormContext(_context, error) {
            this.receivedError = error;
            return { fields: {}, errorCode: typeof error === 'string' ? error : null };
        },
    };
}

function makeHarness({ isValidToken }) {
    const collection = {
        consumed: [],
        deleted: [],
        validateToken() {
            return Promise.resolve(isValidToken);
        },
        consumeToken(_context, csrfSessionId, token) {
            collection.consumed.push({ csrfSessionId, token });
            return Promise.resolve();
        },
        deleteToken(_context, csrfSessionId) {
            collection.deleted.push(csrfSessionId);
            return Promise.resolve();
        },
        getBySessionId() {
            // No reusable pre-session record, so every render mints a new one.
            return Promise.resolve(null);
        },
        createToken() {
            return Promise.resolve({ csrfSessionId: 'csrf-session-2', token: 'fresh-token' });
        },
    };

    const formData = new FormData();
    formData.set(CSRF_FIELD_NAME, 'submitted-token');

    const context = {
        collection,
        getCollection(name) {
            assertEqual('CsrfToken', name);
            return collection;
        },
    };

    const request = {
        url: new URL('https://example.com/admin/invites'),
        formData() {
            return Promise.resolve(formData);
        },
        getCookie(name) {
            return name === CSRF_COOKIE_NAME ? 'csrf-session-1' : null;
        },
    };

    const cookies = [];
    const response = {
        status: undefined,
        props: null,
        cookies,
        setCookie(name, value, options) {
            cookies.push({ name, value, options });
        },
        updateProps(props) {
            response.props = props;
            return response;
        },
    };

    return { context, request, response, collection };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
