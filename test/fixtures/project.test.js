import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, isFunction } from 'kixx-assert';

import { renderProjectFiles } from '../../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { parseSecretsManifest } from '../../kixx/config/secrets-manifest.js';
import HttpRouter from '../../kixx/http-router/http-router.js';

// Never an entry point, and never the Durable Object registry: only
// Cloudflare can load those.
import * as nodeRegistry from './project/node-registry.generated.js';
import * as cloudflareRegistry from './project/cloudflare-registry.generated.js';
import { pluginRoutes } from './project/routes.generated.js';
import virtualHosts from './project/virtual-hosts.js';
import * as app from './project/app/app.js';


const PROJECT_DIRECTORY = fileURLToPath(new URL('./project/', import.meta.url));

// Where core is, from the fixture. A real project holds it at ./kixx.
const CORE_DIRECTORY = '../../../kixx';

const REGENERATE_COMMAND = `node tools/generate-registries.js test/fixtures/project --core ${ CORE_DIRECTORY }`;

const GENERATED_FILE_NAMES = [
    'cloudflare-durable-objects.generated.js',
    'cloudflare-registry.generated.js',
    'example.env.secrets',
    'node-registry.generated.js',
    'routes.generated.js',
];


function readCommittedFile(fileName) {
    return fs.readFileSync(path.join(PROJECT_DIRECTORY, fileName), 'utf8');
}


