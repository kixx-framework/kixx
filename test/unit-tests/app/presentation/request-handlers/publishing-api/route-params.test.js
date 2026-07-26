import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    getWildcardPathname,
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

        it('folds directory segments to lower case', () => {
            const request = makeRequest({ filepath: [ 'Blog', 'Hello', 'body.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('blog/hello/body.md', result.filepath);
            assertEqual('/blog/hello', result.pathname);
        });

        it('preserves the filename case, because reads resolve it verbatim from page metadata', () => {
            const request = makeRequest({ filepath: [ 'Blog', 'MainBody.md' ] });
            const result = splitIncludeFilepath(request, 'filepath');

            assertEqual('MainBody.md', result.filename);
            assertEqual('blog/MainBody.md', result.filepath);
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
