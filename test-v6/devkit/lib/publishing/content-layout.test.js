import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from '../../../lib/vendor/kixx-assert/mod.js';
import {
    RESERVED_PAGE_FILENAMES,
    isValidPathname,
    isValidTemplateFilepath,
    normalizePathname,
} from '../../../lib/publishing/content-layout.js';


describe('publishing/content-layout', ({ it }) => {
    it('accepts canonical pathnames including root and empty values', () => {
        for (const pathname of [ '', '/', '/pages/about', 'stylesheets/site.css', 'posts/2026-08-31' ]) {
            assert(isValidPathname(pathname), `expected ${ pathname } to be valid`);
        }
    });

    it('rejects unsafe or non-canonical pathnames', () => {
        const invalidPathnames = [
            '/About',
            '/about/../admin',
            '/about//team',
            '/about/.draft',
            '.hidden',
            '/about/team member',
            '/about/team@example',
            '/about?preview=true',
            42,
            null,
        ];

        for (const pathname of invalidPathnames) {
            assertFalsy(isValidPathname(pathname), `expected ${ pathname } to be invalid`);
        }
    });

    it('normalizes slashes and case', () => {
        assertEqual('/about/team', normalizePathname('//About///Team/'));
        assertEqual('/', normalizePathname(''));
    });

    it('rejects non-string values during normalization', () => {
        const caught = catchError(() => normalizePathname(null));

        assertEqual('TypeError', caught.name);
    });

    it('accepts non-reserved template files', () => {
        assert(isValidTemplateFilepath('about/page.html'));
        assert(isValidTemplateFilepath('/index.html'));
    });

    it('rejects root and reserved template filenames', () => {
        assertFalsy(isValidTemplateFilepath('/'));
        assertFalsy(isValidTemplateFilepath(''));

        for (const filename of RESERVED_PAGE_FILENAMES) {
            assertFalsy(isValidTemplateFilepath(`about/${ filename }`));
        }
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
