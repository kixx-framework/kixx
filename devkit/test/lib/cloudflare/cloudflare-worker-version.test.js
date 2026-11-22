import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from '../../../lib/vendor/kixx-assert/mod.js';
import CloudflareWorkerVersion from '../../../lib/cloudflare/cloudflare-worker-version.js';


describe('cloudflare/cloudflare-worker-version', ({ describe }) => {

    describe('constructor validation', ({ it }) => {
        it('rejects malformed scalar configuration', () => {
            const calls = [
                [ { compatibilty_date: '2021-01-01' }, 'options does not support the key "compatibilty_date"' ],
                [ { annotations: 'nope' }, 'annotations must be an object' ],
                [ { annotations: { 'workers/nope': 'x' } }, 'does not support the key' ],
                [ { annotations: { 'workers/tag': '' } }, 'must be a non-empty string' ],
                [ { compatibility_date: '01-01-2025' }, 'must be formatted YYYY-MM-DD' ],
                [ { compatibility_flags: 'nodejs_compat' }, 'compatibility_flags must be an array' ],
                [ { compatibility_flags: [ '' ] }, 'compatibility_flags[0] must be a non-empty string' ],
                [ { placement: {} }, 'placement requires one of' ],
                [ { placement: { mode: 'smart', typo: 1 } }, 'does not support the key "typo"' ],
                [ { cache_options: {} }, 'cache_options.enabled must be a boolean' ],
                [ { cache_options: { enabled: true, cross_version_cache: 'yes' } }, 'must be a boolean' ],
                [ { limits: {} }, 'limits requires one of' ],
                [ { limits: { cpu_ms: '50' } }, 'limits.cpu_ms must be a positive integer' ],
                [ { limits: { cpu_ms: 50.5 } }, 'limits.cpu_ms must be a positive integer' ],
                [ { limits: { subrequests: 0 } }, 'limits.subrequests must be a positive integer' ],
            ];

            for (const [ options, message ] of calls) {
                const caught = catchError(() => new CloudflareWorkerVersion(options));

                assert(caught, `expected ${ JSON.stringify(options) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });

        it('accepts a full UTC timestamp as a compatibility date', () => {
            const version = makeVersion({ compatibility_date: '2021-01-01T00:00:00Z' });

            assertEqual('2021-01-01T00:00:00Z', version.toJSON().compatibility_date);
        });

        it('rejects an annotation exceeding its byte limit', () => {
            const caught = catchError(() => {
                return new CloudflareWorkerVersion({
                    annotations: { 'workers/message': 'a'.repeat(1001) },
                });
            });

            assert(caught, 'expected an over-long message to be rejected');
            assertMatches('must not exceed 1000 bytes', caught.message);
        });

        it('measures annotation limits in bytes, not characters', () => {
            // 400 four-byte characters is 1600 bytes but only 800 UTF-16 units,
            // so a length-based check would let this through.
            const caught = catchError(() => {
                return new CloudflareWorkerVersion({
                    annotations: { 'workers/message': '𝄞'.repeat(400) },
                });
            });

            assert(caught, 'expected a multi-byte message over the limit to be rejected');
            assertMatches('must not exceed 1000 bytes', caught.message);
        });

        it('does not police the compatibility flag vocabulary', () => {
            const version = makeVersion({ compatibility_flags: [ 'some_unreleased_flag' ] });

            assertEqual('some_unreleased_flag', version.toJSON().compatibility_flags[0]);
        });

        it('emits every supplied scalar field', () => {
            const version = makeVersion({
                annotations: {
                    'workers/message': 'Deploy the thing',
                    'workers/tag': 'abc123',
                    'workers/triggered_by': 'ci',
                },
                compatibility_date: '2025-01-01',
                compatibility_flags: [ 'nodejs_compat' ],
                placement: { mode: 'smart' },
                cache_options: { enabled: true, cross_version_cache: false },
                limits: { cpu_ms: 50, subrequests: 100 },
            });

            const payload = version.toJSON();

            assertEqual('Deploy the thing', payload.annotations['workers/message']);
            assertEqual('ci', payload.annotations['workers/triggered_by']);
            assertEqual('2025-01-01', payload.compatibility_date);
            assertEqual('nodejs_compat', payload.compatibility_flags[0]);
            assertEqual('smart', payload.placement.mode);
            assertEqual(true, payload.cache_options.enabled);

            // false is meaningful for cross_version_cache and must survive.
            assertEqual(false, payload.cache_options.cross_version_cache);
            assertEqual(50, payload.limits.cpu_ms);
            assertEqual(100, payload.limits.subrequests);
        });

        it('omits scalar fields that were not supplied', () => {
            const payload = makeVersion().toJSON();

            assertUndefined(payload.annotations);
            assertUndefined(payload.compatibility_date);
            assertUndefined(payload.compatibility_flags);
            assertUndefined(payload.placement);
            assertUndefined(payload.cache_options);
            assertUndefined(payload.limits);
            assertUndefined(payload.bindings);
            assertUndefined(payload.migrations);
        });
    });

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
            version.addBinding({ type: 'send_email', name: 'EMAIL' });
            version.addBinding({ type: 'images', name: 'IMAGES' });

            const { bindings } = version.toJSON();

            assertEqual(10, bindings.length);
            assertEqual('d1-id', bindings[0].id);
            assertEqual('Counter', bindings[1].class_name);
            assertEqual('version-id', bindings[2].version_id);
            assertEqual('kv-id', bindings[3].namespace_id);
            assertEqual('production', bindings[4].text);
            assertEqual('media', bindings[5].bucket_name);
            assertEqual('sekret', bindings[6].text);
            assertEqual('version_metadata', bindings[7].type);
            assertEqual('META', bindings[7].name);
            assertEqual(JSON.stringify({ type: 'send_email', name: 'EMAIL' }), JSON.stringify(bindings[8]));
            assertEqual(JSON.stringify({ type: 'images', name: 'IMAGES' }), JSON.stringify(bindings[9]));
        });

        it('serializes email without projecting an application sender into a restriction', () => {
            const version = makeVersion();
            version.addBinding({ type: 'send_email', name: 'EMAIL', from: 'no-reply@example.com' });

            assertEqual(JSON.stringify({ type: 'send_email', name: 'EMAIL' }), JSON.stringify(version.toJSON().bindings[0]));
        });

        it('carries an r2_bucket jurisdiction only when one is given', () => {
            const version = makeVersion();

            version.addBinding({ type: 'r2_bucket', name: 'EU_MEDIA', bucket_name: 'media', jurisdiction: 'eu' });
            version.addBinding({ type: 'r2_bucket', name: 'MEDIA', bucket_name: 'media' });

            const [ euBinding, defaultBinding ] = version.toJSON().bindings;

            assertEqual('eu', euBinding.jurisdiction);
            assert(!Object.hasOwn(defaultBinding, 'jurisdiction'), 'expected no jurisdiction key');
        });

        it('rejects an empty r2_bucket jurisdiction', () => {
            const caught = catchError(() => {
                return makeVersion().addBinding({ type: 'r2_bucket', name: 'MEDIA', bucket_name: 'media', jurisdiction: '' });
            });

            assert(caught, 'expected an empty jurisdiction to be rejected');
            assertMatches('jurisdiction must be a non-empty string', caught.message);
        });

        it('rejects an unsupported binding type and names the supported ones', () => {
            const caught = catchError(() => makeVersion().addBinding({ type: 'ai', name: 'AI' }));

            assert(caught, 'expected an unsupported type to be rejected');
            assertMatches('unsupported binding type "ai"', caught.message);
            assertMatches('kv_namespace', caught.message);
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
                [ { type: 'send_email' }, 'requires a binding.name' ],
                [ { type: 'send_email', name: '' }, 'requires a binding.name' ],
                [ { type: 'plain_text' }, 'requires a binding.name' ],
            ];

            for (const [ binding, message ] of calls) {
                const caught = catchError(() => makeVersion().addBinding(binding));

                assert(caught, `expected ${ JSON.stringify(binding) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });

        it('accepts an empty string for a text field but not for an id field', () => {
            const version = makeVersion();

            version.addBinding({ type: 'plain_text', name: 'EMPTY', text: '' });
            assertEqual('', version.toJSON().bindings[0].text);

            const caught = catchError(() => {
                return version.addBinding({ type: 'kv_namespace', name: 'CACHE', namespace_id: '' });
            });

            assert(caught, 'expected an empty namespace_id to be rejected');
            assertMatches('requires the namespace_id field', caught.message);

            const inherited = catchError(() => {
                return version.addBinding({ type: 'inherit', name: 'TOKEN', version_id: '' });
            });
            assert(inherited, 'expected an empty version_id to be rejected');
            assertMatches('requires the version_id field', inherited.message);

            const latest = catchError(() => {
                return version.addBinding({ type: 'inherit', name: 'LATEST', version_id: 'latest' });
            });
            assert(latest, 'expected implicit latest inheritance to be rejected');
            assertMatches('requires an exact version_id', latest.message);
        });

        it('drops fields not documented for the binding type', () => {
            const version = makeVersion();

            version.addBinding({
                type: 'kv_namespace',
                name: 'CACHE',
                namespace_id: 'kv-id',
                experimental: true,
            });

            const binding = version.toJSON().bindings[0];

            assertUndefined(binding.experimental);
            assertEqual(3, Object.keys(binding).length);
        });

        it('rejects a duplicate binding name at the call site', () => {
            const version = makeVersion();

            version.addBinding({ type: 'plain_text', name: 'ENV', text: 'a' });

            const caught = catchError(() => {
                return version.addBinding({ type: 'plain_text', name: 'ENV', text: 'b' });
            });

            assert(caught, 'expected a duplicate binding name to be rejected');
            assertMatches('duplicate binding name "ENV"', caught.message);
        });
    });

    describe('addModule()', ({ it }) => {
        it('base64 encodes string content and infers the module content type', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'index.js', content: 'export default {};', main: true });

            const [ mod ] = version.toJSON().modules;

            assertEqual('index.js', mod.name);
            assertEqual('application/javascript+module', mod.content_type);
            assertEqual('export default {};', decodeBase64(mod.content_base64));
        });

        it('encodes Uint8Array content', () => {
            const version = new CloudflareWorkerVersion();
            const bytes = new TextEncoder().encode('export default {};');

            version.addModule({ name: 'index.js', content: bytes, main: true });

            assertEqual('export default {};', decodeBase64(version.toJSON().modules[0].content_base64));
        });

        it('encodes content larger than one conversion chunk', () => {
            const version = new CloudflareWorkerVersion();

            // Exceeds the 0x8000 chunk size used to avoid a call stack overflow.
            const content = 'x'.repeat((0x8000 * 3) + 17);

            version.addModule({ name: 'index.js', content, main: true });

            assertEqual(content, decodeBase64(version.toJSON().modules[0].content_base64));
        });

        it('round trips multi-byte content', () => {
            const version = new CloudflareWorkerVersion();
            const content = 'export const sign = "𝄞 ünïcødé";';

            version.addModule({ name: 'index.js', content, main: true });

            assertEqual(content, decodeBase64(version.toJSON().modules[0].content_base64));
        });

        it('infers text/plain for a non-JavaScript name', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'index.js', content: 'x', main: true });
            version.addModule({ name: '_headers', content: '/* nosniff' });

            assertEqual('text/plain', version.toJSON().modules[1].content_type);
        });

        it('honors an explicit content type override', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({
                name: 'index.js',
                content: 'x',
                content_type: 'text/plain',
                main: true,
            });

            assertEqual('text/plain', version.toJSON().modules[0].content_type);
        });

        it('does not emit the main flag as a module field', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'index.js', content: 'x', main: true });

            const [ mod ] = version.toJSON().modules;

            assertUndefined(mod.main);
            assertEqual(3, Object.keys(mod).length);
        });

        it('records the main module name as main_module', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'utils.js', content: 'x' });
            version.addModule({ name: 'index.js', content: 'y', main: true });

            assertEqual('index.js', version.toJSON().main_module);
        });

        it('rejects a second main module', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'index.js', content: 'x', main: true });

            const caught = catchError(() => {
                return version.addModule({ name: 'other.js', content: 'y', main: true });
            });

            assert(caught, 'expected a second main module to be rejected');
            assertMatches('main module already set to "index.js"', caught.message);
        });

        it('rejects a duplicate module name', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'index.js', content: 'x', main: true });

            const caught = catchError(() => {
                return version.addModule({ name: 'index.js', content: 'y' });
            });

            assert(caught, 'expected a duplicate module name to be rejected');
            assertMatches('duplicate module name "index.js"', caught.message);
        });

        it('rejects invalid module arguments', () => {
            const calls = [
                [ undefined, 'requires a module' ],
                [ {}, 'requires a module.name' ],
                [ { name: 'index.js' }, 'content must be a string or Uint8Array' ],
                [ { name: 'index.js', content: 42 }, 'content must be a string or Uint8Array' ],
                [ { name: 'index.js', content: 'x', main: 'yes' }, 'main must be a boolean' ],
                [ { name: 'index.js', content: 'x', content_type: '' }, 'content_type must be a non-empty string' ],
            ];

            for (const [ mod, message ] of calls) {
                const caught = catchError(() => new CloudflareWorkerVersion().addModule(mod));

                assert(caught, `expected ${ JSON.stringify(mod) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });
    });

    describe('addExport()', ({ it }) => {
        it('omits the exports key when no export was recorded', () => {
            assertUndefined(makeVersion().toJSON().exports);
        });

        it('serializes each supported entry shape', () => {
            const version = makeVersion();

            version.addExport('ChatRoom', { type: 'durable-object', storage: 'sqlite' });
            version.addExport('LegacyCounter', { storage: 'legacy-kv', state: 'created' });
            version.addExport('Abandoned', { state: 'deleted' });
            version.addExport('OldName', { state: 'renamed', renamed_to: 'ChatRoom' });
            version.addExport('Departed', { state: 'transferred', transferred_to: 'other-worker' });
            version.addExport('Arriving', {
                state: 'expecting-transfer',
                storage: 'sqlite',
                transfer_from: 'old-worker',
            });

            const { exports } = version.toJSON();

            assertEqual('durable-object', exports.ChatRoom.type);
            assertEqual('sqlite', exports.ChatRoom.storage);
            assertEqual('created', exports.ChatRoom.state);
            assertEqual('legacy-kv', exports.LegacyCounter.storage);

            assertEqual('deleted', exports.Abandoned.state);
            assertUndefined(exports.Abandoned.storage);

            assertEqual('renamed', exports.OldName.state);
            assertEqual('ChatRoom', exports.OldName.renamed_to);

            assertEqual('transferred', exports.Departed.state);
            assertEqual('other-worker', exports.Departed.transferred_to);

            assertEqual('expecting-transfer', exports.Arriving.state);
            assertEqual('old-worker', exports.Arriving.transfer_from);
            assertEqual('sqlite', exports.Arriving.storage);
        });

        it('rejects a field the entry state does not support', () => {
            const calls = [
                [ { storage: 'sqlite', renamed_to: 'Other' }, 'does not support the field "renamed_to"' ],
                [ { storage: 'sqlite', transferred_to: 'other' }, 'does not support the field "transferred_to"' ],
                [ { storage: 'sqlite', transfer_from: 'other' }, 'does not support the field "transfer_from"' ],
                [ { state: 'deleted', storage: 'sqlite' }, 'does not support the field "storage"' ],
                [
                    { state: 'renamed', renamed_to: 'Other', storage: 'sqlite' },
                    'does not support the field "storage"',
                ],
                [ { state: 'deleted', renamed_to: 'Other' }, 'does not support the field "renamed_to"' ],
            ];

            for (const [ entry, message ] of calls) {
                const caught = catchError(() => makeVersion().addExport('ChatRoom', entry));

                assert(caught, `expected ${ JSON.stringify(entry) } to be rejected`);
                assertMatches(message, caught.message);
            }
        });

        it('rejects invalid export arguments', () => {
            const calls = [
                [ (v) => v.addExport('', { storage: 'sqlite' }), 'requires a className' ],
                [ (v) => v.addExport('ChatRoom'), 'requires an entry object' ],
                [ (v) => v.addExport('ChatRoom', { state: 'nope' }), 'unsupported state "nope"' ],
                [ (v) => v.addExport('ChatRoom', {}), 'requires the storage field' ],
                [ (v) => v.addExport('ChatRoom', { storage: 'redis' }), 'storage must be one of' ],
                [ (v) => v.addExport('ChatRoom', { state: 'renamed' }), 'requires the renamed_to field' ],
                [ (v) => v.addExport('ChatRoom', { state: 'transferred' }), 'requires the transferred_to field' ],
                [
                    (v) => v.addExport('ChatRoom', { state: 'expecting-transfer', storage: 'sqlite' }),
                    'requires the transfer_from field',
                ],
                [
                    (v) => v.addExport('ChatRoom', { type: 'worker', storage: 'sqlite' }),
                    'type must be "durable-object"',
                ],
                [
                    (v) => v.addExport('ChatRoom', { state: 'renamed', renamed_to: 'ChatRoom' }),
                    'cannot be renamed to itself',
                ],
            ];

            for (const [ call, message ] of calls) {
                const caught = catchError(() => call(makeVersion()));

                assert(caught, `expected rejection matching "${ message }"`);
                assertMatches(message, caught.message);
            }
        });

        it('rejects a duplicate class name at the call site', () => {
            const version = makeVersion();

            version.addExport('ChatRoom', { storage: 'sqlite' });

            const caught = catchError(() => version.addExport('ChatRoom', { state: 'deleted' }));

            assert(caught, 'expected a duplicate class name to be rejected');
            assertMatches('duplicate class name "ChatRoom"', caught.message);
        });

        it('rejects a rename whose target is not a live export', () => {
            const version = makeVersion();

            version.addExport('OldName', { state: 'renamed', renamed_to: 'NewName' });

            const missing = catchError(() => version.toJSON());

            assert(missing, 'expected a rename to a missing class to be rejected');
            assertMatches('not a live export in the same map', missing.message);

            version.addExport('NewName', { state: 'deleted' });

            const dead = catchError(() => version.toJSON());

            assert(dead, 'expected a rename to a tombstone to be rejected');
            assertMatches('not a live export in the same map', dead.message);
        });

        it('accepts a rename into a class expecting a transfer', () => {
            const version = makeVersion();

            version.addExport('OldName', { state: 'renamed', renamed_to: 'NewName' });
            version.addExport('NewName', {
                state: 'expecting-transfer',
                storage: 'sqlite',
                transfer_from: 'old-worker',
            });

            assertEqual('NewName', version.toJSON().exports.OldName.renamed_to);
        });

        it('returns copied entries that cannot mutate the instance', () => {
            const version = makeVersion();

            version.addExport('ChatRoom', { storage: 'sqlite' });

            const first = version.toJSON();

            first.exports.ChatRoom.storage = 'legacy-kv';
            first.exports.Injected = { type: 'durable-object' };

            const second = version.toJSON();

            assertEqual('sqlite', second.exports.ChatRoom.storage);
            assertUndefined(second.exports.Injected);
        });

        it('can never emit a migrations key', () => {
            const version = makeVersion();

            version.addExport('ChatRoom', { storage: 'sqlite' });

            assertUndefined(version.toJSON().migrations);
            assertEqual('undefined', typeof version.addNewSqliteClass);
            assertEqual('undefined', typeof version.addNewClass);
            assertEqual('undefined', typeof version.deleteClass);
            assertEqual('undefined', typeof version.renameClass);
            assertEqual('undefined', typeof version.transferClass);
            assertEqual('undefined', typeof version.setMigrationTags);
        });
    });

    describe('toJSON()', ({ it }) => {
        it('requires a main module', () => {
            const version = new CloudflareWorkerVersion();

            version.addModule({ name: 'utils.js', content: 'x' });

            const caught = catchError(() => version.toJSON());

            assert(caught, 'expected a version without a main module to be rejected');
            assertMatches('requires a module added with main: true', caught.message);
        });

        it('returns a fresh copy that cannot mutate the instance', () => {
            const version = makeVersion();

            version.addBinding({ type: 'plain_text', name: 'ENV', text: 'production' });

            const first = version.toJSON();

            first.bindings.push({ type: 'plain_text', name: 'INJECTED' });
            first.bindings[0].text = 'mutated';
            first.modules[0].name = 'mutated.js';

            const second = version.toJSON();

            assertEqual(1, second.bindings.length);
            assertEqual('production', second.bindings[0].text);
            assertEqual('index.js', second.modules[0].name);
        });

        it('reflects changes made after an earlier call', () => {
            const version = makeVersion();

            assertUndefined(version.toJSON().bindings);

            version.addBinding({ type: 'plain_text', name: 'ENV', text: 'production' });

            assertEqual(1, version.toJSON().bindings.length);
        });

        it('survives a JSON round trip through the API client payload shape', () => {
            const version = makeVersion({ compatibility_date: '2025-01-01' });

            version.addBinding({ type: 'kv_namespace', name: 'CACHE', namespace_id: 'kv-id' });

            const payload = JSON.parse(JSON.stringify(version.toJSON()));

            assertEqual('index.js', payload.main_module);
            assertEqual('kv-id', payload.bindings[0].namespace_id);
            assertEqual('2025-01-01', payload.compatibility_date);
        });
    });
});


function makeVersion(options) {
    const version = new CloudflareWorkerVersion(options);

    version.addModule({ name: 'index.js', content: 'export default {};', main: true });

    return version;
}


function decodeBase64(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
}


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
