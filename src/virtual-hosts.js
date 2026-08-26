import HyperviewPageHandler from './app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import adminErrorHandler from './app/presentation/error-handlers/admin-error-handler.js';
import adminAuthErrorHandler from './app/presentation/error-handlers/admin-auth-error-handler.js';
import jsonApiErrorHandler from './app/presentation/error-handlers/json-api-error-handler.js';
import authenticateAdminUser from './app/presentation/middleware/authenticate-admin-user.js';
import authenticatePublishingToken from './app/presentation/middleware/authenticate-publishing-token.js';
import * as AdminUsers from './app/presentation/request-handlers/admin-panel/admin-users.js';
import adminPanelRoutes from './routes/admin-panel.js';
import adminApiRoutes from './routes/admin-api-v1.js';
import publishingApiRoutes from './routes/publishing-api-v1.js';
import StaticAssetRequestHandler from './kixx/static-assets/static-asset-request-handler.js';


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
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html' }),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminUsers.postNewAdminUserForm,
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html' }),
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
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html' }),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminUsers.postAdminUserLoginForm,
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html' }),
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
                pattern: '/assets/:hash/*pathname',
                name: 'fingerprinted-assets',
                targets: [
                    {
                        name: 'serve-asset',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticAssetRequestHandler({ fingerprinted: true }),
                        ],
                    },
                ],
            },
            {
                pattern: '*',
                name: 'hyperview-static-catch-all',
                targets: [
                    {
                        name: 'render-static-page',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticAssetRequestHandler({
                                throwNotFound: false,
                                skipWhenFound: true,
                            }),
                            HyperviewPageHandler({ baseTemplateId: 'default.html' }),
                        ],
                    },
                ],
            },
        ],
    },
];
