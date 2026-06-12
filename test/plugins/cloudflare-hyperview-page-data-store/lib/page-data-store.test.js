import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import PageDataStore from '../../../../src/plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

// Minimal Cloudflare KV namespace double. Backed by a single Map so reads and
// writes operate over the same stored keys, exercising the real
// `{namespace}/{filepath}` encoding rather than mocking it. The double honors
// the `{ type }` option the way Cloudflare KV does: `type: 'json'` parses the
// stored text, matching how `PageDataStore` stores serialized JSON on write and
// expects parsed values on read.
function makeKVNamespace(initial) {
    const store = new Map(Object.entries(initial ?? {}));

    function decode(raw, type) {
        if (raw === null || raw === undefined) {
            return null;
        }
        return type === 'json' ? JSON.parse(raw) : raw;
    }

    return {
        store,
        async get(key, options) {
            const type = options?.type;
            if (Array.isArray(key)) {
                const result = new Map();
                for (const name of key) {
                    result.set(name, store.has(name) ? decode(store.get(name), type) : null);
                }
                return result;
            }
            return store.has(key) ? decode(store.get(key), type) : null;
        },
        async put(key, value) {
            store.set(key, value);
        },
    };
}

function makeContext(kvStore) {
    return { env: { PAGE_DATA_STORE: kvStore ?? makeKVNamespace() } };
}

