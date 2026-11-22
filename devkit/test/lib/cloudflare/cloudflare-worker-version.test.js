import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from '../../../lib/vendor/kixx-assert/mod.js';
import CloudflareWorkerVersion from '../../../lib/cloudflare/cloudflare-worker-version.js';


describe('cloudflare/cloudflare-worker-version', ({ describe }) => {

    describe('addBinding()', ({ it }) => {
        it('builds each supported binding type', () => {
            const version = makeVersion();

            version.addBinding({ type: 'd1', name: 'DB', id: 'd1-id' });
            version.addBinding({ type: 'durable_object_namespace', name: 'DO', class_name: 'Counter' });
            version.addBinding({ type: 'inherit', name: 'INHERITED', version_id: 'version-id' });
            version.addBinding({ type: 'kv_namespace', name: 'CACHE', namespace_id: 'kv-id' });
            version.addBinding({ type: 'plain_text', name: 'ENV', text: 'production' });
            version.addBinding({ type: 'r2_bucket', name: 'MEDIA', bucket_name: 'media' });
            version.addBinding({ type: 'secret_text', name: 'TOKEN', text: 'sekret' });
            version.addBinding({ type: 'version_metadata', name: 'META' });
            version.addBinding({ type: 'images', name: 'IMAGES' });

            const { bindings } = version.toJSON();

            assertEqual(9, bindings.length);
            assertEqual('d1-id', bindings[0].id);
            assertEqual('Counter', bindings[1].class_name);
            assertEqual('version-id', bindings[2].version_id);
            assertEqual('kv-id', bindings[3].namespace_id);
            assertEqual('production', bindings[4].text);
            assertEqual('media', bindings[5].bucket_name);
            assertEqual('sekret', bindings[6].text);
            assertEqual('version_metadata', bindings[7].type);
            assertEqual('META', bindings[7].name);
            assertEqual(JSON.stringify({ type: 'images', name: 'IMAGES' }), JSON.stringify(bindings[8]));
        });

        it('rejects an unsupported binding type and names the supported ones', () => {
            const caught = catchError(() => makeVersion().addBinding({ type: 'ai', name: 'AI' }));

            assert(caught, 'expected an unsupported type to be rejected');
            assertMatches('unsupported binding type "ai"', caught.message);
            assertMatches(
                'supported types are: d1, durable_object_namespace, images, inherit, kv_namespace, plain_text, r2_bucket, secret_text, version_metadata',
                caught.message,
            );
        });

        it('rejects a missing required field', () => {
            const calls = [
                [ { type: 'd1', name: 'DB' }, 'requires the id field' ],
                [ { type: 'durable_object_namespace', name: 'DO' }, 'requires the class_name field' ],
                [ { type: 'inherit', name: 'TOKEN' }, 'requires the version_id field' ],
                [ { type: 'kv_namespace', name: 'CACHE' }, 'requires the namespace_id field' ],
                [ { type: 'r2_bucket', name: 'MEDIA' }, 'requires the bucket_name field' ],
                [ { type: 'plain_text', name: 'ENV' }, 'requires the text field as a string' ],
                [ { type: 'secret_text', name: 'TOKEN' }, 'requires the text field as a string' ],
                [ { type: 'kv_namespace', name: 'CACHE', 'namespace-id': 'x' }, 'requires the namespace_id field' ],
                [ {}, 'requires a binding.type' ],
                [ { type: 'images' }, 'requires a binding.name' ],
                [ { type: 'images', name: '' }, 'requires a binding.name' ],
                [ { type: 'plain_text' }, 'requires a binding.name' ],
            ];

            for (const [ binding, message ] of calls) {
                const caught = catchError(() => makeVersion().addBinding(binding));

                assert(caught, `expected ${ JSON.stringify(binding) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });
    });
});


function makeVersion(options) {
    const version = new CloudflareWorkerVersion(options);

    version.addModule({ name: 'index.js', content: 'export default {};', main: true });

    return version;
}


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
