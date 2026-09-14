import HyperviewPageHandler from './app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import adminErrorHandler from './app/presentation/error-handlers/admin-error-handler.js';
import adminAuthErrorHandler from './app/presentation/error-handlers/admin-auth-error-handler.js';
import authenticateAdminUser from './app/presentation/middleware/authenticate-admin-user.js';
import authenticatePublishingToken from './app/presentation/middleware/authenticate-publishing-token.js';
import * as AdminPanel from './app/presentation/request-handlers/admin-panel/mod.js';
import adminPanelRoutes from './routes/admin-panel.js';
import adminApiRoutes from './routes/admin-api-v1.js';
import publishingApiRoutes from './routes/publishing-api-v1.js';
import fileRoutes from './routes/files.js';
import StaticAssetRequestHandler from './kixx/static-assets/static-asset-request-handler.js';

// Root files like /favicon.ico are requested by fixed name and cannot be
// fingerprinted, so allow a modest max-age instead of revalidating every view.
const ROOT_FILE_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';


export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            ...fileRoutes,
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
                            AdminPanel.getNewAdminUserForm,
                            // Every render mints a fresh, session-bound CSRF token, so
                            // the rendered page cache must never store or serve it.
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html', usePageCache: false }),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminPanel.postNewAdminUserForm,
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html', usePageCache: false }),
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
                            AdminPanel.getAdminUserLoginForm,
                            // Every render mints a fresh, session-bound CSRF token, so
                            // the rendered page cache must never store or serve it.
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html', usePageCache: false }),
                        ],
                    },
                    {
                        name: 'post-form',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            AdminPanel.postAdminUserLoginForm,
                            HyperviewPageHandler({ baseTemplateId: 'admin-login.html', usePageCache: false }),
                        ],
                    },
                ],
            },
            {
                pattern: '/admin-api/v1',
                name: 'admin-api',
                routes: adminApiRoutes,
            },
            {
                pattern: '/publishing-api/v1',
                name: 'publishing-api',
                inboundMiddleware: [
                    authenticatePublishingToken,
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
                // Also matches root page context URLs like /index.json, so a
                // missing asset falls through to the page handler.
                pattern: '/:filename.:extension',
                name: 'root-files',
                targets: [
                    {
                        name: 'serve-root-file',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            StaticAssetRequestHandler({
                                cacheControl: ROOT_FILE_CACHE_CONTROL,
                                throwNotFound: false,
                                skipWhenFound: true,
                            }),
                            HyperviewPageHandler({ baseTemplateId: 'default.html' }),
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
