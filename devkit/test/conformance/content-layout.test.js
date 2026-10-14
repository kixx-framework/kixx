import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import * as devkit from '../../lib/publishing/content-layout.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit
// applies exactly the pathname rules the server applies.
import * as lib from '../../../lib/kixx/content-addressable-store/content-layout.js';


const PATHNAMES = [
    '',
    '/',
    'about',
    '/about',
    '/about/',
    'blog/2026/post',
    'Blog/post',
    'blog//post',
    'blog/../post',
    'blog/.hidden',
    '.well-known/x',
    'a b',
    'a_b-c.d',
    'café',
    'page.json',
    'blog/page.json',
    'blog/__page-partials-bundle',
    'blog/__page-includes-bundle',
    'blog/__base-templates-bundle',
    'blog/index.html',
    '//double',
];


describe('conformance: publishing content layout matches lib', ({ it }) => {

    it('has the same reserved page filenames', () => {
        assertEqual(
            [ ...lib.RESERVED_PAGE_FILENAMES ].sort().join(','),
            [ ...devkit.RESERVED_PAGE_FILENAMES ].sort().join(','),
        );
    });

    it('agrees on isValidPathname', () => {
        for (const pathname of PATHNAMES) {
            assertEqual(lib.isValidPathname(pathname), devkit.isValidPathname(pathname), pathname);
        }
        assertEqual(lib.isValidPathname(null), devkit.isValidPathname(null));
    });

    it('agrees on normalizePathname', () => {
        for (const pathname of PATHNAMES) {
            assertEqual(lib.normalizePathname(pathname), devkit.normalizePathname(pathname), pathname);
        }
    });

    it('agrees on isValidTemplateFilepath', () => {
        for (const pathname of PATHNAMES) {
            assertEqual(lib.isValidTemplateFilepath(pathname), devkit.isValidTemplateFilepath(pathname), pathname);
        }
    });
});
