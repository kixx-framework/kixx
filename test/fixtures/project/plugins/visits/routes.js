// Mounted at /visits by the plugin's manifest.

async function countVisit(context, _request, response) {
    const count = await context.getService('Visits').increment(context);

    return response.respondWithJSON(200, {
        count,
        target: context.getService('VisitsPlatform').target,
        config: context.config.env.VISITS,
    });
}

export default [
    {
        // The mount path itself, with or without a trailing slash.
        pattern: '{/}',
        name: 'count',
        targets: [
            { name: 'count', methods: [ 'GET' ], requestHandlers: [ countVisit ] },
        ],
    },
];
