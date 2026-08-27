import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import {
    getAdminUserLoginForm,
    getNewAdminUserForm,
    postAdminUserLoginForm,
    postNewAdminUserForm,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-users.js';


const VALID_EMAIL = 'admin@example.com';
const VALID_PASSWORD = 'a sufficiently long password';
const VALID_INVITE = 'valid-invite';


describe('Admin users request handlers', ({ it }) => {
    it('renders authenticated signup with only the already-logged-in state', async () => {
        const response = makeResponse();
        const context = makeContext({ adminSession: makeAdminSession() });
        const request = makeRequest(null, { adminSessionId: 'valid-session' });

        await getNewAdminUserForm(context, request, response);

        assertEqual('alreadyLoggedIn', Object.keys(response.props).join(','));
        assertEqual(true, response.props.alreadyLoggedIn);
        assertEqual(0, context.calls.getService);
        assertEqual(0, context.calls.rateLimit);
    });

    it('redirects an authenticated login GET before creating form state', async () => {
        const response = makeResponse();
        const context = makeContext({ adminSession: makeAdminSession() });
        const request = makeRequest(null, { adminSessionId: 'valid-session' });
        let skipCallCount = 0;

        await getAdminUserLoginForm(context, request, response, () => {
            skipCallCount += 1;
        });

        assertEqual(1, skipCallCount);
        assertEqual(302, response.redirect.status);
        assertEqual('/admin/style-guide', response.redirect.location);
        assertEqual(0, context.calls.getService);
        assertEqual(0, response.calls.cookie);
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('renders the login GET without a session cookie', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest();

        await getAdminUserLoginForm(context, request, response, () => {});

        assert(response.props.form, 'expected the login form');
        assertEqual(1, context.calls.getService);
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('renders the login GET without clearing an invalid session cookie', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest(null, { adminSessionId: 'invalid-session' });

        await getAdminUserLoginForm(context, request, response, () => {});

        assert(response.props.form, 'expected the login form');
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('propagates an unexpected login GET session error', async () => {
        const unexpected = new Error('session storage unavailable');
        const response = makeResponse();
        const context = makeContext({ adminSessionError: unexpected });
        const request = makeRequest(null, { adminSessionId: 'unknown-session' });

        const caught = await catchAsyncError(() => {
            return getAdminUserLoginForm(context, request, response, () => {});
        });

        assert(caught, 'expected login GET to reject');
        assertEqual('AssertionError', caught.name);
        assertEqual(unexpected, caught.cause);
        assertEqual(0, context.calls.getService);
    });

    it('redirects an authenticated login POST before processing it', async () => {
        const response = makeResponse();
        const context = makeContext({ adminSession: makeAdminSession() });
        const request = makeRequest(null, { adminSessionId: 'valid-session' });
        let skipCallCount = 0;

        await postAdminUserLoginForm(context, request, response, () => {
            skipCallCount += 1;
        });

        assertEqual(1, skipCallCount);
        assertEqual(303, response.redirect.status);
        assertEqual('/admin/style-guide', response.redirect.location);
        assertEqual(0, request.calls.formData);
        assertEqual(0, context.calls.getService);
        assertEqual(0, context.calls.rateLimit);
        assertEqual(0, context.calls.getAdminUserByEmailAddress);
        assertEqual(0, response.calls.cookie);
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('processes login POST without clearing an invalid session cookie', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest({
            email_address: 'not-an-email',
            password: VALID_PASSWORD,
        }, { adminSessionId: 'invalid-session' });

        await postAdminUserLoginForm(context, request, response, () => {});

        assertEqual(422, response.status);
        assertEqual(1, request.calls.formData);
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('propagates an unexpected login POST session error before reading the body', async () => {
        const unexpected = new Error('session storage unavailable');
        const response = makeResponse();
        const context = makeContext({ adminSessionError: unexpected });
        const request = makeRequest(null, { adminSessionId: 'unknown-session' });

        const caught = await catchAsyncError(() => {
            return postAdminUserLoginForm(context, request, response, () => {});
        });

        assert(caught, 'expected login POST to reject');
        assertEqual('AssertionError', caught.name);
        assertEqual(unexpected, caught.cause);
        assertEqual(0, request.calls.formData);
        assertEqual(0, response.calls.adminSessionCookie);
    });

    it('responds with 422 for an invalid signup form', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest({
            email_address: 'not-an-email',
            password: VALID_PASSWORD,
            invite_token: VALID_INVITE,
        });

        await postNewAdminUserForm(context, request, response, () => {});

        assertEqual(422, response.status);
    });

    it('responds with 409 when the signup email already exists', async () => {
        const response = makeResponse();
        const context = makeContext({ existingAdminUser: {} });
        const request = makeRequest(makeValidSignupFields());

        await postNewAdminUserForm(context, request, response, () => {});

        assertEqual(409, response.status);
    });

    it('responds with 409 when an email race spends the invite', async () => {
        const response = makeResponse();
        const conflict = new Error('email claimed concurrently');
        conflict.name = 'DocumentUniqueIndexViolationError';
        const context = makeContext({ createAdminUserError: conflict });
        const request = makeRequest(makeValidSignupFields());

        await postNewAdminUserForm(context, request, response, () => {});

        assertEqual(409, response.status);
    });

    it('responds with 422 for an invalid login form', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest({
            email_address: 'not-an-email',
            password: VALID_PASSWORD,
        });

        await postAdminUserLoginForm(context, request, response, () => {});

        assertEqual(422, response.status);
    });

    it('keeps invalid login credentials at 200', async () => {
        const response = makeResponse();
        const context = makeContext();
        const request = makeRequest({
            email_address: VALID_EMAIL,
            password: VALID_PASSWORD,
        });

        await postAdminUserLoginForm(context, request, response, () => {});

        assertEqual(200, response.status);
        assertEqual('Invalid email or password.', response.props.formError);
    });

    it('keeps throttled login attempts at 200', async () => {
        const response = makeResponse();
        const context = makeContext({ loginThrottled: true });
        const request = makeRequest({
            email_address: VALID_EMAIL,
            password: VALID_PASSWORD,
        });

        await postAdminUserLoginForm(context, request, response, () => {});

        assertEqual(200, response.status);
        assertEqual(true, response.props.throttled);
    });

    it('propagates unexpected signup errors', async () => {
        const unexpected = new Error('unexpected write failure');
        const response = makeResponse();
        const context = makeContext({ createAdminUserError: unexpected });
        const request = makeRequest(makeValidSignupFields());

        const caught = await catchAsyncError(() => {
            return postNewAdminUserForm(context, request, response, () => {});
        });

        assert(caught, 'expected signup to reject');
        assertEqual('AssertionError', caught.name);
        assertEqual(unexpected, caught.cause);
    });

    it('does not create an admin user when signup CSRF validation fails', async () => {
        const response = makeResponse();
        const context = makeContext({ csrfValid: false });
        const request = makeRequest(makeValidSignupFields());

        const caught = await catchAsyncError(() => {
            return postNewAdminUserForm(context, request, response, () => {});
        });

        assert(caught, 'expected signup to reject');
        assertEqual('InvalidCsrfTokenError', caught.code);
        assertEqual(0, context.calls.createAdminUser);
        assertEqual(0, context.calls.getAdminUserByEmailAddress);
    });

    it('does not authenticate credentials when login CSRF validation fails', async () => {
        const response = makeResponse();
        const context = makeContext({ csrfValid: false });
        const request = makeRequest({
            email_address: VALID_EMAIL,
            password: VALID_PASSWORD,
        });

        const caught = await catchAsyncError(() => {
            return postAdminUserLoginForm(context, request, response, () => {});
        });

        assert(caught, 'expected login to reject');
        assertEqual('InvalidCsrfTokenError', caught.code);
        assertEqual(0, context.calls.getAdminUserByEmailAddress);
    });
});


function makeValidSignupFields() {
    return {
        email_address: VALID_EMAIL,
        password: VALID_PASSWORD,
        invite_token: VALID_INVITE,
    };
}

function makeAdminSession() {
    return {
        isExpired: () => false,
        get: (name) => name === 'userId' ? 'admin-user-id' : null,
    };
}

function makeRequest(fields, options) {
    const { adminSessionId = null } = options ?? {};
    const formData = new FormData();
    for (const [ name, value ] of Object.entries(fields ?? {})) {
        formData.set(name, value);
    }
    formData.set('csrf_token', 'valid-csrf-token');

    return {
        calls: { formData: 0 },
        ip: '192.0.2.1',
        queryParams: {},
        url: new URL('https://example.com/'),
        async formData() {
            this.calls.formData += 1;
            return formData;
        },
        getCookie(name) {
            if (name === 'kixx_admin_session') {
                return adminSessionId;
            }
            return name === 'kixx_csrf_session' ? 'csrf-session' : null;
        },
    };
}

function makeResponse() {
    return {
        calls: {
            adminSessionCookie: 0,
            cookie: 0,
        },
        status: 200,
        props: {},
        redirect: null,
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        respondWithRedirect(status, location) {
            this.redirect = { status, location };
            return this;
        },
        setCookie(name) {
            this.calls.cookie += 1;
            if (name === 'kixx_admin_session') {
                this.calls.adminSessionCookie += 1;
            }
        },
    };
}

function makeContext(options) {
    const {
        adminSession = null,
        adminSessionError = null,
        createAdminUserError = null,
        csrfValid = true,
        existingAdminUser = null,
        loginThrottled = false,
    } = options ?? {};
    const calls = {
        createAdminUser: 0,
        getAdminUserByEmailAddress: 0,
        getService: 0,
        rateLimit: 0,
    };

    const inviteRecord = {
        getStatus: () => 'pending',
        get: (name) => name === 'roles' ? [ 'Admin' ] : null,
    };
    const rateLimitState = {
        throttled: loginThrottled,
        retryAfterSeconds: loginThrottled ? 60 : 0,
    };

    const collections = {
        AdminInvite: {
            getByTokenHash: async () => inviteRecord,
            markConsumed: async () => {},
        },
        AdminUser: {
            get: async () => ({
                toAuthenticatedUser: () => ({ id: 'admin-user-id' }),
            }),
            async getByEmailAddress() {
                calls.getAdminUserByEmailAddress += 1;
                return existingAdminUser;
            },
            async createNewAdminUser() {
                calls.createAdminUser += 1;
                if (createAdminUserError) {
                    throw createAdminUserError;
                }
                return {
                    toAuthenticatedUser: () => ({ id: 'admin-user-id' }),
                };
            },
        },
        RateLimit: {
            async getState() {
                calls.rateLimit += 1;
                return rateLimitState;
            },
            recordFailure: async () => rateLimitState,
        },
        UserSession: {
            async get() {
                if (adminSessionError) {
                    throw adminSessionError;
                }
                return adminSession;
            },
        },
    };

    return {
        calls,
        requestId: 'request-id',
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: 1 },
            },
        },
        logger: { warn() {} },
        getCollection: (name) => collections[name],
        getEnvString: () => null,
        getService() {
            calls.getService += 1;
            return {
                sign: async () => 'new-csrf-token',
                verify: async () => csrfValid,
            };
        },
        getHttpTarget(name) {
            const pathname = name === 'admin-panel/style-guide/render-style-guide-page'
                ? '/admin/style-guide'
                : '/form';
            return { compilePathname: () => ({ pathname }) };
        },
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
