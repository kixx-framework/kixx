/**
 * A development server as a real process, on the runtime the runner runs
 * on: it renders the working tree with no publish, no BUILD_ID, and no
 * secret, and shows an edit on the next request.
 *
 * The server runs a copy of the built test app, because the tests edit its
 * files. One copy and one server serve every test here, in order.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { copyBuild, removeDirectory, sleep, startLocalServer, tail } from '../test-helpers/local-server.js';


// Longer than the coarsest modified-time granularity a file system here has
// (one second).
const NEXT_MODIFIED_TIME_MS = 1100;


describeOnTarget([ 'local' ], 'local: development', ({ before, after, it }) => {
    let projectDirectory = null;
    let server = null;

    before(async () => {
        projectDirectory = await copyBuild();

        server = await startLocalServer({
            projectDirectory,
            environment: 'development',
            deployKey: null,
            buildId: null,
        });
    });

    after(async () => {
        await server?.close();

        if (projectDirectory) {
            await removeDirectory(projectDirectory);
        }
    });

    it('renders the home page from the working tree, through the base template', async () => {
        const { status, text } = await get('/');

        assertEqual(200, status);
        assertMatches(/^<!doctype html>/i, text);
        assertMatches('<title>Welcome to Kixx</title>', text);
        assertMatches('<h1>Welcome to Kixx</h1>', text);
    });

    it('renders a plugin\'s page from the plugin\'s directory', async () => {
        const { status, text } = await get('/integration-probe-page');

        assertEqual(200, status);
        assertMatches('<title>Integration probe page</title>', text);
        assertMatches('<h1>Integration probe page</h1>', text);
    });

    it('serves a public file', async () => {
        const { status, text } = await get('/robots.txt');

        assertEqual(200, status);
        assertEqual(await fsp.readFile(path.join(projectDirectory, 'public', 'robots.txt'), 'utf8'), text);
    });

    it('links a fingerprinted stylesheet and serves it', async () => {
        const home = await get('/');
        const [ , href ] = home.text.match(/<link rel="stylesheet" href="([^"]+)">/) ?? [];

        assert(href, 'the home page links no stylesheet');
        assertMatches(/^\/assets\/[^/]+\/site\.css$/, href);

        const { status, text } = await get(href);

        assertEqual(200, status);
        assertMatches('font-family: sans-serif', text);
    });

    it('shows an edit to a page on the next request', async () => {
        const marker = `edited-${ crypto.randomUUID() }`;

        await writeHomePage(marker);

        const { status, text } = await get('/');

        assertEqual(200, status);
        assertMatches(marker, text);
    });

    // The server sees a change by a file's modified time and size alone.
    // Here the size stays the same, so only the modified time can show it.
    it('shows an edit that keeps the file\'s size, a second later', async () => {
        const first = `same-size-${ crypto.randomUUID() }`;
        const second = `same-size-${ crypto.randomUUID() }`;

        assertEqual(first.length, second.length);

        await writeHomePage(first);

        assertMatches(first, (await get('/')).text);

        await sleep(NEXT_MODIFIED_TIME_MS);
        await writeHomePage(second);

        const { status, text } = await get('/');

        assertEqual(200, status);
        assertMatches(second, text);
    });

    // Last: it leaves a page broken.
    it('answers the problems page for a broken page, renders the others, and keeps running', async () => {
        await fsp.writeFile(path.join(projectDirectory, 'pages', 'about', 'page.json'), '{ not json');

        const broken = await get('/about');

        assertEqual(500, broken.status);
        assertMatches('<title>This page has content problems</title>', broken.text);
        assertMatches('malformed-json', broken.text);

        const home = await get('/');

        assertEqual(200, home.status);
        assertMatches('<h1>Welcome to Kixx</h1>', home.text);

        const exit = await server.exitWithin(200);

        assertEqual(null, exit, exit ? tail(exit.output) : '');
    });

    async function get(pathname) {
        const response = await server.fetch(pathname);

        return { status: response.status, text: await response.text() };
    }

    // The skeleton's home page template, with a line added.
    function writeHomePage(marker) {
        return fsp.writeFile(
            path.join(projectDirectory, 'pages', 'page.html'),
            `<h1>{{ page.title }}</h1>\n<p>${ marker }</p>\n`,
        );
    }
});
