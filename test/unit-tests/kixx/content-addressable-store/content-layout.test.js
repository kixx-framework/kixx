import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    getEmailBundlePath,
    isValidPathname,
    isValidTemplateFilepath,
    normalizePathname,
} from '../../../../src/kixx/content-addressable-store/content-layout.js';

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('content-layout', ({ describe }) => {

    describe('isValidPathname()', ({ it }) => {
        it('accepts a lowercase, slash-separated pathname', () => {
            assert(isValidPathname('/a/b/c-2.txt'));
        });

        it('accepts a pathname without a leading slash', () => {
            assert(isValidPathname('a/b'));
        });

        it('rejects non-string values', () => {
            assertEqual(false, isValidPathname(123));
            assertEqual(false, isValidPathname(null));
            assertEqual(false, isValidPathname(undefined));
        });

        it('rejects a pathname containing ".."', () => {
            assertEqual(false, isValidPathname('/a/../b'));
        });

        it('rejects a pathname containing doubled slashes', () => {
            assertEqual(false, isValidPathname('/a//b'));
        });

        it('rejects a pathname with uppercase characters', () => {
            assertEqual(false, isValidPathname('/A/b'));
        });

        it('rejects a segment starting with a dot', () => {
            assertEqual(false, isValidPathname('/.a/b'));
            assertEqual(false, isValidPathname('/a/.b'));
        });

        it('rejects characters outside the filename-safe set', () => {
            assertEqual(false, isValidPathname('/a b/c'));
            assertEqual(false, isValidPathname('/a!/c'));
        });
    });

    describe('normalizePathname()', ({ it }) => {
        it('lower-cases the pathname', () => {
            assertEqual('/a/b', normalizePathname('/A/B'));
        });

        it('adds a leading slash when one is missing', () => {
            assertEqual('/a/b', normalizePathname('a/b'));
        });

        it('collapses consecutive slashes', () => {
            assertEqual('/a/b', normalizePathname('//a///b//'));
        });

        it('removes a trailing slash', () => {
            assertEqual('/a/b', normalizePathname('/a/b/'));
        });

        it('throws TypeError when the value is not a string', () => {
            const caught = catchError(() => normalizePathname(123));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('An identifier must be a string', caught.message);
        });
    });

    describe('isValidTemplateFilepath()', ({ it }) => {
        it('accepts an ordinary template filepath', () => {
            assert(isValidTemplateFilepath('/blog/post/page.html'));
        });

        it('rejects the namespace root', () => {
            assertEqual(false, isValidTemplateFilepath('/'));
        });

        it('rejects a filepath naming a reserved page filename', () => {
            assertEqual(false, isValidTemplateFilepath('/blog/post/page.json'));
            assertEqual(false, isValidTemplateFilepath('/blog/post/__page-partials-bundle'));
            assertEqual(false, isValidTemplateFilepath('/blog/post/__page-includes-bundle'));
        });
    });

    describe('getEmailBundlePath()', ({ it }) => {
        it('produces distinct storage pathnames for distinct email pathnames', () => {
            const welcome = getEmailBundlePath('/welcome');
            const passwordReset = getEmailBundlePath('/password-reset');

            assert(welcome !== passwordReset, 'expected distinct storage pathnames');
        });

        it('nests the bundle beneath the email pathname', () => {
            assertEqual('/emails/welcome/__email-assets', getEmailBundlePath('/welcome'));
        });

        it('throws AssertionError when the pathname is not valid', () => {
            const caught = catchError(() => getEmailBundlePath('/A/b'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
