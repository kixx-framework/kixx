// The integration suite's test routes, mounted at /integration-probe by the
// plugin's manifest. Every one is behind the deploy key.
//
// This module is platform-neutral. What differs between targets comes from
// the IntegrationProbe service, which the target's lifecycle module
// registers: `target`, and `portFactories`, a factory builder for each port
// suite over that target's own adapters and bindings.
//
// This directory sits two levels below the repository root, as
// plugins/integration-probe/ sits two levels below a project's root. So
// these imports are the same in the built test app.
import { requireDeployKey, verifyDeployKey } from '../../kixx/deploy-key/mod.js';
import { BadRequestError, NotFoundError } from '../../kixx/errors/mod.js';
import { createProbeHandler } from '../../test-app/probe/probe-handler.js';
import { BUILT_IN_FACTORIES, PROBE_SUITES } from '../../test-app/probe/probe-suites.js';


// The longest /hold waits. A test's whole request must fit the runner's
// 10-second ceiling.
const MAX_HOLD_MS = 5000;

const PORT_SUITES = [ 'content-store', 'key-value-store', 'logger-writer', 'server-request' ];

// The service is looked up on each request: it isn't registered when this
// module loads.
const portFactories = Object.fromEntries(PORT_SUITES.map((name) => {
    return [ name, (context) => context.getService('IntegrationProbe').portFactories[name](context) ];
}));

const probeHandler = createProbeHandler({
    suites: PROBE_SUITES,
    factories: { ...BUILT_IN_FACTORIES, ...portFactories },
    authorize: (context, request) => verifyDeployKey(context, request),
});

// What the target says it is. No secret and no binding value.
function showEnvironment(context, _request, response) {
    return response.respondWithJSON(200, {
        target: context.getService('IntegrationProbe').target,
        environment: context.config.environment,
        buildId: context.runtime.build?.id ?? null,
    });
}

// Answers after `ms` milliseconds, so a test can have a request in flight
// when it sends the server a signal.
async function hold(_context, request, response) {
    const asked = Number(request.url.searchParams.get('ms'));
    const milliseconds = Number.isFinite(asked) ? Math.min(Math.max(asked, 0), MAX_HOLD_MS) : 0;

    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

    return response.respondWithJSON(200, { held: milliseconds });
}

// A bug, as a server sees one: an error nothing expected.
function throwUnexpectedError() {
    throw new Error('integration-probe: an unexpected error, thrown on purpose');
}

// How many keys the app's key/value store holds under a prefix. The port has
// no listing, so only a target whose adapter can count answers.
async function countKeyValueKeys(context, request, response) {
    const count = context.getService('IntegrationProbe').countKeyValueKeys;

    if (typeof count !== 'function') {
        throw new NotFoundError('This target can\'t count key/value keys');
    }

    const prefix = request.url.searchParams.get('prefix');

    if (!prefix) {
        throw new BadRequestError('The prefix query parameter is required');
    }

    return response.respondWithJSON(200, { prefix, count: await count(prefix) });
}


export default {
    inboundMiddleware: [ requireDeployKey ],
    routes: [
        {
            pattern: '/probe',
            name: 'probe',
            targets: [
                { name: 'probe', methods: [ 'GET', 'POST' ], requestHandlers: [ probeHandler ] },
            ],
        },
        {
            pattern: '/environment',
            name: 'environment',
            targets: [
                { name: 'show', methods: [ 'GET' ], requestHandlers: [ showEnvironment ] },
            ],
        },
        {
            pattern: '/hold',
            name: 'hold',
            targets: [
                { name: 'hold', methods: [ 'GET' ], requestHandlers: [ hold ] },
            ],
        },
        {
            pattern: '/unexpected-error',
            name: 'unexpected-error',
            targets: [
                { name: 'throw', methods: [ 'GET' ], requestHandlers: [ throwUnexpectedError ] },
            ],
        },
        {
            pattern: '/key-value-keys',
            name: 'key-value-keys',
            targets: [
                { name: 'count', methods: [ 'GET' ], requestHandlers: [ countKeyValueKeys ] },
            ],
        },
    ],
};
