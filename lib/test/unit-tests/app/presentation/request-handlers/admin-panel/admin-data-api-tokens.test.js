import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import DocumentStore from '../../../../../../src/kixx/document-store/document-store.js';
import DocumentStoreEngine from '../../../../../../src/plugins/node-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../../src/kixx/logger/logger.js';
import AdminDataApiTokenCollection from '../../../../../../src/app/collections/admin-data-api-token-collection.js';
import {
    getAdminDataApiTokens,
    postCreateAdminDataApiToken,
    postRevokeAdminDataApiToken,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-data-api-tokens.js';
import routes from '../../../../../../src/routes/admin-panel.js';
import { deriveRolePermissions, ROLE_EDITOR, ROLE_ROOT_ADMIN } from '../../../../../../src/app/permissions/roles.js';


const LIST_PATHNAME = '/admin/admin-data-api-tokens';

function makeContext(options) {
    const { isCsrfValid = true } = options ?? {};
    const logger = new Logger({ name: 'Test', level: 'NONE' });
    const store = new DocumentStore({ logger });

    store.initialize({
        engine: new DocumentStoreEngine({ logger, database: new DatabaseSync(':memory:') }),
        indexes: [],
        cursorSigningSecret: 'admin-data-api-token-handler-test-secret',
    });

    const tokens = new AdminDataApiTokenCollection({ db: store });
    const pathnames = {
        'admin-panel/admin-data-api-tokens-revoke/revoke': `${ LIST_PATHNAME }/revoke`,
        'admin-panel/admin-data-api-tokens/render-token-list': LIST_PATHNAME,
        'admin-panel/admin-data-api-tokens/create-token': LIST_PATHNAME,
    };

    return {
        logger,
        user: { id: 'admin-user-id' },
        tokens,
        getCollection(name) {
            assertEqual('AdminDataApiToken', name);
            return tokens;
        },
        getService(name) {
            assertEqual('CsrfTokenSigner', name);
            return {
                async sign() {
                    return 'fresh-csrf-token';
                },
                async verify() {
                    return isCsrfValid;
                },
            };
        },
        getHttpTarget(name) {
            assert(Object.hasOwn(pathnames, name), `unexpected target ${ name }`);
            return {
                compilePathname() {
                    return { method: 'POST', pathname: pathnames[name] };
                },
            };
        },
    };
}

function makeRequest(entries, queryParams) {
    const formData = new FormData();
    formData.set('csrf_token', 'submitted-csrf-token');
    for (const [ name, value ] of entries ?? []) {
        formData.append(name, value);
    }

    return {
        queryParams: queryParams ?? {},
        url: new URL(`https://example.com${ LIST_PATHNAME }`),
        async formData() {
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

async function listStoredTokens(context) {
    return (await context.tokens.listPage(context)).items;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Admin data API token request handlers', ({ describe }) => {

    describe('postCreateAdminDataApiToken()', ({ it }) => {
        it('mints a token and shows its secret only on this response', async () => {
            const context = makeContext();
            const response = makeResponse();

            await postCreateAdminDataApiToken(context, makeRequest([
                [ 'description', 'Exporter' ],
                [ 'grants', 'File:list' ],
                [ 'grants', 'File:get' ],
            ]), response);

            assertMatches(/^kxadt_[0-9a-f]{64}$/, response.props.newToken);
            assertEqual(1, response.props.tokens.length);
            assertEqual('files', response.props.tokens[0].grants[0].type);
            assertEqual('list, get', response.props.tokens[0].grants[0].actions);
            assertEqual(false, JSON.stringify(response.props.tokens).includes(response.props.newToken));
            assertEqual(null, response.props.form.fields.description.value);
            assertEqual(1, (await listStoredTokens(context)).length);

            // A later GET of the list cannot recover the secret.
            const listResponse = makeResponse();
            await getAdminDataApiTokens(context, makeRequest(), listResponse);
            assertEqual(undefined, listResponse.props.newToken);
            assertEqual(false, JSON.stringify(listResponse.props).includes(response.props.newToken));
        });

        it('re-renders a validation failure with the safe submitted fields and mints nothing', async () => {
            const context = makeContext();
            const response = makeResponse();

            await postCreateAdminDataApiToken(context, makeRequest([
                [ 'description', 'Exporter' ],
                [ 'grants', 'FileContent:get' ],
            ]), response);

            assertEqual(422, response.status);
            assertEqual('field_error', response.props.form.errorCode);
            assert(response.props.form.fields.grants.error);
            assertEqual('Exporter', response.props.form.fields.description.value);
            assertEqual(undefined, response.props.newToken);
            assertEqual(0, (await listStoredTokens(context)).length);
        });

        it('keeps previously checked grants checked after a validation failure', async () => {
            const context = makeContext();
            const response = makeResponse();

            await postCreateAdminDataApiToken(context, makeRequest([
                [ 'description', 'x'.repeat(201) ],
                [ 'grants', 'File:get' ],
            ]), response);

            const [ files ] = response.props.form.fields.grants.resources;
            const checked = files.actions.filter((option) => option.isChecked).map((option) => option.action);
            assertEqual('get', checked.join());
        });

        it('does not mint when CSRF validation fails', async () => {
            const context = makeContext({ isCsrfValid: false });
            const response = makeResponse();

            await postCreateAdminDataApiToken(context, makeRequest([ [ 'grants', 'File:get' ] ]), response);

            assertEqual(403, response.status);
            assertEqual('form_expired', response.props.form.errorCode);
            assertEqual('fresh-csrf-token', response.props.form.csrf.token);
            assertEqual(0, (await listStoredTokens(context)).length);
        });
    });

    describe('postRevokeAdminDataApiToken()', ({ it }) => {
        async function mintToken(context) {
            const response = makeResponse();
            await postCreateAdminDataApiToken(context, makeRequest([ [ 'grants', 'File:get' ] ]), response);
            return (await listStoredTokens(context))[0];
        }

        it('revokes and redirects back to the list', async () => {
            const context = makeContext();
            const record = await mintToken(context);
            const response = makeResponse();
            let skipCalls = 0;

            await postRevokeAdminDataApiToken(context, makeRequest([ [ 'token_id', record.id ] ]), response, () => {
                skipCalls += 1;
            });

            assertEqual(1, skipCalls);
            assertEqual(303, response.redirect.status);
            assertEqual(LIST_PATHNAME, response.redirect.location);
            assertEqual('revoked', (await listStoredTokens(context))[0].getStatus());
        });

        it('does not revoke when CSRF validation fails', async () => {
            const context = makeContext();
            const record = await mintToken(context);
            const forged = makeContext({ isCsrfValid: false });
            forged.tokens = context.tokens;
            forged.getCollection = () => context.tokens;
            const response = makeResponse();

            await postRevokeAdminDataApiToken(forged, makeRequest([ [ 'token_id', record.id ] ]), response, () => {});

            assertEqual(`${ LIST_PATHNAME }?notice=form_expired`, response.redirect.location);
            assertEqual('active', (await listStoredTokens(context))[0].getStatus());
        });

        it('reports an unknown token without mutating anything', async () => {
            const context = makeContext();

            const error = await catchAsyncError(() => postRevokeAdminDataApiToken(
                context,
                makeRequest([ [ 'token_id', '0'.repeat(64) ] ]),
                makeResponse(),
                () => {},
            ));

            assertEqual('NotFoundError', error?.name);
        });

        it('rejects malformed token ids before accessing storage', async () => {
            const context = makeContext();
            context.getCollection = () => {
                throw new Error('Malformed token ids must not reach storage');
            };

            const error = await catchAsyncError(() => postRevokeAdminDataApiToken(
                context,
                makeRequest([ [ 'token_id', 'invalid\u0000id' ] ]),
                makeResponse(),
                () => {},
            ));

            assertEqual('ValidationError', error?.name);
            assertEqual(422, error.httpStatusCode);
            assertEqual('token_id', error.errors[0].source);
        });
    });

    describe('getAdminDataApiTokens()', ({ it }) => {
        it('discards unknown notices', async () => {
            const context = makeContext();
            const response = makeResponse();

            await getAdminDataApiTokens(context, makeRequest([], { notice: '<script>' }), response);

            assertEqual(null, response.props.form.errorCode);
        });
    });

    describe('route authorization', ({ it }) => {
        const tokenRoutes = routes.filter((route) => route.pattern.startsWith('/admin-data-api-tokens'));

        function gateFor(route, targetName) {
            const target = route.targets.find((t) => t.name === targetName);
            return target.requestHandlers[0];
        }

        it('gates every token target before its handler', () => {
            const targets = tokenRoutes.flatMap((route) => route.targets);

            assertEqual(3, targets.length);
            for (const target of targets) {
                const [ gate ] = target.requestHandlers;
                assert(Array.isArray(gate.decisions), `${ target.name } must start with an authorize gate`);
                assertEqual('urn:kixx:admin:api-tokens:admin-data', gate.decisions[0].resource);
            }
        });

        it('admits Root Admin and Developer and refuses Admin and Editor', () => {
            const listRoute = tokenRoutes.find((route) => route.name === 'admin-data-api-tokens');
            const revokeRoute = tokenRoutes.find((route) => route.name === 'admin-data-api-tokens-revoke');
            const gates = [
                gateFor(listRoute, 'render-token-list'),
                gateFor(listRoute, 'create-token'),
                gateFor(revokeRoute, 'revoke'),
            ];

            for (const [ roleId, isAllowed ] of [
                [ ROLE_ROOT_ADMIN, true ],
                [ 'developer', true ],
                [ 'admin', false ],
                [ ROLE_EDITOR, false ],
            ]) {
                const context = { user: { permissions: deriveRolePermissions([ roleId ]) } };

                for (const gate of gates) {
                    let error = null;
                    try {
                        gate(context, {}, {});
                    } catch (cause) {
                        error = cause;
                    }
                    assertEqual(isAllowed, error === null, `${ roleId } ${ gate.decisions[0].action }`);
                    if (!isAllowed) {
                        assertEqual('ForbiddenError', error.name);
                    }
                }
            }
        });
    });
});
