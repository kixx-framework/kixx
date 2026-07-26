import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertGreaterThan, assertUndefined } from 'kixx-assert';

import { pbkdf2HashPassword } from '../../../../../src/app/lib/password-hashing.js';
import { ROLE_DEVELOPER_ADMIN, deriveRolePermissions } from '../../../../../src/app/lib/roles.js';
import authenticateAdminApiRequest from '../../../../../src/app/presentation/middleware/authenticate-admin-api-request.js';
import VirtualHost from '../../../../../src/kixx/http-router/virtual-host.js';
import virtualHosts from '../../../../../src/virtual-hosts.js';


describe('Admin API authentication middleware', ({ it }) => {
    it('rejects missing credentials before loading an admin user', async () => {
        const harness = makeAuthenticationHarness();
        const caught = await catchAsyncError(() => {
            return authenticateAdminApiRequest(harness.context, makeRequest(), {});
        });

        assert(caught, 'expected missing credentials to be rejected');
        assertEqual('UnauthenticatedError', caught.name);
        assertEqual(401, caught.httpStatusCode);
        assertEqual(0, harness.collectionCalls);
        assertEqual(null, harness.context.user);
    });

    it('verifies Basic credentials and stores the safe admin principal', async () => {
        const passwordHash = await pbkdf2HashPassword('correct horse', 1);
        const admin = {
            id: 'admin-1',
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
            userCreationDate: '2026-07-17T12:00:00.000Z',
            roles: [ ROLE_DEVELOPER_ADMIN ],
        };
        const harness = makeAuthenticationHarness({ passwordHash, admin });
        const response = {};
        const returned = await authenticateAdminApiRequest(
            harness.context,
            makeRequest('ADMIN@EXAMPLE.COM:correct horse'),
            response,
        );
        const principal = harness.context.user;

        assertEqual(response, returned);
        assertEqual('admin-1', principal.id);
        assertEqual('AdminUser', principal.type);
        assertEqual('admin@example.com', principal.emailAddress);
        assertEqual('2026-07-17T12:00:00.000Z', principal.userCreationDate);
        assertEqual(1, principal.roles.length);
        assertEqual(ROLE_DEVELOPER_ADMIN, principal.roles[0]);
        assertEqual('admin@example.com', harness.loadedEmailAddress);
        assertEqual(1, harness.collectionCalls);
    });

    it('derives principal permissions from the stored role names', async () => {
        const passwordHash = await pbkdf2HashPassword('correct horse', 1);
        const admin = {
            id: 'admin-1',
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
            roles: [ ROLE_DEVELOPER_ADMIN ],
        };
        const harness = makeAuthenticationHarness({ passwordHash, admin });
        await authenticateAdminApiRequest(
            harness.context,
            makeRequest('admin@example.com:correct horse'),
            {},
        );

        const expected = deriveRolePermissions([ ROLE_DEVELOPER_ADMIN ]);
        const { permissions } = harness.context.user;

        assertGreaterThan(0, expected.length);
        assertEqual(expected.length, permissions.length);
        expected.forEach((grant, index) => {
            assertEqual(grant.effect, permissions[index].effect);
            assertEqual(grant.action, permissions[index].action);
            assertEqual(grant.resource, permissions[index].resource);
        });
    });

    it('replaces any stored permissions with freshly derived grants', async () => {
        const passwordHash = await pbkdf2HashPassword('correct horse', 1);
        const admin = {
            id: 'admin-1',
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
            roles: [ ROLE_DEVELOPER_ADMIN ],
            // A stale or forged grant reaching the middleware on the record
            // must never survive onto the principal.
            permissions: [ { effect: 'allow', action: '*', resource: '*' } ],
        };
        const harness = makeAuthenticationHarness({ passwordHash, admin });
        await authenticateAdminApiRequest(
            harness.context,
            makeRequest('admin@example.com:correct horse'),
            {},
        );

        const { permissions } = harness.context.user;

        assertEqual(deriveRolePermissions([ ROLE_DEVELOPER_ADMIN ]).length, permissions.length);
        assertFalsy(
            permissions.some(({ action, resource }) => action === '*' && resource === '*'),
            'expected the stored wildcard grant to be discarded',
        );
    });

    it('grants no permissions to an admin with no role names', async () => {
        const passwordHash = await pbkdf2HashPassword('correct horse', 1);
        const admin = {
            id: 'admin-1',
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
        };
        const harness = makeAuthenticationHarness({ passwordHash, admin });
        await authenticateAdminApiRequest(
            harness.context,
            makeRequest('admin@example.com:correct horse'),
            {},
        );

        assertEqual(0, harness.context.user.permissions.length);
    });

    it('rejects invalid Basic credentials without setting a principal', async () => {
        const passwordHash = await pbkdf2HashPassword('correct horse', 1);
        const harness = makeAuthenticationHarness({ passwordHash });
        const caught = await catchAsyncError(() => {
            return authenticateAdminApiRequest(
                harness.context,
                makeRequest('admin@example.com:wrong horse'),
                {},
            );
        });

        assert(caught, 'expected invalid credentials to be rejected');
        assertEqual('UnauthorizedError', caught.name);
        assertEqual(401, caught.httpStatusCode);
        assertEqual(null, harness.context.user);
    });

    it('authenticates the migrations and publishing-api-tokens subtrees but not accept-invite', () => {
        const adminApiRoute = virtualHosts[0].routes.find(({ name }) => name === 'admin-api');
        const migrationsRoute = adminApiRoute.routes.find(({ name }) => name === 'migrations');
        const tokensRoute = adminApiRoute.routes.find(({ name }) => name === 'publishing-api-tokens');
        const acceptInviteRoute = adminApiRoute.routes.find(({ name }) => name === 'accept-invite');
        const virtualHost = VirtualHost.fromSpecification(virtualHosts[0]);
        const listRoute = virtualHost.routes.find(({ name }) => name === 'admin-api/migrations/list');
        const runRoute = virtualHost.routes.find(({ name }) => name === 'admin-api/migrations/run');

        // Authentication is declared per protected subtree rather than on the
        // shared /admin-api/v1 parent, so accept-invite stays reachable with
        // only the invite bearer token its own handler validates.
        assertUndefined(adminApiRoute.inboundMiddleware);
        assertEqual(1, migrationsRoute.inboundMiddleware.length);
        assertEqual(authenticateAdminApiRequest, migrationsRoute.inboundMiddleware[0]);
        assertEqual(1, tokensRoute.inboundMiddleware.length);
        assertEqual(authenticateAdminApiRequest, tokensRoute.inboundMiddleware[0]);
        assertUndefined(acceptInviteRoute.inboundMiddleware);
        assertEqual('/migrations', migrationsRoute.pattern);
        assertEqual('{/}', migrationsRoute.routes[0].pattern);
        assertEqual('/:id/run', migrationsRoute.routes[1].pattern);
        assertEqual('/publishing-api-tokens{/}', tokensRoute.pattern);
        assertEqual('/users/invite{/}', acceptInviteRoute.pattern);
        assertEqual('/admin-api/v1/migrations{/}', listRoute.pattern);
        assertEqual('/admin-api/v1/migrations/:id/run', runRoute.pattern);
        assertEqual('jsonApiErrorHandler', adminApiRoute.errorHandlers[0].name);
    });
});

