import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import {
    postAdminUserLoginForm,
    postNewAdminUserForm,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-users.js';


const VALID_EMAIL = 'admin@example.com';
const VALID_PASSWORD = 'a sufficiently long password';
const VALID_INVITE = 'valid-invite';


describe('Admin users request handlers', ({ it }) => {
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
});


function makeValidSignupFields() {
    return {
        email_address: VALID_EMAIL,
        password: VALID_PASSWORD,
        invite_token: VALID_INVITE,
    };
}

function makeRequest(fields) {
    const formData = new FormData();
    for (const [ name, value ] of Object.entries(fields)) {
        formData.set(name, value);
    }
    formData.set('csrf_token', 'valid-csrf-token');

    return {
        ip: '192.0.2.1',
        queryParams: {},
        url: new URL('https://example.com/'),
        formData: async () => formData,
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'csrf-session' : null;
        },
    };
}

function makeResponse() {
    return {
        status: 200,
        props: {},
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        setCookie() {},
    };
}

function makeContext(options) {
    const {
        createAdminUserError = null,
        existingAdminUser = null,
        loginThrottled = false,
    } = options ?? {};

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
            getByEmailAddress: async () => existingAdminUser,
            async createNewAdminUser() {
                if (createAdminUserError) {
                    throw createAdminUserError;
                }
                return {
                    toAuthenticatedUser: () => ({ id: 'admin-user-id' }),
                };
            },
        },
        RateLimit: {
            getState: async () => rateLimitState,
            recordFailure: async () => rateLimitState,
        },
    };

    return {
        requestId: 'request-id',
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: 1 },
            },
        },
        logger: { warn() {} },
        getCollection: (name) => collections[name],
        getEnvString: () => null,
        getService: () => ({
            sign: async () => 'new-csrf-token',
            verify: async () => true,
        }),
        getHttpTarget: () => ({
            compilePathname: () => ({ pathname: '/form' }),
        }),
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
