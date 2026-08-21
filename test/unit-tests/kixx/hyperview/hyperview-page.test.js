import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import HyperviewPage from '../../../../src/kixx/hyperview/hyperview-page.js';


// Stands in for a ContentAddressableStore ContentObject: .json() is a method
// that decodes the stored bytes, not a plain data property.
function makeContentObjectDouble(etag, data) {
    return {
        etag,
        json() {
            return data;
        },
    };
}

function makePage(spec) {
    return new HyperviewPage({
        url: new URL('https://example.com/articles/example'),
        pathname: '/articles/example',
        responseProps: {},
        pageTemplateFilename: 'page.html',
        createMiniTemplate() {
            return () => '';
        },
        includes: null,
        partials: null,
        etag: 'page-etag-1',
        ...spec,
    });
}

describe('HyperviewPage', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('decodes an includes content object into parsed data', () => {
            const includesData = { intro: { filename: 'intro.md' } };
            const page = makePage({ includes: makeContentObjectDouble('includes-v1', includesData) });

            assert(page.includes === includesData, 'expected includes.json() to be invoked and its result stored');
        });

        it('leaves includes null when the store has none', () => {
            const page = makePage({ includes: null });

            assertEqual(null, page.includes);
        });

        it('decodes a partials content object into an etag and array of partial definitions', () => {
            const partialDefs = [ { id: 'page.html', source: 'PAGE PARTIAL' } ];
            const page = makePage({ partials: makeContentObjectDouble('partials-v1', partialDefs) });

            assertEqual('partials-v1', page.partials.etag);
            assert(
                page.partials.partials === partialDefs,
                'expected partials.json() to be invoked and its result stored',
            );
        });

        it('leaves partials null when the store has none', () => {
            const page = makePage({ partials: null });

            assertEqual(null, page.partials);
        });
    });

    describe('mergeSources', ({ it }) => {
        it('merges decoded includes into the assembled page context', () => {
            const includesData = { intro: { filename: 'intro.md' } };
            const page = makePage({ includes: makeContentObjectDouble('includes-v1', includesData) });

            page.mergeSources([ { page: {} } ]);

            assert(
                page.getPageContext().includes === includesData,
                'expected the decoded includes data in the page context',
            );
        });
    });
});
