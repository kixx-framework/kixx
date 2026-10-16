import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import routes from '../../routes/admin-panel.js';
import ServerResponse from '../../kixx/http-router/server-response.js';


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

    it('orders upload and action endpoints before the dynamic detail route', () => {
        const patterns = routes.map((route) => route.pattern);
        const detailIndex = patterns.indexOf('/files/:fileId');

        assert(patterns.indexOf('/files/upload') < detailIndex);
        assert(patterns.indexOf('/files/:fileId/download') < detailIndex);
        assert(patterns.indexOf('/files/:fileId/replace') < detailIndex);
        assert(patterns.includes('/files/:fileId/delete'));
    });

    it('authorizes raw upload before its handler can consume the body', () => {
        const upload = routes.find((route) => route.pattern === '/files/upload').targets[0];

        assertEqual('urn:kixx:create', upload.requestHandlers[0].decisions[0].action);
        assertEqual('urn:kixx:publishing:files', upload.requestHandlers[0].decisions[0].resource);
        assertEqual('postFileUpload', upload.requestHandlers[1].name);
    });

    it('orders the migration routes before the directory and static-page fallback', () => {
        const patterns = routes.map((route) => route.pattern);
        const detailIndex = patterns.indexOf('/migrations/:id');
        const listIndex = patterns.indexOf('/migrations');

        assert(detailIndex >= 0, 'expected a migration detail route');
        assert(detailIndex < listIndex, 'expected the detail route before the list route');
        assert(listIndex < patterns.indexOf('{/}'));
        assert(listIndex < patterns.indexOf('*'));
    });

    it('gates every migration page on the migration list permission', () => {
        const expected = [
            [ '/migrations/:id', 'migration-detail', 'render-detail', 'getAdminMigration' ],
            [ '/migrations', 'migrations', 'render-list', 'getAdminMigrations' ],
        ];

        for (const [ pattern, routeName, targetName, handlerName ] of expected) {
            const route = routes.find((candidate) => candidate.pattern === pattern);
            assertEqual(routeName, route.name);
            assertEqual(1, route.targets.length);

            const [ target ] = route.targets;
            assertEqual(targetName, target.name);
            assertEqual('GET,HEAD', target.methods.join(','));

            const { decisions } = target.requestHandlers[0];
            assertEqual(1, decisions.length);
            assertEqual('urn:kixx:list', decisions[0].action);
            assertEqual('urn:kixx:admin:migrations', decisions[0].resource);
            assertEqual(handlerName, target.requestHandlers[1].name);
        }
    });

    it('orders the migration action routes before the migration detail route', () => {
        const patterns = routes.map((route) => route.pattern);
        const detailIndex = patterns.indexOf('/migrations/:id');

        for (const pattern of [ '/migrations/:id/run', '/migrations/:id/dry-run', '/migrations/:id/force' ]) {
            const index = patterns.indexOf(pattern);
            assert(index >= 0, `expected ${ pattern }`);
            assert(index < detailIndex, `expected ${ pattern } before the detail route`);
        }

        assert(detailIndex < patterns.indexOf('{/}'));
        assert(detailIndex < patterns.indexOf('*'));
    });

    it('gates every migration action on the migration run permission', () => {
        const expected = [
            [ '/migrations/:id/run', 'migration-run', 'run', 'POST', 'postMigrationRun' ],
            [ '/migrations/:id/dry-run', 'migration-dry-run', 'dry-run', 'POST', 'postMigrationDryRun' ],
            [ '/migrations/:id/force', 'migration-force', 'render-confirm', 'GET,HEAD', 'getMigrationForceConfirmation' ],
            [ '/migrations/:id/force', 'migration-force', 'force', 'POST', 'postMigrationForce' ],
        ];

        for (const [ pattern, routeName, targetName, methods, handlerName ] of expected) {
            const route = routes.find((candidate) => candidate.pattern === pattern);
            assertEqual(routeName, route.name);

            const target = route.targets.find((candidate) => candidate.name === targetName);
            assert(target, `expected target ${ targetName }`);
            assertEqual(methods, target.methods.join(','));

            const { decisions } = target.requestHandlers[0];
            assertEqual(1, decisions.length);
            assertEqual('urn:kixx:run', decisions[0].action);
            assertEqual('urn:kixx:admin:migrations', decisions[0].resource);
            assertEqual(handlerName, target.requestHandlers[1].name);
        }

        const force = routes.find((route) => route.pattern === '/migrations/:id/force');
        assertEqual(2, force.targets.length);
        assertEqual(1, routes.find((route) => route.pattern === '/migrations/:id/run').targets.length);
        assertEqual(1, routes.find((route) => route.pattern === '/migrations/:id/dry-run').targets.length);
    });

    it('orders the job routes before the directory and static-page fallback', () => {
        const patterns = routes.map((route) => route.pattern);
        const detailIndex = patterns.indexOf('/jobs/:id');
        const listIndex = patterns.indexOf('/jobs');

        assert(detailIndex >= 0, 'expected a job detail route');
        assert(detailIndex < listIndex, 'expected the detail route before the list route');
        assert(listIndex < patterns.indexOf('{/}'));
        assert(listIndex < patterns.indexOf('*'));
    });

    it('orders the fixed job pages before the job detail route', () => {
        const patterns = routes.map((route) => route.pattern);
        const detailIndex = patterns.indexOf('/jobs/:id');

        for (const pattern of [ '/jobs/registered', '/jobs/schedules' ]) {
            const index = patterns.indexOf(pattern);
            assert(index >= 0, `expected ${ pattern }`);
            assert(index < detailIndex, `expected ${ pattern } before /jobs/:id`);
        }
    });

    it('gates the job pages on the jobs resource', () => {
        const expected = [
            [ '/jobs/registered', 'job-registry', 'render-list', 'urn:kixx:list', 'getAdminJobRegistry' ],
            [ '/jobs/schedules', 'job-schedules', 'render-list', 'urn:kixx:list', 'getAdminJobSchedules' ],
            [ '/jobs/:id', 'job-detail', 'render-detail', 'urn:kixx:get', 'getAdminJob' ],
            [ '/jobs', 'jobs', 'render-list', 'urn:kixx:list', 'getAdminJobs' ],
        ];

        for (const [ pattern, routeName, targetName, action, handlerName ] of expected) {
            const route = routes.find((candidate) => candidate.pattern === pattern);
            assertEqual(routeName, route.name);
            assertEqual(1, route.targets.length);

            const [ target ] = route.targets;
            assertEqual(targetName, target.name);
            assertEqual('GET,HEAD', target.methods.join(','));

            const { decisions } = target.requestHandlers[0];
            assertEqual(1, decisions.length);
            assertEqual(action, decisions[0].action);
            assertEqual('urn:kixx:admin:jobs', decisions[0].resource);
            assertEqual(handlerName, target.requestHandlers[1].name);
            assertEqual(3, target.requestHandlers.length);
        }
    });

    it('declares job retry as a POST before the job detail route', () => {
        const patterns = routes.map((route) => route.pattern);
        const retryIndex = patterns.indexOf('/jobs/:id/retry');

        assert(retryIndex >= 0, 'expected a job retry route');
        assert(retryIndex < patterns.indexOf('/jobs/:id'));

        const route = routes[retryIndex];
        assertEqual('job-retry', route.name);
        assertEqual(1, route.targets.length);

        const [ target ] = route.targets;
        assertEqual('retry', target.name);
        assertEqual('POST', target.methods.join(','));
        assertEqual('urn:kixx:update', target.requestHandlers[0].decisions[0].action);
        assertEqual('urn:kixx:admin:jobs', target.requestHandlers[0].decisions[0].resource);
        assertEqual('postJobRetry', target.requestHandlers[1].name);
        assertEqual(2, target.requestHandlers.length);
    });
});
