import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import DocumentStore from '../../../../../src/kixx/document-store/document-store.js';
import DocumentStoreEngine from '../../../../../src/plugins/node-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import { sha256Hex } from '../../../../../src/kixx/utils/crypto.js';
import AdminDataApiTokenCollection from '../../../../../src/app/collections/admin-data-api-token-collection.js';
import PublishingApiTokenCollection from '../../../../../src/app/collections/publishing-api-token-collection.js';
import AdminDataApiTokenCreateForm from '../../../../../src/app/presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js';
import authenticateMiddleware from '../../../../../src/app/presentation/middleware/authenticate-admin-data-api-token.js';
import { adminDataResources } from '../../../../../src/app/admin-data-api/mod.js';
import { ROLE_EDITOR } from '../../../../../src/app/permissions/roles.js';
import { createAdminDataApiToken } from '../../../../../src/app/transaction-scripts/admin-data-api-tokens/create-admin-data-api-token.js';
import { authenticateAdminDataApiToken } from '../../../../../src/app/transaction-scripts/admin-data-api-tokens/authenticate-admin-data-api-token.js';
import { listAdminDataApiTokens } from '../../../../../src/app/transaction-scripts/admin-data-api-tokens/list-admin-data-api-tokens.js';
import { revokeAdminDataApiToken } from '../../../../../src/app/transaction-scripts/admin-data-api-tokens/revoke-admin-data-api-token.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeContext() {
    const logger = makeLogger();
    const database = new DatabaseSync(':memory:');
    const store = new DocumentStore({ logger });

    store.initialize({
        engine: new DocumentStoreEngine({ logger, database }),
        indexes: [],
        cursorSigningSecret: 'admin-data-api-token-test-secret',
    });

    const collections = {
        AdminDataApiToken: new AdminDataApiTokenCollection({ db: store }),
        PublishingApiToken: new PublishingApiTokenCollection({ db: store }),
    };

    let user = null;

    return {
        logger,
        get user() {
            return user;
        },
        setUser(value) {
            user = value;
        },
        getCollection(name) {
            return collections[name];
        },
    };
}

function makeForm(grants) {
    const form = new AdminDataApiTokenCreateForm({
        description: 'Test token',
        grants: grants ?? [ 'File:list', 'File:get' ],
    });
    form.validate();
    return form;
}

async function mint(context, grants) {
    return await createAdminDataApiToken(context, makeForm(grants), 'admin-user-id');
}

