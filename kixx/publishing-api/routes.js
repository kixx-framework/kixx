import { requireDeployKey } from '../deploy-key/mod.js';
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
} from './mod.js';


// A valid deploy key grants the whole API, so the key is checked once, on the
// mount, and no route carries its own grant.
//
// Order matters: `/releases/validation` and `/releases/:releaseId/manifest`
// must come before `/releases/:releaseId`.
export default {
    inboundMiddleware: [ requireDeployKey ],
    routes: [
        route('{/}', 'discovery', [ target('GET', getDiscovery) ]),
        route('/objects/status', 'object-status', [ target('POST', getObjectStatus) ]),
        route('/objects/:objectId', 'object', [ target('PUT', putObject) ]),
        route('/releases/validation', 'release-validation', [ target('POST', validateRelease) ]),
        route('/releases{/}', 'releases', [
            target('GET', listReleases),
            target('POST', createRelease),
        ]),
        route('/releases/:releaseId/manifest', 'release-manifest', [ target('GET', getReleaseManifest) ]),
        route('/releases/:releaseId', 'release', [ target('GET', getRelease) ]),
        route('/builds{/}', 'builds', [ target('GET', listBuilds) ]),
        route('/builds/:buildId/activations', 'build-activations', [ target('GET', listBuildActivations) ]),
        route('/builds/:buildId', 'build', [
            target('GET', getBuild),
            target('PUT', putBuild),
        ]),
    ],
};

function target(method, handler) {
    return {
        name: method.toLowerCase(),
        methods: [ method ],
        requestHandlers: [ handler ],
    };
}

function route(pattern, name, targets) {
    return {
        pattern,
        name,
        targets,
    };
}
