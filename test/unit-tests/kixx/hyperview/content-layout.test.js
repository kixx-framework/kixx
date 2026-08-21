import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    BASE_TEMPLATES_BUNDLE,
    TEMPLATE_PARTIALS_BUNDLE,
    PAGE_PARTIALS_BUNDLE,
    PAGE_INCLUDES_BUNDLE,
    RESERVED_PAGE_FILENAMES,
    isValidPathname,
    isValidTemplateFilepath,
    normalizePathname,
    getBaseTemplatesPath,
    getTemplatePartialsPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageIncludesPath,
    getPageTemplatePath,
} from '../../../../src/kixx/hyperview/content-layout.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('content-layout', ({ describe }) => {

    describe('RESERVED_PAGE_FILENAMES', ({ it }) => {
        it('reserves page.json and both bundle filenames', () => {
            assert(RESERVED_PAGE_FILENAMES.has('page.json'));
            assert(RESERVED_PAGE_FILENAMES.has(PAGE_PARTIALS_BUNDLE));
            assert(RESERVED_PAGE_FILENAMES.has(PAGE_INCLUDES_BUNDLE));
        });
    });

    describe('isValidPathname()', ({ it }) => {
        it('accepts a lowercase, slash-separated pathname', () => {
            assert(isValidPathname('/a/b/c-2.txt'));
        });

        it('accepts the root pathname "/"', () => {
            assert(isValidPathname('/'));
        });

        it('accepts the empty string', () => {
            // HyperviewService#assertCanonicalIdentifier() relies on this: it
            // checks for content separately with isNonEmptyString() before
            // calling isValidPathname().
            assert(isValidPathname(''));
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

    describe('isValidTemplateFilepath()', ({ it }) => {
        it('accepts a canonical, non-root filepath', () => {
            assert(isValidTemplateFilepath('blog/index.html'));
            assert(isValidTemplateFilepath('/blog/index.html'));
        });

        it('rejects the root pathname "/"', () => {
            assertEqual(false, isValidTemplateFilepath('/'));
        });

        it('rejects the empty string', () => {
            // Unlike isValidPathname(), this rule must reject the empty
            // string outright: a template filepath must name a real file.
            assertEqual(false, isValidTemplateFilepath(''));
        });

        it('rejects a pathname that fails the canonical pathname rule', () => {
            assertEqual(false, isValidTemplateFilepath('/A/b.html'));
            assertEqual(false, isValidTemplateFilepath('/a/../b.html'));
        });

        it('rejects non-string values', () => {
            assertEqual(false, isValidTemplateFilepath(123));
            assertEqual(false, isValidTemplateFilepath(null));
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

        it('folds the empty string to the root pathname', () => {
            assertEqual('/', normalizePathname(''));
        });

        it('throws TypeError when the value is not a string', () => {
            const caught = catchError(() => normalizePathname(123));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('An identifier must be a string', caught.message);
        });
    });

    describe('getBaseTemplatesPath()', ({ it }) => {
        it('constructs the base-templates bundle path', () => {
            assertEqual(`/templates/${ BASE_TEMPLATES_BUNDLE }`, getBaseTemplatesPath());
        });
    });

    describe('getTemplatePartialsPath()', ({ it }) => {
        it('constructs the template-partials bundle path', () => {
            assertEqual(`/templates/${ TEMPLATE_PARTIALS_BUNDLE }`, getTemplatePartialsPath());
        });
    });

    describe('getPageMetadataPath()', ({ it }) => {
        it('constructs the root page metadata path', () => {
            assertEqual('/pages/page.json', getPageMetadataPath('/'));
        });

        it('constructs a nested page metadata path', () => {
            assertEqual('/pages/blog/led-zeppelin/page.json', getPageMetadataPath('/blog/led-zeppelin'));
        });

        it('throws an AssertionError for an invalid page pathname', () => {
            const caught = catchError(() => getPageMetadataPath('/Bad Path'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getPagePartialsPath()', ({ it }) => {
        it('constructs the page partials bundle path', () => {
            assertEqual(
                `/pages/blog/led-zeppelin/${ PAGE_PARTIALS_BUNDLE }`,
                getPagePartialsPath('/blog/led-zeppelin'),
            );
        });

        it('throws an AssertionError for an invalid page pathname', () => {
            const caught = catchError(() => getPagePartialsPath('/Bad Path'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getPageIncludesPath()', ({ it }) => {
        it('constructs the page includes bundle path', () => {
            assertEqual(
                `/pages/blog/led-zeppelin/${ PAGE_INCLUDES_BUNDLE }`,
                getPageIncludesPath('/blog/led-zeppelin'),
            );
        });

        it('throws an AssertionError for an invalid page pathname', () => {
            const caught = catchError(() => getPageIncludesPath('/Bad Path'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getPageTemplatePath()', ({ it }) => {
        it('constructs a page template path', () => {
            assertEqual('/pages/blog/led-zeppelin/index.html', getPageTemplatePath('blog/led-zeppelin/index.html'));
        });

        it('throws an AssertionError for the root pathname "/"', () => {
            const caught = catchError(() => getPageTemplatePath('/'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for an invalid filepath', () => {
            const caught = catchError(() => getPageTemplatePath('Bad Path'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
