import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import routeModule from '../../../kixx/publishing-api/routes.js';
import { requireDeployKey } from '../../../kixx/deploy-key/mod.js';
import * as handlers from '../../../kixx/publishing-api/mod.js';


const { routes } = routeModule;

function describeRoute(route) {
    const targets = route.targets.map((target) => target.methods.join('|')).join(',');
    return `${ route.pattern } ${ route.name } ${ targets }`;
}


describe('Publishing API v1 routes', ({ it }) => {

    it('puts the deploy key check, and only it, on the mount', () => {
        assertEqual('inboundMiddleware,routes', Object.keys(routeModule).join(','));
        assertEqual(1, routeModule.inboundMiddleware.length);
        assertEqual(requireDeployKey, routeModule.inboundMiddleware[0]);
    });

    it('keeps the v6 order, names, and methods', () => {
        const expected = [
            '{/} discovery GET',
            '/objects/status object-status POST',
            '/objects/:objectId object PUT',
            '/releases/validation release-validation POST',
            '/releases{/} releases GET,POST',
            '/releases/:releaseId/manifest release-manifest GET',
            '/releases/:releaseId release GET',
            '/builds{/} builds GET',
            '/builds/:buildId/activations build-activations GET',
            '/builds/:buildId build GET,PUT',
        ];

        assertEqual(expected.join('\n'), routes.map(describeRoute).join('\n'));
    });

    it('gives each target exactly one handler and no per-route grant', () => {
        const exported = new Set(Object.values(handlers));

        for (const route of routes) {
            for (const target of route.targets) {
                assertEqual(target.methods[0].toLowerCase(), target.name);
                assertEqual(1, target.requestHandlers.length);
                assertEqual(true, exported.has(target.requestHandlers[0]));
            }
        }
    });
});
