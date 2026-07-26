import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import validatePathname from '../../../src/kixx/utils/validate-pathname.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('validatePathname', ({ describe }) => {

    describe('valid pathnames', ({ it }) => {
        it('returns a simple relative pathname unchanged', () => {
            assertEqual('pages/about.html', validatePathname('pages/about.html'));
        });

        it('returns a leading-slash pathname unchanged', () => {
            assertEqual('/blog/hello-world', validatePathname('/blog/hello-world'));
        });

        it('accepts the allowed character set (letters, digits, _, ., -)', () => {
            const pathname = '/Assets/file_name-v2.0.min.js';
            assertEqual(pathname, validatePathname(pathname));
        });

        it('accepts an interior dot within a segment', () => {
            assertEqual('docs/report.final.pdf', validatePathname('docs/report.final.pdf'));
        });

        it('accepts the root pathname', () => {
            assertEqual('/', validatePathname('/'));
        });

        it('accepts an empty string', () => {
            assertEqual('', validatePathname(''));
        });
    });

    describe('path traversal', ({ it }) => {
        it('rejects a pathname containing ".."', () => {
            const error = catchError(() => validatePathname('/pages/../secrets'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
            assertEqual('BAD_REQUEST_ERROR', error.code);
            assertMatches('Invalid pathname: /pages/../secrets', error.message);
        });

        it('rejects ".." even when not a standalone segment', () => {
            const error = catchError(() => validatePathname('/pages/a..b'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
        });

        it('rejects a pathname containing "//"', () => {
            const error = catchError(() => validatePathname('/pages//about'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
            assertMatches('Invalid pathname: /pages//about', error.message);
        });
    });

    describe('leading-dot segments', ({ it }) => {
        it('rejects a dotfile segment', () => {
            const error = catchError(() => validatePathname('/pages/.env'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
        });

        it('rejects a single-dot segment', () => {
            const error = catchError(() => validatePathname('/pages/./about'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
        });
    });

    describe('disallowed characters', ({ it }) => {
        it('rejects whitespace in a segment', () => {
            const error = catchError(() => validatePathname('/pages/my file.html'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
        });

        it('rejects URL query and fragment metacharacters', () => {
            assert(catchError(() => validatePathname('/pages/about?x=1')), 'expected ? to be rejected');
            assert(catchError(() => validatePathname('/pages/about#top')), 'expected # to be rejected');
        });

        it('rejects shell metacharacters', () => {
            assert(catchError(() => validatePathname('/pages/$(whoami)')), 'expected $() to be rejected');
            assert(catchError(() => validatePathname('/pages/a;b')), 'expected ; to be rejected');
        });

        it('rejects percent-encoded sequences', () => {
            const error = catchError(() => validatePathname('/pages/%2e%2e'));

            assert(error, 'expected an error to be thrown');
            assertEqual('BadRequestError', error.name);
        });
    });
});
