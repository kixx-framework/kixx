import HyperviewPageHandler from './kixx/hyperview/hyperview-page-handler.js';
import StaticAssetRequestHandler from './kixx/static-assets/static-asset-request-handler.js';
import { pluginRoutes } from './routes.generated.js';


// The URL the assetUrl template helper writes: an asset under its content
// hash, cached forever.
const fingerprintedAssetsRoute = {
    pattern: '/assets/:hash/*pathname',
    name: 'fingerprinted-assets',
    targets: [
        {
            name: 'serve-asset',
            methods: [ 'GET', 'HEAD' ],
            requestHandlers: [ StaticAssetRequestHandler({ fingerprinted: true }) ],
        },
    ],
};

// Everything else is content: a static asset by its pathname, else a page.
// A new page needs no route.
const catchAllRoute = {
    pattern: '*',
    name: 'catch-all',
    targets: [
        {
            name: 'serve-content',
            methods: [ 'GET', 'HEAD' ],
            requestHandlers: [
                // A miss falls through to the page handler.
                StaticAssetRequestHandler({ throwNotFound: false, skipWhenFound: true }),
                HyperviewPageHandler({ baseTemplateId: 'default.html' }),
            ],
        },
    ],
};

// Add your own routes first. Plugin routes come after them, and the
// catch-all must stay last.
export default [
    {
        name: 'kixx-app',
        // Answers on every hostname.
        hostname: '*',
        routes: [ fingerprintedAssetsRoute, ...pluginRoutes, catchAllRoute ],
    },
];
