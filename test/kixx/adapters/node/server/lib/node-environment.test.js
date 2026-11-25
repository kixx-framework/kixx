import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import {
    resolveDotenvFilepath,
    readEnvironment,
    readOptionalDotEnvFile,
    readSourceConfigFile,
    createResolveFilepath,
} from '../../../../../../kixx/adapters/node/server/lib/node-environment.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

const tempDirectories = [];

function makeTempDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-environment-test-'));
    tempDirectories.push(directory);
    return directory;
}


describe('node-environment', ({ describe, after }) => {

    after(() => {
        for (const directory of tempDirectories) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    describe('resolveDotenvFilepath', ({ it }) => {
        it('defaults to .env.<environment> inside baseDirectory', () => {
            const filepath = resolveDotenvFilepath({
                baseDirectory: '/app/src',
                environment: 'production',
            });

            assertEqual(path.join('/app/src', '.env.production'), filepath);
        });

        it('resolves an explicit dotenv path against the current working directory', () => {
            const filepath = resolveDotenvFilepath({
                baseDirectory: '/app/src',
                environment: 'production',
                dotenv: 'custom/path.env',
            });

            assertEqual(path.resolve('custom/path.env'), filepath);
        });
    });

    describe('readSourceConfigFile', ({ it }) => {
        it('parses a JSONC config file', () => {
            const dir = makeTempDirectory();
            const filepath = path.join(dir, 'config.jsonc');
            fs.writeFileSync(filepath, '{\n    // comment\n    "name": "app",\n}\n');

            const result = readSourceConfigFile(filepath);

            assertEqual('app', result.name);
        });

        it('throws an OperationalError when the file does not exist', () => {
            const dir = makeTempDirectory();
            const error = catchError(() => readSourceConfigFile(path.join(dir, 'missing.jsonc')));

            assert(error, 'expected an error');
            assertEqual('OperationalError', error.name);
            assertMatches('Unable to read config file', error.message);
        });

        it('throws an OperationalError when the file cannot be parsed', () => {
            const dir = makeTempDirectory();
            const filepath = path.join(dir, 'invalid.jsonc');
            fs.writeFileSync(filepath, '{ name: "app" }');

            const error = catchError(() => readSourceConfigFile(filepath));

            assert(error, 'expected an error');
            assertEqual('OperationalError', error.name);
            assertMatches('Unable to parse config file', error.message);
        });
    });

    describe('readOptionalDotEnvFile', ({ it }) => {
        it('returns undefined when the file does not exist', () => {
            const dir = makeTempDirectory();
            const result = readOptionalDotEnvFile(path.join(dir, 'missing.env'));

            assertUndefined(result);
        });

        it('parses an existing dotenv file', () => {
            const dir = makeTempDirectory();
            const filepath = path.join(dir, 'present.env');
            fs.writeFileSync(filepath, 'FOO=bar\n');

            const result = readOptionalDotEnvFile(filepath);

            assertEqual('bar', result.FOO);
        });

        it('throws an OperationalError when the file cannot be parsed', () => {
            const dir = makeTempDirectory();
            const filepath = path.join(dir, 'unreadable.env');

            // A directory at the expected file path fails the read with EISDIR,
            // exercising the not-ENOENT branch without relying on chmod semantics
            // that differ across platforms.
            fs.mkdirSync(filepath);

            const caught = catchError(() => readOptionalDotEnvFile(filepath));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('Unable to read dotenv file', caught.message);
        });
    });

    describe('readEnvironment', ({ it }) => {
        it('merges the plain file, its .secrets sibling, and the process environment', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            fs.writeFileSync(dotenvFile, 'PLAIN_KEY=plain-value\n');
            fs.writeFileSync(`${ dotenvFile }.secrets`, 'SECRET_KEY=secret-value\n');

            const env = readEnvironment({
                dotenvFile,
                processEnv: { PROCESS_KEY: 'process-value' },
            });

            assertEqual('plain-value', env.PLAIN_KEY);
            assertEqual('secret-value', env.SECRET_KEY);
            assertEqual('process-value', env.PROCESS_KEY);
        });

        it('tolerates a missing dotenv pair, falling back to the process environment alone', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            const env = readEnvironment({
                dotenvFile,
                processEnv: { PROCESS_KEY: 'process-value' },
            });

            assertEqual('PROCESS_KEY', Object.keys(env).join(','));
            assertEqual('process-value', env.PROCESS_KEY);
        });

        it('reads the real process environment when processEnv is not given', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            const env = readEnvironment({ dotenvFile });

            assertEqual(Object.keys(process.env).sort().join(','), Object.keys(env).sort().join(','));
        });

        it('reads both files through an injected readFile', () => {
            const dotenvFile = '/app/.env.test';
            const files = new Map([
                [ dotenvFile, 'PLAIN_KEY=plain-value\n' ],
                [ `${ dotenvFile }.secrets`, 'SECRET_KEY=secret-value\n' ],
            ]);

            const env = readEnvironment({
                dotenvFile,
                processEnv: {},
                readFile: (filepath) => files.get(filepath),
            });

            assertEqual('plain-value', env.PLAIN_KEY);
            assertEqual('secret-value', env.SECRET_KEY);
        });

        it('throws an OperationalError when a key is defined by more than one source', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            fs.writeFileSync(dotenvFile, 'DUPLICATE_KEY=plain\n');
            fs.writeFileSync(`${ dotenvFile }.secrets`, 'DUPLICATE_KEY=secret\n');

            const caught = catchError(() => readEnvironment({ dotenvFile, processEnv: {} }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('DUPLICATE_KEY', caught.message);
        });

        it('throws an OperationalError when a file and the process environment define one key', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            fs.writeFileSync(dotenvFile, 'DUPLICATE_KEY=plain\n');

            const caught = catchError(() => {
                readEnvironment({ dotenvFile, processEnv: { DUPLICATE_KEY: 'process' } });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('DUPLICATE_KEY', caught.message);
            assertMatches('process.env', caught.message);
        });
    });

    describe('createResolveFilepath', ({ it }) => {
        it('joins a POSIX-style relative path onto baseDirectory', () => {
            const resolveFilepath = createResolveFilepath({ baseDirectory: '/app/src' });

            assertEqual(path.join('/app/src', 'a', 'b.sqlite'), resolveFilepath('a/b.sqlite'));
        });

        it('throws an AssertionError when relativeFilepath is empty', () => {
            const resolveFilepath = createResolveFilepath({ baseDirectory: '/app/src' });

            const caught = catchError(() => resolveFilepath(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('resolves against baseDirectory when dataDirectory is absent', () => {
            const resolveFilepath = createResolveFilepath({ baseDirectory: '/app/src' });

            assertEqual(path.join('/app/src', 'x'), resolveFilepath('./x'));
        });

        it('resolves against dataDirectory when it is a non-empty string', () => {
            const resolveFilepath = createResolveFilepath({
                baseDirectory: '/app/src',
                dataDirectory: '/abs/dir',
            });

            assertEqual(path.join('/abs/dir', 'x'), resolveFilepath('./x'));
        });

        it('falls back to baseDirectory when dataDirectory is an empty string', () => {
            const resolveFilepath = createResolveFilepath({
                baseDirectory: '/app/src',
                dataDirectory: '',
            });

            assertEqual(path.join('/app/src', 'x'), resolveFilepath('./x'));
        });
    });
});
