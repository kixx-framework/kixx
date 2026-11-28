import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import {
    BUILD_DIRECTORY,
    createServerEnvironment,
    getFreePort,
    makeTemporaryDirectory,
    removeDirectory,
    tail,
} from '../../../../test-app/test/test-helpers/local-server.js';


// The parts that start nothing. startLocalServer() starts a real process,
// so only the integration suite calls it.
describe('test-app/test/test-helpers/local-server.js', ({ describe, it }) => {

    it('names the build directory beside the runner', () => {
        assertEqual('build', path.basename(BUILD_DIRECTORY));
        assertEqual('test-app', path.basename(path.dirname(BUILD_DIRECTORY)));
    });

    describe('createServerEnvironment()', ({ it }) => {
        const runnerEnvironment = {
            PATH: '/usr/bin',
            HOME: '/home/someone',
            INTEGRATION_TESTS_DEPLOY_KEY: 'the-target-key',
            INTEGRATION_TESTS_BASE_URL: 'http://localhost:2026/',
            INTEGRATION_TESTS_TARGET: 'local',
            BUILD_ID: 'someone-elses-build',
            DATA_DIRECTORY: '/somewhere/else',
            DEPLOY_KEY_HASH: 'someone-elses-hash',
            NODE_ENV: 'test',
            PORT: '9999',
            TRUST_PROXY: 'true',
        };

        it('keeps the runner\'s environment, but for the suite\'s variables and the server\'s', () => {
            assertEqual(
                JSON.stringify({ PATH: '/usr/bin', HOME: '/home/someone' }),
                JSON.stringify(createServerEnvironment(runnerEnvironment)),
            );
        });

        it('adds the variables given, over anything the runner had', () => {
            const env = createServerEnvironment(runnerEnvironment, { BUILD_ID: 'mine', DATA_DIRECTORY: '/mine' });

            assertEqual('mine', env.BUILD_ID);
            assertEqual('/mine', env.DATA_DIRECTORY);
            assertFalsy('DEPLOY_KEY_HASH' in env);
            assertFalsy('INTEGRATION_TESTS_DEPLOY_KEY' in env);
        });

        it('leaves the runner\'s environment as it was', () => {
            createServerEnvironment(runnerEnvironment, { BUILD_ID: 'mine' });

            assertEqual('someone-elses-build', runnerEnvironment.BUILD_ID);
        });
    });

    describe('getFreePort()', ({ it }) => {
        it('resolves a port a server can then listen on', async () => {
            const port = await getFreePort();

            assert(Number.isInteger(port) && port > 0 && port < 65536, `got ${ port }`);

            await new Promise((resolve, reject) => {
                const server = net.createServer();

                server.once('error', reject);
                server.listen(port, '127.0.0.1', () => server.close(resolve));
            });
        });
    });

    describe('makeTemporaryDirectory() and removeDirectory()', ({ it }) => {
        it('make a new empty directory each time, and remove one with what it holds', async () => {
            const first = await makeTemporaryDirectory('unit');
            const second = await makeTemporaryDirectory('unit');

            try {
                assert(first !== second);
                assertEqual(0, fs.readdirSync(first).length);

                fs.writeFileSync(path.join(first, 'file.txt'), 'text');
            } finally {
                await removeDirectory(first);
                await removeDirectory(second);
            }

            assertFalsy(fs.existsSync(first));
            assertFalsy(fs.existsSync(second));
        });
    });

    describe('tail()', ({ it }) => {
        it('returns the last lines of some output', () => {
            assertEqual('c\nd', tail('a\nb\nc\nd\n', 2));
            assertEqual('a', tail('a\n'));
        });
    });
}, { timeout: 5000 });
