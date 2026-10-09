import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { once } from 'node:events';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches, assertNotMatches } from 'kixx-assert';

import {
    NAME_PATTERN,
    assertValidName,
    getInstanceDirectory,
    getDotenvPath,
    getDotenvSecretsPath,
    getCredentialsPath,
    getInstanceMetadataPath,
    generateBuildId,
    generateSecret,
    formatPlainDotenv,
    formatSecretsDotenv,
    findProcessEnvCollisions,
    formatCredentials,
    createInstance,
    destroyInstance,
    readInstancePort,
} from '../../../../tools/local-target/instance.js';
import { isValidBuildId } from '../../../../src/kixx/utils/build-id.js';


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


describe('local-target instance', ({ describe }) => {

    describe('assertValidName', ({ it }) => {
        it('accepts lowercase alphanumeric names with single hyphens', () => {
            for (const name of [ 'alpha', 'a1', 'my-feature-branch', 'a-b-c' ]) {
                assert(NAME_PATTERN.test(name), `expected "${ name }" to match NAME_PATTERN`);
                assertEqual(null, catchError(() => assertValidName(name)));
            }
        });

        it('rejects empty, uppercase, and malformed names', () => {
            for (const name of [ '', 'Alpha', 'alpha_beta', '-alpha', 'alpha-', 'alpha--beta', undefined, null ]) {
                const caught = catchError(() => assertValidName(name));
                assert(caught, `expected "${ name }" to be rejected`);
                assertEqual('OperationalError', caught.name);
            }
        });
    });

    describe('instance paths', ({ it }) => {
        it('derives the dotenv, secrets, and credentials paths from the instance directory', () => {
            const directory = getInstanceDirectory('alpha');

            assertMatches(path.join('data', 'local-targets', 'alpha'), directory);
            assertEqual(path.join(directory, '.env'), getDotenvPath('alpha'));
            assertEqual(`${ getDotenvPath('alpha') }.secrets`, getDotenvSecretsPath('alpha'));
            assertEqual(path.join(directory, 'credentials.json'), getCredentialsPath('alpha'));
        });
    });

    describe('generateBuildId', ({ it }) => {
        it('produces a valid, lowercase Build ID unique to the instance', () => {
            const buildId = generateBuildId('alpha');

            assert(isValidBuildId(buildId), `expected "${ buildId }" to be a valid Build ID`);
            assertMatches('local-alpha-', buildId);
            assertEqual(buildId.toLowerCase(), buildId);
        });
    });

    describe('generateSecret', ({ it }) => {
        it('generates a hex string of the requested byte length', () => {
            const secret = generateSecret(16);

            assertEqual(32, secret.length);
            assert(/^[0-9a-f]+$/.test(secret), 'expected a lowercase hex string');
        });

        it('generates different secrets on each call', () => {
            assert(generateSecret() !== generateSecret());
        });
    });

    describe('formatPlainDotenv', ({ it }) => {
        it('writes ENVIRONMENT, TRUST_PROXY, BUILD_ID, and DATA_DIRECTORY, and no PORT', () => {
            const content = formatPlainDotenv({
                buildId: 'local-alpha-1',
                dataDirectory: '/tmp/alpha',
            });

            assertMatches('ENVIRONMENT=local', content);
            assertMatches('TRUST_PROXY=false', content);
            assertNotMatches(/^PORT=/m, content);
            assertMatches('BUILD_ID=local-alpha-1', content);
            assertMatches('DATA_DIRECTORY=/tmp/alpha', content);
            assert(content.endsWith('\n'), 'expected the file content to end with a newline');
        });
    });

    describe('formatSecretsDotenv', ({ it }) => {
        it('writes three distinct secrets and returns the bootstrap token', () => {
            const { content, adminBootstrapToken } = formatSecretsDotenv();

            assertMatches('DOCUMENT_STORE_CURSOR_SIGNING_SECRET=', content);
            assertMatches('CSRF_TOKEN_SIGNING_SECRET=', content);
            assertMatches(`ADMIN_BOOTSTRAP_TOKEN=${ adminBootstrapToken }`, content);

            const lines = content.trim().split('\n');
            const values = lines.map((line) => line.split('=')[1]);
            assertEqual(3, new Set(values).size);
        });
    });

    describe('findProcessEnvCollisions', ({ it }) => {
        it('returns an empty list when none of the written keys are set', () => {
            const original = process.env.BUILD_ID;
            delete process.env.BUILD_ID;

            try {
                assertEqual(0, findProcessEnvCollisions().length);
            } finally {
                if (original !== undefined) {
                    process.env.BUILD_ID = original;
                }
            }
        });

        it('names a key that is set in process.env', () => {
            const original = process.env.BUILD_ID;
            process.env.BUILD_ID = 'something';

            try {
                assert(findProcessEnvCollisions().includes('BUILD_ID'));
            } finally {
                if (original === undefined) {
                    delete process.env.BUILD_ID;
                } else {
                    process.env.BUILD_ID = original;
                }
            }
        });

        it('does not report an exported PORT as a dotenv collision', () => {
            const original = process.env.PORT;
            process.env.PORT = '3000';

            try {
                assertFalsy(findProcessEnvCollisions().includes('PORT'));
            } finally {
                if (original === undefined) {
                    delete process.env.PORT;
                } else {
                    process.env.PORT = original;
                }
            }
        });
    });

    // Instances live in the real data/local-targets/ directory, so each test
    // uses a name unique to this process and removes it afterwards.
    describe('instance port', ({ after, it }) => {
        const namePrefix = `unit-test-${ process.pid }`;
        const names = [];

        after(async () => {
            for (const name of names) {
                await fsp.rm(getInstanceDirectory(name), { recursive: true, force: true });
            }
        });

        function nextName() {
            const name = `${ namePrefix }-${ names.length }`;
            names.push(name);
            return name;
        }

        it('records the port in instance.json and leaves PORT out of .env', async () => {
            const name = nextName();

            const { port } = await createInstance(name, { port: 50999 });

            assertEqual(50999, port);
            assertEqual(50999, JSON.parse(await fsp.readFile(getInstanceMetadataPath(name), 'utf8')).port);
            assertEqual(50999, readInstancePort(name));

            const dotenv = await fsp.readFile(getDotenvPath(name), 'utf8');
            assertNotMatches(/^PORT=/m, dotenv);
            assertMatches(/^BUILD_ID=local-/m, dotenv);
        });

        it('rejects reading the port of an instance with no instance.json', async () => {
            const name = nextName();
            await createInstance(name, { port: 50998 });
            await fsp.rm(getInstanceMetadataPath(name));

            const caught = catchError(() => readInstancePort(name));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('destroy and re-create the instance', caught.message);
        });

        it('rejects an instance.json without a valid port', async () => {
            const name = nextName();
            await createInstance(name, { port: 50997 });
            await fsp.writeFile(getInstanceMetadataPath(name), JSON.stringify({ port: '50997' }));

            const caught = catchError(() => readInstancePort(name));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('has no valid port', caught.message);
        });

        it('refuses to destroy an instance while its recorded port is serving', async () => {
            const name = nextName();
            const server = net.createServer();
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');

            try {
                await createInstance(name, { port: server.address().port });

                const caught = await catchAsyncError(() => destroyInstance(name));

                assert(caught, 'expected an error to be thrown');
                assertEqual('OperationalError', caught.name);
                assertMatches('is still serving on port', caught.message);
                assert(fs.existsSync(getInstanceDirectory(name)));
            } finally {
                server.close();
            }
        });

        it('destroys an instance created before the port moved to instance.json', async () => {
            const name = nextName();
            await createInstance(name, { port: 50996 });
            await fsp.rm(getInstanceMetadataPath(name));

            await destroyInstance(name);

            assertFalsy(fs.existsSync(getInstanceDirectory(name)));
        });
    });

    describe('formatCredentials', ({ it }) => {
        it('serializes the fields seed writes to credentials.json', () => {
            const credentials = formatCredentials({
                port: 4000,
                buildId: 'local-alpha-1',
                username: 'root@alpha.local',
                password: 'secret',
                publishingApiToken: 'kxpat_abc',
            });

            assertEqual('http://localhost:4000/', credentials.baseUrl);
            assertEqual('root@alpha.local', credentials.username);
            assertEqual('secret', credentials.password);
            assertEqual('kxpat_abc', credentials.publishingApiToken);
            assertEqual('local-alpha-1', credentials.buildId);
            assertEqual(4000, credentials.port);
        });

        it('throws an AssertionError when a required field is missing', () => {
            const caught = catchError(() => formatCredentials({ port: 4000 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });
});
