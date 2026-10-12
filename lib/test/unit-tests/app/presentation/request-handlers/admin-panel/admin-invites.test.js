import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    postCreateAdminInvite,
    postRevokeAdminInvite,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-invites.js';


describe('Admin invite request handlers CSRF enforcement', ({ it }) => {
    it('does not create an invite when CSRF validation fails', async () => {
        const state = makeState();
        const context = makeContext(state);
        const request = makeRequest({ role_id: 'admin' });
        const response = makeResponse();

        await postCreateAdminInvite(context, request, response);

        assertEqual(1, request.calls.formData);
        assertEqual(1, state.verifyCalls);
        assertEqual(0, state.createCalls);
        assertEqual(403, response.status);
        assertEqual('form_expired', response.props.form.errorCode);
        assertEqual('fresh-csrf-token', response.props.form.csrf.token);
    });

    it('does not revoke an invite when CSRF validation fails', async () => {
        const state = makeState();
        const request = makeRequest({ invite_id: 'invite-id' });
        const response = makeResponse();
        let skipCalls = 0;

        await postRevokeAdminInvite(makeContext(state), request, response, () => {
            skipCalls += 1;
        });

        assertEqual(1, request.calls.formData);
        assertEqual(1, state.verifyCalls);
        assertEqual(0, state.loadForRevokeCalls);
        assertEqual(0, state.revokeCalls);
        assertEqual(1, skipCalls);
        assertEqual(303, response.redirect.status);
        assertEqual('/admin/invites?notice=form_expired', response.redirect.location);
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
    const collections = {
        AdminInvite: {
            async createInvite() {
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
        },
        AdminUser: {
            async get() {
                return null;
            },
        },
    };

    return {
        user: { id: 'admin-user-id' },
        getCollection(name) {
            return collections[name];
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
                'admin-panel/invites-revoke/revoke': '/admin/invites/revoke',
                'admin-panel/invites/render-invite-list': '/admin/invites',
                'admin-panel/invites/create-invite': '/admin/invites',
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
        url: new URL('https://example.com/admin/invites'),
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
