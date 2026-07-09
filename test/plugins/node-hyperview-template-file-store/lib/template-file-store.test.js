import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import TemplateFileStore from '../../../../src/plugins/node-hyperview-template-file-store/lib/template-file-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


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

        it('allows logger-only construction for request-config-backed stores', () => {
            const store = new TemplateFileStore({ logger: makeLogger() });

            assert(store, 'expected store to be constructed');
        });
    });

    describe('request config', ({ it }) => {
        it('resolves HYPERVIEW_TEMPLATE_FILE_STORE.directory from the method context', async () => {
            const directory = await makeTempDir();
            const tracker = new MockTracker();
            const resolveFilepath = tracker.fn(() => directory);
            const context = {
                config: {
                    env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './templates' } },
                    resolveFilepath,
                },
            };
            const store = new TemplateFileStore({ logger: makeLogger() });

            await store.putBaseTemplate(context, null, 'home.html', '<home/>');
            const result = await store.getBaseTemplate(context, null, 'home.html');

            assertEqual('./templates', resolveFilepath.mock.getCall(0).arguments[0]);
            assertEqual('<home/>', result.source);
        });

        it('throws when HYPERVIEW_TEMPLATE_FILE_STORE.directory is missing', async () => {
            const store = new TemplateFileStore({ logger: makeLogger() });

            const caught = await catchAsyncError(() => {
                return store.getBaseTemplate({ config: { env: {} } }, null, 'missing.html');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HYPERVIEW_TEMPLATE_FILE_STORE.directory', caught.message);
        });

        it('locks the resolved directory across requests with a stable config', async () => {
            const directory = await makeTempDir();
            const resolveFilepath = () => directory;
            const makeConfigContext = () => {
                return {
                    config: {
                        env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './templates' } },
                        resolveFilepath,
                    },
                };
            };
            const store = new TemplateFileStore({ logger: makeLogger() });

            // A fresh context object each request still resolves the same directory,
            // so a template written on one request is readable on the next.
            await store.putBaseTemplate(makeConfigContext(), null, 'home.html', '<home/>');
            const result = await store.getBaseTemplate(makeConfigContext(), null, 'home.html');

            assertEqual('<home/>', result.source);
        });

        it('throws when the resolved directory changes after it is set', async () => {
            const firstDirectory = await makeTempDir();
            const secondDirectory = await makeTempDir();
            const resolveFilepath = (configuredPath) => {
                return configuredPath === './first' ? firstDirectory : secondDirectory;
            };
            const firstContext = {
                config: {
                    env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './first' } },
                    resolveFilepath,
                },
            };
            const secondContext = {
                config: {
                    env: { HYPERVIEW_TEMPLATE_FILE_STORE: { directory: './second' } },
                    resolveFilepath,
                },
            };
            const store = new TemplateFileStore({ logger: makeLogger() });

            await store.putBaseTemplate(firstContext, null, 'home.html', '<home/>');

            const caught = await catchAsyncError(() => {
                return store.getBaseTemplate(secondContext, null, 'home.html');
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not change', caught.message);
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

    describe('putPartial and getPartials', ({ it }) => {
        it('returns an empty array when no partials exist', async () => {
            const directory = await makeTempDir();
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), null);

            assertEqual(0, result.length);
        });

        it('writes a partial under the partials prefix and round-trips through getPartials', async () => {
            const directory = await makeTempDir();
            const context = makeContext();
            const store = makeStore(directory);

            const written = await store.putPartial(context, null, 'nav.html', '<nav/>');
            assertEqual('partials/nav.html', written.filepath);

            const result = await store.getPartials(context, null);
            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
            assertEqual('<nav/>', result[0].source);
        });

        it('returns logical filepaths with the namespace stripped', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/partials/nav.html', '<nav/>');
            await seedFile(directory, 'v1/partials/footer.html', '<footer/>');
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), 'v1');

            const filepaths = result.map((file) => file.filepath).sort();
            assertEqual('partials/footer.html', filepaths[0]);
            assertEqual('partials/nav.html', filepaths[1]);
        });

        it('returns nested partials with their full logical filepath', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'partials/widgets/card.html', '<card/>');
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), null);

            assertEqual(1, result.length);
            assertEqual('partials/widgets/card.html', result[0].filepath);
            assertEqual('<card/>', result[0].source);
        });

        it('does not return files from another prefix', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'partials/nav.html', '<nav/>');
            await seedFile(directory, 'base/home.html', '<home/>');
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), null);

            assertEqual(1, result.length);
            assertEqual('partials/nav.html', result[0].filepath);
        });

        it('does not return partials written under a different namespace', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/partials/nav.html', '<nav/>');
            const store = makeStore(directory);

            const result = await store.getPartials(makeContext(), 'v2');

            assertEqual(0, result.length);
        });
    });
});
