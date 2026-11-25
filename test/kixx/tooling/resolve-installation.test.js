import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import {
    validatePluginManifest,
    validateAppManifest,
    resolveInstallation,
} from '../../../kixx/tooling/mod.js';


function makeCore(overrides) {
    const manifest = Object.assign({
        name: 'kixx',
        version: '7.0.0-alpha.0',
        description: 'Kixx core.',
        services: [ 'KeyValueStore' ],
        lifecycle: [ './hyperview/plugin.js' ],
        adapters: {
            node: {
                lifecycle: [ './adapters/node/key-value-store/plugin.js' ],
                loggerWriter: './adapters/node/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/node/server-request/lib/server-request.js',
            },
            cloudflare: {
                lifecycle: [ './adapters/cloudflare/key-value-store/plugin.js' ],
                loggerWriter: './adapters/cloudflare/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/cloudflare/server-request/lib/server-request.js',
            },
        },
        config: {
            keys: [ 'HYPERVIEW', 'KEY_VALUE_STORE' ],
            defaults: {
                all: { HYPERVIEW: { useTemplateCache: false, ttlSeconds: 86400 } },
                cloudflare: {
                    HYPERVIEW: { ttlSeconds: 60 },
                    KEY_VALUE_STORE: { bindingName: 'KEY_VALUE_STORE' },
                },
            },
        },
        cloudflare: {
            kvNamespaces: [ { config: 'KEY_VALUE_STORE' } ],
        },
    }, overrides);

    return validatePluginManifest(manifest, { file: 'kixx/plugin.json', isCore: true });
}

function makePlugin(name, overrides) {
    const manifest = Object.assign({
        name,
        version: '7.0.0',
        core: '7.0.0',
        description: `The ${ name } plugin.`,
    }, overrides);

    return validatePluginManifest(manifest, { file: `plugins/${ name }/plugin.json`, directoryName: name });
}

function makeApp(secrets) {
    return validateAppManifest({ secrets }, { file: 'app/app.json' });
}

// A plugin that uses every part of a manifest the model reads.
function makeVisits(overrides) {
    return makePlugin('visits', Object.assign({
        services: [ 'Visits' ],
        lifecycle: [ './plugin.js' ],
        adapters: {
            node: { lifecycle: [ './adapters/node/plugin.js' ] },
            cloudflare: { lifecycle: [ './adapters/cloudflare/plugin.js' ] },
        },
        config: {
            keys: [ 'VISITS' ],
            defaults: {
                all: { VISITS: { greeting: 'hello', store: 'memory' } },
                node: { VISITS: { store: 'sqlite' } },
                cloudflare: { VISITS: { durableObject: { bindingName: 'VISITS_DURABLE_OBJECT' } } },
            },
        },
        secrets: [
            { name: 'VISITS_SIGNING_SECRET', description: 'Signs visit tokens.' },
            { name: 'VISITS_DEBUG_TOKEN', required: false, description: 'Unlocks debug output.' },
        ],
        cloudflare: {
            durableObjects: [
                { className: 'VisitsStore', module: './adapters/cloudflare/lib/visits-store.js', config: 'VISITS.durableObject' },
            ],
        },
        routes: [
            { module: './routes.js', mount: '/visits', name: 'visits' },
            { module: './root-routes.js' },
        ],
        content: { pagesDirectory: './pages' },
        whenInstalled: {
            admin: {
                lifecycle: [ './admin-plugin.js' ],
                routes: [ { module: './admin-routes.js', mount: '/admin/visits', name: 'admin-visits' } ],
                content: { templatesDirectory: './admin-templates' },
            },
        },
    }, overrides));
}

