import authorize from '../app/presentation/middleware/authorize.js';
import {
    createRelease,
    getBuild,
    getDiscovery,
    getObjectStatus,
    getRelease,
    getReleaseManifest,
    listBuildActivations,
    listBuilds,
    listReleases,
    putBuild,
    putObject,
    validateRelease,
} from '../app/presentation/request-handlers/publishing-api/mod.js';


const OBJECTS = 'urn:kixx:publishing:objects';
const RELEASES = 'urn:kixx:publishing:releases';
const BUILDS = 'urn:kixx:publishing:builds';

function grant(action, resource) {
    return authorize([ { action, resource } ]);
}

export default [
    route('{/}', 'discovery', [ target('GET', getDiscovery) ]),
    route('/objects/status', 'object-status', [ target('POST', getObjectStatus, 'urn:kixx:create', OBJECTS) ]),
    route('/objects/:objectId', 'object', [ target('PUT', putObject, 'urn:kixx:create', OBJECTS) ]),
    route('/releases/validation', 'release-validation', [ target('POST', validateRelease, 'urn:kixx:create', RELEASES) ]),
    route('/releases{/}', 'releases', [
        target('GET', listReleases, 'urn:kixx:get', RELEASES),
        target('POST', createRelease, 'urn:kixx:create', RELEASES),
    ]),
    route('/releases/:releaseId/manifest', 'release-manifest', [ target('GET', getReleaseManifest, 'urn:kixx:get', RELEASES) ]),
    route('/releases/:releaseId', 'release', [ target('GET', getRelease, 'urn:kixx:get', RELEASES) ]),
    route('/builds{/}', 'builds', [ target('GET', listBuilds, 'urn:kixx:get', BUILDS) ]),
    route('/builds/:buildId/activations', 'build-activations', [ target('GET', listBuildActivations, 'urn:kixx:get', BUILDS) ]),
    route('/builds/:buildId', 'build', [
        target('GET', getBuild, 'urn:kixx:get', BUILDS),
        target('PUT', putBuild, 'urn:kixx:update', BUILDS),
    ]),
];

function target(method, handler, action, resource) {
    const requestHandlers = action ? [ grant(action, resource), handler ] : [ handler ];
    return {
        name: method.toLowerCase(),
        methods: [ method ],
        requestHandlers,
    };
}

function route(pattern, name, targets) {
    return {
        pattern,
        name,
        targets,
    };
}
