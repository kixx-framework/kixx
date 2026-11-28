// Core describes itself in the plugin schema (PLUG-1): kixx/plugin.json. The
// registry generator reads it as the first entry, so every module it names
// must exist and have the shape a generated registry expects.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe } from 'kixx-test';
import { assert, assertEqual, isFunction } from 'kixx-assert';

import { validatePluginManifest, resolveInstallation } from '../../kixx/tooling/mod.js';
import HyperviewService from '../../kixx/hyperview/hyperview-service.js';


const CORE_URL = new URL('../../kixx/', import.meta.url);
const LIFECYCLE_HOOKS = [ 'register', 'initialize', 'start', 'stop' ];
const TARGETS = [ 'node', 'cloudflare' ];


function readCoreManifest() {
    const text = fs.readFileSync(fileURLToPath(new URL('plugin.json', CORE_URL)), 'utf8');
    return validatePluginManifest(JSON.parse(text), { file: 'kixx/plugin.json', isCore: true });
}

function importCoreModule(modulePath) {
    return import(new URL(modulePath, CORE_URL).href);
}

function listLifecycleModules(manifest) {
    return manifest.lifecycle.concat(TARGETS.flatMap((target) => manifest.adapters[target].lifecycle));
}

function listClassModules(manifest) {
    return TARGETS.flatMap((target) => {
        return [ manifest.adapters[target].loggerWriter, manifest.adapters[target].serverRequest ];
    });
}


describe('core manifest', ({ it }) => {
    const manifest = readCoreManifest();

    it('is valid as core\'s manifest', () => {
        assertEqual('kixx', manifest.name);
        assertEqual('7.0.0-alpha.0', manifest.version);
        assert(Object.isFrozen(manifest));
    });

    it('resolves alone, as an installation with no plugins', () => {
        const installation = resolveInstallation({ core: manifest, plugins: [] });

        assertEqual('kixx', installation.entries.map((entry) => entry.name).join(','));
        assertEqual(1, installation.routes.length);
    });

    it('mounts the Publishing API at /publishing-api/v1', () => {
        assertEqual(1, manifest.routes.length);

        const [ route ] = manifest.routes;

        assertEqual('./publishing-api/routes.js', route.module);
        assertEqual('/publishing-api/v1', route.mount);
        assertEqual('publishing-api', route.name);
    });

    it('declares exactly one secret, the deploy key hash, required outside development', () => {
        assertEqual(1, manifest.secrets.length);
        assertEqual('DEPLOY_KEY_HASH', manifest.secrets[0].name);
        assertEqual('outsideDevelopment', manifest.secrets[0].required);
    });

    it('declares exactly the template helpers a new HyperviewService has', () => {
        const noop = () => {};
        const logger = { createChild: () => ({ debug: noop, info: noop, warn: noop, error: noop }) };
        const service = new HyperviewService({ logger });

        const { undeclared, unregistered } = service.reportTemplateHelperDifferences(manifest.templateHelpers);

        assertEqual('', undeclared.join(','), 'built-in helpers missing from kixx/plugin.json');
        assertEqual('', unregistered.join(','), 'helpers in kixx/plugin.json that Hyperview does not have');
        assertEqual(11, manifest.templateHelpers.length);
    });

    it('names only modules that exist', () => {
        // The Durable Object module is checked as a file only. It is a shell,
        // and only Cloudflare can load it.
        const modules = [
            ...listLifecycleModules(manifest),
            ...listClassModules(manifest),
            ...manifest.cloudflare.durableObjects.map((durableObject) => durableObject.module),
            ...manifest.routes.map((route) => route.module),
        ];

        assertEqual(13, modules.length);

        const missing = modules.filter((modulePath) => {
            const filepath = fileURLToPath(new URL(modulePath, CORE_URL));
            return !fs.existsSync(filepath) || !fs.statSync(filepath).isFile();
        });

        assertEqual('', missing.join('\n'));
    });

    it('lists lifecycle modules that each export a lifecycle hook', async () => {
        for (const modulePath of listLifecycleModules(manifest)) {
            const module = await importCoreModule(modulePath);
            const hooks = LIFECYCLE_HOOKS.filter((name) => isFunction(module[name]));

            assert(hooks.length > 0, `${ modulePath } exports a lifecycle hook`);
        }
    });

    it('names a class as each target\'s logger writer and server request', async () => {
        for (const modulePath of listClassModules(manifest)) {
            const module = await importCoreModule(modulePath);

            assert(isFunction(module.default), `${ modulePath } exports a class by default`);
        }
    });

    it('gives each target the config defaults its registration modules read', () => {
        const { node, cloudflare } = resolveInstallation({ core: manifest, plugins: [] }).targets;

        assertEqual(
            JSON.stringify({
                useTemplateCache: false,
                usePageCache: false,
                pageCacheReadTtlSeconds: 86400,
                pageCacheExpirationSeconds: 86400,
                allowJsonResponse: false,
            }),
            JSON.stringify(node.configDefaults.HYPERVIEW),
        );
        assertEqual(JSON.stringify(node.configDefaults.HYPERVIEW), JSON.stringify(cloudflare.configDefaults.HYPERVIEW));

        // OP-C: the Node.js store paths, so a project's config needn't name them.
        assertEqual('HYPERVIEW,KEY_VALUE_STORE,CONTENT_STORE', Object.keys(node.configDefaults).join(','));
        assertEqual('{"path":"data/key-value-store.sqlite"}', JSON.stringify(node.configDefaults.KEY_VALUE_STORE));
        assertEqual('{"rootDirectory":"data/content-store"}', JSON.stringify(node.configDefaults.CONTENT_STORE));

        assertEqual('KEY_VALUE_STORE', cloudflare.configDefaults.KEY_VALUE_STORE.bindingName);
        assertEqual(
            JSON.stringify({
                blobReadCacheTtlSeconds: 86400,
                indexCacheTtlSeconds: 10,
                kvNamespace: { bindingName: 'CA_STORE_KV_STORE' },
                durableObject: { bindingName: 'CA_STORE_DURABLE_OBJECT' },
            }),
            JSON.stringify(cloudflare.configDefaults.CONTENT_STORE),
        );
    });

    it('declares its Cloudflare resources as config paths', () => {
        assertEqual(
            'KEY_VALUE_STORE,CONTENT_STORE.kvNamespace',
            manifest.cloudflare.kvNamespaces.map((namespace) => namespace.config).join(','),
        );
        assertEqual(
            'ContentAddressableIndexStore:CONTENT_STORE.durableObject',
            manifest.cloudflare.durableObjects.map((object) => `${ object.className }:${ object.config }`).join(','),
        );
    });
});
