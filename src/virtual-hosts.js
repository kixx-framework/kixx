import { HyperviewStaticPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';

export default [
    {
        name: 'kixx-app',
        hostname: 'localhost',
        routes: [
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
                            HyperviewStaticPageHandler(),
                        ],
                    },
                ],
            },
        ],
    },
];
