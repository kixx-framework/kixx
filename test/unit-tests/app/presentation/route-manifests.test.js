import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import virtualHosts from '../../../../src/virtual-hosts.js';
import adminPanelRoutes from '../../../../src/routes/admin-panel.js';


function findTarget(routes, routeName, targetName) {
    const route = routes.find((candidate) => candidate.name === routeName);
    return route?.targets?.find((candidate) => candidate.name === targetName);
}


describe('presentation route manifests', ({ it }) => {

    it('imports the active manifests and configures explicit base templates', () => {
        const virtualHost = virtualHosts[0];
        const signupTarget = findTarget(virtualHost.routes, 'new-admin-user-form', 'render-form');
        const adminRoute = adminPanelRoutes.find((route) => route.name === 'static-pages');
        const adminTarget = adminRoute.targets[0];

        assert(signupTarget, 'expected signup route target');
        assert(adminTarget, 'expected admin static page target');
        assertEqual(2, signupTarget.requestHandlers.length);
        assertEqual(1, adminTarget.requestHandlers.length);
    });
});