describe('fixture project', ({ describe }) => {

    describe('generated files', ({ before, it }) => {
        let rendered;

        before(async () => {
            rendered = await renderProjectFiles({
                fileSystem: createProjectFileSystem(PROJECT_DIRECTORY),
                coreDirectory: CORE_DIRECTORY,
            });
        });

        it('renders exactly the five generated files', () => {
            assertEqual(GENERATED_FILE_NAMES.join(','), [ ...rendered.keys() ].sort().join(','));
        });

        it('holds every generated file exactly as the generator writes it', () => {
            for (const [ fileName, text ] of rendered) {
                assert(
                    readCommittedFile(fileName) === text,
                    `test/fixtures/project/${ fileName } is out of date. Regenerate it with: ${ REGENERATE_COMMAND }`,
                );
            }
        });

        it('holds no other generated module at its root', () => {
            // cloudflare-config.generated.js is written by a deploy and is
            // never committed, here or in a real project.
            const found = fs.readdirSync(PROJECT_DIRECTORY).filter((name) => name.endsWith('.generated.js'));
            const expected = GENERATED_FILE_NAMES.filter((name) => name.endsWith('.generated.js'));

            assertEqual(expected.join(','), found.sort().join(','));
        });

        it('leaves no trace of a contribution to a plugin that isn\'t installed', () => {
            // The visits plugin contributes routes when "reports" is installed.
            for (const [ fileName, text ] of rendered) {
                assertFalsy(text.includes('reports'), `${ fileName } names the reports plugin`);
            }
        });

        it('ignores a plugins/ directory that has no manifest', () => {
            for (const [ fileName, text ] of rendered) {
                assertFalsy(text.includes('draft'), `${ fileName } names the draft directory`);
            }
        });

        it('declares the same secrets in example.env.secrets as in both registries', () => {
            const declared = parseSecretsManifest(readCommittedFile('example.env.secrets'));

            assertEqual('FIXTURE_APP_SECRET,PANEL_SIGNING_SECRET', declared.required.join(','));
            assertEqual('VISITS_OPTIONAL_TOKEN', declared.optional.join(','));

            for (const registry of [ nodeRegistry, cloudflareRegistry ]) {
                assertEqual(declared.required.join(','), registry.secrets.required.join(','));
                assertEqual(declared.optional.join(','), registry.secrets.optional.join(','));
            }
        });
    });

    describe('registries', ({ it }) => {
        it('export the same names for both targets', () => {
            assertEqual(
                'LoggerWriter,ServerRequest,configDefaults,contentRoots,plugins,secrets',
                Object.keys(nodeRegistry).sort().join(','),
            );
            assertEqual(
                Object.keys(nodeRegistry).sort().join(','),
                Object.keys(cloudflareRegistry).sort().join(','),
            );
        });

        it('order lifecycle modules: core, then visits, then panel, which depends on it', () => {
            assertEqual(
                [
                    'kixx:./content-addressable-store/plugin.js',
                    'kixx:./hyperview/plugin.js',
                    'kixx:./adapters/node/key-value-store/plugin.js',
                    'kixx:./adapters/node/content-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./adapters/node/plugin.js',
                    'panel:./plugin.js',
                ].join('\n'),
                [ ...nodeRegistry.plugins.keys() ].join('\n'),
            );
            assertEqual(
                [
                    'kixx:./content-addressable-store/plugin.js',
                    'kixx:./hyperview/plugin.js',
                    'kixx:./adapters/cloudflare/key-value-store/plugin.js',
                    'kixx:./adapters/cloudflare/content-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./adapters/cloudflare/plugin.js',
                    'panel:./plugin.js',
                ].join('\n'),
                [ ...cloudflareRegistry.plugins.keys() ].join('\n'),
            );
        });

        it('hold each target\'s config defaults over the defaults for all targets', () => {
            assertEqual('hello', nodeRegistry.configDefaults.VISITS.greeting);
            assertEqual('a default for Node.js', nodeRegistry.configDefaults.VISITS.platformNote);
            assertEqual('hello', cloudflareRegistry.configDefaults.VISITS.greeting);
            assertEqual('a default for Cloudflare', cloudflareRegistry.configDefaults.VISITS.platformNote);
            assertEqual('Fixture panel', nodeRegistry.configDefaults.PANEL.title);

            // Core's Cloudflare defaults name its bindings; Node.js has none.
            assertEqual('KEY_VALUE_STORE', cloudflareRegistry.configDefaults.KEY_VALUE_STORE.bindingName);
            assertFalsy(Object.hasOwn(nodeRegistry.configDefaults, 'KEY_VALUE_STORE'));
        });

        it('list the visits plugin\'s content root', () => {
            for (const registry of [ nodeRegistry, cloudflareRegistry ]) {
                assertEqual(1, registry.contentRoots.length);
                assertEqual('visits', registry.contentRoots[0].plugin);
                assertEqual('plugins/visits/pages', registry.contentRoots[0].pagesDirectory);
            }
        });
    });

    // Nothing is booted here. These checks only show that the hand-written
    // files and the generated ones fit each other.
    describe('hand-written files', ({ it }) => {
        it('mount the plugin routes in entry order, a plugin\'s conditional routes after its own', () => {
            assertEqual('visits,panel-visits,panel', pluginRoutes.map(({ name }) => name).join(','));
            assertEqual('/visits,/panel/visits,/panel', pluginRoutes.map(({ pattern }) => pattern).join(','));
        });

        it('put middleware on the panel mount', () => {
            const panel = pluginRoutes.find(({ name }) => name === 'panel');

            assertEqual(1, panel.inboundMiddleware.length);
            assert(isFunction(panel.inboundMiddleware[0]));
        });

        it('place the plugin routes between the project\'s own routes and the catch-all', () => {
            assertEqual(1, virtualHosts.length);

            const { routes } = virtualHosts[0];

            assertEqual('home', routes[0].name);
            assertEqual(pluginRoutes.map(({ name }) => name).join(','), routes.slice(1, -1).map(({ name }) => name).join(','));
            assertEqual('*', routes.at(-1).pattern);
        });

        it('build a router', () => {
            // Building the router validates every route specification, the
            // mounted ones included.
            const router = new HttpRouter(virtualHosts);

            assert(router);
        });

        it('give the app the lifecycle hooks it uses', () => {
            assertEqual('initialize,start,stop', Object.keys(app).sort().join(','));

            for (const hook of Object.values(app)) {
                assert(isFunction(hook));
            }
        });
    });
});
