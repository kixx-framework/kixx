import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { deriveRolePermissions, ROLE_EDITOR } from '../../../../src/app/permissions/roles.js';
import { evaluatePermissions } from '../../../../src/kixx/permissions/permission-validation.js';
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

    // Reachability is checked through deriveRolePermissions() rather than the
    // role table, because a principal is what the gate actually evaluates. A
    // grant vocabulary that drifts from the manifests would still read as
    // correct against the raw table.
    it('is fully reachable by a developer principal', () => {
        const unreachable = unsatisfiedBy(decisions, [ 'developer' ]);

        assertEqual(0, unreachable.length, `unreachable by developer: ${ unreachable.join(', ') }`);
    });

    it('grants an editor principal the publishing API and nothing else', () => {
        const publishingDecisions = decisions.filter(isPublishingApiDecision);
        const adminDecisions = decisions.filter((decision) => !isPublishingApiDecision(decision));

        assert(publishingDecisions.length > 0, 'expected publishing API decisions');

        const unreachable = unsatisfiedBy(publishingDecisions, [ ROLE_EDITOR ]);
        assertEqual(0, unreachable.length, `unreachable by editor: ${ unreachable.join(', ') }`);

        const reachable = adminDecisions.length - unsatisfiedBy(adminDecisions, [ ROLE_EDITOR ]).length;
        assertEqual(0, reachable, 'expected an editor principal to reach no admin decision');
    });

    it('grants an admin principal the invite decisions but no developer decisions', () => {
        const invites = decisions.filter((decision) => {
            return decision.resource === 'urn:kixx:admin:user-invites';
        });
        const developerOnly = decisions.filter((decision) => {
            return decision.resource.startsWith('urn:kixx:admin:api-tokens') ||
                decision.resource === 'urn:kixx:admin:migrations';
        });

        assert(invites.length > 0, 'expected invite decisions');
        assert(developerOnly.length > 0, 'expected developer-only decisions');

        assertEqual(0, unsatisfiedBy(invites, [ 'admin' ]).length);
        assertEqual(developerOnly.length, unsatisfiedBy(developerOnly, [ 'admin' ]).length);
    });

    it('denies every decision to a principal holding an unregistered role', () => {
        const unsatisfied = unsatisfiedBy(decisions, [ 'Developer Admin', 'not-a-role' ]);

        assertEqual(decisions.length, unsatisfied.length);
    });

});

function isPublishingApiDecision(decision) {
    return decision.resource.startsWith('urn:kixx:publishing:');
}

function unsatisfiedBy(decisions, roleIds) {
    const user = { permissions: deriveRolePermissions(roleIds) };

    return decisions
        .filter((decision) => {
            return !evaluatePermissions(user.permissions, {
                action: decision.action,
                resource: decision.resource,
            });
        })
        .map((decision) => `${ decision.route }: ${ decision.action } ${ decision.resource }`);
}
