import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import PageDataStore from '../../../../src/plugins/node-hyperview-page-data-store/lib/page-data-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


// Temp directories created during the run, removed together in the top-level after hook.
const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-pds-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeStore(directory) {
    return new PageDataStore({ logger: makeLogger(), directory });
}

// Constructor-supplied directory stores bypass request-config resolution, so most
// low-level filesystem behavior tests can pass a null context.
function makeContext() {
    return null;
}

// Writes a file directly into the backing directory using a logical-to-filesystem
// path, so read-path tests can seed assets without going through the store.
async function seedFile(directory, relativePath, content) {
    const fullPath = path.join(directory, relativePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, content, 'utf8');
}

// Reads a file directly from the backing directory so write-path tests can assert
// what landed on disk.
async function readBackingFile(directory, relativePath) {
    return fsp.readFile(path.join(directory, relativePath), 'utf8');
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


describe('PageDataStore (node)', ({ after, describe }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', async () => {
            const directory = await makeTempDir();
            const caught = catchError(() => new PageDataStore({ directory }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore requires a logger', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new PageDataStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when directory is not provided', () => {
            const caught = catchError(() => new PageDataStore({ logger: makeLogger() }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore requires a directory', caught.message);
        });
    });

    describe('getJSONFiles', ({ it }) => {
        it('returns an empty array for empty input', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getJSONFiles(makeContext(), null, []);

            assertEqual(0, result.length);
        });

        it('returns parsed json with a logical filepath when no namespace is used', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'page.json', JSON.stringify({ title: 'Home' }));
            const store = makeStore(directory);

            const result = await store.getJSONFiles(makeContext(), null, [ '/page.json' ]);

            assertEqual(1, result.length);
            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('aligns results positionally with null for missing files', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'page.json', JSON.stringify({ title: 'Home' }));
            const store = makeStore(directory);

            const result = await store.getJSONFiles(
                makeContext(),
                null,
                [ '/page.json', '/blog/page.json' ],
            );

            assertEqual(2, result.length);
            assertEqual('page.json', result[0].filepath);
            assertEqual(null, result[1]);
        });

        it('reads a nested filepath several segments deep', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'blog/2026/post/page.json', JSON.stringify({ title: 'Post' }));
            const store = makeStore(directory);

            const result = await store.getJSONFiles(makeContext(), null, [ 'blog/2026/post/page.json' ]);

            assertEqual('blog/2026/post/page.json', result[0].filepath);
            assertEqual('Post', result[0].json.title);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/page.json', JSON.stringify({ title: 'Home' }));
            const store = makeStore(directory);

            const result = await store.getJSONFiles(makeContext(), 'v1', [ '/page.json' ]);

            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('does not find a file written under a different namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/page.json', JSON.stringify({ title: 'Home' }));
            const store = makeStore(directory);

            const result = await store.getJSONFiles(makeContext(), 'v2', [ '/page.json' ]);

            assertEqual(null, result[0]);
        });

        it('throws when a read filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'secret.json', JSON.stringify({ x: 1 }));
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getJSONFiles(makeContext(), null, [ '../secret.json' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('read filepath must not contain', caught.message);
        });
    });

    describe('getTextFiles', ({ it }) => {
        it('returns an empty array for empty input', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getTextFiles(makeContext(), null, []);

            assertEqual(0, result.length);
        });

        it('returns the source with a logical filepath when no namespace is used', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'blog/body.md', '# Body');
            const store = makeStore(directory);

            const result = await store.getTextFiles(makeContext(), null, [ '/blog/body.md' ]);

            assertEqual(1, result.length);
            assertEqual('blog/body.md', result[0].filepath);
            assertEqual('# Body', result[0].source);
        });

        it('aligns results positionally with null for missing files', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'blog/body.md', '# Body');
            const store = makeStore(directory);

            const result = await store.getTextFiles(
                makeContext(),
                null,
                [ '/blog/header.html', '/blog/body.md' ],
            );

            assertEqual(2, result.length);
            assertEqual(null, result[0]);
            assertEqual('blog/body.md', result[1].filepath);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/blog/body.md', '# Body');
            const store = makeStore(directory);

            const result = await store.getTextFiles(makeContext(), 'v1', [ '/blog/body.md' ]);

            assertEqual('blog/body.md', result[0].filepath);
            assertEqual('# Body', result[0].source);
        });

        it('throws when a read filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'secret.md', '# Secret');
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getTextFiles(makeContext(), null, [ '../secret.md' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('read filepath must not contain', caught.message);
        });
    });

    describe('getTextFile', ({ it }) => {
        it('returns null when the file does not exist', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getTextFile(makeContext(), null, '/page.html');

            assertEqual(null, result);
        });

        it('returns the raw source string when no namespace is used', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'page.html', '<page/>');
            const store = makeStore(directory);

            const result = await store.getTextFile(makeContext(), null, '/page.html');

            assertEqual('<page/>', result);
        });

        it('reads from the namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/page.html', '<page/>');
            const store = makeStore(directory);

            const result = await store.getTextFile(makeContext(), 'v1', '/page.html');

            assertEqual('<page/>', result);
        });

        it('strips a leading slash from the filepath when resolving the path', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'page.html', '<page/>');
            const store = makeStore(directory);

            const result = await store.getTextFile(makeContext(), null, '/page.html');

            assertEqual('<page/>', result);
        });

        it('throws when the read filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'secret.html', '<secret/>');
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), null, '../secret.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('read filepath must not contain', caught.message);
        });

        it('throws when the read filepath is only leading slashes', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), null, '///'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore read requires a filepath', caught.message);
        });
    });

    describe('putJSONFile', ({ it }) => {
        it('writes serialized json to the flat namespace and returns the logical filepath', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putJSONFile(makeContext(), null, '/page.json', { title: 'Home' });

            assertEqual('page.json', result.filepath);
            assertEqual(JSON.stringify({ title: 'Home' }), await readBackingFile(directory, 'page.json'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putJSONFile(makeContext(), 'v1', '/page.json', { title: 'Home' });

            assertEqual('page.json', result.filepath);
            assertEqual(JSON.stringify({ title: 'Home' }), await readBackingFile(directory, 'v1/page.json'));
        });

        it('writes a nested filepath, creating intermediate directories', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putJSONFile(makeContext(), null, 'blog/2026/post/page.json', { title: 'Post' });

            assertEqual('blog/2026/post/page.json', result.filepath);
            assertEqual(JSON.stringify({ title: 'Post' }), await readBackingFile(directory, 'blog/2026/post/page.json'));
        });

        it('round-trips with getJSONFiles under the same namespace', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putJSONFile(context, 'v1', '/page.json', { title: 'Home' });
            const result = await store.getJSONFiles(context, 'v1', [ '/page.json' ]);

            assertEqual('page.json', result[0].filepath);
            assertEqual('Home', result[0].json.title);
        });

        it('throws when json is not a non-null object', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '/page.json', null));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires a non-null JSON object', caught.message);
        });

        it('throws when the filepath is empty', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '', { title: 'Home' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires a filepath', caught.message);
        });

        it('throws when the filepath is only leading slashes', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '///', { title: 'Home' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires a filepath', caught.message);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putJSONFile(makeContext(), null, '../secret.json', { x: 1 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('write filepath must not contain', caught.message);
        });
    });

    describe('putTextFile', ({ it }) => {
        it('writes to the flat namespace and returns the logical filepath', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putTextFile(makeContext(), null, '/body.md', '# Body');

            assertEqual('body.md', result.filepath);
            assertEqual('# Body', await readBackingFile(directory, 'body.md'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putTextFile(makeContext(), 'v1', '/body.md', '# Body');

            assertEqual('body.md', result.filepath);
            assertEqual('# Body', await readBackingFile(directory, 'v1/body.md'));
        });

        it('writes a nested filepath, creating intermediate directories', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putTextFile(makeContext(), null, 'blog/2026/post/body.md', '# Body');

            assertEqual('blog/2026/post/body.md', result.filepath);
            assertEqual('# Body', await readBackingFile(directory, 'blog/2026/post/body.md'));
        });

        it('round-trips with getTextFile under the same namespace', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putTextFile(context, 'v1', '/body.md', '# Body');
            const result = await store.getTextFile(context, 'v1', '/body.md');

            assertEqual('# Body', result);
        });

        it('overwrites an existing file', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putTextFile(context, null, '/body.md', '# Old');
            await store.putTextFile(context, null, '/body.md', '# New');

            assertEqual('# New', await readBackingFile(directory, 'body.md'));
        });

        it('throws when the source is empty', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putTextFile(makeContext(), null, '/body.md', ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('PageDataStore write requires source text', caught.message);
        });
    });

    describe('namespace validation', ({ it }) => {
        it('throws when the namespace contains ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), '../escape', '/page.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must not contain', caught.message);
        });

        it('throws when the namespace is provided as a non-string', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getTextFile(makeContext(), 42, '/page.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must be a string', caught.message);
        });

        it('treats an empty-string namespace as no namespace (flat namespace)', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putTextFile(context, '', '/body.md', '# Body');

            assertEqual('# Body', await readBackingFile(directory, 'body.md'));
            const result = await store.getTextFile(context, null, '/body.md');
            assertEqual('# Body', result);
        });
    });
});
