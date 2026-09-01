import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import {
    validateReleaseManifest,
    validateStructuredContent,
} from '../../../../src/kixx/content-addressable-store/release-manifest.js';

const OBJECT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const OBJECT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
const OBJECT_C = 'cccccccccccccccccccccccccc';

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function reference(objectId = OBJECT_A, size = 1) {
    return { objectId, size };
}

describe('ReleaseManifest', ({ describe, it }) => {
    it('converts every manifest facet to flat index source files', () => {
        const files = validateReleaseManifest({
            staticAssets: {
                '/app.css': { objectId: OBJECT_A, size: 0, mediaType: 'text/css' },
            },
            globalTemplatePartials: reference(OBJECT_B, 2),
            baseTemplates: reference(OBJECT_C, 3),
            pages: {
                '/blog/post': {
                    metadata: reference(OBJECT_A, 4),
                    partials: reference(OBJECT_B, 5),
                    includes: reference(OBJECT_C, 6),
                    templates: {
                        'page.html': reference(OBJECT_A, 7),
                        'card.html': reference(OBJECT_B, 8),
                    },
                },
            },
            emails: {
                '/welcome': reference(OBJECT_C, 9),
            },
        });
        const byPathname = new Map(files.map((file) => [ file.pathname, file ]));

        assertEqual(9, files.length);
        assertEqual(0, byPathname.get('/assets/app.css').size);
        assertEqual('text/css', byPathname.get('/assets/app.css').metadata.mediaType);
        assertEqual(OBJECT_B, byPathname.get('/templates/__template-partials-bundle').hash);
        assertEqual(OBJECT_C, byPathname.get('/templates/__base-templates-bundle').hash);
        assertEqual(OBJECT_A, byPathname.get('/pages/blog/post/page.json').hash);
        assertEqual(OBJECT_B, byPathname.get('/pages/blog/post/__page-partials-bundle').hash);
        assertEqual(OBJECT_C, byPathname.get('/pages/blog/post/__page-includes-bundle').hash);
        assertEqual(OBJECT_A, byPathname.get('/pages/blog/post/page.html').hash);
        assertEqual(OBJECT_B, byPathname.get('/pages/blog/post/card.html').hash);
        assertEqual(OBJECT_C, byPathname.get('/emails/welcome/__email-assets').hash);
    });

    it('omits metadata when a static asset does not declare a media type', () => {
        const [ file ] = validateReleaseManifest({
            staticAssets: { '/empty.css': reference(OBJECT_A, 0) },
        });

        assertUndefined(file.metadata);
    });

    it('rejects non-canonical paths instead of normalizing them', () => {
        const caught = catchError(() => validateReleaseManifest({
            staticAssets: { '/Logo.PNG': reference() },
            pages: { 'about': {} },
            emails: { '/welcome/': reference() },
        }));

        assert(caught, 'expected validation to fail');
        assertEqual('VALIDATION_ERROR', caught.code);
        assertEqual('/staticAssets/~1Logo.PNG,/pages/about,/emails/~1welcome~1', caught.errors.map(({ source }) => source).join(','));
    });

    it('collects malformed containers, references, and unknown fields', () => {
        const caught = catchError(() => validateReleaseManifest({
            unexpected: true,
            staticAssets: [],
            globalTemplatePartials: { objectId: 'bad', size: -1, typo: true },
            baseTemplates: null,
            pages: {
                '/about': {
                    metadata: 'bad',
                    templates: [],
                    typo: true,
                },
            },
            emails: 'bad',
        }));

        assert(caught, 'expected validation to fail');
        assertEqual('VALIDATION_ERROR', caught.code);
        assertEqual(10, caught.errors.length);
    });

    it('rejects reserved and nested page template filenames', () => {
        const caught = catchError(() => validateReleaseManifest({
            pages: {
                '/about': {
                    templates: {
                        'page.json': reference(),
                        'nested/page.html': reference(),
                        '__page-includes-bundle': reference(),
                    },
                },
            },
        }));

        assert(caught, 'expected validation to fail');
        assertEqual(3, caught.errors.length);
    });

    it('reports file and directory collisions as validation failures', () => {
        const caught = catchError(() => validateReleaseManifest({
            staticAssets: {
                '/docs': reference(OBJECT_A),
                '/docs/index.html': reference(OBJECT_B),
            },
        }));

        assert(caught, 'expected validation to fail');
        assertEqual(1, caught.errors.length);
        assertEqual('/staticAssets/~1docs~1index.html', caught.errors[0].source);
    });

    it('turns hostile manifest values into ValidationError entries', () => {
        const cyclic = {};
        cyclic.self = cyclic;
        const values = [ null, [], 'manifest', 1, cyclic ];

        for (const value of values) {
            const caught = catchError(() => validateReleaseManifest(value));
            assert(caught, 'expected validation to fail');
            assertEqual('ValidationError', caught.name);
        }
    });

    describe('validateStructuredContent()', ({ it }) => {
        it('accepts each structured content schema', () => {
            validateStructuredContent('globalTemplatePartials', [ { id: 'header', source: '<header>' } ]);
            validateStructuredContent('baseTemplates', [ { id: 'main', source: '<main>' } ]);
            validateStructuredContent('pageMetadata', { title: 'About', flags: [ true, null ] });
            validateStructuredContent('pagePartials', [ { id: 'card', source: '<article>' } ]);
            validateStructuredContent('pageIncludes', { intro: 'Hello' });
            validateStructuredContent('email', {
                htmlTemplate: { id: 'welcome-html', source: '<h1>Hello</h1>' },
                textTemplate: { id: 'welcome-text', source: 'Hello' },
                partials: [ { id: 'signature', source: 'Regards' } ],
                includes: { legal: 'Terms' },
                contextData: { recipient: 'Kris' },
            });
        });

        it('reports every malformed template entry and duplicate id', () => {
            const caught = catchError(() => validateStructuredContent('pagePartials', [
                { id: 'card', source: 'one', typo: true },
                { id: 'card', source: '' },
                null,
            ]));

            assert(caught, 'expected validation to fail');
            assertEqual(4, caught.errors.length);
        });

        it('rejects unknown email fields and an empty email bundle', () => {
            const caught = catchError(() => validateStructuredContent('email', { typo: true }));

            assert(caught, 'expected validation to fail');
            assertEqual(2, caught.errors.length);
        });

        it('rejects non-string includes and non-JSON page metadata in bulk', () => {
            const includesError = catchError(() => validateStructuredContent('pageIncludes', {
                first: 1,
                second: null,
            }));
            const metadataError = catchError(() => validateStructuredContent('pageMetadata', {
                missing: undefined,
                infinite: Infinity,
                date: new Date(),
            }));

            assertEqual(2, includesError.errors.length);
            assertEqual(3, metadataError.errors.length);
        });
    });
});
