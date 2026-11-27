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
import { createProbeHandler } from '../../test-app/probe/probe-handler.js';
import { BUILT_IN_FACTORIES, PROBE_SUITES } from '../../test-app/probe/probe-suites.js';


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
    ],
};
