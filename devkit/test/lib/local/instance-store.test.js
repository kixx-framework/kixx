import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { parseEnvFile } from '../../../lib/env-file.js';
import {
    assertValidInstanceName,
    createInstance,
    destroyInstance,
    findProcessEnvCollisions,
    generateBuildId,
    getInstancePaths,
    listInstances,
    readCredentials,
    readInstance,
    resolveInstancesDirectory,
    writeCredentials,
} from '../../../lib/local/instance-store.js';

const MANIFEST = [
    'CSRF_TOKEN_SIGNING_SECRET=x',
    'CURSOR_SECRET=x',
    '# @optional',
    'ADMIN_BOOTSTRAP_TOKEN=x',
    '# @optional',
    'THIRD_PARTY_KEY=x',
    '',
].join('\n');

const NOW = () => new Date(1700000000000);

const CREDENTIALS = {
    baseUrl: 'http://localhost:5555/',
    username: 'root@alpha.local',
    password: 'password-password',
    publishingApiToken: 'token',
    buildId: 'local-alpha-1',
    port: 5555,
};


describe('local instance-store', ({ before, after, it, describe }) => {
    let root;
    let source;

    before(async () => {
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-')));
        source = path.join(root, 'app');
        await fsp.mkdir(source);
        await fsp.writeFile(path.join(source, 'node-server.js'), '');
        await fsp.writeFile(path.join(source, 'example.env.secrets'), MANIFEST);
        await fsp.writeFile(path.join(source, 'example.env'), 'ENVIRONMENT=development\nTRUST_PROXY=false\nPORT=1\n');
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    // Each test gets its own instances directory so tests stay independent.
    let counter = 0;
    const newInstancesDirectory = () => {
        counter += 1;
        return path.join(root, `target-${ counter }`, 'instances');
    };

    const create = (instancesDirectory, overrides) => createInstance({
        sourceDirectory: source,
        instancesDirectory,
        name: 'alpha',
        now: NOW,
        getFreePort: async () => 5555,
        ...overrides,
    });

    describe('names and paths', ({ it }) => {
        it('accepts valid names', () => {
            assertValidInstanceName('alpha');
            assertValidInstanceName('a1-b2');
        });

        it('rejects invalid names with a UsageError', () => {
            for (const name of [ 'Alpha', 'a--b', '-a', 'a/b', '..', '', 'a-', undefined ]) {
                const error = catchError(() => assertValidInstanceName(name));
                assertEqual('UsageError', error?.name, `name ${ name }`);
            }
        });

        it('resolves the instances directory', () => {
            assertEqual('/app/.kixx/instances', resolveInstancesDirectory({ sourceDirectory: '/app' }));
            assertEqual('/t/instances', resolveInstancesDirectory({ sourceDirectory: '/app', target: '/t' }));
            assertEqual(
                path.resolve('rel', 'instances'),
                resolveInstancesDirectory({ sourceDirectory: '/app', target: 'rel' }),
            );
        });

        it('generates a Build ID from the name and time', () => {
            assertEqual('local-alpha-1700000000000', generateBuildId('alpha', NOW()));
        });
    });

    it('creates instance.json, .env, and .env.secrets', async () => {
        const instancesDirectory = newInstancesDirectory();
        const result = await create(instancesDirectory);
        const paths = getInstancePaths(instancesDirectory, 'alpha');

        assertEqual(paths.directory, result.directory);
        assertEqual(5555, result.port);
        assertEqual('local-alpha-1700000000000', result.buildId);

        const metadata = JSON.parse(await fsp.readFile(paths.metadata, 'utf8'));
        assertEqual(5555, metadata.port);
        assertEqual(1, Object.keys(metadata).length);

        const env = parseEnvFile(await fsp.readFile(paths.dotenv, 'utf8'), paths.dotenv, { reservedNames: [] });
        assertEqual('local', env.ENVIRONMENT);
        assertEqual('false', env.TRUST_PROXY);
        assertEqual(result.buildId, env.BUILD_ID);
        assertEqual(paths.directory, env.DATA_DIRECTORY);
        assert(path.isAbsolute(env.DATA_DIRECTORY), 'absolute DATA_DIRECTORY');
        assertEqual(undefined, env.PORT);

        const secrets = parseEnvFile(await fsp.readFile(paths.dotenvSecrets, 'utf8'), paths.dotenvSecrets);
        assertEqual(
            'ADMIN_BOOTSTRAP_TOKEN,CSRF_TOKEN_SIGNING_SECRET,CURSOR_SECRET',
            Object.keys(secrets).sort().join(','),
        );
        assertEqual(3, new Set(Object.values(secrets)).size);

        for (const value of Object.values(secrets)) {
            assertMatches(/^[0-9a-f]{64}$/, value);
        }

        if (process.platform !== 'win32') {
            const stats = await fsp.stat(paths.dotenvSecrets);
            assertEqual(0o600, stats.mode & 0o777);
        }

        assert(result.envNames.includes('BUILD_ID'), 'envNames lists plain names');
        assert(result.envNames.includes('ADMIN_BOOTSTRAP_TOKEN'), 'envNames lists secret names');
    });

    it('uses a given port', async () => {
        const instancesDirectory = newInstancesDirectory();
        const result = await create(instancesDirectory, { port: 4100 });
        assertEqual(4100, result.port);
    });

    it('rejects an invalid port before touching disk', async () => {
        const instancesDirectory = newInstancesDirectory();
        const error = await catchAsyncError(() => create(instancesDirectory, { port: 70000 }));

        assertEqual('UsageError', error?.name);
        assertEqual(false, await exists(path.dirname(instancesDirectory)));
    });

    it('refuses an existing instance', async () => {
        const instancesDirectory = newInstancesDirectory();
        await create(instancesDirectory);

        const error = await catchAsyncError(() => create(instancesDirectory));

        assertEqual('UsageError', error?.name);
        assertMatches('already exists', error.message);
    });

    it('refuses a source without node-server.js and leaves nothing behind', async () => {
        const instancesDirectory = newInstancesDirectory();
        const error = await catchAsyncError(() => create(instancesDirectory, { sourceDirectory: root }));

        assertEqual('UsageError', error?.name);
        assertMatches('is not a Kixx application', error.message);
        assertEqual(false, await exists(path.join(instancesDirectory, 'alpha')));
    });

    it('refuses a source without example.env.secrets and leaves nothing behind', async () => {
        const bare = path.join(root, 'bare-app');
        await fsp.mkdir(bare);
        await fsp.writeFile(path.join(bare, 'node-server.js'), '');

        const instancesDirectory = newInstancesDirectory();
        const error = await catchAsyncError(() => create(instancesDirectory, { sourceDirectory: bare }));

        assertEqual('UsageError', error?.name);
        assertMatches('Missing secrets manifest', error.message);
        assertEqual(false, await exists(path.join(instancesDirectory, 'alpha')));
    });

    describe('readInstance()', ({ it }) => {
        it('reads the port, dotenv pair, and seeded state', async () => {
            const instancesDirectory = newInstancesDirectory();
            const created = await create(instancesDirectory);

            const instance = await readInstance({ instancesDirectory, name: 'alpha' });

            assertEqual(5555, instance.port);
            assertEqual(created.buildId, instance.env.BUILD_ID);
            assertMatches(/^[0-9a-f]{64}$/, instance.secrets.ADMIN_BOOTSTRAP_TOKEN);
            assertEqual(false, instance.isSeeded);

            await writeCredentials(instance.paths, CREDENTIALS);

            assertEqual(true, (await readInstance({ instancesDirectory, name: 'alpha' })).isSeeded);
        });

        it('refuses a missing instance, naming the create command', async () => {
            const error = await catchAsyncError(() => readInstance({
                instancesDirectory: newInstancesDirectory(),
                name: 'alpha',
            }));

            assertEqual('UsageError', error?.name);
            assertMatches('run "kixx local create alpha" first', error.message);
        });

        it('refuses an invalid instance.json', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);
            const paths = getInstancePaths(instancesDirectory, 'alpha');

            for (const text of [ 'not json', '{"port":"80"}', '{"port":0}' ]) {
                // eslint-disable-next-line no-await-in-loop
                await fsp.writeFile(paths.metadata, text);
                // eslint-disable-next-line no-await-in-loop
                const error = await catchAsyncError(() => readInstance({ instancesDirectory, name: 'alpha' }));

                assertEqual('UsageError', error?.name, text);
                assertMatches('destroy and re-create', error.message);
            }

            await fsp.rm(paths.metadata);
            const error = await catchAsyncError(() => readInstance({ instancesDirectory, name: 'alpha' }));
            assertMatches('destroy and re-create', error?.message);
        });
    });

    describe('credentials', ({ it }) => {
        it('returns null before seeding and round-trips after writing', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);
            const paths = getInstancePaths(instancesDirectory, 'alpha');

            assertEqual(null, await readCredentials(paths));

            await writeCredentials(paths, CREDENTIALS);

            assertEqual(JSON.stringify(CREDENTIALS), JSON.stringify(await readCredentials(paths)));

            const text = await fsp.readFile(paths.credentials, 'utf8');
            assert(text.endsWith('}\n'), 'trailing newline');

            if (process.platform !== 'win32') {
                assertEqual(0o600, (await fsp.stat(paths.credentials)).mode & 0o777);
            }
        });

        it('rejects a write missing a field', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);
            const paths = getInstancePaths(instancesDirectory, 'alpha');

            const error = await catchAsyncError(() => writeCredentials(paths, { ...CREDENTIALS, password: undefined }));

            assertMatches('credentials.password', error?.message);
            assertEqual(null, await readCredentials(paths));
        });

        it('rejects invalid JSON with a UsageError', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);
            const paths = getInstancePaths(instancesDirectory, 'alpha');

            for (const text of [ '{', '[]' ]) {
                // eslint-disable-next-line no-await-in-loop
                await fsp.writeFile(paths.credentials, text);
                // eslint-disable-next-line no-await-in-loop
                const error = await catchAsyncError(() => readCredentials(paths));
                assertEqual('UsageError', error?.name, text);
            }
        });
    });

    describe('listInstances()', ({ it }) => {
        it('returns [] when the instances directory is missing', async () => {
            assertEqual(0, (await listInstances({ instancesDirectory: newInstancesDirectory() })).length);
        });

        it('lists sorted instances, skipping junk', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory, { name: 'beta', port: 4002 });
            await create(instancesDirectory, { name: 'alpha', port: 4001 });
            await writeCredentials(getInstancePaths(instancesDirectory, 'alpha'), CREDENTIALS);

            await fsp.mkdir(path.join(instancesDirectory, 'Not-Valid'));
            await fsp.writeFile(path.join(instancesDirectory, 'file'), '');
            await fsp.mkdir(path.join(instancesDirectory, 'gamma'));

            const instances = await listInstances({ instancesDirectory });

            assertEqual(JSON.stringify([
                { name: 'alpha', port: 4001, isSeeded: true },
                { name: 'beta', port: 4002, isSeeded: false },
                { name: 'gamma', port: null, isSeeded: false },
            ]), JSON.stringify(instances));
        });
    });

    describe('destroyInstance()', ({ it }) => {
        it('refuses while the port accepts connections', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);

            const ports = [];
            const error = await catchAsyncError(() => destroyInstance({
                instancesDirectory,
                name: 'alpha',
                canConnect: async (port) => {
                    ports.push(port);
                    return true;
                },
            }));

            assertEqual('UsageError', error?.name);
            assertMatches('stop it before running destroy', error.message);
            assertEqual('5555', ports.join(','));
            assert(await exists(path.join(instancesDirectory, 'alpha')), 'kept the directory');
        });

        it('removes a stopped instance', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);

            await destroyInstance({ instancesDirectory, name: 'alpha', canConnect: async () => false });

            assertEqual(false, await exists(path.join(instancesDirectory, 'alpha')));
        });

        it('removes an instance whose instance.json is missing', async () => {
            const instancesDirectory = newInstancesDirectory();
            await create(instancesDirectory);
            await fsp.rm(getInstancePaths(instancesDirectory, 'alpha').metadata);

            await destroyInstance({ instancesDirectory, name: 'alpha', canConnect: async () => true });

            assertEqual(false, await exists(path.join(instancesDirectory, 'alpha')));
        });

        it('refuses a missing instance and an invalid name', async () => {
            const instancesDirectory = newInstancesDirectory();
            const canConnect = async () => false;

            const missing = await catchAsyncError(() => destroyInstance({ instancesDirectory, name: 'alpha', canConnect }));
            assertEqual('UsageError', missing?.name);

            const invalid = await catchAsyncError(() => destroyInstance({ instancesDirectory, name: '..', canConnect }));
            assertEqual('UsageError', invalid?.name);
            assertMatches('Invalid instance name', invalid.message);
        });
    });

    it('findProcessEnvCollisions() returns non-empty names in order', () => {
        const env = { B: 'x', A: 'y', EMPTY: '' };
        assertEqual('B,A', findProcessEnvCollisions([ 'B', 'EMPTY', 'C', 'A' ], env).join(','));
    });
});


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

async function exists(filepath) {
    try {
        await fsp.stat(filepath);
        return true;
    } catch {
        return false;
    }
}
