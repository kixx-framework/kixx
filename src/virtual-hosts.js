import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
import {
    StaticAssetRequestHandler,
    StaticFileRequestHandler,
} from './kixx/static-file-server/static-file-server-request-handlers.js';
import adminErrorHandler from './app/presentation/error-handlers/admin-error-handler.js';
import adminAuthErrorHandler from './app/presentation/error-handlers/admin-auth-error-handler.js';
import jsonApiErrorHandler from './app/presentation/error-handlers/json-api-error-handler.js';
import authenticateAdminUser from './app/presentation/middleware/authenticate-admin-user.js';
import authenticatePublishingToken from './app/presentation/middleware/authenticate-publishing-token.js';
import * as AdminUsers from './app/presentation/request-handlers/admin-panel/admin-users.js';
import adminPanelRoutes from './routes/admin-panel.js';
import adminApiRoutes from './routes/admin-api-v1.js';
import publishingApiRoutes from './routes/publishing-api-v1.js';


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
                routes: adminPanelRoutes,
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
                routes: adminApiRoutes,
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
                routes: publishingApiRoutes,
            },
            {
                pattern: '/assets/:build_id/*pathname',
                name: 'build-assets',
                targets: [
                    {
                        name: 'serve-asset',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticAssetRequestHandler(),
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
