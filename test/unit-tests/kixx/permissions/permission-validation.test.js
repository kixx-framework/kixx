import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import {
    doesPatternMatch,
    evaluatePermissions,
    requirePermission,
} from '../../../../src/kixx/permissions/permission-validation.js';


describe('permission validation', ({ describe }) => {
    describe('requirePermission', ({ it }) => {
        const decision = {
            action: 'urn:kixx:read',
            resource: 'urn:kixx:publishing:article:42',
        };

        it('returns when the user has permission', () => {
            const user = {
                permissions: [ {
                    action: 'urn:kixx:read',
                    resource: 'urn:kixx:publishing:*',
                } ],
            };

            assertUndefined(requirePermission(user, decision));
        });

        it('throws the default forbidden error when permission is denied', () => {
            const error = catchError(() => requirePermission({ permissions: [] }, decision));

            assert(error, 'expected requirePermission to throw');
            assertEqual('ForbiddenError', error.name);
            assertEqual('FORBIDDEN_ERROR', error.code);
            assertEqual(403, error.httpStatusCode);
            assertEqual(true, error.expected);
            assertEqual('You are not authorized to perform this request.', error.message);
        });

        it('asserts a missing user', () => {
            const error = catchError(() => requirePermission(null, decision));

            assert(error, 'expected requirePermission to throw');
            assertEqual('AssertionError', error.name);
            assertMatches(/user must be a plain object/, error.message);
        });

        it('denies a user without permissions', () => {
            const error = catchError(() => requirePermission({}, decision));

            assert(error, 'expected requirePermission to throw');
            assertEqual('ForbiddenError', error.name);
        });

        it('denies a user with malformed stored grants', () => {
            const user = { permissions: [ null, { action: 'urn:kixx:read' } ] };

            const error = catchError(() => requirePermission(user, decision));

            assert(error, 'expected requirePermission to throw');
            assertEqual('ForbiddenError', error.name);
        });

        it('asserts a missing decision', () => {
            const error = catchError(() => requirePermission({ permissions: [] }, null));

            assert(error, 'expected requirePermission to throw');
            assertEqual('AssertionError', error.name);
            assertMatches(/decision must be a plain object/, error.message);
        });

        it('asserts a malformed decision action', () => {
            const user = { permissions: [ { action: '*', resource: '*' } ] };

            const error = catchError(() => requirePermission(user, {
                action: '',
                resource: decision.resource,
            }));

            assert(error, 'expected requirePermission to throw');
            assertEqual('AssertionError', error.name);
            assertMatches(/decision.action/, error.message);
        });

        it('asserts a malformed decision resource', () => {
            const user = { permissions: [ { action: '*', resource: '*' } ] };

            const error = catchError(() => requirePermission(user, {
                action: decision.action,
                resource: null,
            }));

            assert(error, 'expected requirePermission to throw');
            assertEqual('AssertionError', error.name);
            assertMatches(/decision.resource/, error.message);
        });

        it('asserts malformed error overrides', () => {
            const user = { permissions: [] };

            const messageError = catchError(() => requirePermission(user, decision, {
                message: 42,
            }));

            assert(messageError, 'expected requirePermission to throw');
            assertEqual('AssertionError', messageError.name);
            assertMatches(/options.message/, messageError.message);

            const codeError = catchError(() => requirePermission(user, decision, { code: '' }));

            assert(codeError, 'expected requirePermission to throw');
            assertEqual('AssertionError', codeError.name);
            assertMatches(/options.code/, codeError.message);

            const optionsError = catchError(() => requirePermission(user, decision, 'nope'));

            assert(optionsError, 'expected requirePermission to throw');
            assertEqual('AssertionError', optionsError.name);
            assertMatches(/options must be a plain object/, optionsError.message);
        });

        it('uses custom forbidden error fields', () => {
            const error = catchError(() => requirePermission(
                { permissions: [] },
                decision,
                {
                    message: 'Article access is restricted.',
                    code: 'ARTICLE_FORBIDDEN',
                },
            ));

            assert(error, 'expected requirePermission to throw');
            assertEqual('Article access is restricted.', error.message);
            assertEqual('ARTICLE_FORBIDDEN', error.code);
        });
    });

    describe('evaluatePermissions', ({ it }) => {
        const request = {
            action: 'urn:kixx:read',
            resource: 'urn:kixx:publishing:article:42',
        };

        it('allows a request when a grant matches', () => {
            const permissions = [ {
                action: 'urn:kixx:read',
                resource: 'urn:kixx:publishing:article:42',
            } ];

            assertEqual(true, evaluatePermissions(permissions, request));
        });

        it('ignores a legacy grant effect', () => {
            const permissions = [ {
                action: 'urn:kixx:read',
                resource: 'urn:kixx:publishing:*',
                effect: 'deny',
            } ];

            assertEqual(true, evaluatePermissions(permissions, request));
        });

        it('matches any action in a grant action array', () => {
            const permissions = [ {
                action: [ 'urn:kixx:write', 'urn:kixx:read' ],
                resource: 'urn:kixx:publishing:*',
            } ];

            assertEqual(true, evaluatePermissions(permissions, request));
        });

        it('denies a request when no grant matches', () => {
            const permissions = [ {
                action: 'urn:kixx:write',
                resource: 'urn:kixx:publishing:*',
            } ];

            assertEqual(false, evaluatePermissions(permissions, request));
        });

        it('ignores unsupported grants', () => {
            const permissions = [
                null,
                {
                    action: 'urn:kixx:read',
                },
                {
                    action: [ 'urn:kixx:read', null ],
                    resource: 'urn:kixx:publishing:*',
                },
            ];

            assertEqual(false, evaluatePermissions(permissions, request));
        });

        it('denies a malformed permission request', () => {
            assertEqual(false, evaluatePermissions([], null));
            assertEqual(false, evaluatePermissions(null, request));
        });
    });

    describe('doesPatternMatch global wildcard', ({ it }) => {
        it('matches any permission URN', () => {
            assertEqual(true, doesPatternMatch('*', 'urn:kixx:publishing:page:create'));
        });

        it('matches an empty value', () => {
            assertEqual(true, doesPatternMatch('*', ''));
        });
    });

    describe('doesPatternMatch exact pattern', ({ it }) => {
        it('matches an identical permission URN', () => {
            const urn = 'urn:kixx:publishing:page:create';

            assertEqual(true, doesPatternMatch(urn, urn));
        });

        it('does not match a different permission URN', () => {
            assertEqual(false, doesPatternMatch(
                'urn:kixx:publishing:page:create',
                'urn:kixx:publishing:page:delete',
            ));
        });

        it('does not match unsupported values', () => {
            assertEqual(false, doesPatternMatch(null, null));
            assertEqual(false, doesPatternMatch('urn:kixx:read', null));
        });
    });

    describe('doesPatternMatch scoped wildcard', ({ it }) => {
        const pattern = 'urn:kixx:publishing:page-metadata:*';

        it('matches a non-empty value within the scope', () => {
            assertEqual(true, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata:/blog/hello',
            ));
        });

        it('matches a value containing additional colon-delimited segments', () => {
            assertEqual(true, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata:draft:title',
            ));
        });

        it('matches the scope with an empty remainder', () => {
            assertEqual(true, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata:',
            ));
        });

        it('does not match the bare scope without its final colon', () => {
            assertEqual(false, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata',
            ));
        });

        it('does not match a sibling scope with a similar prefix', () => {
            assertEqual(false, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata-settings:read',
            ));
        });

        it('does not treat a wildcard outside the final segment as special', () => {
            assertEqual(false, doesPatternMatch(
                'urn:kixx:publishing:*:read',
                'urn:kixx:publishing:page:read',
            ));
        });

        it('matches a wildcard in the final segment', () => {
            assertEqual(true, doesPatternMatch(
                pattern,
                'urn:kixx:publishing:page-metadata:*',
            ));
        });
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}
