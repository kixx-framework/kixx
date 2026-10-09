import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    postCreatePublishingApiToken,
    postRevokePublishingApiToken,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-publishing-api-tokens.js';


describe('Admin Publishing API token request handlers CSRF enforcement', ({ it }) => {
    it('does not create a token when CSRF validation fails', async () => {
        const state = makeState();
        const context = makeContext(state);
        const request = makeRequest({ description: 'deploy token' });
        const response = makeResponse();

        await postCreatePublishingApiToken(context, request, response);

        assertEqual(1, request.calls.formData);
        assertEqual(1, state.verifyCalls);
        assertEqual(0, state.createCalls);
        assertEqual(403, response.status);
        assertEqual('form_expired', response.props.form.errorCode);
        assertEqual('fresh-csrf-token', response.props.form.csrf.token);
    });

    it('does not revoke a token when CSRF validation fails', async () => {
        const state = makeState();
        const request = makeRequest({ token_id: 'token-id' });
        const response = makeResponse();
        let skipCalls = 0;

        await postRevokePublishingApiToken(makeContext(state), request, response, () => {
            skipCalls += 1;
        });

        assertEqual(1, request.calls.formData);
        assertEqual(1, state.verifyCalls);
        assertEqual(0, state.loadForRevokeCalls);
        assertEqual(0, state.revokeCalls);
        assertEqual(1, skipCalls);
        assertEqual(303, response.redirect.status);
        assertEqual('/admin/publishing-api-tokens?notice=form_expired', response.redirect.location);
    });
});


function makeState() {
    return {
        createCalls: 0,
        loadForRevokeCalls: 0,
        revokeCalls: 0,
        verifyCalls: 0,
    };
}

function makeContext(state) {
    const collection = {
        async createToken() {
            state.createCalls += 1;
        },
        async getByTokenHash() {
            state.loadForRevokeCalls += 1;
            return null;
        },
        async listPage() {
            return { items: [], cursor: null };
        },
        async revoke() {
            state.revokeCalls += 1;
        },
    };

    return {
        user: { id: 'admin-user-id' },
        getCollection() {
            return collection;
        },
        getService() {
            return {
                async sign() {
                    return 'fresh-csrf-token';
                },
                async verify() {
                    state.verifyCalls += 1;
                    return false;
                },
            };
        },
        getHttpTarget(name) {
            const pathnames = {
                'admin-panel/publishing-api-tokens-revoke/revoke': '/admin/publishing-api-tokens/revoke',
                'admin-panel/publishing-api-tokens/render-token-list': '/admin/publishing-api-tokens',
                'admin-panel/publishing-api-tokens/create-token': '/admin/publishing-api-tokens',
            };
            return {
                compilePathname() {
                    return { method: 'POST', pathname: pathnames[name] };
                },
            };
        },
    };
}

function makeRequest(fields) {
    const formData = new FormData();
    formData.set('csrf_token', 'forged-csrf-token');
    for (const [ name, value ] of Object.entries(fields)) {
        formData.set(name, value);
    }

    return {
        calls: { formData: 0 },
        queryParams: {},
        url: new URL('https://example.com/admin/publishing-api-tokens'),
        async formData() {
            this.calls.formData += 1;
            return formData;
        },
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'browser-session' : null;
        },
    };
}

function makeResponse() {
    return {
        props: {},
        redirect: null,
        status: 200,
        setCookie() {
            return this;
        },
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        respondWithRedirect(status, location) {
            this.redirect = { status, location };
            return this;
        },
    };
}
