import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { evaluatePermissions } from '../../../../src/kixx/permissions/permission-validation.js';
import { roles } from '../../../../src/app/permissions/roles.js';
import adminPanelRoutes from '../../../../src/routes/admin-panel.js';
import adminApiRoutes from '../../../../src/routes/admin-api-v1.js';
import publishingApiRoutes from '../../../../src/routes/publishing-api-v1.js';


// The closed verb set documented in src/app/permissions/roles.js. A route
// naming a verb outside it can only ever be satisfied by a wildcard grant.
const SUPPORTED_ACTIONS = new Set([
    'urn:kixx:get',
    'urn:kixx:list',
    'urn:kixx:create',
    'urn:kixx:run',
    'urn:kixx:revoke',
    'urn:kixx:grant-role',
]);

const ROOT_ADMIN = 'Root Admin';


function collectDecisions(routes, trail) {
    const collected = [];

    for (const route of routes) {
        const routeTrail = `${ trail }/${ route.name }`;

        for (const target of route.targets ?? []) {
            for (const handler of target.requestHandlers ?? []) {
                for (const decision of handler.decisions ?? []) {
                    collected.push({ ...decision, route: `${ routeTrail }/${ target.name }` });
                }
            }
        }

        collected.push(...collectDecisions(route.routes ?? [], routeTrail));
    }

    return collected;
}

function rolesAllowing(decision) {
    return roles
        .filter((role) => evaluatePermissions(role.permissions, decision))
        .map((role) => role.name);
}


describe('route authorization decisions', ({ it }) => {

    const decisions = collectDecisions(adminPanelRoutes, 'admin-panel')
        .concat(collectDecisions(adminApiRoutes, 'admin-api'))
        .concat(collectDecisions(publishingApiRoutes, 'publishing-api'));

    it('collects a gate from every route manifest', () => {
        assert(decisions.length > 0, 'expected the manifests to declare authorization decisions');

        for (const name of [ 'admin-panel', 'admin-api', 'publishing-api' ]) {
            assert(
                decisions.some((decision) => decision.route.startsWith(name)),
                `expected ${ name } to declare authorization decisions`,
            );
        }
    });

    it('names only supported action verbs', () => {
        const unsupported = decisions
            .filter((decision) => !SUPPORTED_ACTIONS.has(decision.action))
            .map((decision) => `${ decision.route }: ${ decision.action }`);

        assertEqual(0, unsupported.length, `unsupported action verbs: ${ unsupported.join(', ') }`);
    });

    it('grants every decision to a role other than Root Admin', () => {
        // Root Admin holds '*' on '*', so it satisfies any decision including a
        // misspelled one. Requiring a second role is what makes this a test.
        const unreachable = decisions
            .filter((decision) => {
                const allowed = rolesAllowing(decision);
                return !allowed.some((name) => name !== ROOT_ADMIN);
            })
            .map((decision) => `${ decision.route }: ${ decision.action } @ ${ decision.resource }`);

        assertEqual(0, unreachable.length, `no role can reach: ${ unreachable.join(', ') }`);
    });

    it('keeps Root Admin able to reach every decision', () => {
        const denied = decisions
            .filter((decision) => !rolesAllowing(decision).includes(ROOT_ADMIN))
            .map((decision) => `${ decision.route }: ${ decision.action }`);

        assertEqual(0, denied.length, `Root Admin denied: ${ denied.join(', ') }`);
    });
});
