import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import TemplateFileStore from '../../../../../src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Minimal Cloudflare KV namespace double. Backed by a single Map so reads,
// writes, and prefix listings all operate over the same stored keys, exercising
// the real `{namespace}/{prefix}{filepath}` encoding rather than mocking it.
// Every read's options are recorded on `readOptions` so tests can assert the
// cacheTtl handed to the platform.
function makeKVNamespace(initial) {
    const store = new Map(Object.entries(initial ?? {}));
    const readOptions = [];

    return {
        store,
        readOptions,
        async get(key, options) {
            readOptions.push(options);
            if (Array.isArray(key)) {
                const result = new Map();
                for (const name of key) {
                    result.set(name, store.has(name) ? store.get(name) : null);
                }
                return result;
            }
            return store.has(key) ? store.get(key) : null;
        },
        async put(key, value) {
            store.set(key, value);
        },
        async list({ prefix }) {
            const keys = [];
            for (const name of store.keys()) {
                if (!prefix || name.startsWith(prefix)) {
                    keys.push({ name });
                }
            }
            return { keys };
        },
    };
}

// `config` is optional so the majority of tests, which do not care about the
// cache TTL, exercise the built-in defaults the same way an unconfigured
// deployment would.
function makeContext(kvStore, config) {
    return {
        env: { HYPERVIEW_TEMPLATE_FILE_STORE: kvStore ?? makeKVNamespace() },
        config,
    };
}

function makeConfig(templateFileStoreConfig) {
    return { env: { HYPERVIEW_TEMPLATE_FILE_STORE: templateFileStoreConfig } };
}

