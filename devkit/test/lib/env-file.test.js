import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { readEnvFile } from '../../lib/env-file.js';
import createMemoryFileSystem from '../helpers/memory-file-system.js';

const FILEPATH = '/app/.env.production';


describe('env-file', ({ it }) => {
    it('reads .env.<environment> into names and string values', async () => {
        const values = await read('NAME=value\nEMPTY=\nTOKEN=abc#def');

        assertEqual('value', values.NAME);
        assertEqual('', values.EMPTY);
        assertEqual('abc#def', values.TOKEN);
    });

    it('throws a UsageError naming the expected path when the file is missing', async () => {
        const caught = await catchAsyncError(() => readEnvFile({
            projectDirectory: '/app',
            environment: 'production',
            fileSystem: createMemoryFileSystem({}),
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes(FILEPATH), 'expected the path');
    });

    it('drops an authored ENVIRONMENT', async () => {
        const values = await read('ENVIRONMENT=development\nTRUST_PROXY=false');

        assertEqual('TRUST_PROXY', Object.keys(values).join(','));
    });

    it('rejects BUILD_ID naming the line and file', async () => {
        const caught = await catchAsyncError(() => read('NAME=value\nBUILD_ID=nope'));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('BUILD_ID'), 'expected the name');
        assert(caught.message.includes('line 2'), 'expected the line');
        assert(caught.message.includes(FILEPATH), 'expected the file');
    });

    it('skips blank lines and full-line comments', async () => {
        const values = await read([ '', '# a comment', '   # indented', 'NAME=value', '' ].join('\n'));

        assertEqual('NAME', Object.keys(values).join(','));
    });

    it('strips one layer of matching quotes', async () => {
        const values = await read([ 'DOUBLE="say \'hi\'"', 'SINGLE=\'say "hi"\'' ].join('\n'));

        assertEqual('say \'hi\'', values.DOUBLE);
        assertEqual('say "hi"', values.SINGLE);
    });

    it('rejects a malformed line naming its line number', async () => {
        const caught = await catchAsyncError(() => read('NAME=value\nnot-a-valid-line'));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('line 2'), 'expected the line');
    });

    it('rejects an invalid name', async () => {
        const caught = await catchAsyncError(() => read('1NAME=value'));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('1NAME'), 'expected the name');
    });

    it('rejects a duplicate name naming both lines', async () => {
        const caught = await catchAsyncError(() => read('NAME=one\nNAME=two'));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('lines 1 and 2'), 'expected both lines');
    });

    it('does not let a __proto__ key pollute the returned object', async () => {
        const values = await read('__proto__=value');

        assertEqual('value', values.__proto__);
        assertEqual(null, Object.getPrototypeOf(values));
    });

    it('parses \\r\\n line endings identically to \\n', async () => {
        const values = await read('ONE=1\r\nTWO=2');

        assertEqual('1', values.ONE);
        assertEqual('2', values.TWO);
    });
});

function read(text) {
    return readEnvFile({
        projectDirectory: '/app',
        environment: 'production',
        fileSystem: createMemoryFileSystem({ [FILEPATH]: text }),
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
