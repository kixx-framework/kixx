import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import {
    resolveDotenvFilepath,
    readEnvironment,
    readOptionalDotEnvFile,
    createResolveFilepath,
} from '../../src/node-environment.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeTempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'node-environment-test-'));
}


describe('node-environment', ({ describe }) => {

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
        it('merges the plain file, its .secrets sibling, and process.env', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            fs.writeFileSync(dotenvFile, 'PLAIN_KEY=plain-value\n');
            fs.writeFileSync(`${ dotenvFile }.secrets`, 'SECRET_KEY=secret-value\n');

            const env = readEnvironment({ dotenvFile });

            assertEqual('plain-value', env.PLAIN_KEY);
            assertEqual('secret-value', env.SECRET_KEY);
        });

        it('tolerates a missing dotenv pair, falling back to process.env alone', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            const env = readEnvironment({ dotenvFile });

            assertUndefined(env.PLAIN_KEY);
        });

        it('throws an OperationalError when a key is defined by more than one source', () => {
            const dir = makeTempDirectory();
            const dotenvFile = path.join(dir, '.env.test');

            fs.writeFileSync(dotenvFile, 'DUPLICATE_KEY=plain\n');
            fs.writeFileSync(`${ dotenvFile }.secrets`, 'DUPLICATE_KEY=secret\n');

            const caught = catchError(() => readEnvironment({ dotenvFile }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('DUPLICATE_KEY', caught.message);
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
