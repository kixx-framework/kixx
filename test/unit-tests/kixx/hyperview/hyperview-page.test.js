import { describe } from 'kixx-test';
import { assertEqual, assertUndefined } from 'kixx-assert';

import HyperviewPage from '../../../../src/kixx/hyperview/hyperview-page.js';


function makePage(args) {
    const {
        pageDataSources,
        responseProps = {},
        includes = {},
    } = args;

    return new HyperviewPage({
        url: new URL('https://example.com/articles/example'),
        pathname: '/articles/example',
        responseProps,
        pageDataSources,
        template: () => '',
        partials: new Map(),
        includes,
        hash: 'page-hash',
        createMiniTemplate: () => () => '',
    });
}

describe('HyperviewPage', ({ it }) => {
    it('removes published build directives from the template context', () => {
        const page = makePage({
            pageDataSources: [
                {
                    template: 'root.html',
                    partials: { card: 'root-card.html' },
                },
                {
                    template: 'leaf.html',
                    partials: { card: 'leaf-card.html' },
                },
            ],
        });

        assertUndefined(page.context.template);
        assertUndefined(page.context.partials);
    });

    it('preserves response props which reuse build directive names', () => {
        const page = makePage({
            pageDataSources: [ { template: 'page.html', partials: { card: 'card.html' } } ],
            responseProps: { template: 'runtime template', partials: 'runtime partials' },
        });

        assertEqual('runtime template', page.context.template);
        assertEqual('runtime partials', page.context.partials);
    });

    it('replaces the includes manifest with resolved content', () => {
        const includes = { introduction: '<p>Resolved content</p>' };
        const page = makePage({
            pageDataSources: [
                { includes: { introduction: { filename: 'introduction.html' } } },
            ],
            includes,
        });

        assertEqual(includes, page.context.includes);
    });
});
