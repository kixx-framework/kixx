import { pluginRoutes } from './routes.generated.js';


function showHome(_context, _request, response) {
    return response.respondWithJSON(200, { page: 'home' });
}

function answerNotFound(_context, _request, response) {
    return response.respond(404, { 'content-type': 'text/plain; charset=utf-8' }, 'fixture catch-all: not found\n');
}

const homeRoute = {
    pattern: '/',
    name: 'home',
    targets: [
        { name: 'home', methods: [ 'GET', 'HEAD' ], requestHandlers: [ showHome ] },
    ],
};

const catchAllRoute = {
    pattern: '*',
    name: 'catch-all',
    targets: [
        { name: 'not-found', methods: [ 'GET', 'HEAD' ], requestHandlers: [ answerNotFound ] },
    ],
};

// The project decides where plugin routes go: after its own routes, and
// before the catch-all, which must stay last.
export default [
    {
        name: 'fixture',
        hostname: 'localhost',
        routes: [ homeRoute, ...pluginRoutes, catchAllRoute ],
    },
];
