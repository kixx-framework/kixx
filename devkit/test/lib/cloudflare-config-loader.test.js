import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import {
    CLOUDFLARE_CONFIG_FILE_NAME,
    loadCloudflareConfig,
} from '../../lib/cloudflare-config-loader.js';
import createMemoryFileSystem from '../helpers/memory-file-system.js';
import { parseJsonc } from '../helpers/fake-parsers.js';


const PROJECT_DIRECTORY = path.resolve('/work/project');
const FILEPATH = path.join(PROJECT_DIRECTORY, 'cloudflare-config.jsonc');


describe('CloudflareConfigLoader', ({ it }) => {

    it('names the JSONC file', () => {
        assertEqual('cloudflare-config.jsonc', CLOUDFLARE_CONFIG_FILE_NAME);
    });

    // The grammar is the project's: the loader parses nothing itself.
    it('gives the file\'s text to the injected parser and returns what it parses', async () => {
        const source = '{ /* any JSONC */ }';
        const fileSystem = createMemoryFileSystem({ [FILEPATH]: source });
        const seen = [];

        const config = await loadCloudflareConfig(PROJECT_DIRECTORY, {
            fileSystem,
            parseJsonc(text) {
                seen.push(text);
                return { name: 'example-worker', environments: { production: {} } };
            },
        });

        assertEqual(source, seen.join('|'));
        assertEqual('example-worker', config.name);
        assert(Object.hasOwn(config.environments, 'production'));
    });

    it('requires the parser', async () => {
        const fileSystem = createMemoryFileSystem({ [FILEPATH]: '{ "environments": {} }' });

        const caught = await catchAsyncError(() => loadCloudflareConfig(PROJECT_DIRECTORY, { fileSystem }));

        assertEqual('AssertionError', caught?.name);
        assertMatches('requires parseJsonc', caught.message);
    });

    it('reads the file from disk by default', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dev-cloudflare-config-'));

        try {
            await fsp.writeFile(path.join(directory, 'cloudflare-config.jsonc'), '{ "environments": {} }\n');

            const config = await loadCloudflareConfig(directory, { parseJsonc });

            assertEqual(0, Object.keys(config.environments).length);
        } finally {
            await fsp.rm(directory, { recursive: true, force: true });
        }
    });

    it('reports a missing file with its absolute path', async () => {
        const caught = await catchAsyncError(() => {
            return loadCloudflareConfig(PROJECT_DIRECTORY, { fileSystem: createMemoryFileSystem(), parseJsonc });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assertMatches('Missing required Cloudflare configuration file', caught.message);
        assertMatches(FILEPATH, caught.message);
    });

    it('reports invalid JSONC with the parser message', async () => {
        const fileSystem = createMemoryFileSystem({ [FILEPATH]: '{ "environments": {' });

        const caught = await catchAsyncError(() => {
            return loadCloudflareConfig(PROJECT_DIRECTORY, {
                fileSystem,
                parseJsonc() {
                    throw new Error('unterminated block comment');
                },
            });
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assertMatches(`Unable to parse JSONC in ${ FILEPATH }`, caught.message);
        assertMatches('unterminated block comment', caught.message);
    });

    it('rejects a top level value that is not an object', async () => {
        const fileSystem = createMemoryFileSystem({ [FILEPATH]: '[ { "environments": {} } ]' });

        const caught = await catchAsyncError(() => loadCloudflareConfig(PROJECT_DIRECTORY, { fileSystem, parseJsonc }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assertMatches('Expected a JSON object at the top level', caught.message);
        assertMatches(FILEPATH, caught.message);
    });

    it('requires an environments object', async () => {
        for (const source of [ '{ "name": "x" }', '{ "environments": [] }', '{ "environments": null }' ]) {
            const fileSystem = createMemoryFileSystem({ [FILEPATH]: source });

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => loadCloudflareConfig(PROJECT_DIRECTORY, { fileSystem, parseJsonc }));

            assert(caught, `expected an error for ${ source }`);
            assertEqual('UsageError', caught.name);
            assertMatches('Expected an "environments" object', caught.message);
            assertMatches(FILEPATH, caught.message);
        }
    });
});


async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
