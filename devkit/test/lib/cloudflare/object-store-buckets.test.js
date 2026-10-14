import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from '../../../lib/vendor/kixx-assert/mod.js';
import { readObjectStoreBuckets } from '../../../lib/cloudflare/object-store-buckets.js';

describe('cloudflare/object-store-buckets', ({ it }) => {
    it('returns an empty list without an OBJECT_STORE block', () => {
        assertEqual(0, read({}).length);
    });

    it('reads every bucket with its full config path, accepting and ignoring creation options', () => {
        const [ bucket ] = read(makeConfig({
            jurisdiction: 'eu',
            locationHint: 'weur',
            storageClass: 'InfrequentAccess',
        }));

        assertEqual('environments.production.OBJECT_STORE.buckets.files', bucket.configPath);
        assertEqual('OBJECT_STORE_FILES', bucket.bindingName);
        assertEqual('example-files', bucket.bucketName);
        assertEqual('eu', bucket.jurisdiction);
        assertEqual('configPath,bindingName,bucketName,jurisdiction', Object.keys(bucket).join(','));
    });

    it('rejects a non-object OBJECT_STORE or buckets block', () => {
        for (const config of [ { OBJECT_STORE: 'x' }, { OBJECT_STORE: { buckets: [] } } ]) {
            const caught = catchError(() => read(config));

            assert(caught, 'expected an error to be thrown');
            assertEqual('UsageError', caught.name);
            assert(caught.message.includes('environments.production.OBJECT_STORE'), caught.message);
        }
    });

    it('treats an explicit default jurisdiction the same as none', () => {
        const [ explicit ] = read(makeConfig({ jurisdiction: 'default' }));
        const [ omitted ] = read(makeConfig({}));

        assertUndefined(explicit.jurisdiction);
        assertUndefined(omitted.jurisdiction);
    });

    it('rejects an unknown jurisdiction naming its config path', () => {
        const caught = catchError(() => read(makeConfig({ jurisdiction: 'us' })));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('OBJECT_STORE.buckets.files.jurisdiction'), caught.message);
        assert(caught.message.includes('fedramp'), 'expected the allowed values');
    });

    it('rejects an empty optional string naming its config path', () => {
        const caught = catchError(() => read(makeConfig({ locationHint: '' })));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('OBJECT_STORE.buckets.files.locationHint'), caught.message);
    });

    it('rejects a missing bucket name naming its config path', () => {
        const config = makeConfig({});
        delete config.OBJECT_STORE.buckets.files.bucketName;

        const caught = catchError(() => read(config));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('OBJECT_STORE.buckets.files.bucketName'), caught.message);
    });
});

function read(environmentConfig) {
    return readObjectStoreBuckets({ environmentConfig, environment: 'production' });
}

function makeConfig(options) {
    return {
        OBJECT_STORE: {
            type: 'r2_bucket',
            buckets: {
                files: {
                    bindingName: 'OBJECT_STORE_FILES',
                    bucketName: 'example-files',
                    ...options,
                },
            },
        },
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