function resolve(plugins, options) {
    return resolveInstallation(Object.assign({ core: makeCore(), plugins }, options));
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function names(installation) {
    return installation.entries.map((entry) => entry.name).join(',');
}

function modules(lifecycle) {
    return lifecycle.map((record) => `${ record.owner }:${ record.module }`).join(',');
}

function assertProblems(caught, expected) {
    assert(caught, 'expected an error to be thrown');
    assertEqual('ValidationError', caught.name);
    assertEqual(expected.join(' | '), caught.errors.map((problem) => problem.message).join(' | '));
    assertEqual(`Invalid plugin installation: ${ expected.join('; ') }`, caught.message);
}


describe('resolveInstallation', ({ describe }) => {

    describe('order', ({ it }) => {
        function makePlugins() {
            return [
                makePlugin('zebra'),
                makePlugin('alpha', { dependencies: [ 'zebra' ] }),
                makePlugin('beta'),
                makePlugin('mid', { dependencies: [ 'alpha', 'beta' ] }),
            ];
        }

        it('puts core first with no plugins', () => {
            assertEqual('kixx', names(resolve([])));
        });

        it('puts each dependency before its dependents and breaks ties by name', () => {
            assertEqual('kixx,beta,zebra,alpha,mid', names(resolve(makePlugins())));
        });

        it('gives the same model for the same manifests in any order', () => {
            const expected = JSON.stringify(resolve(makePlugins()));
            const [ zebra, alpha, beta, mid ] = makePlugins();

            assertEqual(expected, JSON.stringify(resolve([ mid, beta, alpha, zebra ])));
            assertEqual(expected, JSON.stringify(resolve([ beta, mid, zebra, alpha ])));
        });

        it('does not reorder the list it is given', () => {
            const plugins = makePlugins();

            resolve(plugins);

            assertEqual('zebra,alpha,beta,mid', plugins.map((manifest) => manifest.name).join(','));
        });

        it('returns a deeply frozen model', () => {
            const installation = resolve([ makeVisits(), makePlugin('admin') ]);

            assert(Object.isFrozen(installation));
            assert(Object.isFrozen(installation.entries));
            assert(Object.isFrozen(installation.entries[1].manifest.lifecycle));
            assert(Object.isFrozen(installation.targets.node.lifecycle[0]));
            assert(Object.isFrozen(installation.targets.cloudflare.configDefaults.VISITS.durableObject));
            assert(Object.isFrozen(installation.secrets[0]));
            assert(Object.isFrozen(installation.routes[0]));
            assert(Object.isFrozen(installation.contentRoots[0]));
            assert(Object.isFrozen(installation.durableObjects[0]));
            assert(Object.isFrozen(installation.kvNamespaces[0]));
        });
    });

    describe('whenInstalled', ({ it }) => {
        it('merges a block when its plugin is installed', () => {
            const installation = resolve([ makeVisits(), makePlugin('admin') ]);
            const { manifest } = installation.entries.find((entry) => entry.name === 'visits');

            assertEqual('./plugin.js,./admin-plugin.js', manifest.lifecycle.join(','));
            assertEqual('./routes.js,./root-routes.js,./admin-routes.js', manifest.routes.map((route) => route.module).join(','));
            assertEqual(2, manifest.contentRoots.length);
            assertEqual('./pages', manifest.contentRoots[0].pagesDirectory);
            assertEqual('./admin-templates', manifest.contentRoots[1].templatesDirectory);
        });

        it('leaves a block out when its plugin is not installed', () => {
            const installation = resolve([ makeVisits() ]);
            const { manifest } = installation.entries[1];

            assertEqual('./plugin.js', manifest.lifecycle.join(','));
            assertEqual('./routes.js,./root-routes.js', manifest.routes.map((route) => route.module).join(','));
            assertEqual(1, manifest.contentRoots.length);
            assertEqual(1, installation.contentRoots.length);
            assertEqual('/visits', installation.routes.filter((route) => route.mount).map((route) => route.mount).join(','));
        });

        it('merges blocks in name order, whatever the manifest\'s key order', () => {
            const visits = makePlugin('visits', {
                whenInstalled: {
                    studio: { lifecycle: [ './studio.js' ] },
                    admin: { lifecycle: [ './admin.js' ] },
                },
            });

            const installation = resolve([ visits, makePlugin('studio'), makePlugin('admin') ]);

            assertEqual('visits:./admin.js,visits:./studio.js', modules(installation.targets.node.lifecycle.slice(-2)));
        });

        it('runs a module once when a block lists one the plugin already runs', () => {
            const visits = makePlugin('visits', {
                lifecycle: [ './plugin.js' ],
                whenInstalled: { admin: { lifecycle: [ './plugin.js', './admin.js' ] } },
            });

            const installation = resolve([ visits, makePlugin('admin') ]);

            assertEqual(
                'kixx:./hyperview/plugin.js,kixx:./adapters/node/key-value-store/plugin.js,visits:./plugin.js,visits:./admin.js',
                modules(installation.targets.node.lifecycle),
            );
        });
    });

    describe('the model', ({ it }) => {
        function resolveExample() {
            return resolve([ makeVisits(), makePlugin('admin', { secrets: [ { name: 'ADMIN_SECRET', description: 'Signs forms.' } ] }) ], {
                app: makeApp([ { name: 'SUPPORT_TOKEN', required: false, description: 'Lets support staff sign in.' } ]),
            });
        }

        it('lists each target\'s lifecycle modules in the order they run', () => {
            const { targets } = resolveExample();

            assertEqual(
                [
                    'kixx:./hyperview/plugin.js',
                    'kixx:./adapters/node/key-value-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./admin-plugin.js',
                    'visits:./adapters/node/plugin.js',
                ].join(','),
                modules(targets.node.lifecycle),
            );

            assertEqual(
                [
                    'kixx:./hyperview/plugin.js',
                    'kixx:./adapters/cloudflare/key-value-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./admin-plugin.js',
                    'visits:./adapters/cloudflare/plugin.js',
                ].join(','),
                modules(targets.cloudflare.lifecycle),
            );
        });

        it('names core\'s logger writer and server request for each target', () => {
            const { targets } = resolveExample();

            assertEqual('./adapters/node/logger-writer/lib/logger-writer.js', targets.node.loggerWriter);
            assertEqual('./adapters/node/server-request/lib/server-request.js', targets.node.serverRequest);
            assertEqual('./adapters/cloudflare/logger-writer/lib/logger-writer.js', targets.cloudflare.loggerWriter);
            assertEqual('./adapters/cloudflare/server-request/lib/server-request.js', targets.cloudflare.serverRequest);
        });

        it('merges each target\'s config defaults over the defaults for all targets', () => {
            const { targets } = resolveExample();

            assertEqual(
                JSON.stringify({
                    HYPERVIEW: { useTemplateCache: false, ttlSeconds: 86400 },
                    VISITS: { greeting: 'hello', store: 'sqlite' },
                }),
                JSON.stringify(targets.node.configDefaults),
            );

            assertEqual(
                JSON.stringify({
                    HYPERVIEW: { useTemplateCache: false, ttlSeconds: 60 },
                    KEY_VALUE_STORE: { bindingName: 'KEY_VALUE_STORE' },
                    VISITS: { greeting: 'hello', store: 'memory', durableObject: { bindingName: 'VISITS_DURABLE_OBJECT' } },
                }),
                JSON.stringify(targets.cloudflare.configDefaults),
            );
        });

        it('lists the secrets in entry order with the app\'s last', () => {
            const { secrets } = resolveExample();

            assertEqual(
                JSON.stringify([
                    { owner: 'admin', name: 'ADMIN_SECRET', required: true, description: 'Signs forms.' },
                    { owner: 'visits', name: 'VISITS_SIGNING_SECRET', required: true, description: 'Signs visit tokens.' },
                    { owner: 'visits', name: 'VISITS_DEBUG_TOKEN', required: false, description: 'Unlocks debug output.' },
                    { owner: 'app', name: 'SUPPORT_TOKEN', required: false, description: 'Lets support staff sign in.' },
                ]),
                JSON.stringify(secrets),
            );
        });

        it('lists the routes in entry order, a plugin\'s own before its whenInstalled routes', () => {
            const { routes } = resolveExample();

            assertEqual(
                JSON.stringify([
                    { owner: 'visits', module: './routes.js', mount: '/visits', name: 'visits' },
                    { owner: 'visits', module: './root-routes.js' },
                    { owner: 'visits', module: './admin-routes.js', mount: '/admin/visits', name: 'admin-visits' },
                ]),
                JSON.stringify(routes),
            );
            assertUndefined(routes[1].mount);
        });

        it('lists the content roots, the Durable Object classes, and the KV namespaces with their owners', () => {
            const installation = resolveExample();

            assertEqual(
                JSON.stringify([
                    { owner: 'visits', pagesDirectory: './pages' },
                    { owner: 'visits', templatesDirectory: './admin-templates' },
                ]),
                JSON.stringify(installation.contentRoots),
            );

            assertEqual(
                JSON.stringify([
                    {
                        owner: 'visits',
                        className: 'VisitsStore',
                        module: './adapters/cloudflare/lib/visits-store.js',
                        config: 'VISITS.durableObject',
                    },
                ]),
                JSON.stringify(installation.durableObjects),
            );

            assertEqual(JSON.stringify([ { owner: 'kixx', config: 'KEY_VALUE_STORE' } ]), JSON.stringify(installation.kvNamespaces));
        });

        it('resolves without an app manifest', () => {
            const installation = resolve([]);

            assertEqual(0, installation.secrets.length);
            assertEqual(0, installation.routes.length);
        });
    });

    describe('core versions', ({ it }) => {
        function resolveWith(coreVersion, pluginCore) {
            return resolveInstallation({
                core: makeCore({ version: coreVersion }),
                plugins: [ makePlugin('visits', { core: pluginCore }) ],
            });
        }

        it('accepts a plugin whose core is the same version, ignoring a prerelease tag', () => {
            assertEqual('kixx,visits', names(resolveWith('7.0.0-alpha.0', '7.0.0')));
        });

        it('accepts a plugin whose core is older within the same major version', () => {
            assertEqual('kixx,visits', names(resolveWith('7.2.1', '7.0.0')));
            assertEqual('kixx,visits', names(resolveWith('7.2.1', '7.2.0')));
            assertEqual('kixx,visits', names(resolveWith('7.10.0', '7.9.5')));
        });

        it('rejects a plugin whose core is newer', () => {
            const caught = catchError(() => resolveWith('7.2.1', '7.3.0'));

            assertProblems(caught, [ 'plugin "visits" needs core 7.3.0 or a later 7.x version, but core is 7.2.1' ]);
        });

        it('rejects a plugin whose core is a newer patch', () => {
            const caught = catchError(() => resolveWith('7.2.1', '7.2.2'));

            assertProblems(caught, [ 'plugin "visits" needs core 7.2.2 or a later 7.x version, but core is 7.2.1' ]);
        });

        it('rejects a plugin whose core has another major version', () => {
            const newer = catchError(() => resolveWith('7.9.0', '8.0.0'));
            const older = catchError(() => resolveWith('7.9.0', '6.0.0'));

            assertProblems(newer, [ 'plugin "visits" needs core 8.0.0 or a later 8.x version, but core is 7.9.0' ]);
            assertProblems(older, [ 'plugin "visits" needs core 6.0.0 or a later 6.x version, but core is 7.9.0' ]);
        });
    });

    describe('problems', ({ it }) => {
        it('reports a dependency that is not installed', () => {
            const caught = catchError(() => resolve([ makePlugin('visits', { dependencies: [ 'admin' ] }) ]));

            assertProblems(caught, [ 'plugin "visits" depends on "admin", which is not installed' ]);
        });

        it('reports a dependency cycle, naming only the plugins in it', () => {
            const caught = catchError(() => resolve([
                makePlugin('alpha', { dependencies: [ 'beta' ] }),
                makePlugin('beta', { dependencies: [ 'gamma' ] }),
                makePlugin('gamma', { dependencies: [ 'alpha' ] }),
                makePlugin('delta', { dependencies: [ 'alpha' ] }),
                makePlugin('free'),
            ]));

            assertProblems(caught, [ 'plugins alpha, beta and gamma depend on each other in a cycle' ]);
        });

        it('reports a service in two manifests', () => {
            const caught = catchError(() => resolve([ makePlugin('visits', { services: [ 'KeyValueStore' ] }) ]));

            assertProblems(caught, [ 'service "KeyValueStore" is provided by kixx and visits' ]);
        });

        it('reports a config key in two manifests', () => {
            const caught = catchError(() => resolve([ makePlugin('visits', { config: { keys: [ 'HYPERVIEW' ] } }) ]));

            assertProblems(caught, [ 'config key "HYPERVIEW" is owned by kixx and visits' ]);
        });

        it('reports a secret in two manifests', () => {
            const secrets = [ { name: 'SHARED_SECRET', description: 'Shared.' } ];
            const caught = catchError(() => resolve([ makePlugin('admin', { secrets }), makePlugin('visits', { secrets }) ]));

            assertProblems(caught, [ 'secret "SHARED_SECRET" is declared by admin and visits' ]);
        });

        it('reports a secret the app declares again', () => {
            const secrets = [ { name: 'SHARED_SECRET', description: 'Shared.' } ];
            const caught = catchError(() => resolve([ makePlugin('visits', { secrets }) ], { app: makeApp(secrets) }));

            assertProblems(caught, [ 'secret "SHARED_SECRET" is declared by visits and the app' ]);
        });

        it('reports a Durable Object class in two manifests', () => {
            function makeWithClass(name, key) {
                return makePlugin(name, {
                    config: { keys: [ key ] },
                    cloudflare: { durableObjects: [ { className: 'SharedStore', module: './store.js', config: key } ] },
                });
            }

            const caught = catchError(() => resolve([ makeWithClass('admin', 'ADMIN'), makeWithClass('visits', 'VISITS') ]));

            assertProblems(caught, [ 'Durable Object class "SharedStore" is declared by admin and visits' ]);
        });

        it('reports a route mount used twice', () => {
            const caught = catchError(() => resolve([
                makePlugin('admin', { routes: [ { module: './routes.js', mount: '/shared', name: 'admin' } ] }),
                makePlugin('visits', { routes: [ { module: './routes.js', mount: '/shared', name: 'visits' } ] }),
            ]));

            assertProblems(caught, [ 'route mount "/shared" is used by admin and visits' ]);
        });

        it('reports a route name used twice, also within one manifest', () => {
            const caught = catchError(() => resolve([
                makePlugin('visits', {
                    routes: [
                        { module: './a.js', mount: '/a', name: 'visits' },
                        { module: './b.js', mount: '/b', name: 'visits' },
                    ],
                }),
            ]));

            assertProblems(caught, [ 'route name "visits" is used by visits more than once' ]);
        });

        it('counts a merged whenInstalled route', () => {
            const caught = catchError(() => resolve([
                makePlugin('admin', { routes: [ { module: './routes.js', mount: '/admin', name: 'admin' } ] }),
                makePlugin('visits', {
                    whenInstalled: { admin: { routes: [ { module: './admin-routes.js', mount: '/admin', name: 'admin-visits' } ] } },
                }),
            ]));

            assertProblems(caught, [ 'route mount "/admin" is used by admin and visits' ]);
        });

        it('allows any number of routes without a mount', () => {
            const installation = resolve([
                makePlugin('admin', { routes: [ { module: './routes.js' } ] }),
                makePlugin('visits', { routes: [ { module: './routes.js' }, { module: './more-routes.js' } ] }),
            ]);

            assertEqual(3, installation.routes.length);
        });

        it('reports every problem in one error', () => {
            const caught = catchError(() => resolve([
                makePlugin('alpha', { dependencies: [ 'beta', 'missing' ], core: '8.0.0' }),
                makePlugin('beta', { dependencies: [ 'alpha' ], services: [ 'KeyValueStore' ] }),
            ]));

            assertProblems(caught, [
                'plugin "alpha" depends on "missing", which is not installed',
                'plugins alpha and beta depend on each other in a cycle',
                'plugin "alpha" needs core 8.0.0 or a later 8.x version, but core is 7.0.0-alpha.0',
                'service "KeyValueStore" is provided by kixx and beta',
            ]);
            assertEqual(4, caught.errors.length);
            assertMatches('Invalid plugin installation: ', caught.message);
        });

        it('throws an AssertionError when plugins is not an Array', () => {
            const caught = catchError(() => resolveInstallation({ core: makeCore(), plugins: {} }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
