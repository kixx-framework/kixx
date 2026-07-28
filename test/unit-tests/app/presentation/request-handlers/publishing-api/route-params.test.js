import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    getWildcardFilepath,
    getWildcardPathname,
    getWildcardTemplateFilepath,
    splitIncludeFilepath,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/route-params.js';


describe('publishing API route params', ({ describe }) => {

    describe('getWildcardPathname()', ({ it }) => {

        it('returns the root pathname when the wildcard param is absent', () => {
            assertEqual('/', getWildcardPathname(makeRequest({}), 'pathname'));
        });

        it('returns the root pathname when the wildcard param is an empty array', () => {
            assertEqual('/', getWildcardPathname(makeRequest({ pathname: [] }), 'pathname'));
        });

        it('joins wildcard segments into an absolute pathname', () => {
            const request = makeRequest({ pathname: [ 'blog', 'hello-world' ] });
            assertEqual('/blog/hello-world', getWildcardPathname(request, 'pathname'));
        });

        it('folds the pathname to lower case so writes land on the key reads use', () => {
            const request = makeRequest({ pathname: [ 'Blog', 'Hello-World' ] });
            assertEqual('/blog/hello-world', getWildcardPathname(request, 'pathname'));
        });

        it('reads the wildcard param under the given name', () => {
            const request = makeRequest({ other: [ 'a' ], pathname: [ 'b' ] });
            assertEqual('/a', getWildcardPathname(request, 'other'));
        });

        it('rejects an empty path segment as a client error', () => {
            const request = makeRequest({ pathname: [ 'blog', '', 'hello' ] });
            const caught = catchError(() => getWildcardPathname(request, 'pathname'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('EmptyPathSegment', caught.code);
            assertMatches('Page pathname', caught.message);
        });

        it('rejects a trailing slash, which arrives as a trailing empty segment', () => {
            const request = makeRequest({ pathname: [ 'blog', 'hello', '' ] });
            const caught = catchError(() => getWildcardPathname(request, 'pathname'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('EmptyPathSegment', caught.code);
        });

        it('rejects path traversal segments', () => {
            const request = makeRequest({ pathname: [ 'blog', '..', 'etc' ] });
            const caught = catchError(() => getWildcardPathname(request, 'pathname'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertMatches('Invalid pathname', caught.message);
        });

        it('rejects characters outside the path whitelist', () => {
            const request = makeRequest({ pathname: [ 'blog', 'hello world' ] });
            const caught = catchError(() => getWildcardPathname(request, 'pathname'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
        });

        it('echoes the segments as the client sent them in the error message', () => {
            const request = makeRequest({ pathname: [ 'Blog', 'Hello World' ] });
            const caught = catchError(() => getWildcardPathname(request, 'pathname'));

            assert(caught, 'expected an error to be thrown');
            assertMatches('/Blog/Hello World', caught.message);
        });
    });

    describe('getWildcardFilepath()', ({ it }) => {

        const OPTIONS = {
            label: 'Template filepath',
            requiredCode: 'TemplateFilepathRequired',
        };

        it('joins wildcard segments into a relative filepath', () => {
            const request = makeRequest({ filepath: [ 'base', 'website.html' ] });
            assertEqual('base/website.html', getWildcardFilepath(request, 'filepath', OPTIONS));
        });

        it('preserves the filepath case, which static asset reads resolve verbatim', () => {
            const request = makeRequest({ filepath: [ 'Images', 'Logo.png' ] });
            assertEqual('Images/Logo.png', getWildcardFilepath(request, 'filepath', OPTIONS));
        });

        it('reads the wildcard param under the given name', () => {
            const request = makeRequest({ other: [ 'a.html' ], filepath: [ 'b.html' ] });
            assertEqual('a.html', getWildcardFilepath(request, 'other', OPTIONS));
        });

        it('rejects a missing filepath param with the caller-supplied code', () => {
            const caught = catchError(() => getWildcardFilepath(makeRequest({}), 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('TemplateFilepathRequired', caught.code);
            assertMatches('Template filepath', caught.message);
        });

        it('rejects an empty filepath param', () => {
            const request = makeRequest({ filepath: [] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TemplateFilepathRequired', caught.code);
        });

        it('rejects a leading slash, which arrives as a leading empty segment', () => {
            const request = makeRequest({ filepath: [ '', 'logo.png' ] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('EmptyPathSegment', caught.code);
            assertMatches('Template filepath', caught.message);
        });

        it('rejects a trailing slash, which arrives as a trailing empty segment', () => {
            const request = makeRequest({ filepath: [ 'base', 'site.html', '' ] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('EmptyPathSegment', caught.code);
        });

        it('labels the empty segment error with the caller-supplied label', () => {
            const request = makeRequest({ filepath: [ '', 'logo.png' ] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', {
                label: 'Static asset filepath',
                requiredCode: 'StaticAssetFilepathRequired',
            }));

            assert(caught, 'expected an error to be thrown');
            assertMatches('Static asset filepath', caught.message);
        });

        it('rejects path traversal segments', () => {
            const request = makeRequest({ filepath: [ '..', 'site.html' ] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
        });

        it('rejects characters outside the path whitelist', () => {
            const request = makeRequest({ filepath: [ 'base', 'my site.html' ] });
            const caught = catchError(() => getWildcardFilepath(request, 'filepath', OPTIONS));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
        });
    });

    describe('getWildcardTemplateFilepath()', ({ it }) => {

        it('joins wildcard segments into a relative filepath', () => {
            const request = makeRequest({ filepath: [ 'blog', 'byline.html' ] });
            assertEqual('blog/byline.html', getWildcardTemplateFilepath(request, 'filepath'));
        });

        it('folds the filepath to the canonical key Hyperview requires', () => {
            const request = makeRequest({ filepath: [ 'Blog', 'MainPage.HTML' ] });
            assertEqual('blog/mainpage.html', getWildcardTemplateFilepath(request, 'filepath'));
        });

        it('reads the wildcard param under the given name', () => {
            const request = makeRequest({ other: [ 'A.html' ], filepath: [ 'b.html' ] });
            assertEqual('a.html', getWildcardTemplateFilepath(request, 'other'));
        });

        it('rejects a missing filepath param with the template code', () => {
            const caught = catchError(() => getWildcardTemplateFilepath(makeRequest({}), 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('TemplateFilepathRequired', caught.code);
            assertMatches('Template filepath', caught.message);
        });

        it('rejects an empty path segment before folding', () => {
            const request = makeRequest({ filepath: [ 'Base', 'Site.html', '' ] });
            const caught = catchError(() => getWildcardTemplateFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('EmptyPathSegment', caught.code);
        });

        // The error must echo the filepath as the client sent it. Folding first
        // would report a filepath the client never wrote.
        it('rejects invalid characters and reports the unfolded filepath', () => {
            const request = makeRequest({ filepath: [ 'Base', 'My Site.html' ] });
            const caught = catchError(() => getWildcardTemplateFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname: Base/My Site.html', caught.message);
        });
    });

    describe('splitIncludeFilepath()', ({ it }) => {

        it('splits a nested filepath into filepath, pathname, and filename', () => {
            const request = makeRequest({ filepath: [ 'blog', 'hello', 'body.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('blog/hello/body.md', result.filepath);
            assertEqual('/blog/hello', result.pathname);
            assertEqual('body.md', result.filename);
        });

        it('treats a single segment as a root page include', () => {
            const request = makeRequest({ filepath: [ 'body.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('body.md', result.filepath);
            assertEqual('/', result.pathname);
            assertEqual('body.md', result.filename);
        });

        it('folds every filepath segment to lower case', () => {
            const request = makeRequest({ filepath: [ 'Blog', 'Hello', 'Body.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('blog/hello/body.md', result.filepath);
            assertEqual('/blog/hello', result.pathname);
            assertEqual('body.md', result.filename);
        });

        it('returns a canonical filename for a mixed-case request', () => {
            const request = makeRequest({ filepath: [ 'Blog', 'MainBody.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('mainbody.md', result.filename);
            assertEqual('blog/mainbody.md', result.filepath);
        });

        it('rejects a missing filepath param', () => {
            const caught = catchError(() => splitIncludeFilepath(makeRequest({}), 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('IncludeFilepathRequired', caught.code);
        });

        it('rejects an empty filepath param', () => {
            const request = makeRequest({ filepath: [] });
            const caught = catchError(() => splitIncludeFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('IncludeFilepathRequired', caught.code);
        });

        it('rejects a trailing slash, which would leave an empty filename', () => {
            const request = makeRequest({ filepath: [ 'blog', 'body.md', '' ] });
            const caught = catchError(() => splitIncludeFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('EmptyPathSegment', caught.code);
            assertMatches('Include filepath', caught.message);
        });

        it('rejects path traversal segments', () => {
            const request = makeRequest({ filepath: [ '..', 'body.md' ] });
            const caught = catchError(() => splitIncludeFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
        });

        it('rejects characters outside the path whitelist', () => {
            const request = makeRequest({ filepath: [ 'blog', 'body file.md' ] });
            const caught = catchError(() => splitIncludeFilepath(request, 'filepath'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertMatches('Invalid pathname', caught.message);
        });
    });
});

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