function makeRequest(token) {
    return {
        getAuthorizationBearer() {
            return token;
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

async function expireToken(context, id) {
    const tokens = context.getCollection('AdminDataApiToken');
    const record = await tokens.get(context, id);
    record.set('tokenCreationDate', '2020-01-01T00:00:00.000Z');
    record.set('tokenExpirationDate', '2020-01-02T00:00:00.000Z');
    await tokens.update(context, record);
}


describe('Admin data API token lifecycle', ({ describe }) => {

    describe('minting', ({ it }) => {
        it('returns a prefixed secret once and stores only its hash', async () => {
            const context = makeContext();
            const result = await mint(context);

            assertMatches(/^kxadt_[0-9a-f]{64}$/, result.token);
            assertEqual(await sha256Hex(result.token), result.id);

            const stored = await context.getCollection('AdminDataApiToken').get(context, result.id);
            assertEqual(false, JSON.stringify(stored.toObject()).includes(result.token));
            assertEqual('Test token', stored.get('description'));
            assertEqual('admin-user-id', stored.get('createdBy'));
            assertEqual(null, stored.get('revokedAt'));
        });

        it('stores grants in canonical action order', async () => {
            const context = makeContext();
            const result = await mint(context, [ 'File:delete', 'File:get', 'File:list' ]);

            assertEqual(1, result.grants.length);
            assertEqual('File', result.grants[0].collection);
            assertEqual('list,get,delete', result.grants[0].actions.join());
        });

        it('lists tokens without exposing any secret', async () => {
            const context = makeContext();
            const first = await mint(context);
            const second = await mint(context, [ 'File:update' ]);

            const page = await listAdminDataApiTokens(context);
            const serialized = JSON.stringify(page);

            assertEqual(2, page.items.length);
            assertEqual(false, serialized.includes(first.token));
            assertEqual(false, serialized.includes(second.token));
            assertEqual('active', page.items[0].status);
            assert(Array.isArray(page.items[0].grants));
        });

        it('refuses grants outside the resource registry as programmer errors', async () => {
            const context = makeContext();
            const tokens = context.getCollection('AdminDataApiToken');

            for (const grants of [
                [ { collection: 'FileContent', actions: [ 'get' ] } ],
                [ { collection: 'File', actions: [ 'run' ] } ],
                [ { collection: 'File', actions: [] } ],
                [ { collection: 'File', actions: [ 'get' ] }, { collection: 'File', actions: [ 'list' ] } ],
                [],
            ]) {
                const error = await catchAsyncError(() => tokens.createToken(context, {
                    createdBy: 'admin-user-id',
                    grants,
                    ttlSeconds: 60,
                }));

                assert(error, `expected ${ JSON.stringify(grants) } to be refused`);
                assertEqual('AssertionError', error.name);
            }

            assertEqual(0, (await tokens.listPage(context)).items.length);
        });
    });

    describe('authentication', ({ it }) => {
        it('returns the active record for a valid token', async () => {
            const context = makeContext();
            const { token, id } = await mint(context);

            const record = await authenticateAdminDataApiToken(context, token);

            assertEqual(id, record.id);
        });

        it('rejects missing, malformed, and unknown tokens with 401', async () => {
            const context = makeContext();
            const unknown = `kxadt_${ '0'.repeat(64) }`;

            for (const token of [ null, undefined, '', 'Basic abc', 'kxadt_short', unknown ]) {
                const error = await catchAsyncError(() => authenticateAdminDataApiToken(context, token));
                assertEqual('UnauthenticatedError', error?.name, `token ${ token }`);
                assertEqual(401, error.httpStatusCode);
            }
        });

        it('rejects a valid Publishing API token', async () => {
            const context = makeContext();
            const { token } = await context.getCollection('PublishingApiToken').createToken(context, {
                createdBy: 'admin-user-id',
                roles: [ ROLE_EDITOR ],
                ttlSeconds: 60,
            });

            const error = await catchAsyncError(() => authenticateAdminDataApiToken(context, token));

            assertEqual('UnauthenticatedError', error?.name);
        });

        it('rejects an expired token', async () => {
            const context = makeContext();
            const { token, id } = await mint(context);
            await expireToken(context, id);

            const error = await catchAsyncError(() => authenticateAdminDataApiToken(context, token));

            assertEqual('UnauthenticatedError', error?.name);
            assertEqual('AdminDataApiTokenInactive', error.code);
        });

        it('rejects a revoked token on the next request', async () => {
            const context = makeContext();
            const { token, id } = await mint(context);

            await authenticateAdminDataApiToken(context, token);
            await revokeAdminDataApiToken(context, id);
            const error = await catchAsyncError(() => authenticateAdminDataApiToken(context, token));

            assertEqual('UnauthenticatedError', error?.name);
            assertEqual('AdminDataApiTokenInactive', error.code);
        });
    });

    describe('middleware principal', ({ it }) => {
        it('derives permissions only from the token grants', async () => {
            const context = makeContext();
            const { token, id } = await mint(context, [ 'File:list', 'File:get' ]);
            const response = {};

            const result = await authenticateMiddleware(context, makeRequest(token), response);

            assertEqual(response, result);
            assertEqual(id, context.user.id);
            assertEqual('AdminDataApiToken', context.user.type);
            assertEqual(undefined, context.user.roles);

            const { permissions } = context.user;
            assertEqual(true, adminDataResources.isAuthorized(permissions, 'files', 'list'));
            assertEqual(true, adminDataResources.isAuthorized(permissions, 'files', 'get'));
            assertEqual(false, adminDataResources.isAuthorized(permissions, 'files', 'update'));
            assertEqual(false, adminDataResources.isAuthorized(permissions, 'files', 'delete'));
            assertEqual(false, adminDataResources.isAuthorized(permissions, 'releases', 'get'));
        });

        it('rejects a request without bearer credentials and assigns no principal', async () => {
            const context = makeContext();

            const error = await catchAsyncError(() => authenticateMiddleware(context, makeRequest(null), {}));

            assertEqual('UnauthenticatedError', error?.name);
            assertEqual(null, context.user);
        });
    });

    describe('revocation', ({ it }) => {
        it('stamps revokedAt and lists the token as revoked', async () => {
            const context = makeContext();
            const { id } = await mint(context);

            await revokeAdminDataApiToken(context, id);

            const [ item ] = (await listAdminDataApiTokens(context)).items;
            assertEqual('revoked', item.status);
            assert(item.revokedAt);
        });

        it('refuses to re-revoke and preserves the original timestamp', async () => {
            const context = makeContext();
            const { id } = await mint(context);
            const tokens = context.getCollection('AdminDataApiToken');

            await revokeAdminDataApiToken(context, id);
            const original = (await tokens.get(context, id)).get('revokedAt');

            const error = await catchAsyncError(() => revokeAdminDataApiToken(context, id));

            assertEqual('ConflictError', error?.name);
            assertEqual('AdminDataApiTokenNotRevocable', error.code);
            assertEqual(original, (await tokens.get(context, id)).get('revokedAt'));
        });

        it('rejects a concurrent revocation loaded before the first one was stored', async () => {
            const context = makeContext();
            const { id } = await mint(context);
            const tokens = context.getCollection('AdminDataApiToken');

            // Both admins loaded the active token before either revoked it.
            const staleCopy = await tokens.get(context, id);

            await revokeAdminDataApiToken(context, id);
            const original = (await tokens.get(context, id)).get('revokedAt');

            const error = await catchAsyncError(() => tokens.revoke(context, staleCopy));

            assertEqual('VersionConflictError', error?.name);
            assertEqual(original, (await tokens.get(context, id)).get('revokedAt'));
        });

        it('reports an unknown token id as not found', async () => {
            const context = makeContext();

            const error = await catchAsyncError(() => revokeAdminDataApiToken(context, 'missing'));

            assertEqual('NotFoundError', error?.name);
            assertEqual('AdminDataApiTokenNotFound', error.code);
        });
    });
});
