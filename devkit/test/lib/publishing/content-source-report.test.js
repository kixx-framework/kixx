import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
} from '../../../lib/vendor/kixx-assert/mod.js';

import {
    assertPublishableContentSources,
    formatUnmatchedFiles,
} from '../../../lib/publishing/content-source-report.js';


describe('publishing/content-source-report', ({ it }) => {
    it('throws one UsageError listing every source problem', () => {
        const result = {
            problems: [
                {
                    filepath: 'pages/about/page.json',
                    message: 'Page template references missing file "pages/about/page.html"',
                },
                {
                    filepath: 'static-assets/Bad Name.css',
                    message: 'Filepath cannot be represented by a canonical content pathname',
                },
            ],
            unmatchedFiles: [],
        };

        const caught = catchError(() => assertPublishableContentSources(result));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assertMatches(
            '- pages/about/page.json: Page template references missing file "pages/about/page.html"',
            caught.message,
        );
        assertMatches(
            '- static-assets/Bad Name.css: Filepath cannot be represented by a canonical content pathname',
            caught.message,
        );
    });

    it('states that validation failures publish nothing', () => {
        const caught = catchError(() => assertPublishableContentSources({
            problems: [
                { filepath: 'emails/welcome/email.json', message: 'email.json contains malformed JSON' },
            ],
            unmatchedFiles: [],
        }));

        assert(caught, 'expected an error to be thrown');
        assertMatches('Nothing was published.', caught.message);
    });

    it('includes unmatched files as a separate informational section', () => {
        const caught = catchError(() => assertPublishableContentSources({
            problems: [
                { filepath: 'pages/page.json', message: 'page.json contains malformed JSON' },
            ],
            unmatchedFiles: [
                'pages/notes.txt',
                'templates/README.md',
            ],
        }));

        assert(caught, 'expected an error to be thrown');
        assertMatches(
            'Files not matched by a publishing convention:\n- pages/notes.txt\n- templates/README.md',
            caught.message,
        );
    });

    it('formats unmatched files without raising for valid sources', () => {
        const result = {
            problems: [],
            unmatchedFiles: [ 'templates/README.md' ],
        };

        assertPublishableContentSources(result);

        assertEqual(
            'Files not matched by a publishing convention:\n- templates/README.md',
            formatUnmatchedFiles(result.unmatchedFiles),
        );
        assertEqual('', formatUnmatchedFiles([]));
    });

    it('reports only project-relative paths supplied by the scanner', () => {
        const caught = catchError(() => assertPublishableContentSources({
            problems: [
                { filepath: 'public/Bad Name.txt', message: 'Invalid pathname' },
            ],
            unmatchedFiles: [ 'templates/README.md' ],
        }));

        assert(caught, 'expected an error to be thrown');
        assertMatches('public/Bad Name.txt', caught.message);
        assertMatches('templates/README.md', caught.message);
        assertNotMatches('/Users/', caught.message);
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
