import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
import { StaticFileRequestHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';
import { adminErrorHandler } from './app/presentation/error-handlers/admin-error-handler.js';
import { adminAuthErrorHandler } from './app/presentation/error-handlers/admin-auth-error-handler.js';
import { jsonApiErrorHandler } from './app/presentation/error-handlers/json-api-error-handler.js';
import { authenticateAdminUser } from './app/presentation/middleware/admin-authentication.js';
import { authenticateAdminApiRequest } from './app/presentation/middleware/admin-api-authentication.js';
import { authenticatePublishingToken } from './app/presentation/middleware/publishing-authentication.js';
import * as AdminUsers from './app/presentation/request-handlers/admin-users.js';
import * as AdminInvites from './app/presentation/request-handlers/admin-invites.js';
import * as AdminPublishingApiTokens from './app/presentation/request-handlers/admin-publishing-api-tokens.js';
import * as AdminAPI from './app/presentation/request-handlers/admin-api/mod.js';
import * as PublishingAPI from './app/presentation/request-handlers/publishing-api/mod.js';


export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            {
                pattern: '/admin',
                name: 'admin-panel',
                inboundMiddleware: [
                    authenticateAdminUser,
                ],
                errorHandlers: [
                    adminErrorHandler,
                ],
                routes: [
                    {
                        pattern: '/style-guide{.:suffix}',
                        name: 'style-guide',
                        targets: [
                            {
                                name: 'render-style-guide-page',
                                methods: [ 'GET', 'HEAD' ],
                                requestHandlers: [
                                    HyperviewStaticPageHandler(),
                                ],
                            },
                        ],
                    },
                    {
                        // Revoke is its own route because it shares the POST method
                        // with create-invite; one route cannot host two POST targets.
                        pattern: '/invites/revoke',
                        name: 'invites-revoke',
                        targets: [
                            {
                                name: 'revoke',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminInvites.postRevokeAdminInvite,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/invites',
                        name: 'invites',
                        targets: [
                            {
                                name: 'render-invite-list',
                                methods: [ 'GET', 'HEAD' ],
                                requestHandlers: [
                                    AdminInvites.getAdminInvites,
                                    HyperviewDynamicPageHandler(),
                                ],
                            },
                            {
                                name: 'create-invite',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminInvites.postCreateAdminInvite,
                                    HyperviewDynamicPageHandler(),
                                ],
                            },
                        ],
                    },
                    {
                        // Revoke is its own route because it shares the POST method
                        // with create-token; one route cannot host two POST targets.
                        pattern: '/publishing-api-tokens/revoke',
                        name: 'publishing-api-tokens-revoke',
                        targets: [
                            {
                                name: 'revoke',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminPublishingApiTokens.postRevokePublishingApiToken,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/publishing-api-tokens',
                        name: 'publishing-api-tokens',
                        targets: [
                            {
                                name: 'render-token-list',
                                methods: [ 'GET', 'HEAD' ],
                                requestHandlers: [
                                    AdminPublishingApiTokens.getPublishingApiTokens,
                                    HyperviewDynamicPageHandler(),
                                ],
                            },
                            {
                                name: 'create-token',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminPublishingApiTokens.postCreatePublishingApiToken,
                                    HyperviewDynamicPageHandler(),
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '*',
                        name: 'static-pages',
                        targets: [
                            {
                                name: 'render-static-page',
                                methods: [ 'GET', 'HEAD' ],
                                requestHandlers: [
                                    HyperviewStaticPageHandler(),
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                pattern: '/users/admin/new{.:suffix}',
                name: 'new-admin-user-form',
                errorHandlers: [
                    adminAuthErrorHandler,
                ],
                targets: [
                    {
                        name: 'render-form',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            AdminUsers.getNewAdminUserForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminUsers.postNewAdminUserForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                ],
            },
            {
                pattern: '/login/admin/new{.:suffix}',
                name: 'admin-login-form',
                errorHandlers: [
                    adminAuthErrorHandler,
                ],
                targets: [
                    {
                        name: 'render-form',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            AdminUsers.getAdminUserLoginForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminUsers.postAdminUserLoginForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                ],
            },
            {
                pattern: '/admin-api/v1',
                name: 'admin-api',
                errorHandlers: [
                    jsonApiErrorHandler,
                ],
                routes: [
                    {
                        pattern: '/migrations',
                        name: 'migrations',
                        inboundMiddleware: [
                            authenticateAdminApiRequest,
                        ],
                        routes: [
                            {
                                pattern: '{/}',
                                name: 'list',
                                targets: [
                                    {
                                        name: 'get',
                                        methods: [ 'GET' ],
                                        requestHandlers: [
                                            AdminAPI.listMigrations,
                                        ],
                                    },
                                ],
                            },
                            {
                                pattern: '/:id/run',
                                name: 'run',
                                targets: [
                                    {
                                        name: 'post',
                                        methods: [ 'POST' ],
                                        requestHandlers: [
                                            AdminAPI.runMigration,
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/users/invite{/}',
                        name: 'accept-invite',
                        targets: [
                            {
                                name: 'post',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminAPI.acceptAdminInvite,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/publishing-api-tokens{/}',
                        name: 'publishing-api-tokens',
                        targets: [
                            {
                                name: 'create',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    AdminAPI.createPublishingApiToken,
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                pattern: '/publishing-api/v1',
                name: 'publishing-api',
                inboundMiddleware: [
                    authenticatePublishingToken,
                ],
                errorHandlers: [
                    jsonApiErrorHandler,
                ],
                routes: [
                    {
                        pattern: '/templates/base/*filepath',
                        name: 'base-templates',
                        targets: [
                            {
                                name: 'put',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putBaseTemplate,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/templates/pages/*filepath',
                        name: 'page-templates',
                        targets: [
                            {
                                name: 'put',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putPageTemplate,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/templates/partials/*filepath',
                        name: 'partial-templates',
                        targets: [
                            {
                                name: 'put',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putPartialTemplate,
                                ],
                            },
                        ],
                    },
                    {
                        // Optional wildcard group so the site root page ('/') can be
                        // published via `PUT /publishing-api/v1/pages` (or with a
                        // trailing slash). A bare `/pages/*pathname` requires at least
                        // one segment, so the root request would fall through to the
                        // catch-all GET/HEAD route and return 405.
                        pattern: '/pages{/*pathname}',
                        name: 'pages',
                        targets: [
                            {
                                name: 'put-metadata',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putPageMetadata,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/includes/*filepath',
                        name: 'includes',
                        targets: [
                            {
                                name: 'put',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putPageInclude,
                                ],
                            },
                        ],
                    },
                    {
                        pattern: '/assets/*filepath',
                        name: 'assets',
                        targets: [
                            {
                                name: 'put',
                                methods: [ 'PUT' ],
                                requestHandlers: [
                                    PublishingAPI.putStaticAsset,
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                pattern: '*',
                name: 'hyperview-static-catch-all',
                targets: [
                    {
                        // Catch-all renderer for static Hyperview static pages, including the
                        // site root, with optional JSON page data responses.
                        name: 'render-static-page',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            // Serve a public file when one matches; otherwise fall
                            // through to the Hyperview page renderer rather than 404.
                            StaticFileRequestHandler({
                                throwNotFound: false,
                                skipWhenFound: true,
                            }),
                            HyperviewStaticPageHandler(),
                        ],
                    },
                ],
            },
        ],
    },
];
