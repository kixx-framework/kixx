import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
import { StaticFileServerHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';
import { adminErrorHandler } from './app/presentation/error-handlers/admin-error-handler.js';
import { authenticateAdminUser } from './app/presentation/middleware/admin-authentication.js';
import {
    getNewAdminUserForm,
    postNewAdminUserForm,
    getAdminUserLoginForm,
    postAdminUserLoginForm,
} from './app/presentation/request-handlers/admin-users.js';
import {
    getAdminInvites,
    postCreateAdminInvite,
    postRevokeAdminInvite,
} from './app/presentation/request-handlers/admin-invites.js';


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
                                    postRevokeAdminInvite,
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
                                    getAdminInvites,
                                    HyperviewDynamicPageHandler(),
                                ],
                            },
                            {
                                name: 'create-invite',
                                methods: [ 'POST' ],
                                requestHandlers: [
                                    postCreateAdminInvite,
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
                            getNewAdminUserForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            postNewAdminUserForm,
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
                            getAdminUserLoginForm,
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            postAdminUserLoginForm,
                            HyperviewDynamicPageHandler(),
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
