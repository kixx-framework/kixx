import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import routes from '../../../src/routes/admin-panel.js';
import ServerResponse from '../../../src/kixx/http-router/server-response.js';


describe('Admin panel routes', ({ it }) => {

    it('declares the admin directory before the static-page fallback', () => {
        const directoryIndex = routes.findIndex((route) => route.pattern === '{/}');
        const staticPagesIndex = routes.findIndex((route) => route.pattern === '*');
        const directory = routes[directoryIndex];

        assert(directoryIndex >= 0, 'expected an explicit admin-directory route');
        assert(directoryIndex < staticPagesIndex, 'expected the directory before static pages');
        assertEqual('admin-directory', directory.name);
        assertEqual(1, directory.targets.length);
        assertEqual('render-admin-directory', directory.targets[0].name);
        assertEqual('GET,HEAD', directory.targets[0].methods.join(','));
    });

    it('renders the directory with the admin shell', async () => {
        const directory = routes.find((route) => route.pattern === '{/}');
        const render = directory.targets[0].requestHandlers[0];
        const calls = [];
        const context = {
            getService(name) {
                assertEqual('HyperviewService', name);
                return {
                    async renderPage(_context, options) {
                        calls.push(options);
                        return { type: 'hypertext', hypertext: '<main>Admin Panel</main>' };
                    },
                };
            },
        };
        const request = {
            headers: new Headers(),
            url: new URL('https://www.example.com/admin'),
        };
        const response = new ServerResponse();

        await render(context, request, response);

        assertEqual(1, calls.length);
        assertEqual('admin.html', calls[0].baseTemplateId);
    });
});
