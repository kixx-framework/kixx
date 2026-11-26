import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import { validatePluginManifest, validateAppManifest } from '../../../kixx/tooling/mod.js';


const PLUGIN_FILE = 'plugins/visits/plugin.json';
const CORE_FILE = 'kixx/plugin.json';
const APP_FILE = 'app/app.json';

// The example manifest from the plugin guide, with every key in use.
function makeManifest() {
    return {
        name: 'visits',
        version: '7.0.0-alpha.0',
        core: '7.0.0',
        description: 'Counts visits. One line.',
        dependencies: [ 'admin' ],
        services: [ 'Visits' ],
        lifecycle: [ './plugin.js' ],
        adapters: {
            node: { lifecycle: [ './adapters/node/plugin.js' ] },
            cloudflare: { lifecycle: [ './adapters/cloudflare/plugin.js' ] },
        },
        config: {
            keys: [ 'VISITS' ],
            defaults: {
                all: { VISITS: { greeting: 'hello' } },
                node: { VISITS: { store: 'sqlite' } },
                cloudflare: {
                    VISITS: {
                        kvNamespace: { bindingName: 'VISITS_KV' },
                        durableObject: { bindingName: 'VISITS_DURABLE_OBJECT' },
                    },
                },
            },
        },
        secrets: [
            { name: 'VISITS_SIGNING_SECRET', required: true, description: 'Signs visit tokens.' },
        ],
        cloudflare: {
            kvNamespaces: [ { config: 'VISITS.kvNamespace' } ],
            durableObjects: [
                {
                    className: 'VisitsStore',
                    module: './adapters/cloudflare/lib/visits-store.js',
                    config: 'VISITS.durableObject',
                },
            ],
        },
        routes: [
            { module: './routes.js', mount: '/visits', name: 'visits' },
        ],
        content: {
            pagesDirectory: './pages',
            templatesDirectory: './templates',
            staticAssetsDirectory: './static-assets',
        },
        templateHelpers: [ 'formatVisits', '_count2' ],
        whenInstalled: {
            admin: {
                routes: [ { module: './admin-routes.js', mount: '/admin/visits', name: 'admin-visits' } ],
            },
        },
    };
}

function makeMinimalManifest(overrides) {
    return Object.assign({
        name: 'visits',
        version: '7.0.0',
        core: '7.0.0',
        description: 'Counts visits.',
    }, overrides);
}

function makeCoreManifest(overrides) {
    return Object.assign({
        name: 'kixx',
        version: '7.0.0-alpha.0',
        description: 'Kixx core.',
        adapters: {
            node: {
                loggerWriter: './adapters/node/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/node/server-request/lib/server-request.js',
            },
            cloudflare: {
                loggerWriter: './adapters/cloudflare/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/cloudflare/server-request/lib/server-request.js',
            },
        },
    }, overrides);
}

function validatePlugin(manifest) {
    return validatePluginManifest(manifest, { file: PLUGIN_FILE, directoryName: 'visits' });
}

function validateCore(manifest) {
    return validatePluginManifest(manifest, { file: CORE_FILE, isCore: true });
}

// Each returns a function that changes a manifest at a dotted path, such as
// 'secrets.0.name'.
function set(path, value) {
    return (manifest) => {
        const keys = path.split('.');
        const last = keys.pop();
        const parent = keys.reduce((object, key) => object[key], manifest);

        parent[last] = value;
    };
}

