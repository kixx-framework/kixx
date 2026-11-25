// Mounted at /panel/visits, and only when the panel plugin is installed.

function showVisitsPanel(_context, _request, response) {
    return response.respondWithJSON(200, { panel: 'visits' });
}

export default [
    {
        pattern: '{/}',
        name: 'show',
        targets: [
            { name: 'show', methods: [ 'GET' ], requestHandlers: [ showVisitsPanel ] },
        ],
    },
];