function makeAuthenticationHarness(options) {
    const {
        passwordHash = null,
        admin = {
            id: 'admin-1',
            type: 'AdminUser',
            emailAddress: 'admin@example.com',
            userCreationDate: '2026-07-17T12:00:00.000Z',
        },
    } = options ?? {};
    const harness = {
        collectionCalls: 0,
        loadedEmailAddress: null,
    };
    const user = passwordHash ? {
        get(name) {
            assertEqual('passwordHash', name);
            return passwordHash;
        },
        toAuthenticatedUser() {
            return admin;
        },
    } : null;
    const context = {
        config: {
            env: {
                SECRET_ENCRYPTION: { PBKDF2_ITERATIONS: 1 },
            },
        },
        user: null,
        getCollection(name) {
            harness.collectionCalls += 1;
            assertEqual('AdminUser', name);
            return {
                async getByEmailAddress(_context, emailAddress) {
                    harness.loadedEmailAddress = emailAddress;
                    return user;
                },
            };
        },
        setUser(principal) {
            this.user = principal;
        },
    };

    harness.context = context;
    return harness;
}

function makeRequest(credentials) {
    const headers = new Headers();
    if (credentials) {
        headers.set('authorization', `Basic ${ btoa(credentials) }`);
    }
    return { headers };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
