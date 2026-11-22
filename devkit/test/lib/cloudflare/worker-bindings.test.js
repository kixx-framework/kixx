import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { buildWorkerBindings } from '../../../lib/cloudflare/worker-bindings.js';
import CloudflareWorkerVersion from '../../../lib/cloudflare/cloudflare-worker-version.js';


describe('cloudflare/worker-bindings', ({ it }) => {
    it('produces the expected binding set from a full sample environment', () => {
        const bindings = build({ inheritedSecretNames: [ 'API_SECRET' ] });

        const byType = groupByType(bindings);

        assertEqual(1, byType.d1.length);
        assertEqual(2, byType.kv_namespace.length);
        assertEqual(1, byType.durable_object_namespace.length);
        assertEqual(1, byType.r2_bucket.length);
        assertEqual(1, byType.images.length);
        // TRUST_PROXY, plus the injected ENVIRONMENT.
        assertEqual(2, byType.plain_text.length);
        assertEqual(1, byType.inherit.length);
        assertEqual(
            'd1,durable_object_namespace,images,inherit,kv_namespace,plain_text,r2_bucket',
            Object.keys(byType).sort().join(','),
        );
    });

    it('projects IMAGES without application fields', () => {
        const bindings = build({
            environmentConfig: {
                IMAGES: { bindingName: 'IMAGES', bucket: 'media' },
            },
            envars: {},
        });

        assertEqual(JSON.stringify([
            { type: 'plain_text', name: 'ENVIRONMENT', text: 'production' },
            { type: 'images', name: 'IMAGES' },
        ]), JSON.stringify(bindings));
    });

    // Every name-only block shares one validation path; each case runs against each block.
    const NAME_ONLY_BLOCKS = [ 'IMAGES' ];

    it('rejects malformed present name-only blocks', () => {
        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const block of [ null, false, '', 'IMAGES', [], 42 ]) {
                const caught = catchError(() => build({ environmentConfig: { [configKey]: block } }));

                assert(caught, `expected malformed ${ configKey } configuration to be rejected`);
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(`${ configKey } must be an object`), 'expected the config path');
            }
        }
    });

    it('rejects missing, empty, and invalid name-only binding names', () => {
        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const bindingName of [ undefined, null, false, 42, '', ' ', ' IMAGES', 'IMAGES ', '1IMAGES', 'MY-IMAGES' ]) {
                const caught = catchError(() => {
                    return build({ environmentConfig: { [configKey]: { bindingName } } });
                });

                assert(caught, `expected an invalid ${ configKey } binding name to be rejected`);
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(`${ configKey }.bindingName`), 'expected the config path');
            }
        }
    });

    it('rejects command-owned name-only binding names', () => {
        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const bindingName of [ 'ENVIRONMENT', 'BUILD_ID' ]) {
                const caught = catchError(() => {
                    return build({ environmentConfig: { [configKey]: { bindingName } } });
                });

                assert(caught, 'expected a reserved name to be rejected');
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(`${ configKey }.bindingName`), 'expected the config path');
                assert(caught.message.includes(bindingName), 'expected the reserved name');
            }
        }
    });

    it('reports both sources when a name-only binding collides with a resource, plain value, or secret', () => {
        const cases = [
            { bindingName: 'DOCUMENT_STORE', source: 'DOCUMENT_STORE' },
            { bindingName: 'TRUST_PROXY', source: '.env.production' },
            { bindingName: 'API_SECRET', source: 'example.env.secrets' },
        ];

        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const { bindingName, source } of cases) {
                const environmentConfig = makeEnvironmentConfig();
                environmentConfig[configKey] = { bindingName };

                const caught = catchError(() => build({ environmentConfig, inheritedSecretNames: [ 'API_SECRET' ] }));

                assert(caught, 'expected a collision to be rejected');
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(configKey), `expected the ${ configKey } source`);
                assert(caught.message.includes(source), 'expected the conflicting source');
            }
        }
    });

    it('sorts the result by name regardless of input key order', () => {
        const config = makeEnvironmentConfig();

        const bindingsOne = build({ environmentConfig: config, inheritedSecretNames: [ 'API_SECRET' ] });

        const reordered = {
            IMAGES: config.IMAGES,
            OBJECT_STORE: config.OBJECT_STORE,
            CONTENT_STORE: config.CONTENT_STORE,
            KEY_VALUE_STORE: config.KEY_VALUE_STORE,
            DOCUMENT_STORE: config.DOCUMENT_STORE,
        };
        const bindingsTwo = build({ environmentConfig: reordered, inheritedSecretNames: [ 'API_SECRET' ] });

        assertEqual(JSON.stringify(bindingsOne), JSON.stringify(bindingsTwo));

        const names = bindingsOne.map((binding) => binding.name);
        const sortedNames = names.slice().sort();
        assertEqual(sortedNames.join(','), names.join(','));
    });

    it('produces bindings every one of which CloudflareWorkerVersion#addBinding() accepts', () => {
        const bindings = build({ inheritedSecretNames: [ 'API_SECRET' ] });

        const version = new CloudflareWorkerVersion();

        for (const binding of bindings) {
            version.addBinding(binding);
        }

        assert(true, 'expected no binding to be rejected');
    });
});

function makeEnvironmentConfig() {
    return {
        DOCUMENT_STORE: {
            bindingName: 'DOCUMENT_STORE',
            databaseId: 'database-id',
        },
        KEY_VALUE_STORE: {
            bindingName: 'KEY_VALUE_STORE',
            namespaceId: 'kv-namespace-id',
        },
        CONTENT_STORE: {
            kvBindingName: 'CONTENT_STORE_KV',
            kvNamespaceId: 'content-kv-namespace-id',
            durableObjectBindingName: 'CONTENT_STORE_DO',
            durableObjectClassName: 'ContentAddressableIndexStore',
        },
        OBJECT_STORE: {
            buckets: { assets: { bindingName: 'ASSET_BUCKET', bucketName: 'assets' } },
        },
        IMAGES: { bindingName: 'IMAGES', bucket: 'media' },
    };
}

// Every case here is a variation on one full environment, so the defaults are
// the sample and a test names only what it is actually varying.
function build(args) {
    const {
        environmentConfig = makeEnvironmentConfig(),
        environment = 'production',
        envars = { TRUST_PROXY: 'false' },
        inheritedSecretNames = [],
        secretVersionId = 'source-version-id',
    } = args;

    return buildWorkerBindings({ environmentConfig, environment, envars, inheritedSecretNames, secretVersionId });
}

function groupByType(bindings) {
    const groups = {};

    for (const binding of bindings) {
        groups[binding.type] = groups[binding.type] ?? [];
        groups[binding.type].push(binding);
    }

    return groups;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
