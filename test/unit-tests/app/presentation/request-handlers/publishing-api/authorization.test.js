import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    requireAssetPermission,
    requireIncludePermission,
    requirePageMetadataPermission,
    requireTemplatePermission,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/authorization.js';


const FORBIDDEN_CODE = 'PublishingApiTokenForbidden';
const FORBIDDEN_MESSAGE = 'The publishing API token is not authorized for this request.';


describe('publishing API authorization middleware', ({ describe }) => {

    describe('requireTemplatePermission()', ({ it }) => {

        it('returns the response when the token grants the template capability', () => {
            const response = {};
            const context = makeContext([ allow(
                'urn:kixx:publishing:template:put',
                'urn:kixx:publishing:template',
            ) ]);

            assertEqual(response, requireTemplatePermission(context, makeRequest({}), response));
        });

        it('is not scoped by filepath', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:template:put',
                'urn:kixx:publishing:template',
            ) ]);
            const request = makeRequest({ filepath: [ 'base', 'website.html' ] });

            assertEqual('ok', requireTemplatePermission(context, request, 'ok'));
        });

        it('throws the publishing API forbidden error when the capability is absent', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:asset:put',
                'urn:kixx:publishing:asset',
            ) ]);
            const caught = catchError(() => {
                return requireTemplatePermission(context, makeRequest({}), {});
            });

            assertForbidden(caught);
        });

        it('throws when the principal has no permissions at all', () => {
            const caught = catchError(() => {
                return requireTemplatePermission({ user: null }, makeRequest({}), {});
            });

            assertForbidden(caught);
        });
    });

    describe('requirePageMetadataPermission()', ({ it }) => {

        it('authorizes the exact pathname URN the handler will write', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:/blog/hello',
            ) ]);
            const request = makeRequest({ pathname: [ 'blog', 'hello' ] });

            assertEqual('ok', requirePageMetadataPermission(context, request, 'ok'));
        });

        it('resolves the URN from the case-folded pathname', () => {
            // A grant naming the canonical (lower case) URN must match a request
            // that used upper case, because both write the same stored page.
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:/blog/hello',
            ) ]);
            const request = makeRequest({ pathname: [ 'Blog', 'Hello' ] });

            assertEqual('ok', requirePageMetadataPermission(context, request, 'ok'));
        });

        it('authorizes the root page as the "/" scope', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:/',
            ) ]);

            assertEqual('ok', requirePageMetadataPermission(context, makeRequest({}), 'ok'));
        });

        it('denies a pathname outside a narrowly scoped grant', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:/blog/hello',
            ) ]);
            const request = makeRequest({ pathname: [ 'blog', 'other' ] });
            const caught = catchError(() => {
                return requirePageMetadataPermission(context, request, {});
            });

            assertForbidden(caught);
        });

        it('honors a wildcard-scoped grant for any pathname', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:*',
            ) ]);
            const request = makeRequest({ pathname: [ 'anything', 'goes' ] });

            assertEqual('ok', requirePageMetadataPermission(context, request, 'ok'));
        });

        it('lets a resolver error propagate as a client error rather than a 403', () => {
            // A malformed pathname is bad input, not a permission failure, so the
            // 400 must survive instead of being reframed as a forbidden response.
            const context = makeContext([ allow(
                'urn:kixx:publishing:page-metadata:put',
                'urn:kixx:publishing:page-metadata:*',
            ) ]);
            const request = makeRequest({ pathname: [ 'blog', '..' ] });
            const caught = catchError(() => {
                return requirePageMetadataPermission(context, request, {});
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
        });

        it('resolves the URN before the permission check, so bad input beats a denied token', () => {
            const request = makeRequest({ pathname: [ 'blog', '..' ] });
            const caught = catchError(() => {
                return requirePageMetadataPermission(makeContext([]), request, {});
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
        });
    });

    describe('requireIncludePermission()', ({ it }) => {

        it('authorizes the exact filepath URN the handler will write', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:include:put',
                'urn:kixx:publishing:include:blog/hello/body.md',
            ) ]);
            const request = makeRequest({ filepath: [ 'blog', 'hello', 'body.md' ] });

            assertEqual('ok', requireIncludePermission(context, request, 'ok'));
        });

        it('resolves the URN with folded directories and a verbatim filename', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:include:put',
                'urn:kixx:publishing:include:blog/MainBody.md',
            ) ]);
            const request = makeRequest({ filepath: [ 'Blog', 'MainBody.md' ] });

            assertEqual('ok', requireIncludePermission(context, request, 'ok'));
        });

        it('denies a filepath outside a narrowly scoped grant', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:include:put',
                'urn:kixx:publishing:include:blog/hello/body.md',
            ) ]);
            const request = makeRequest({ filepath: [ 'blog', 'hello', 'other.md' ] });
            const caught = catchError(() => {
                return requireIncludePermission(context, request, {});
            });

            assertForbidden(caught);
        });

        it('lets a missing filepath propagate as a client error rather than a 403', () => {
            const caught = catchError(() => {
                return requireIncludePermission(makeContext([]), makeRequest({}), {});
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('IncludeFilepathRequired', caught.code);
        });
    });

    describe('requireAssetPermission()', ({ it }) => {

        it('returns the response when the token grants the asset capability', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:asset:put',
                'urn:kixx:publishing:asset',
            ) ]);
            const request = makeRequest({ filepath: [ 'images', 'logo.png' ] });

            assertEqual('ok', requireAssetPermission(context, request, 'ok'));
        });

        it('throws the publishing API forbidden error when the capability is absent', () => {
            const context = makeContext([ allow(
                'urn:kixx:publishing:template:put',
                'urn:kixx:publishing:template',
            ) ]);
            const caught = catchError(() => {
                return requireAssetPermission(context, makeRequest({}), {});
            });

            assertForbidden(caught);
        });

        it('is denied by a deny grant which overrides a matching allow grant', () => {
            const context = makeContext([
                allow('urn:kixx:publishing:asset:put', 'urn:kixx:publishing:asset'),
                { effect: 'deny', action: '*', resource: 'urn:kixx:publishing:asset' },
            ]);
            const caught = catchError(() => {
                return requireAssetPermission(context, makeRequest({}), {});
            });

            assertForbidden(caught);
        });
    });
});

function assertForbidden(caught) {
    assert(caught, 'expected a forbidden error to be thrown');
    assertEqual('ForbiddenError', caught.name);
    assertEqual(403, caught.httpStatusCode);
    assertEqual(FORBIDDEN_CODE, caught.code);
    assertMatches(FORBIDDEN_MESSAGE, caught.message);
}

function allow(action, resource) {
    return { effect: 'allow', action, resource };
}

function makeContext(permissions) {
    return { user: { id: 'token-1', permissions } };
}

function makeRequest(pathnameParams) {
    return { pathnameParams };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
