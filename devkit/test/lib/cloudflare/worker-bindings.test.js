import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { buildDurableObjectBindings, buildWorkerBindings } from '../../../lib/cloudflare/worker-bindings.js';
import CloudflareWorkerVersion from '../../../lib/cloudflare/cloudflare-worker-version.js';
import { parseJsonc } from '../../../lib/parse-jsonc.js';


describe('cloudflare/worker-bindings', ({ it }) => {
    it('produces the expected binding set from a full sample environment', () => {
        const bindings = build({ inheritedSecretNames: [ 'API_SECRET' ] });

        const byType = groupByType(bindings);

        assertEqual(1, byType.d1.length);
        assertEqual(2, byType.kv_namespace.length);
        assertEqual(1, byType.durable_object_namespace.length);
        assertEqual(1, byType.r2_bucket.length);
        assertEqual(1, byType.send_email.length);
        assertEqual(1, byType.images.length);
        // TRUST_PROXY, plus the injected ENVIRONMENT.
        assertEqual(2, byType.plain_text.length);
        assertEqual(1, byType.inherit.length);
    });

    it('binds plain values and inherits declared secrets from an exact version', () => {
        const bindings = build({
            envars: { TRUST_PROXY: 'false' },
            inheritedSecretNames: [ 'API_SECRET' ],
            secretVersionId: 'source-version',
        });

        const byName = groupByName(bindings);

        assertEqual('plain_text', byName.TRUST_PROXY.type);
        assertEqual('false', byName.TRUST_PROXY.text);
        assertEqual('inherit', byName.API_SECRET.type);
        assertEqual('source-version', byName.API_SECRET.version_id);
    });

    it('rejects ENVIRONMENT in envars, which readEnvFile() already drops', () => {
        const caught = catchError(() => build({ envars: { ENVIRONMENT: 'development' } }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('.env.production'), 'expected the file');
        assert(caught.message.includes('ENVIRONMENT'), 'expected the name');
    });

    it('rejects reserved names on any config binding', () => {
        for (const bindingName of [ 'ENVIRONMENT', 'BUILD_ID' ]) {
            const config = makeEnvironmentConfig();
            config.DOCUMENT_STORE.bindingName = bindingName;

            const caught = catchError(() => build({ environmentConfig: config }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('UsageError', caught.name);
            assert(caught.message.includes('environments.production.DOCUMENT_STORE.bindingName'), 'expected the full config path');
        }
    });

    it('requires an exact source version to inherit secrets', () => {
        const caught = catchError(() => build({ inheritedSecretNames: [ 'API_SECRET' ], secretVersionId: null }));

        assert(caught, 'expected an error to be thrown');
        assert(caught.message.includes('secretVersionId'), 'expected the missing argument');
    });

    it('needs no source version when nothing is inherited', () => {
        const bindings = build({ inheritedSecretNames: [], secretVersionId: null });

        assert(!bindings.some((binding) => binding.type === 'inherit'), 'expected no inherit bindings');
    });

    it('binds ENVIRONMENT even when the plain file omits it', () => {
        const bindings = build({ environmentConfig: {}, envars: {} });

        assertEqual(1, bindings.length);
        assertEqual('ENVIRONMENT', bindings[0].name);
        assertEqual('production', bindings[0].text);
    });

    it('never includes BUILD_ID with unrelated envars and declared secrets', () => {
        const bindings = build({ inheritedSecretNames: [ 'API_SECRET' ] });

        assert(!bindings.some((binding) => binding.name === 'BUILD_ID'), 'expected no BUILD_ID binding');
    });

    it('produces no r2_bucket bindings for an empty buckets array', () => {
        const config = makeEnvironmentConfig();
        config.OBJECT_STORE = { buckets: {} };

        const bindings = build({ environmentConfig: config });

        assert(!bindings.some((binding) => binding.type === 'r2_bucket'), 'expected no r2_bucket bindings');
    });

    it('names a non-default bucket jurisdiction on the r2_bucket binding', () => {
        const config = makeEnvironmentConfig();
        config.OBJECT_STORE.buckets.assets.jurisdiction = 'eu';

        const byName = groupByName(build({ environmentConfig: config }));

        assertEqual('eu', byName.ASSET_BUCKET.jurisdiction);
    });

    it('produces an identical binding for an omitted and an explicit default jurisdiction', () => {
        const explicit = makeEnvironmentConfig();
        explicit.OBJECT_STORE.buckets.assets.jurisdiction = 'default';

        const explicitBinding = groupByName(build({ environmentConfig: explicit })).ASSET_BUCKET;
        const omittedBinding = groupByName(build({})).ASSET_BUCKET;

        assertEqual(JSON.stringify(omittedBinding), JSON.stringify(explicitBinding));
        assert(!Object.hasOwn(omittedBinding, 'jurisdiction'), 'expected no jurisdiction field');
    });

    it('omits every config block independently', () => {
        const bindings = build({ environmentConfig: {}, envars: {}, inheritedSecretNames: [] });

        assertEqual(1, bindings.length);
        assertEqual('ENVIRONMENT', bindings[0].name);
    });

    it('throws a UsageError naming the config path for a missing required field', () => {
        const config = makeEnvironmentConfig();
        delete config.DOCUMENT_STORE.bindingName;

        const caught = catchError(() => build({ environmentConfig: config }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('DOCUMENT_STORE.bindingName'), 'expected the message to name the path');
    });

    it('projects SEND_EMAIL and IMAGES without application fields', () => {
        const bindings = build({
            environmentConfig: {
                SEND_EMAIL: { bindingName: 'EMAIL', from: 'no-reply@example.com' },
                IMAGES: { bindingName: 'IMAGES', bucket: 'media' },
            },
            envars: {},
        });

        assertEqual(JSON.stringify([
            { type: 'send_email', name: 'EMAIL' },
            { type: 'plain_text', name: 'ENVIRONMENT', text: 'production' },
            { type: 'images', name: 'IMAGES' },
        ]), JSON.stringify(bindings));
    });

    // SEND_EMAIL and IMAGES share one validation path; each case runs against both.
    const NAME_ONLY_BLOCKS = [ 'SEND_EMAIL', 'IMAGES' ];

    it('rejects malformed present name-only blocks', () => {
        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const block of [ null, false, '', 'EMAIL', [], 42 ]) {
                const caught = catchError(() => build({ environmentConfig: { [configKey]: block } }));

                assert(caught, `expected malformed ${ configKey } configuration to be rejected`);
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(`${ configKey } must be an object`), 'expected the config path');
            }
        }
    });

    it('rejects missing, empty, and invalid name-only binding names', () => {
        for (const configKey of NAME_ONLY_BLOCKS) {
            for (const bindingName of [ undefined, null, false, 42, '', ' ', ' EMAIL', 'EMAIL ', '1EMAIL', 'SEND-EMAIL' ]) {
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

    it('throws a UsageError naming the config path when a resource id is missing or null', () => {
        const config = makeEnvironmentConfig();
        config.DOCUMENT_STORE.databaseId = null;

        const caught = catchError(() => build({ environmentConfig: config }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('environments.production.DOCUMENT_STORE.databaseId'), 'expected the config path');
    });

    it('throws naming the plain file when it declares BUILD_ID', () => {
        const caught = catchError(() => build({ envars: { BUILD_ID: 'nope' } }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('.env.production'), 'expected the message to name the file');
    });

    it('throws naming both sources for a plain name colliding with a declared secret', () => {
        const caught = catchError(() => {
            return build({ envars: { API_SECRET: 'plain' }, inheritedSecretNames: [ 'API_SECRET' ] });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('.env.production'), 'expected the message to name the plain file');
        assert(caught.message.includes('example.env.secrets'), 'expected the message to name the declaration file');
    });

    it('throws naming both sources for a dotenv name colliding with a config binding name', () => {
        const caught = catchError(() => build({ inheritedSecretNames: [ 'DOCUMENT_STORE' ] }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('DOCUMENT_STORE'), 'expected the message to name DOCUMENT_STORE');
    });

    it('throws naming both sources for a duplicate name across two config blocks', () => {
        const config = makeEnvironmentConfig();
        config.KEY_VALUE_STORE.bindingName = config.DOCUMENT_STORE.bindingName;

        const caught = catchError(() => build({ environmentConfig: config }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('DOCUMENT_STORE'), 'expected the message to name DOCUMENT_STORE');
        assert(caught.message.includes('KEY_VALUE_STORE'), 'expected the message to name KEY_VALUE_STORE');
    });

    it('binds a JOB_QUEUE Durable Object namespace and ignores runtime config keys', () => {
        const config = makeEnvironmentConfig();
        config.JOB_QUEUE = {
            durableObjectBindingName: 'JOB_QUEUE_DURABLE_OBJECT',
            durableObjectClassName: 'JobQueueStore',
            concurrency: 4,
            retention: { completedMaxAgeDays: 7 },
        };

        const byName = groupByName(build({ environmentConfig: config }));

        assertEqual('durable_object_namespace', byName.JOB_QUEUE_DURABLE_OBJECT.type);
        assertEqual('JobQueueStore', byName.JOB_QUEUE_DURABLE_OBJECT.class_name);
        assertEqual(3, Object.keys(byName.JOB_QUEUE_DURABLE_OBJECT).length);
    });

    it('names the exact JOB_QUEUE field path when a required field is missing', () => {
        for (const field of [ 'durableObjectBindingName', 'durableObjectClassName' ]) {
            const config = makeEnvironmentConfig();
            config.JOB_QUEUE = {
                durableObjectBindingName: 'JOB_QUEUE_DURABLE_OBJECT',
                durableObjectClassName: 'JobQueueStore',
            };
            delete config.JOB_QUEUE[field];

            const caught = catchError(() => build({ environmentConfig: config }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('UsageError', caught.name);
            assert(caught.message.includes(`JOB_QUEUE.${ field }`), `expected the message to name JOB_QUEUE.${ field }`);
        }
    });

    it('rejects a JOB_QUEUE binding name that collides with another binding', () => {
        const config = makeEnvironmentConfig();
        config.JOB_QUEUE = {
            durableObjectBindingName: 'CONTENT_STORE_DO',
            durableObjectClassName: 'JobQueueStore',
        };

        const caught = catchError(() => build({ environmentConfig: config }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('JOB_QUEUE'), 'expected the message to name JOB_QUEUE');
    });

    it('sorts the result by name regardless of input key order', () => {
        const config = makeEnvironmentConfig();

        const bindingsOne = build({ environmentConfig: config, inheritedSecretNames: [ 'API_SECRET' ] });

        const reordered = {
            IMAGES: config.IMAGES,
            SEND_EMAIL: config.SEND_EMAIL,
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
        SEND_EMAIL: { bindingName: 'EMAIL', from: 'no-reply@example.com' },
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

function groupByName(bindings) {
    const byName = {};

    for (const binding of bindings) {
        byName[binding.name] = binding;
    }

    return byName;
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

describe('cloudflare/worker-bindings with the lib production config', ({ it }) => {
    it('binds every lib resource and the inherited secrets, sorted by name', async () => {
        const environmentConfig = await readLibProductionConfig();

        const bindings = buildWorkerBindings({
            environmentConfig,
            environment: 'production',
            envars: { TRUST_PROXY: 'false' },
            inheritedSecretNames: [ 'CSRF_TOKEN_SIGNING_SECRET', 'DOCUMENT_STORE_CURSOR_SIGNING_SECRET' ],
            secretVersionId: 'source-version-id',
        });

        const summary = bindings.map((binding) => `${ binding.name }:${ binding.type }`);

        assertEqual([
            'CA_STORE_DURABLE_OBJECT:durable_object_namespace',
            'CA_STORE_KV_STORE:kv_namespace',
            'CSRF_TOKEN_SIGNING_SECRET:inherit',
            'DOCUMENT_STORE:d1',
            'DOCUMENT_STORE_CURSOR_SIGNING_SECRET:inherit',
            'ENVIRONMENT:plain_text',
            'JOB_QUEUE_DURABLE_OBJECT:durable_object_namespace',
            'KEY_VALUE_STORE:kv_namespace',
            'OBJECT_STORE_FILES:r2_bucket',
            'SEND_EMAIL:send_email',
            'TRUST_PROXY:plain_text',
        ].join('\n'), summary.join('\n'));

        const byName = groupByName(bindings);

        assertEqual('kixx-test-app-production-files', byName.OBJECT_STORE_FILES.bucket_name);
        assertEqual('production', byName.ENVIRONMENT.text);
        assertEqual('source-version-id', byName.CSRF_TOKEN_SIGNING_SECRET.version_id);
    });

    it('builds the Durable Object bindings alone, without any resource ID', async () => {
        const environmentConfig = await readLibProductionConfig();
        const withoutIds = {
            ...environmentConfig,
            DOCUMENT_STORE: { ...environmentConfig.DOCUMENT_STORE, databaseId: null },
            CONTENT_STORE: { ...environmentConfig.CONTENT_STORE, kvNamespaceId: '' },
        };

        const bindings = buildDurableObjectBindings({ environmentConfig: withoutIds, environment: 'production' });
        const summary = bindings.map((binding) => `${ binding.name }:${ binding.class_name }`);

        assertEqual([
            'CA_STORE_DURABLE_OBJECT:ContentAddressableIndexStore',
            'JOB_QUEUE_DURABLE_OBJECT:JobQueueStore',
        ].join(','), summary.join(','));
    });
});

async function readLibProductionConfig() {
    const url = new URL('../../fixtures/lib-cloudflare-config.jsonc', import.meta.url);
    const config = parseJsonc(await fsp.readFile(url, 'utf8'));
    return config.environments.production;
}
