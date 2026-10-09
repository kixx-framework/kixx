import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import authorize from '../../../../../src/app/presentation/middleware/authorize.js';


const READ_ARTICLES = {
    action: 'urn:kixx:read',
    resource: 'urn:kixx:publishing:article:42',
};

const WRITE_ARTICLES = {
    action: 'urn:kixx:write',
    resource: 'urn:kixx:publishing:article:42',
};


function makeContext(permissions) {
    return { user: permissions === null ? null : { permissions } };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}


describe('authorize middleware', ({ describe }) => {

    describe('decision validation', ({ it }) => {
        it('rejects a missing or empty decision list', () => {
            const missing = catchError(() => authorize());
            const empty = catchError(() => authorize([]));

            assertEqual('AssertionError', missing.name);
            assertMatches(/decisions must be a non-empty array/, missing.message);

            // An empty list would leave the route unguarded rather than gated.
            assertEqual('AssertionError', empty.name);
            assertMatches(/decisions must be a non-empty array/, empty.message);
        });

        it('rejects a malformed decision and names its index', () => {
            const notAnObject = catchError(() => authorize([ 'urn:kixx:read' ]));
            const noAction = catchError(() => authorize([ READ_ARTICLES, { resource: 'urn:kixx:publishing:*' } ]));
            const emptyResource = catchError(() => authorize([ { action: 'urn:kixx:read', resource: '' } ]));

            assertEqual('AssertionError', notAnObject.name);
            assertMatches(/decisions\[0\] must be a plain object/, notAnObject.message);

            assertEqual('AssertionError', noAction.name);
            assertMatches(/decisions\[1\]\.action/, noAction.message);

            assertEqual('AssertionError', emptyResource.name);
            assertMatches(/decisions\[0\]\.resource/, emptyResource.message);
        });

        it('rejects malformed error overrides', () => {
            const badOptions = catchError(() => authorize([ READ_ARTICLES ], 'Forbidden'));
            const badMessage = catchError(() => authorize([ READ_ARTICLES ], { message: '' }));
            const badCode = catchError(() => authorize([ READ_ARTICLES ], { code: 42 }));

            assertEqual('AssertionError', badOptions.name);
            assertMatches(/options must be a plain object/, badOptions.message);

            assertEqual('AssertionError', badMessage.name);
            assertMatches(/options\.message/, badMessage.message);

            assertEqual('AssertionError', badCode.name);
            assertMatches(/options\.code/, badCode.message);
        });

        it('accepts a valid gate without error overrides', () => {
            const middleware = authorize([ READ_ARTICLES ]);

            assertEqual('function', typeof middleware);
            assertEqual('authorizeMiddleware', middleware.name);
        });
    });

    describe('enforcement', ({ it }) => {
        it('returns the response it was given when every decision passes', () => {
            const middleware = authorize([ READ_ARTICLES, WRITE_ARTICLES ]);
            const context = makeContext([ {
                action: [ 'urn:kixx:read', 'urn:kixx:write' ],
                resource: 'urn:kixx:publishing:*',
            } ]);
            const response = { name: 'response' };

            assertEqual(response, middleware(context, {}, response));
        });

        it('throws ForbiddenError when the only decision is denied', () => {
            const middleware = authorize([ READ_ARTICLES ]);
            const context = makeContext([ WRITE_ARTICLES ]);

            const error = catchError(() => middleware(context, {}, {}));

            assert(error, 'expected the gate to throw');
            assertEqual('ForbiddenError', error.name);
            assertEqual('FORBIDDEN_ERROR', error.code);
            assertEqual(403, error.httpStatusCode);
            assertEqual('You are not authorized to perform this request.', error.message);
        });

        it('requires every decision, not just one', () => {
            const middleware = authorize([ READ_ARTICLES, WRITE_ARTICLES ]);
            const context = makeContext([ READ_ARTICLES ]);

            const error = catchError(() => middleware(context, {}, {}));

            assert(error, 'expected the gate to throw');
            assertEqual('ForbiddenError', error.name);
        });

        it('applies error overrides to every decision', () => {
            const middleware = authorize([ READ_ARTICLES, WRITE_ARTICLES ], {
                message: 'Article access is restricted.',
                code: 'ARTICLE_FORBIDDEN',
            });

            // Denied on the second decision, so the override must not be
            // attached to the first decision alone.
            const error = catchError(() => middleware(makeContext([ READ_ARTICLES ]), {}, {}));

            assert(error, 'expected the gate to throw');
            assertEqual('Article access is restricted.', error.message);
            assertEqual('ARTICLE_FORBIDDEN', error.code);
        });

        it('reads the principal at request time', () => {
            const middleware = authorize([ READ_ARTICLES ]);
            const context = makeContext([]);
            const response = { name: 'response' };

            assert(catchError(() => middleware(context, {}, response)), 'expected the gate to throw');

            context.user = { permissions: [ { action: '*', resource: '*' } ] };

            assertEqual(response, middleware(context, {}, response));
        });

        it('crashes rather than denying when no principal is authenticated', () => {
            const middleware = authorize([ READ_ARTICLES ]);

            // Reaching a gate with no user means the route was wired without
            // authentication middleware. That is a bug, not a 403.
            const error = catchError(() => middleware(makeContext(null), {}, {}));

            assert(error, 'expected the gate to throw');
            assertEqual('AssertionError', error.name);
            assertMatches(/user must be a plain object/, error.message);
        });

        it('ignores mutation of the caller decision list after construction', () => {
            const decisions = [ READ_ARTICLES ];
            const middleware = authorize(decisions);

            decisions.push(WRITE_ARTICLES);
            decisions[ 0 ] = WRITE_ARTICLES;

            const response = { name: 'response' };

            assertEqual(response, middleware(makeContext([ READ_ARTICLES ]), {}, response));
        });
    });
});
