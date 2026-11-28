/**
 * The test app serves its content from a published Release: pages through
 * the base template, a fingerprinted stylesheet, and a public file. A second
 * Release shows a new page with no restart and no deploy.
 */
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/target.js';
import { ensurePublished, publishTestAppContent, readTestAppContent } from '../test-helpers/publish.js';


const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// A page only this file's second Release holds.
const EXTRA_PAGE_PATHNAME = '/integration-extra-page';

const EXTRA_PAGE_FILES = {
    'pages/integration-extra-page/page.html': '<h1>{{ page.title }}</h1>\n',
    'pages/integration-extra-page/page.json': JSON.stringify({
        template: 'page.html',
        page: { title: 'Integration extra page', description: 'Published by the integration suite.' },
    }),
};


describe('pages', ({ before, it }) => {
    before(async () => {
        await ensurePublished();
    });

    it('renders the home page through the base template', async () => {
        const response = await get('/');
        const text = await response.text();

        assertEqual(200, response.status);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        assertMatches(/^<!doctype html>/i, text);
        assertMatches('<title>Welcome to Kixx</title>', text);
        assertMatches('<h1>Welcome to Kixx</h1>', text);
    });

    it('renders a page in a subdirectory, with no route of its own', async () => {
        const response = await get('/about');
        const text = await response.text();

        assertEqual(200, response.status);
        assertMatches('<title>About</title>', text);
        assertMatches('<h1>About</h1>', text);
    });

    it('links a fingerprinted stylesheet, served to be cached forever', async () => {
        const home = await (await get('/')).text();
        const [ , href ] = home.match(/<link rel="stylesheet" href="([^"]+)">/) ?? [];

        assert(href, 'the home page links no stylesheet');
        assertMatches(/^\/assets\/[^/]+\/site\.css$/, href);

        const response = await get(href);
        const text = await response.text();

        assertEqual(200, response.status);
        assertEqual('text/css; charset=utf-8', response.headers.get('content-type'));
        assertEqual(IMMUTABLE_CACHE_CONTROL, response.headers.get('cache-control'));

        // The compiler bundles a stylesheet, so it is not served byte for byte.
        assertMatches('font-family: sans-serif', text);
    });

    it('serves a public file at the root', async () => {
        const files = await readTestAppContent();
        const response = await get('/robots.txt');

        assertEqual(200, response.status);
        assertEqual(new TextDecoder().decode(files['public/robots.txt']), await response.text());
    });

    it('answers 404 for a path with no content', async () => {
        const response = await get('/integration-no-such-page');

        await response.arrayBuffer();

        assertEqual(404, response.status);
    });

    it('answers a HEAD request with no body', async () => {
        const response = await get('/', { method: 'HEAD' });

        assertEqual(200, response.status);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        assertEqual('', await response.text());
    });

    // CONT-13. The second Release is left assigned: it holds every file of
    // the first, so the pages above still render. A rerun passes because the
    // test assigns the first content back before it looks.
    it('shows a new page once a Release that holds it is assigned, with no restart', async () => {
        await publishTestAppContent();

        const before = await get(EXTRA_PAGE_PATHNAME);

        await before.arrayBuffer();

        assertEqual(404, before.status);

        const second = await publishTestAppContent(EXTRA_PAGE_FILES);

        assertEqual('publish', second.intent);

        const after = await get(EXTRA_PAGE_PATHNAME);

        assertEqual(200, after.status);
        assertMatches('<h1>Integration extra page</h1>', await after.text());

        // The first Release's pages are in the second.
        const home = await get('/');

        await home.arrayBuffer();

        assertEqual(200, home.status);
    });
});


function get(pathname, init = {}) {
    return fetch(`${ getBaseUrl() }${ pathname }`, { redirect: 'manual', ...init });
}
