import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { pbkdf2HashPassword } from '../../../../src/app/lib/password-hashing.js';
import { authenticateAdminApiRequest } from '../../../../src/app/presentation/middleware/admin-api-authentication.js';
import VirtualHost from '../../../../src/kixx/http-router/virtual-host.js';
import virtualHosts from '../../../../src/virtual-hosts.js';


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
        };
        const harness = makeAuthenticationHarness({ passwordHash, admin });
        const response = {};
        const returned = await authenticateAdminApiRequest(
            harness.context,
            makeRequest('ADMIN@EXAMPLE.COM:correct horse'),
            response,
        );

        assertEqual(response, returned);
        assertEqual(admin, harness.context.user);
        assertEqual('admin@example.com', harness.loadedEmailAddress);
        assertEqual(1, harness.collectionCalls);
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

    it('protects only the migrations subtree beneath the shared JSON API error route', () => {
        const adminApiRoute = virtualHosts[0].routes.find(({ name }) => name === 'admin-api');
        const migrationsRoute = adminApiRoute.routes.find(({ name }) => name === 'migrations');
        const siblingRoute = adminApiRoute.routes.find(({ name }) => name === 'publishing-api-tokens');
        const virtualHost = VirtualHost.fromSpecification(virtualHosts[0]);
        const listRoute = virtualHost.routes.find(({ name }) => name === 'admin-api/migrations/list');
        const runRoute = virtualHost.routes.find(({ name }) => name === 'admin-api/migrations/run');

        assertEqual(authenticateAdminApiRequest, migrationsRoute.inboundMiddleware[0]);
        assertEqual(undefined, siblingRoute.inboundMiddleware);
        assertEqual('/migrations', migrationsRoute.pattern);
        assertEqual('{/}', migrationsRoute.routes[0].pattern);
        assertEqual('/:id/run', migrationsRoute.routes[1].pattern);
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