function makeStore() {
    return new TemplateFileStore({ logger: makeLogger() });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('TemplateFileStore', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new TemplateFileStore({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore requires a logger', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new TemplateFileStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getBaseTemplate', ({ it }) => {
        it('returns null when the template does not exist', async () => {
            const store = makeStore();
            const context = makeContext();

            const result = await store.getBaseTemplate(context, null, 'home.html');

            assertEqual(null, result);
        });

        it('returns the source with a logical filepath when no namespace is used', async () => {
            const kvStore = makeKVNamespace({ 'base/home.html': '<home/>' });
            const store = makeStore();

            const result = await store.getBaseTemplate(makeContext(kvStore), null, 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/base/home.html': '<home/>' });
            const store = makeStore();

            const result = await store.getBaseTemplate(makeContext(kvStore), 'v1', 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('strips a leading slash from the filepath when resolving the key', async () => {
            const kvStore = makeKVNamespace({ 'base/home.html': '<home/>' });
            const store = makeStore();

            const result = await store.getBaseTemplate(makeContext(kvStore), null, '/home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('does not find a template written under a different namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/base/home.html': '<home/>' });
            const store = makeStore();

            const result = await store.getBaseTemplate(makeContext(kvStore), 'v2', 'home.html');

            assertEqual(null, result);
        });
    });

    describe('putBaseTemplate', ({ it }) => {
        it('writes to the flat namespace and returns the logical filepath when no namespace is used', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putBaseTemplate(makeContext(kvStore), null, 'home.html', '<home/>');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', kvStore.store.get('base/home.html'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putBaseTemplate(makeContext(kvStore), 'v1', 'home.html', '<home/>');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', kvStore.store.get('v1/base/home.html'));
        });

        it('round-trips with getBaseTemplate under the same namespace', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putBaseTemplate(context, 'v1', 'home.html', '<home/>');
            const result = await store.getBaseTemplate(context, 'v1', 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('throws when the filepath is empty', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, '', '<home/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore write requires a filepath', caught.message);
        });

        it('throws when the source is empty', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, 'home.html', ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore write requires source text', caught.message);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, '../secret.html', '<x/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });
    });

    describe('getPageTemplate', ({ it }) => {
        it('returns null when the template does not exist', async () => {
            const store = makeStore();
            const context = makeContext();

            const result = await store.getPageTemplate(context, null, 'index.html');

            assertEqual(null, result);
        });

        it('returns the source with a logical filepath under the pages prefix', async () => {
            const kvStore = makeKVNamespace({ 'pages/index.html': '<index/>' });
            const store = makeStore();

            const result = await store.getPageTemplate(makeContext(kvStore), null, 'index.html');

            assertEqual('pages/index.html', result.filepath);
            assertEqual('<index/>', result.source);
        });

        it('resolves a filepath nested several segments deep', async () => {
            const kvStore = makeKVNamespace({ 'pages/blog/posts/welcome.html': '<post/>' });
            const store = makeStore();

            const result = await store.getPageTemplate(makeContext(kvStore), null, 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('reads a nested filepath from the namespace and strips it from the logical filepath', async () => {
            const kvStore = makeKVNamespace({ 'v1/pages/blog/posts/welcome.html': '<post/>' });
            const store = makeStore();

            const result = await store.getPageTemplate(makeContext(kvStore), 'v1', 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('does not find a page written under a different namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/pages/index.html': '<index/>' });
            const store = makeStore();

            const result = await store.getPageTemplate(makeContext(kvStore), 'v2', 'index.html');

            assertEqual(null, result);
        });
    });

    describe('putPageTemplate', ({ it }) => {
        it('writes under the pages prefix and returns the logical filepath when no namespace is used', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putPageTemplate(makeContext(kvStore), null, 'index.html', '<index/>');

            assertEqual('pages/index.html', result.filepath);
            assertEqual('<index/>', kvStore.store.get('pages/index.html'));
        });

        it('writes a nested filepath several segments deep', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putPageTemplate(makeContext(kvStore), null, 'blog/posts/welcome.html', '<post/>');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', kvStore.store.get('pages/blog/posts/welcome.html'));
        });

        it('writes a nested filepath under the namespace', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putPageTemplate(makeContext(kvStore), 'v1', 'blog/posts/welcome.html', '<post/>');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', kvStore.store.get('v1/pages/blog/posts/welcome.html'));
        });

        it('round-trips a nested filepath with getPageTemplate under the same namespace', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putPageTemplate(context, 'v1', 'blog/posts/welcome.html', '<post/>');
            const result = await store.getPageTemplate(context, 'v1', 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putPageTemplate(makeContext(), null, 'blog/../secret.html', '<x/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });
    });

    describe('namespace validation', ({ it }) => {
        it('throws when the namespace contains ".." segments', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), '../escape', 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must not contain', caught.message);
        });

        it('throws when the namespace is provided as a non-string', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), 42, 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must be a string', caught.message);
        });

        it('treats an empty-string namespace as no namespace (flat namespace)', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putBaseTemplate(context, '', 'home.html', '<home/>');

            assertEqual('<home/>', kvStore.store.get('base/home.html'));
            const result = await store.getBaseTemplate(context, null, 'home.html');
            assertEqual('<home/>', result.source);
        });
    });

    describe('putPartial and getPartials', ({ it }) => {
        it('returns an empty array when no partials exist', async () => {
            const store = makeStore();

            const result = await store.getPartials(makeContext(), null);

            assertEqual(0, result.length);
        });

        it('writes a partial under the partials prefix and round-trips through getPartials', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            const written = await store.putPartial(context, null, 'nav.html', '<nav/>');
            assertEqual('partials/nav.html', written.filepath);

            const result = await store.getPartials(context, null);
            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
            assertEqual('<nav/>', result[0].source);
        });

        it('returns logical filepaths with the namespace stripped', async () => {
            const kvStore = makeKVNamespace({
                'v1/partials/nav.html': '<nav/>',
                'v1/partials/footer.html': '<footer/>',
            });
            const store = makeStore();

            const result = await store.getPartials(makeContext(kvStore), 'v1');

            const filepaths = result.map((file) => file.filepath).sort();
            assertEqual('partials/footer.html', filepaths[0]);
            assertEqual('partials/nav.html', filepaths[1]);
        });

        it('does not return files from another prefix', async () => {
            const kvStore = makeKVNamespace({
                'partials/nav.html': '<nav/>',
                'base/home.html': '<home/>',
            });
            const store = makeStore();

            const result = await store.getPartials(makeContext(kvStore), null);

            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
        });

        it('does not return partials written under a different namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/partials/nav.html': '<nav/>' });
            const store = makeStore();

            const result = await store.getPartials(makeContext(kvStore), 'v2');

            assertEqual(0, result.length);
        });
    });

    describe('read cache TTL', ({ it }) => {
        // A build never rewrites its own templates, so a namespaced key can be
        // cached for as long as the build lives.
        it('applies the long default TTL to a namespaced read', async () => {
            const kvStore = makeKVNamespace({ 'v1/base/home.html': '<home/>' });
            const store = makeStore();

            await store.getBaseTemplate(makeContext(kvStore), 'v1', 'home.html');

            assertEqual(1, kvStore.readOptions.length);
            assertEqual(86400, kvStore.readOptions[0].cacheTtl);
            assertEqual('text', kvStore.readOptions[0].type);
        });

        // Flat keys carry no build-id immutability guarantee, so they must not
        // inherit the long TTL.
        it('caps the TTL for an un-namespaced read', async () => {
            const kvStore = makeKVNamespace({ 'base/home.html': '<home/>' });
            const store = makeStore();

            await store.getBaseTemplate(makeContext(kvStore), null, 'home.html');

            assertEqual(300, kvStore.readOptions[0].cacheTtl);
        });

        it('treats an empty-string namespace as un-namespaced for the TTL', async () => {
            const kvStore = makeKVNamespace({ 'base/home.html': '<home/>' });
            const store = makeStore();

            await store.getBaseTemplate(makeContext(kvStore), '', 'home.html');

            assertEqual(300, kvStore.readOptions[0].cacheTtl);
        });

        it('applies the TTL to page template reads', async () => {
            const kvStore = makeKVNamespace({ 'v1/pages/blog/page.html': '<page/>' });
            const store = makeStore();

            await store.getPageTemplate(makeContext(kvStore), 'v1', 'blog/page.html');

            assertEqual(86400, kvStore.readOptions[0].cacheTtl);
        });

        it('applies the TTL to the getPartials bulk read', async () => {
            const kvStore = makeKVNamespace({ 'v1/partials/nav.html': '<nav/>' });
            const store = makeStore();

            await store.getPartials(makeContext(kvStore), 'v1');

            assertEqual(1, kvStore.readOptions.length);
            assertEqual(86400, kvStore.readOptions[0].cacheTtl);
        });

        it('uses the configured cacheTtl for a namespaced read', async () => {
            const kvStore = makeKVNamespace({ 'v1/base/home.html': '<home/>' });
            const config = makeConfig({ cacheTtl: 604800 });
            const store = makeStore();

            await store.getBaseTemplate(makeContext(kvStore, config), 'v1', 'home.html');

            assertEqual(604800, kvStore.readOptions[0].cacheTtl);
        });

        // The cap clamps rather than substitutes, so a deployment which asks for
        // a TTL shorter than the cap still gets the shorter value.
        it('keeps a configured TTL shorter than the un-namespaced cap', async () => {
            const kvStore = makeKVNamespace({ 'base/home.html': '<home/>' });
            const config = makeConfig({ cacheTtl: 60 });
            const store = makeStore();

            await store.getBaseTemplate(makeContext(kvStore, config), null, 'home.html');

            assertEqual(60, kvStore.readOptions[0].cacheTtl);
        });

        it('throws when the configured cacheTtl is below the Cloudflare minimum', async () => {
            const store = makeStore();
            const context = makeContext(null, makeConfig({ cacheTtl: 29 }));
            const caught = await catchAsyncError(() => store.getBaseTemplate(context, 'v1', 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('at least 30 seconds', caught.message);
        });

        it('throws when the configured cacheTtl is not an integer', async () => {
            const store = makeStore();
            const context = makeContext(null, makeConfig({ cacheTtl: 86400.5 }));
            const caught = await catchAsyncError(() => store.getBaseTemplate(context, 'v1', 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must be an integer', caught.message);
        });
    });
});
