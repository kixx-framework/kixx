import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
import { StaticFileServerHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';
import { adminErrorHandler } from './app/presentation/error-handlers/admin-error-handler.js';
import { jsonApiErrorHandler } from './app/presentation/error-handlers/json-api-error-handler.js';
import { authenticateAdminUser } from './app/presentation/middleware/admin-authentication.js';
import { authenticatePublishingToken } from './app/presentation/middleware/publishing-authentication.js';
import * as AdminUsers from './app/presentation/request-handlers/admin-users.js';
import * as AdminInvites from './app/presentation/request-handlers/admin-invites.js';
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
                ],
            },
            {
                pattern: '/users/admin/new{.:suffix}',
                name: 'new-admin-user-form',
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
                        pattern: '/pages/*pathname',
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
                            StaticFileServerHandler(),
                            HyperviewStaticPageHandler(),
                        ],
                    },
                ],
            },
        ],
    },
];
