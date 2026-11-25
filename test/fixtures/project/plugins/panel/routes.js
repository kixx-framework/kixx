// Mounted at /panel by the plugin's manifest. Exporting an object, not an
// array, puts the middleware on the mount: it runs for every route below.

function markPanelResponse(_context, _request, response) {
    response.setHeader('x-fixture-panel', 'yes');
    return response;
}

function showPanel(context, _request, response) {
    return response.respondWithJSON(200, { title: context.getService('Panel').title });
}

export default {
    inboundMiddleware: [ markPanelResponse ],
    routes: [
        {
            pattern: '{/}',
            name: 'home',
            targets: [
                { name: 'home', methods: [ 'GET' ], requestHandlers: [ showPanel ] },
            ],
        },
    ],
};
