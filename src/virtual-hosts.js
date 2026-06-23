import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
import { StaticFileServerHandler } from './kixx/static-file-server/static-file-server-request-handlers.js';

export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
            {
                pattern: '/admin',
                name: 'admin-panel',
                routes: [
                    {
                        pattern: '/style-guide',
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
                ],
            },
            {
                pattern: '/accounts/admin/new',
                name: 'new-admin-account-form',
                targets: [
                    {
                        name: 'render-form',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
                            HyperviewDynamicPageHandler(),
                        ],
                    },
                ],
            },
            {
                pattern: '/login/admin/new',
                name: 'admin-login-form',
                targets: [
                    {
                        name: 'render-form',
                        methods: [ 'GET', 'HEAD' ],
                        requestHandlers: [
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
