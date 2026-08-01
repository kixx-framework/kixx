import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import TemplateFileStore from '../../../../../src/plugins/node-hyperview-template-file-store/lib/template-file-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';


// Temp directories created during the run, removed together in the top-level after hook.
const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-tfs-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

function makeStore(directory) {
    return new TemplateFileStore({ logger: makeLogger(), directory });
}

// Constructor-supplied directory stores bypass request-config resolution, so most
// low-level filesystem behavior tests can pass a null context.
function makeContext() {
    return null;
}

// Writes a file directly into the backing directory using a logical-to-filesystem
// path, so read-path tests can seed templates without going through the store.
async function seedFile(directory, relativePath, source) {
    const fullPath = path.join(directory, relativePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, source, 'utf8');
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


describe('TemplateFileStore (node)', ({ after, describe }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('constructor', ({ it }) => {
        it('throws when logger is not provided', async () => {
            const directory = await makeTempDir();
            const caught = catchError(() => new TemplateFileStore({ directory }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore requires a logger', caught.message);
        });

        it('throws when options are not provided', () => {
            const caught = catchError(() => new TemplateFileStore());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws when directory is not provided', () => {
            const caught = catchError(() => new TemplateFileStore({ logger: makeLogger() }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore requires a directory', caught.message);
        });
    });

    describe('getBaseTemplate', ({ it }) => {
        it('returns null when the template does not exist', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getBaseTemplate(makeContext(), null, 'home.html');

            assertEqual(null, result);
        });

        it('returns the source with a logical filepath when no namespace is used', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getBaseTemplate(makeContext(), null, 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('reads from the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getBaseTemplate(makeContext(), 'v1', 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('strips a leading slash from the filepath when resolving the path', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getBaseTemplate(makeContext(), null, '/home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('does not find a template written under a different namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getBaseTemplate(makeContext(), 'v2', 'home.html');

            assertEqual(null, result);
        });

        it('throws when the read filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'secret.html', '<secret/>');
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), null, '../secret.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('read filepath must not contain', caught.message);
        });
    });

    describe('putBaseTemplate', ({ it }) => {
        it('writes to the flat namespace and returns the logical filepath when no namespace is used', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putBaseTemplate(makeContext(), null, 'home.html', '<home/>');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', await readBackingFile(directory, 'base/home.html'));
        });

        it('writes under the namespace and returns a logical filepath without the namespace', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putBaseTemplate(makeContext(), 'v1', 'home.html', '<home/>');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', await readBackingFile(directory, 'v1/base/home.html'));
        });

        it('round-trips with getBaseTemplate under the same namespace', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putBaseTemplate(context, 'v1', 'home.html', '<home/>');
            const result = await store.getBaseTemplate(context, 'v1', 'home.html');

            assertEqual('base/home.html', result.filepath);
            assertEqual('<home/>', result.source);
        });

        it('overwrites an existing file', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putBaseTemplate(context, null, 'home.html', '<old/>');
            await store.putBaseTemplate(context, null, 'home.html', '<new/>');

            assertEqual('<new/>', await readBackingFile(directory, 'base/home.html'));
        });

        it('throws when the filepath is empty', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, '', '<home/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore write requires a filepath', caught.message);
        });

        it('throws when the source is empty', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, 'home.html', ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('TemplateFileStore write requires source text', caught.message);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putBaseTemplate(makeContext(), null, '../secret.html', '<x/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });
    });

    describe('getPageTemplate', ({ it }) => {
        it('returns null when the template does not exist', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getPageTemplate(makeContext(), null, 'index.html');

            assertEqual(null, result);
        });

        it('returns the source with a logical filepath under the pages prefix', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'pages/index.html', '<index/>');
            const store = makeStore(directory);

            const result = await store.getPageTemplate(makeContext(), null, 'index.html');

            assertEqual('pages/index.html', result.filepath);
            assertEqual('<index/>', result.source);
        });

        it('resolves a filepath nested several segments deep', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'pages/blog/posts/welcome.html', '<post/>');
            const store = makeStore(directory);

            const result = await store.getPageTemplate(makeContext(), null, 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('reads a nested filepath from the namespace and strips it from the logical filepath', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/pages/blog/posts/welcome.html', '<post/>');
            const store = makeStore(directory);

            const result = await store.getPageTemplate(makeContext(), 'v1', 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('does not find a page written under a different namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/pages/index.html', '<index/>');
            const store = makeStore(directory);

            const result = await store.getPageTemplate(makeContext(), 'v2', 'index.html');

            assertEqual(null, result);
        });
    });

    describe('putPageTemplate', ({ it }) => {
        it('writes under the pages prefix and returns the logical filepath when no namespace is used', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putPageTemplate(makeContext(), null, 'index.html', '<index/>');

            assertEqual('pages/index.html', result.filepath);
            assertEqual('<index/>', await readBackingFile(directory, 'pages/index.html'));
        });

        it('writes a nested filepath several segments deep, creating intermediate directories', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putPageTemplate(makeContext(), null, 'blog/posts/welcome.html', '<post/>');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', await readBackingFile(directory, 'pages/blog/posts/welcome.html'));
        });

        it('writes a nested filepath under the namespace', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.putPageTemplate(makeContext(), 'v1', 'blog/posts/welcome.html', '<post/>');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', await readBackingFile(directory, 'v1/pages/blog/posts/welcome.html'));
        });

        it('round-trips a nested filepath with getPageTemplate under the same namespace', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putPageTemplate(context, 'v1', 'blog/posts/welcome.html', '<post/>');
            const result = await store.getPageTemplate(context, 'v1', 'blog/posts/welcome.html');

            assertEqual('pages/blog/posts/welcome.html', result.filepath);
            assertEqual('<post/>', result.source);
        });

        it('throws when the filepath contains ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putPageTemplate(makeContext(), null, 'blog/../secret.html', '<x/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });

        it('throws when the filepath contains backslash-delimited ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.putPageTemplate(makeContext(), null, 'blog\\..\\secret.html', '<x/>'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('filepath must not contain', caught.message);
        });
    });

    describe('namespace validation', ({ it }) => {
        it('throws when the namespace contains ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), '../escape', 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must not contain', caught.message);
        });

        it('throws when the namespace contains backslash-delimited ".." segments', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), 'v1\\..\\escape', 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must not contain', caught.message);
        });

        it('throws when the namespace is provided as a non-string', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);
            const caught = await catchAsyncError(() => store.getBaseTemplate(makeContext(), 42, 'home.html'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('namespace must be a string', caught.message);
        });

        it('treats an empty-string namespace as no namespace (flat namespace)', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putBaseTemplate(context, '', 'home.html', '<home/>');

            assertEqual('<home/>', await readBackingFile(directory, 'base/home.html'));
            const result = await store.getBaseTemplate(context, null, 'home.html');
            assertEqual('<home/>', result.source);
        });
    });

    describe('putPartials and getPartials', ({ it }) => {
        it('returns an empty array for the flat namespace when no partials exist', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), null);

            assertEqual(0, result.length);
        });

        it('throws when a namespaced partials directory was never published', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const caught = await catchAsyncError(() => store.getPartials(makeContext(), 'v1'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('no published partials directory', caught.message);
        });

        it('writes a complete set under the partials prefix and round-trips through getPartials, in submitted order', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            const written = await store.putPartials(context, 'v1', [
                { filepath: 'nav.html', source: '<nav/>' },
                { filepath: 'footer.html', source: '<footer/>' },
            ]);

            assertEqual(2, written.length);
            assertEqual('partials/nav.html', written[0].filepath);
            assertEqual('partials/footer.html', written[1].filepath);

            const result = await store.getPartials(context, 'v1');
            const byFilepath = new Map(result.map((file) => [ file.filepath, file.source ]));
            assertEqual(2, result.length);
            assertEqual('<nav/>', byFilepath.get('partials/nav.html'));
            assertEqual('<footer/>', byFilepath.get('partials/footer.html'));
        });

        it('writes nested partials with their full logical filepath', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const written = await store.putPartials(makeContext(), 'v1', [
                { filepath: 'widgets/card.html', source: '<card/>' },
            ]);

            assertEqual('partials/widgets/card.html', written[0].filepath);
            assertEqual('<card/>', await readBackingFile(directory, 'v1/partials/widgets/card.html'));
        });

        it('publishes an explicitly empty set that resolves to an empty array rather than failing', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const written = await store.putPartials(makeContext(), 'v1', []);
            assertEqual(0, written.length);

            const result = await store.getPartials(makeContext(), 'v1');
            assertEqual(0, result.length);
        });

        it('replaces the complete set, removing a file omitted from a later successful batch', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putPartials(context, 'v1', [
                { filepath: 'nav.html', source: '<nav/>' },
                { filepath: 'footer.html', source: '<footer/>' },
            ]);
            await store.putPartials(context, 'v1', [
                { filepath: 'nav.html', source: '<nav-2/>' },
            ]);

            const result = await store.getPartials(context, 'v1');

            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
            assertEqual('<nav-2/>', result[0].source);
        });

        it('does not touch other template prefixes or namespaces when replacing partials', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            await store.putBaseTemplate(context, 'v1', 'home.html', '<home/>');
            await seedFile(directory, 'v2/partials/nav.html', '<nav-v2/>');

            await store.putPartials(context, 'v1', [ { filepath: 'nav.html', source: '<nav/>' } ]);
            await store.putPartials(context, 'v1', [ { filepath: 'footer.html', source: '<footer/>' } ]);

            assertEqual('<home/>', await readBackingFile(directory, 'v1/base/home.html'));
            const v2Result = await store.getPartials(context, 'v2');
            assertEqual(1, v2Result.length);
            assertEqual('<nav-v2/>', v2Result[0].source);
        });

        it('throws when putPartials is called without a namespace', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const caught = await catchAsyncError(() => store.putPartials(makeContext(), null, []));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('putPartials requires a non-empty namespace', caught.message);
        });

        it('does not return files from another prefix in the flat namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'partials/nav.html', '<nav/>');
            await seedFile(directory, 'base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), null);

            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
        });
    });
});
