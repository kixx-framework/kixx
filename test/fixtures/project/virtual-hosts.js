import HyperviewPageHandler from '../../../kixx/hyperview/hyperview-page-handler.js';
import StaticAssetRequestHandler from '../../../kixx/static-assets/static-asset-request-handler.js';
import { pluginRoutes } from './routes.generated.js';


function showHome(_context, _request, response) {
    return response.respondWithJSON(200, { page: 'home' });
}

const homeRoute = {
    pattern: '/',
    name: 'home',
    targets: [
        { name: 'home', methods: [ 'GET', 'HEAD' ], requestHandlers: [ showHome ] },
    ],
};

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

// The project decides where plugin routes go: after its own routes, and
// before the catch-all, which must stay last.
export default [
    {
        name: 'fixture',
        hostname: 'localhost',
        routes: [ homeRoute, fingerprintedAssetsRoute, ...pluginRoutes, catchAllRoute ],
    },
];