function makeStore() {
    return new PageDataStore({ logger: makeLogger() });
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


describe('PageDataStore', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', () => {
            const caught = catchError(() => new PageDataStore({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore requires a logger', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new PageDataStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('getJSONFiles', ({ it }) => {
        it('returns an empty array for empty input', async () => {
            const store = makeStore();

            const result = await store.getJSONFiles(makeContext(), null, []);

            assertEqual(0, result.length);
        });

        it('returns parsed json with a logical filepath when no namespace is used', async () => {
            const kvStore = makeKVNamespace({ 'page.json': JSON.stringify({ title: 'Home' }) });
            const store = makeStore();

            const result = await store.getJSONFiles(makeContext(kvStore), null, [ '/page.json' ]);

            assertEqual(1, result.length);
            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('aligns results positionally with null for missing files', async () => {
            const kvStore = makeKVNamespace({ 'page.json': JSON.stringify({ title: 'Home' }) });
            const store = makeStore();

            const result = await store.getJSONFiles(
                makeContext(kvStore),
                null,
                [ '/page.json', '/blog/page.json' ],
            );

            assertEqual(2, result.length);
            assertEqual('page.json', result[0].filepath);
            assertEqual(null, result[1]);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/page.json': JSON.stringify({ title: 'Home' }) });
            const store = makeStore();

            const result = await store.getJSONFiles(makeContext(kvStore), 'v1', [ '/page.json' ]);

            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('does not find a file written under a different namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/page.json': JSON.stringify({ title: 'Home' }) });
            const store = makeStore();

            const result = await store.getJSONFiles(makeContext(kvStore), 'v2', [ '/page.json' ]);

            assertEqual(null, result[0]);
        });
    });

    describe('getTextFiles', ({ it }) => {
        it('returns an empty array for empty input', async () => {
            const store = makeStore();

            const result = await store.getTextFiles(makeContext(), null, []);

            assertEqual(0, result.length);
        });

        it('returns the source with a logical filepath when no namespace is used', async () => {
            const kvStore = makeKVNamespace({ 'blog/body.md': '# Body' });
            const store = makeStore();

            const result = await store.getTextFiles(makeContext(kvStore), null, [ '/blog/body.md' ]);

            assertEqual(1, result.length);
            assertEqual('blog/body.md', result[0].filepath);
            assertEqual('# Body', result[0].source);
        });

        it('aligns results positionally with null for missing files', async () => {
            const kvStore = makeKVNamespace({ 'blog/body.md': '# Body' });
            const store = makeStore();

            const result = await store.getTextFiles(
                makeContext(kvStore),
                null,
                [ '/blog/header.html', '/blog/body.md' ],
            );

            assertEqual(2, result.length);
            assertEqual(null, result[0]);
            assertEqual('blog/body.md', result[1].filepath);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/blog/body.md': '# Body' });
            const store = makeStore();

            const result = await store.getTextFiles(makeContext(kvStore), 'v1', [ '/blog/body.md' ]);

            assertEqual('blog/body.md', result[0].filepath);
            assertEqual('# Body', result[0].source);
        });
    });

    describe('getTextFile', ({ it }) => {
        it('returns null when the file does not exist', async () => {
            const store = makeStore();

            const result = await store.getTextFile(makeContext(), null, '/page.html');

            assertEqual(null, result);
        });

        it('returns the raw source string when no namespace is used', async () => {
            const kvStore = makeKVNamespace({ 'page.html': '<page/>' });
            const store = makeStore();

            const result = await store.getTextFile(makeContext(kvStore), null, '/page.html');

            assertEqual('<page/>', result);
        });

        it('reads from the namespace', async () => {
            const kvStore = makeKVNamespace({ 'v1/page.html': '<page/>' });
            const store = makeStore();

            const result = await store.getTextFile(makeContext(kvStore), 'v1', '/page.html');

            assertEqual('<page/>', result);
        });

        it('strips a leading slash from the filepath when resolving the key', async () => {
            const kvStore = makeKVNamespace({ 'page.html': '<page/>' });
            const store = makeStore();

            const result = await store.getTextFile(makeContext(kvStore), null, '/page.html');

            assertEqual('<page/>', result);
        });
    });

    describe('putJSONFile', ({ it }) => {
        it('writes serialized json to the flat namespace and returns the logical filepath', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putJSONFile(makeContext(kvStore), null, '/page.json', { title: 'Home' });

            assertEqual('page.json', result.filepath);
            assertEqual(JSON.stringify({ title: 'Home' }), kvStore.store.get('page.json'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putJSONFile(makeContext(kvStore), 'v1', '/page.json', { title: 'Home' });

            assertEqual('page.json', result.filepath);
            assertEqual(JSON.stringify({ title: 'Home' }), kvStore.store.get('v1/page.json'));
        });

        it('round-trips with getJSONFiles under the same namespace', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putJSONFile(context, 'v1', '/page.json', { title: 'Home' });
            const result = await store.getJSONFiles(context, 'v1', [ '/page.json' ]);

            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('throws when json is not a non-null object', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '/page.json', null));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires a non-null JSON object', caught.message);
        });

        it('throws when the filepath is empty', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '', { title: 'Home' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires a filepath', caught.message);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '../secret.json', { x: 1 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });
    });

    describe('putTextFile', ({ it }) => {
        it('writes to the flat namespace and returns the logical filepath', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putTextFile(makeContext(kvStore), null, '/body.md', '# Body');

            assertEqual('body.md', result.filepath);
            assertEqual('# Body', kvStore.store.get('body.md'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const kvStore = makeKVNamespace();
            const store = makeStore();

            const result = await store.putTextFile(makeContext(kvStore), 'v1', '/body.md', '# Body');

            assertEqual('body.md', result.filepath);
            assertEqual('# Body', kvStore.store.get('v1/body.md'));
        });

        it('round-trips with getTextFile under the same namespace', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putTextFile(context, 'v1', '/body.md', '# Body');
            const result = await store.getTextFile(context, 'v1', '/body.md');

            assertEqual('# Body', result);
        });

        it('throws when the source is empty', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.putTextFile(makeContext(), null, '/body.md', ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires source text', caught.message);
        });
    });

    describe('namespace validation', ({ it }) => {
        it('throws when the namespace contains ".." segments', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), '../escape', '/page.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must not contain', caught.message);
        });

        it('throws when the namespace is provided as a non-string', async () => {
            const store = makeStore();
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), 42, '/page.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must be a string', caught.message);
        });

        it('treats an empty-string namespace as no namespace (flat namespace)', async () => {
            const kvStore = makeKVNamespace();
            const context = makeContext(kvStore);
            const store = makeStore();

            await store.putTextFile(context, '', '/body.md', '# Body');

            assertEqual('# Body', kvStore.store.get('body.md'));
            const result = await store.getTextFile(context, null, '/body.md');
            assertEqual('# Body', result);
        });
    });
});
