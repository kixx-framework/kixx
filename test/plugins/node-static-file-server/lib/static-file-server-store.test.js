import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import StaticFileStore from '../../../../src/plugins/node-static-file-server/lib/static-file-server-store.js';
import Logger from '../../../../src/kixx/logger/logger.js';


const tempDirs = [];

async function makeTempDir() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-sfs-'));
    tempDirs.push(dir);
    return dir;
}

function makeLogger() {
    return new Logger({ name: 'Test', level: 'NONE' });
}

async function seedFile(directory, relativePath, source) {
    const fullPath = path.join(directory, relativePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, source, 'utf8');
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Node StaticFileStore', ({ after, describe }) => {

    after(async () => {
        for (const dir of tempDirs) {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    describe('request config', ({ it }) => {
        it('resolves STATIC_FILE_STORE.directory from the read context', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'site.css', 'body{}');
            const tracker = new MockTracker();
            const resolveFilepath = tracker.fn(() => directory);
            const context = {
                config: {
                    env: { STATIC_FILE_STORE: { directory: './public' } },
                    resolveFilepath,
                },
            };
            const store = new StaticFileStore({ logger: makeLogger() });

            const result = await store.read(context, {
                key: 'site.css',
                namespace: null,
                computeEtag: false,
            });

            assert(result, 'expected a static file result');
            assertEqual('./public', resolveFilepath.mock.getCall(0).arguments[0]);
            assertEqual('text/css; charset=utf-8', result.contentType);
            assertEqual(6, result.contentLength);
            assertEqual(null, result.etag);
            await result.body.cancel();
        });

        it('throws when STATIC_FILE_STORE.directory is missing', async () => {
            const store = new StaticFileStore({ logger: makeLogger() });

            const caught = await catchAsyncError(() => {
                return store.read({ config: { env: {} } }, {
                    key: 'site.css',
                    namespace: null,
                    computeEtag: false,
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('STATIC_FILE_STORE.directory', caught.message);
        });

        it('reuses the resolved root and manifest across requests with a stable directory', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'v1/site.txt', 'hello');
            await seedFile(directory, 'v1/manifest.json', JSON.stringify({
                'site.txt': {
                    etag: '"manifest-etag"',
                    contentType: 'text/custom',
                    lastModified: '2026-01-01T00:00:00.000Z',
                },
            }));
            const resolveFilepath = () => directory;
            const makeConfigContext = () => {
                return {
                    config: {
                        env: { STATIC_FILE_STORE: { directory: './public' } },
                        resolveFilepath,
                    },
                };
            };
            const store = new StaticFileStore({ logger: makeLogger() });

            // A fresh context object each request still resolves the same root, so
            // the manifest metadata is served consistently across requests.
            const first = await store.read(makeConfigContext(), {
                key: 'site.txt',
                namespace: 'v1',
                computeEtag: true,
            });
            const second = await store.read(makeConfigContext(), {
                key: 'site.txt',
                namespace: 'v1',
                computeEtag: true,
            });

            assertEqual('"manifest-etag"', first.etag);
            assertEqual('text/custom', first.contentType);
            assertEqual('"manifest-etag"', second.etag);
            assertEqual('text/custom', second.contentType);
            await first.body.cancel();
            await second.body.cancel();
        });

        it('throws when the resolved root directory changes after the first read', async () => {
            const firstDirectory = await makeTempDir();
            const secondDirectory = await makeTempDir();
            await seedFile(firstDirectory, 'site.txt', 'first');
            await seedFile(secondDirectory, 'site.txt', 'second');
            const resolveFilepath = (configuredPath) => {
                return configuredPath === './first-public' ? firstDirectory : secondDirectory;
            };
            const firstContext = {
                config: {
                    env: { STATIC_FILE_STORE: { directory: './first-public' } },
                    resolveFilepath,
                },
            };
            const secondContext = {
                config: {
                    env: { STATIC_FILE_STORE: { directory: './second-public' } },
                    resolveFilepath,
                },
            };
            const store = new StaticFileStore({ logger: makeLogger() });

            const first = await store.read(firstContext, {
                key: 'site.txt',
                namespace: null,
                computeEtag: false,
            });
            await first.body.cancel();

            const caught = await catchAsyncError(() => {
                return store.read(secondContext, {
                    key: 'site.txt',
                    namespace: null,
                    computeEtag: false,
                });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must not change', caught.message);
        });
    });

    describe('explicit directory configuration', ({ it }) => {
        it('reads from an explicit directory without request config', async () => {
            const directory = await makeTempDir();
            await seedFile(directory, 'site.css', 'body{}');
            const store = new StaticFileStore({ logger: makeLogger(), directory });

            const result = await store.read(null, {
                key: 'site.css',
                namespace: null,
                computeEtag: true,
            });

            assert(result, 'expected a static file result');
            assertEqual('text/css; charset=utf-8', result.contentType);
            assertMatches(/^"[a-f0-9]{64}"$/, result.etag);
            await result.body.cancel();
        });

        it('returns null for paths outside the root directory', async () => {
            const directory = await makeTempDir();
            const store = new StaticFileStore({ logger: makeLogger(), directory });

            const result = await store.read(null, {
                key: '../secret.txt',
                namespace: null,
                computeEtag: false,
            });

            assertEqual(null, result);
        });
    });
});
