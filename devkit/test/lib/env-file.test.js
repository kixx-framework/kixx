import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { formatEnvFile, parseEnvFile, readEnvFile } from '../../lib/env-file.js';
import createMemoryFileSystem from '../helpers/memory-file-system.js';

const FILEPATH = '/app/.env.production';


describe('env-file', ({ it, describe }) => {
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

    describe('parseEnvFile() reservedNames', ({ it }) => {
        it('accepts BUILD_ID when no names are reserved', () => {
            const values = parseEnvFile('BUILD_ID=local-a-1\n', '/x/.env', { reservedNames: [] });
            assertEqual('local-a-1', values.BUILD_ID);
        });

        it('rejects a custom reserved name', () => {
            let error = null;

            try {
                parseEnvFile('PORT=1\n', '/x/.env', { reservedNames: [ 'PORT' ] });
            } catch (cause) {
                error = cause;
            }

            assertEqual('UsageError', error?.name);
            assert(error.message.includes('"PORT" on line 1'), error.message);
        });
    });

    describe('formatEnvFile()', ({ it }) => {
        it('round-trips bare and single-quoted values through parseEnvFile', () => {
            const values = {
                BARE: 'local-a_1.2/x:y@z+w,v',
                EMPTY: '',
                SPACED: '/tmp/with space/instance',
                HASH: 'a # b',
                DOUBLE: '"quoted"',
            };

            const text = formatEnvFile(values);

            assert(text.endsWith('\n'), 'ends with a newline');
            assert(text.includes('BARE=local-a_1.2/x:y@z+w,v\n'), 'bare value unquoted');
            assert(text.includes('SPACED=\'/tmp/with space/instance\'\n'), 'spaced value single-quoted');

            const parsed = parseEnvFile(text, '/x/.env');

            for (const [ name, value ] of Object.entries(values)) {
                assertEqual(value, parsed[name], name);
            }
        });

        it('rejects single quotes, line breaks, and invalid names', () => {
            for (const values of [ { A: 'it\'s' }, { A: 'a\nb' }, { A: 'a\rb' }, { '1A': 'x' } ]) {
                let error = null;

                try {
                    formatEnvFile(values);
                } catch (cause) {
                    error = cause;
                }

                assertEqual('UsageError', error?.name, JSON.stringify(values));
            }
        });
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