function unset(path) {
    return (manifest) => {
        const keys = path.split('.');
        const last = keys.pop();
        const parent = keys.reduce((object, key) => object[key], manifest);

        delete parent[last];
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Asserts that the error holds exactly one problem, at the given source, and
// that the problem's message begins with the source and names the value.
function assertOneProblem(caught, source, value) {
    assert(caught, 'expected an error to be thrown');
    assertEqual('ValidationError', caught.name);

    const sources = caught.errors.map((problem) => problem.source);

    assertEqual(source, sources.join(' | '));

    const { message } = caught.errors[0];

    if (source !== '') {
        assert(message.startsWith(source) || message.startsWith(`"${ source }"`), `message starts with path: ${ message }`);
    }

    if (value !== undefined) {
        assertMatches(value, message);
    }

    assertMatches(message, caught.message);
}


describe('plugin-manifest', ({ describe }) => {

    describe('validatePluginManifest with a valid manifest', ({ it }) => {
        it('accepts the example manifest and returns each value', () => {
            const result = validatePlugin(makeManifest());

            assertEqual('visits', result.name);
            assertEqual('7.0.0-alpha.0', result.version);
            assertEqual('7.0.0', result.core);
            assertEqual('Counts visits. One line.', result.description);
            assertEqual('admin', result.dependencies.join(','));
            assertEqual('Visits', result.services.join(','));
            assertEqual('./plugin.js', result.lifecycle.join(','));
            assertEqual('./adapters/node/plugin.js', result.adapters.node.lifecycle.join(','));
            assertEqual('./adapters/cloudflare/plugin.js', result.adapters.cloudflare.lifecycle.join(','));
            assertEqual('VISITS', result.config.keys.join(','));
            assertEqual('hello', result.config.defaults.all.VISITS.greeting);
            assertEqual('sqlite', result.config.defaults.node.VISITS.store);
            assertEqual('VISITS_KV', result.config.defaults.cloudflare.VISITS.kvNamespace.bindingName);
            assertEqual('VISITS_SIGNING_SECRET', result.secrets[0].name);
            assertEqual(true, result.secrets[0].required);
            assertEqual('Signs visit tokens.', result.secrets[0].description);
            assertEqual('VISITS.kvNamespace', result.cloudflare.kvNamespaces[0].config);
            assertEqual('VisitsStore', result.cloudflare.durableObjects[0].className);
            assertEqual('./adapters/cloudflare/lib/visits-store.js', result.cloudflare.durableObjects[0].module);
            assertEqual('VISITS.durableObject', result.cloudflare.durableObjects[0].config);
            assertEqual('./routes.js', result.routes[0].module);
            assertEqual('/visits', result.routes[0].mount);
            assertEqual('visits', result.routes[0].name);
            assertEqual('./pages', result.content.pagesDirectory);
            assertEqual('./templates', result.content.templatesDirectory);
            assertEqual('./static-assets', result.content.staticAssetsDirectory);
            assertEqual('formatVisits,_count2', result.templateHelpers.join(','));
            assertEqual('/admin/visits', result.whenInstalled.admin.routes[0].mount);
            assertEqual(0, result.whenInstalled.admin.lifecycle.length);
            assertEqual(0, Object.keys(result.whenInstalled.admin.content).length);
        });

        it('returns a deeply frozen copy and leaves its input alone', () => {
            const manifest = makeManifest();
            const before = JSON.stringify(manifest);

            const result = validatePlugin(manifest);

            assert(result !== manifest, 'expected a copy');
            assert(Object.isFrozen(result));
            assert(Object.isFrozen(result.dependencies));
            assert(Object.isFrozen(result.adapters.node.lifecycle));
            assert(Object.isFrozen(result.config.defaults.cloudflare.VISITS.kvNamespace));
            assert(Object.isFrozen(result.secrets[0]));
            assert(Object.isFrozen(result.cloudflare.durableObjects[0]));
            assert(Object.isFrozen(result.routes[0]));
            assert(Object.isFrozen(result.templateHelpers));
            assert(Object.isFrozen(result.whenInstalled.admin.routes[0]));

            assertEqual(before, JSON.stringify(manifest));
            assertEqual(false, Object.isFrozen(manifest));
            assertEqual(false, Object.isFrozen(manifest.config.defaults.all.VISITS));
            assert(result.config.defaults.all.VISITS !== manifest.config.defaults.all.VISITS, 'expected defaults to be copied');
        });

        it('fills every optional key of a minimal manifest with its empty value', () => {
            const result = validatePlugin(makeMinimalManifest());

            assertEqual(0, result.dependencies.length);
            assertEqual(0, result.services.length);
            assertEqual(0, result.lifecycle.length);
            assertEqual(0, result.adapters.node.lifecycle.length);
            assertEqual(0, result.adapters.cloudflare.lifecycle.length);
            assertEqual(0, result.config.keys.length);
            assertEqual('{"all":{},"node":{},"cloudflare":{}}', JSON.stringify(result.config.defaults));
            assertEqual(0, result.secrets.length);
            assertEqual(0, result.cloudflare.kvNamespaces.length);
            assertEqual(0, result.cloudflare.durableObjects.length);
            assertEqual(0, result.routes.length);
            assertEqual(0, Object.keys(result.content).length);
            assertEqual(0, result.templateHelpers.length);
            assertEqual(0, Object.keys(result.whenInstalled).length);
        });

        it('defaults a secret to required and keeps an optional one', () => {
            const result = validatePlugin(makeMinimalManifest({
                secrets: [
                    { name: 'A_SECRET', description: 'First.' },
                    { name: '_b_secret', required: false, description: 'Second.' },
                    { name: 'C_SECRET', required: true, description: 'Third.' },
                    { name: 'D_SECRET', required: 'outsideDevelopment', description: 'Fourth.' },
                ],
            }));

            assertEqual(true, result.secrets[0].required);
            assertEqual(false, result.secrets[1].required);
            assertEqual(true, result.secrets[2].required);
            assertEqual('outsideDevelopment', result.secrets[3].required);
        });

        it('accepts an unmounted route and leaves mount and name out of it', () => {
            const result = validatePlugin(makeMinimalManifest({ routes: [ { module: './routes.js' } ] }));

            assertEqual('module', Object.keys(result.routes[0]).join(','));
        });

        it('does not check the directory name when none is given', () => {
            const result = validatePluginManifest(makeMinimalManifest({ name: 'other' }), { file: PLUGIN_FILE });

            assertEqual('other', result.name);
        });

        it('accepts config defaults that are free-form JSON below the top-level keys', () => {
            const result = validatePlugin(makeMinimalManifest({
                config: {
                    keys: [ 'VISITS' ],
                    defaults: { all: { VISITS: { 'any key': [ 1, null, { 'Deep-Key': true } ] } } },
                },
            }));

            assertEqual(true, result.config.defaults.all.VISITS['any key'][2]['Deep-Key']);
        });
    });

    describe('validatePluginManifest with one broken rule', ({ it }) => {
        // Each case changes the example manifest in one way. `source` is the
        // path of the one problem, and `value` is text its message must hold.
        const cases = [
            // name
            { rule: 'name is required', change: unset('name'), source: 'name', value: 'is required' },
            { rule: 'name pattern', change: set('name', 'Visits'), source: 'name', value: '"Visits"' },
            { rule: 'name is not a string', change: set('name', 7), source: 'name', value: '7' },
            { rule: 'name equals the directory name', change: set('name', 'visitors'), source: 'name', value: '"visitors"' },
            { rule: 'name "kixx" is core\'s', change: set('name', 'kixx'), source: 'name', value: '"kixx"' },
            { rule: 'name "app" is reserved', change: set('name', 'app'), source: 'name', value: '"app"' },

            // version, core, description
            { rule: 'version is required', change: unset('version'), source: 'version', value: 'is required' },
            { rule: 'version pattern', change: set('version', '7.0'), source: 'version', value: '"7.0"' },
            { rule: 'core is required', change: unset('core'), source: 'core', value: 'is required' },
            { rule: 'core takes no prerelease tag', change: set('core', '7.0.0-alpha.0'), source: 'core', value: '"7.0.0-alpha.0"' },
            { rule: 'description is required', change: unset('description'), source: 'description', value: 'is required' },
            { rule: 'description is not empty', change: set('description', ''), source: 'description', value: '""' },
            { rule: 'description has no line break', change: set('description', 'One\nTwo'), source: 'description', value: 'line break' },

            // dependencies
            { rule: 'dependencies is an array', change: set('dependencies', 'admin'), source: 'dependencies', value: 'array' },
            { rule: 'a dependency is a plugin name', change: set('dependencies', [ 'Admin' ]), source: 'dependencies[0]', value: '"Admin"' },
            { rule: 'dependencies are unique', change: set('dependencies', [ 'admin', 'admin' ]), source: 'dependencies[1]', value: '"admin"' },
            { rule: 'a plugin does not depend on itself', change: set('dependencies', [ 'visits' ]), source: 'dependencies[0]', value: '"visits"' },

            // services
            { rule: 'a service name pattern', change: set('services', [ 'visits-store' ]), source: 'services[0]', value: '"visits-store"' },
            { rule: 'services are unique', change: set('services', [ 'Visits', 'Visits' ]), source: 'services[1]', value: '"Visits"' },

            // lifecycle and the module path rule
            { rule: 'a lifecycle entry is a module path', change: set('lifecycle', [ 'plugin.js' ]), source: 'lifecycle[0]', value: '"plugin.js"' },
            { rule: 'a module path cannot leave the directory', change: set('lifecycle', [ './../plugin.js' ]), source: 'lifecycle[0]', value: '"./../plugin.js"' },
            { rule: 'a module path ends in .js', change: set('lifecycle', [ './plugin.ts' ]), source: 'lifecycle[0]', value: '"./plugin.ts"' },
            { rule: 'lifecycle entries are unique', change: set('lifecycle', [ './plugin.js', './plugin.js' ]), source: 'lifecycle[1]', value: '"./plugin.js"' },

            // adapters
            { rule: 'adapters is an object', change: set('adapters', []), source: 'adapters', value: 'JSON object' },
            { rule: 'adapters holds only the two targets', change: set('adapters.deno', {}), source: 'adapters.deno', value: 'not a manifest key' },
            { rule: 'an adapter is an object', change: set('adapters.node', './plugin.js'), source: 'adapters.node', value: 'JSON object' },
            { rule: 'an adapter holds only its three keys', change: set('adapters.node.routes', []), source: 'adapters.node.routes', value: 'not a manifest key' },
            { rule: 'an adapter lifecycle entry is a module path', change: set('adapters.node.lifecycle', [ '/abs/plugin.js' ]), source: 'adapters.node.lifecycle[0]', value: '"/abs/plugin.js"' },
            { rule: 'a plugin names no logger writer', change: set('adapters.node.loggerWriter', './writer.js'), source: 'adapters.node.loggerWriter', value: 'only in core' },
            { rule: 'a plugin names no server request', change: set('adapters.cloudflare.serverRequest', './request.js'), source: 'adapters.cloudflare.serverRequest', value: 'only in core' },

            // config
            { rule: 'config holds only keys and defaults', change: set('config.values', {}), source: 'config.values', value: 'not a manifest key' },
            {
                rule: 'a config key pattern',
                change: (m) => {
                    m.config = { keys: [ 'visits' ] };
                    m.cloudflare = {};
                },
                source: 'config.keys[0]',
                value: '"visits"',
            },
            { rule: 'config keys are unique', change: set('config.keys', [ 'VISITS', 'VISITS' ]), source: 'config.keys[1]', value: '"VISITS"' },
            { rule: 'config.defaults holds only all and the two targets', change: set('config.defaults.deno', {}), source: 'config.defaults.deno', value: 'not a manifest key' },
            { rule: 'a defaults block is an object', change: set('config.defaults.node', []), source: 'config.defaults.node', value: 'JSON object' },
            { rule: 'a defaults top-level key is in config.keys', change: set('config.defaults.node.OTHER', {}), source: 'config.defaults.node.OTHER', value: 'config.keys' },
            {
                rule: 'no defaults key is __proto__',
                change: set('config.defaults.all', JSON.parse('{"VISITS":{"list":[{"__proto__":{"a":1}}]}}')),
                source: 'config.defaults.all.VISITS.list[0].__proto__',
                value: 'not allowed',
            },

            // secrets
            { rule: 'secrets is an array', change: set('secrets', {}), source: 'secrets', value: 'array' },
            { rule: 'a secret is an object', change: set('secrets', [ 'A_SECRET' ]), source: 'secrets[0]', value: 'JSON object' },
            { rule: 'a secret holds only its three keys', change: set('secrets.0.value', 'x'), source: 'secrets[0].value', value: 'not a manifest key' },
            { rule: 'a secret name is required', change: unset('secrets.0.name'), source: 'secrets[0].name', value: 'is required' },
            { rule: 'a secret name pattern', change: set('secrets.0.name', 'bad-name'), source: 'secrets[0].name', value: '"bad-name"' },
            { rule: 'BUILD_ID is not a secret name', change: set('secrets.0.name', 'BUILD_ID'), source: 'secrets[0].name', value: '"BUILD_ID"' },
            { rule: 'ENVIRONMENT is not a secret name', change: set('secrets.0.name', 'ENVIRONMENT'), source: 'secrets[0].name', value: '"ENVIRONMENT"' },
            { rule: 'required is a boolean', change: set('secrets.0.required', 'yes'), source: 'secrets[0].required', value: 'must be true, false, or "outsideDevelopment"' },
            { rule: 'required is not another environment', change: set('secrets.0.required', 'outsideProduction'), source: 'secrets[0].required', value: '"outsideProduction"' },
            { rule: 'a secret description is required', change: unset('secrets.0.description'), source: 'secrets[0].description', value: 'is required' },
            { rule: 'a secret description has no line break', change: set('secrets.0.description', 'a\r\nb'), source: 'secrets[0].description', value: 'line break' },
            { rule: 'a secret description is not @optional', change: set('secrets.0.description', ' @optional '), source: 'secrets[0].description', value: '@optional' },
            {
                rule: 'a secret description is not @required-outside-development',
                change: set('secrets.0.description', '@required-outside-development'),
                source: 'secrets[0].description',
                value: 'is reserved',
            },
            {
                rule: 'secret names are unique',
                change: (m) => {
                    m.secrets.push({ name: 'VISITS_SIGNING_SECRET', description: 'Again.' });
                },
                source: 'secrets[1].name',
                value: '"VISITS_SIGNING_SECRET"',
            },

            // cloudflare and the config path rule
            { rule: 'cloudflare holds no d1Databases yet', change: set('cloudflare.d1Databases', []), source: 'cloudflare.d1Databases', value: 'not a manifest key' },
            { rule: 'cloudflare holds no r2Buckets yet', change: set('cloudflare.r2Buckets', []), source: 'cloudflare.r2Buckets', value: 'not a manifest key' },
            {
                rule: 'cloudflare holds no durableObjectMigrations yet',
                change: set('cloudflare.durableObjectMigrations', []),
                source: 'cloudflare.durableObjectMigrations',
                value: 'not a manifest key',
            },
            { rule: 'a KV namespace holds only config', change: set('cloudflare.kvNamespaces.0.bindingName', 'X'), source: 'cloudflare.kvNamespaces[0].bindingName', value: 'not a manifest key' },
            { rule: 'a KV namespace config is required', change: set('cloudflare.kvNamespaces', [ {} ]), source: 'cloudflare.kvNamespaces[0].config', value: 'is required' },
            { rule: 'a config path pattern', change: set('cloudflare.kvNamespaces.0.config', 'VISITS.kv-namespace'), source: 'cloudflare.kvNamespaces[0].config', value: '"VISITS.kv-namespace"' },
            { rule: 'a config path begins with a key in config.keys', change: set('cloudflare.kvNamespaces.0.config', 'OTHER.kvNamespace'), source: 'cloudflare.kvNamespaces[0].config', value: '"OTHER.kvNamespace"' },
            { rule: 'config paths are unique', change: set('cloudflare.durableObjects.0.config', 'VISITS.kvNamespace'), source: 'cloudflare.durableObjects[0].config', value: '"VISITS.kvNamespace"' },
            { rule: 'a Durable Object holds only its three keys', change: set('cloudflare.durableObjects.0.storage', 'sqlite'), source: 'cloudflare.durableObjects[0].storage', value: 'not a manifest key' },
            { rule: 'a class name pattern', change: set('cloudflare.durableObjects.0.className', 'visitsStore'), source: 'cloudflare.durableObjects[0].className', value: '"visitsStore"' },
            { rule: 'a Durable Object module is a module path', change: set('cloudflare.durableObjects.0.module', 'visits-store.js'), source: 'cloudflare.durableObjects[0].module', value: '"visits-store.js"' },
            {
                rule: 'class names are unique',
                change: (m) => {
                    m.config.keys.push('MORE');
                    m.cloudflare.durableObjects.push({ className: 'VisitsStore', module: './other.js', config: 'MORE.durableObject' });
                },
                source: 'cloudflare.durableObjects[1].className',
                value: '"VisitsStore"',
            },

            // routes
            { rule: 'routes is an array', change: set('routes', {}), source: 'routes', value: 'array' },
            { rule: 'a route holds only its three keys', change: set('routes.0.pattern', '/x'), source: 'routes[0].pattern', value: 'not a manifest key' },
            { rule: 'a route module is required', change: unset('routes.0.module'), source: 'routes[0].module', value: 'is required' },
            { rule: 'a mount starts with a slash', change: set('routes.0.mount', 'visits'), source: 'routes[0].mount', value: '"visits"' },
            { rule: 'a mount holds no whitespace', change: set('routes.0.mount', '/my visits'), source: 'routes[0].mount', value: '"/my visits"' },
            { rule: 'a mount holds no quote', change: set('routes.0.mount', '/visits\''), source: 'routes[0].mount', value: 'must match' },
            { rule: 'a mount holds no backslash', change: set('routes.0.mount', '/visits\\x'), source: 'routes[0].mount', value: 'must match' },
            { rule: 'a route name pattern', change: set('routes.0.name', 'Visits'), source: 'routes[0].name', value: '"Visits"' },
            { rule: 'a name is required with a mount', change: unset('routes.0.name'), source: 'routes[0].name', value: 'is required' },
            { rule: 'a name is not allowed without a mount', change: unset('routes.0.mount'), source: 'routes[0].name', value: '"visits"' },

            // content and the directory path rule
            { rule: 'content holds only its three keys', change: set('content.publicDirectory', './public'), source: 'content.publicDirectory', value: 'not a manifest key' },
            { rule: 'content holds at least one directory', change: set('content', {}), source: 'content', value: 'at least one' },
            { rule: 'a directory path pattern', change: set('content.pagesDirectory', 'pages'), source: 'content.pagesDirectory', value: '"pages"' },
            { rule: 'a directory path cannot leave the directory', change: set('content.pagesDirectory', './../pages'), source: 'content.pagesDirectory', value: '"./../pages"' },
            { rule: 'a directory path has no trailing slash', change: set('content.pagesDirectory', './pages/'), source: 'content.pagesDirectory', value: '"./pages/"' },

            // templateHelpers
            { rule: 'templateHelpers is an array', change: set('templateHelpers', 'formatVisits'), source: 'templateHelpers', value: 'array' },
            { rule: 'a helper name is a string', change: set('templateHelpers.1', 7), source: 'templateHelpers[1]', value: '7 must match' },
            { rule: 'a helper name holds no hyphen', change: set('templateHelpers.0', 'format-money'), source: 'templateHelpers[0]', value: '"format-money"' },
            { rule: 'a helper name holds no dot', change: set('templateHelpers.0', 'a.b'), source: 'templateHelpers[0]', value: '"a.b"' },
            { rule: 'a helper name does not start with a digit', change: set('templateHelpers.0', '2count'), source: 'templateHelpers[0]', value: '"2count"' },
            { rule: 'a helper name is not empty', change: set('templateHelpers.0', ''), source: 'templateHelpers[0]', value: '"" must match' },
            { rule: 'a helper name is listed once', change: set('templateHelpers.1', 'formatVisits'), source: 'templateHelpers[1]', value: 'more than once' },

            // whenInstalled
            { rule: 'whenInstalled is an object', change: set('whenInstalled', []), source: 'whenInstalled', value: 'JSON object' },
            { rule: 'whenInstalled is keyed by plugin name', change: set('whenInstalled', { Admin: { lifecycle: [ './a.js' ] } }), source: 'whenInstalled.Admin', value: 'plugin name' },
            { rule: 'whenInstalled does not name the plugin itself', change: set('whenInstalled', { visits: { lifecycle: [ './a.js' ] } }), source: 'whenInstalled.visits', value: 'itself' },
            { rule: 'a whenInstalled block is an object', change: set('whenInstalled.admin', []), source: 'whenInstalled.admin', value: 'JSON object' },
            { rule: 'a whenInstalled block holds only its three keys', change: set('whenInstalled.admin.secrets', []), source: 'whenInstalled.admin.secrets', value: 'not a manifest key' },
            {
                rule: 'a whenInstalled block declares no template helpers',
                change: set('whenInstalled.admin.templateHelpers', [ 'formatVisits' ]),
                source: 'whenInstalled.admin.templateHelpers',
                value: 'not a manifest key',
            },
            { rule: 'a whenInstalled block holds at least one key', change: set('whenInstalled.admin', {}), source: 'whenInstalled.admin', value: 'at least one' },
            { rule: 'a whenInstalled lifecycle entry is a module path', change: set('whenInstalled.admin.lifecycle', [ 'a.js' ]), source: 'whenInstalled.admin.lifecycle[0]', value: '"a.js"' },
            { rule: 'a whenInstalled route follows the route rules', change: unset('whenInstalled.admin.routes.0.name'), source: 'whenInstalled.admin.routes[0].name', value: 'is required' },
            { rule: 'whenInstalled content follows the content rules', change: set('whenInstalled.admin.content', { pagesDirectory: 'pages' }), source: 'whenInstalled.admin.content.pagesDirectory', value: '"pages"' },

            // unknown keys
            { rule: 'an unknown top-level key', change: set('migrations', []), source: 'migrations', value: '"migrations" is not a manifest key' },
        ];

        for (const { rule, change, source, value } of cases) {
            it(`rejects: ${ rule }`, () => {
                const manifest = makeManifest();
                change(manifest);

                const caught = catchError(() => validatePlugin(manifest));

                assertOneProblem(caught, source, value);
            });
        }
    });

    describe('validatePluginManifest errors', ({ it }) => {
        it('reports a manifest that is not an object as one problem', () => {
            for (const manifest of [ undefined, null, [], 'visits', 7 ]) {
                const caught = catchError(() => validatePlugin(manifest));

                assertOneProblem(caught, '', 'must be a JSON object');
                assertEqual(`Invalid plugin manifest ${ PLUGIN_FILE }: must be a JSON object`, caught.message);
            }
        });

        it('reports three unrelated mistakes in one error', () => {
            const manifest = makeManifest();
            manifest.version = 'seven';
            manifest.secrets[0].name = 'bad-name';
            manifest.adapters.node.lifecycle = [ 'plugin.js' ];

            const caught = catchError(() => validatePlugin(manifest));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ValidationError', caught.name);
            assertEqual(3, caught.errors.length);
            assertEqual('version | adapters.node.lifecycle[0] | secrets[0].name', caught.errors.map((p) => p.source).join(' | '));
            assertEqual(
                'secrets[0].name "bad-name" must match /^[A-Za-z_][A-Za-z0-9_]*$/',
                caught.errors[2].message,
            );
            assertEqual(
                `Invalid plugin manifest ${ PLUGIN_FILE }: ${ caught.errors.map((p) => p.message).join('; ') }`,
                caught.message,
            );
        });

        it('never puts a config default value in a message', () => {
            const manifest = makeManifest();
            manifest.config.defaults.node.OTHER = { token: 'default-value-91ab' };
            manifest.config.defaults.all = [ 'default-value-5f2c' ];

            const caught = catchError(() => validatePlugin(manifest));

            assert(caught, 'expected an error to be thrown');
            assertEqual(2, caught.errors.length);
            assertEqual(false, caught.message.includes('default-value'));
        });

        it('throws an AssertionError when no file is given', () => {
            const caught = catchError(() => validatePluginManifest(makeManifest(), {}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('validatePluginManifest for core', ({ it }) => {
        it('accepts core\'s manifest and leaves out the plugin-only keys', () => {
            const result = validateCore(makeCoreManifest());

            assertEqual('kixx', result.name);
            assertUndefined(result.core);
            assertEqual(0, result.dependencies.length);
            assertEqual(0, Object.keys(result.whenInstalled).length);
            assertEqual('./adapters/node/logger-writer/lib/logger-writer.js', result.adapters.node.loggerWriter);
            assertEqual('./adapters/cloudflare/server-request/lib/server-request.js', result.adapters.cloudflare.serverRequest);
            assert(Object.isFrozen(result.adapters.node));
        });

        it('accepts a secret required outside development', () => {
            const result = validateCore(makeCoreManifest({
                secrets: [ { name: 'DEPLOY_KEY_HASH', required: 'outsideDevelopment', description: 'Hash.' } ],
            }));

            assertEqual('outsideDevelopment', result.secrets[0].required);
        });

        it('accepts template helper names', () => {
            const result = validateCore(makeCoreManifest({ templateHelpers: [ 'each', 'formatDate' ] }));

            assertEqual('each,formatDate', result.templateHelpers.join(','));
            assertEqual(0, validateCore(makeCoreManifest()).templateHelpers.length);
        });

        it('rejects a manifest named kixx without isCore', () => {
            const caught = catchError(() => {
                validatePluginManifest(makeMinimalManifest({ name: 'kixx' }), { file: CORE_FILE, directoryName: 'kixx' });
            });

            assertOneProblem(caught, 'name', '"kixx"');
        });

        it('rejects any other name with isCore', () => {
            const caught = catchError(() => validateCore(makeCoreManifest({ name: 'visits' })));

            assertOneProblem(caught, 'name', '"visits"');
        });

        it('rejects core, dependencies, and whenInstalled with isCore', () => {
            const pluginOnly = {
                core: '7.0.0',
                dependencies: [],
                whenInstalled: {},
            };

            for (const [ key, value ] of Object.entries(pluginOnly)) {
                const caught = catchError(() => validateCore(makeCoreManifest({ [key]: value })));

                assertOneProblem(caught, key, 'not allowed in core');
            }
        });

        it('rejects a missing logger writer or server request for either target', () => {
            for (const target of [ 'node', 'cloudflare' ]) {
                for (const key of [ 'loggerWriter', 'serverRequest' ]) {
                    const manifest = makeCoreManifest();
                    delete manifest.adapters[target][key];

                    const caught = catchError(() => validateCore(manifest));

                    assertOneProblem(caught, `adapters.${ target }.${ key }`, 'is required');
                }
            }
        });

        it('rejects a manifest with no adapters at all, naming all four modules', () => {
            const manifest = makeCoreManifest();
            delete manifest.adapters;

            const caught = catchError(() => validateCore(manifest));

            assert(caught, 'expected an error to be thrown');
            assertEqual(
                'adapters.node.loggerWriter | adapters.node.serverRequest | adapters.cloudflare.loggerWriter | adapters.cloudflare.serverRequest',
                caught.errors.map((p) => p.source).join(' | '),
            );
        });

        it('rejects a logger writer that is not a module path', () => {
            const manifest = makeCoreManifest();
            manifest.adapters.node.loggerWriter = 'logger-writer.js';

            const caught = catchError(() => validateCore(manifest));

            assertOneProblem(caught, 'adapters.node.loggerWriter', '"logger-writer.js"');
        });
    });

    describe('validateAppManifest', ({ it }) => {
        function validateApp(manifest) {
            return validateAppManifest(manifest, { file: APP_FILE });
        }

        it('accepts an empty manifest', () => {
            const result = validateApp({});

            assertEqual(0, result.secrets.length);
            assertEqual(0, result.templateHelpers.length);
            assert(Object.isFrozen(result));
            assert(Object.isFrozen(result.secrets));
            assert(Object.isFrozen(result.templateHelpers));
        });

        it('accepts secrets and normalizes them', () => {
            const manifest = {
                secrets: [
                    { name: 'SUPPORT_TOKEN', required: false, description: 'Lets support staff sign in.' },
                    { name: 'MAIL_API_KEY', description: 'Sends mail.' },
                    { name: 'BILLING_KEY', required: 'outsideDevelopment', description: 'Charges cards.' },
                ],
            };

            const result = validateApp(manifest);

            assertEqual('outsideDevelopment', result.secrets[2].required);

            assertEqual('SUPPORT_TOKEN', result.secrets[0].name);
            assertEqual(false, result.secrets[0].required);
            assertEqual(true, result.secrets[1].required);
            assert(Object.isFrozen(result.secrets[0]));
            assertEqual(false, Object.isFrozen(manifest.secrets[0]));
            assertUndefined(manifest.secrets[1].required);
        });

        it('accepts template helper names', () => {
            const result = validateApp({ templateHelpers: [ 'formatMoney', 'initials' ] });

            assertEqual('formatMoney,initials', result.templateHelpers.join(','));
        });

        it('applies the template helper rules', () => {
            const caught = catchError(() => {
                validateApp({ templateHelpers: [ 'formatMoney', 'format-money', 'formatMoney' ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('templateHelpers[1] | templateHelpers[2]', caught.errors.map((p) => p.source).join(' | '));
            assertMatches('templateHelpers[2] "formatMoney" is listed more than once', caught.message);
        });

        it('rejects a helper list that is not an array', () => {
            const caught = catchError(() => validateApp({ templateHelpers: {} }));

            assertOneProblem(caught, 'templateHelpers', 'must be a JSON array');
        });

        it('rejects any other key', () => {
            for (const key of [ 'config', 'name', 'routes' ]) {
                const caught = catchError(() => validateApp({ [key]: {} }));

                assertOneProblem(caught, key, `"${ key }" is not a manifest key`);
                assertMatches(`Invalid app manifest ${ APP_FILE }: `, caught.message);
            }
        });

        it('applies the secrets rule', () => {
            const caught = catchError(() => {
                validateApp({ secrets: [ { name: 'BUILD_ID', description: '@optional' } ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('secrets[0].name | secrets[0].description', caught.errors.map((p) => p.source).join(' | '));
        });

        it('reports a manifest that is not an object as one problem', () => {
            const caught = catchError(() => validateApp([]));

            assertOneProblem(caught, '', 'must be a JSON object');
            assertEqual(`Invalid app manifest ${ APP_FILE }: must be a JSON object`, caught.message);
        });
    });
});
