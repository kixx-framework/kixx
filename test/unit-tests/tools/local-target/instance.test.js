import path from 'node:path';
import process from 'node:process';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    NAME_PATTERN,
    assertValidName,
    getInstanceDirectory,
    getDotenvPath,
    getDotenvSecretsPath,
    getCredentialsPath,
    generateBuildId,
    generateSecret,
    formatPlainDotenv,
    formatSecretsDotenv,
    findProcessEnvCollisions,
    formatCredentials,
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
        it('writes ENVIRONMENT, TRUST_PROXY, PORT, BUILD_ID, and DATA_DIRECTORY', () => {
            const content = formatPlainDotenv({
                port: 4000,
                buildId: 'local-alpha-1',
                dataDirectory: '/tmp/alpha',
            });

            assertMatches('ENVIRONMENT=local', content);
            assertMatches('TRUST_PROXY=false', content);
            assertMatches('PORT=4000', content);
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
