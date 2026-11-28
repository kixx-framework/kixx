import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import {
    EXIT_CODES,
    EXIT_CODE_BY_ERROR_CODE,
    describeError,
    getExitCodeForError,
} from '../../lib/exit-codes.js';
import UsageError from '../../lib/usage-error.js';
import { CommandNotAvailableError } from '../../lib/placeholder-command.js';


const COMMANDS_README = new URL('../../commands/README.md', import.meta.url);

// A row of the README's exit-code table: | 2 | `UsageError` | Meaning. |
const TABLE_ROW_PATTERN = /^\| (\d+) \| `([A-Za-z]+)` \| (.+) \|$/gm;


function makeNamedError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}


describe('exit-codes', ({ describe }) => {

    describe('EXIT_CODES', ({ it }) => {
        it('holds the documented rows in order', () => {
            assertEqual(
                '0 Success,1 UnexpectedError,2 UsageError,3 ProjectNotFound,3 UnsupportedProjectVersion,4 CommandNotAvailable',
                EXIT_CODES.map(({ code, name }) => `${ code } ${ name }`).join(','),
            );
        });

        it('keeps every code below 126, where shells start', () => {
            for (const { code, name } of EXIT_CODES) {
                assert(Number.isInteger(code) && code >= 0 && code < 126, `code of ${ name }`);
            }
        });

        it('never repeats a name', () => {
            const names = EXIT_CODES.map(({ name }) => name);

            assertEqual(names.length, new Set(names).size);
        });

        it('gives every row a meaning', () => {
            for (const { name, meaning } of EXIT_CODES) {
                assert(meaning.trim().length > 0, `meaning of ${ name }`);
            }
        });

        it('is frozen', () => {
            assert(Object.isFrozen(EXIT_CODES), 'the table');
            assert(EXIT_CODES.every((row) => Object.isFrozen(row)), 'each row');
            assert(Object.isFrozen(EXIT_CODE_BY_ERROR_CODE), 'the map');
        });

        it('equals the table in commands/README.md', async () => {
            const text = await fsp.readFile(COMMANDS_README, 'utf8');

            const documented = [ ...text.matchAll(TABLE_ROW_PATTERN) ]
                .map(([ , code, name, meaning ]) => `${ code } | ${ name } | ${ meaning }`);

            const actual = EXIT_CODES.map(({ code, name, meaning }) => `${ code } | ${ name } | ${ meaning }`);

            assertEqual(actual.join('\n'), documented.join('\n'));
        });
    });

    describe('EXIT_CODE_BY_ERROR_CODE', ({ it }) => {
        it('maps every row an error can carry', () => {
            assertEqual(
                'UnexpectedError=1,UsageError=2,ProjectNotFound=3,UnsupportedProjectVersion=3,CommandNotAvailable=4',
                Object.entries(EXIT_CODE_BY_ERROR_CODE).map(([ name, code ]) => `${ name }=${ code }`).join(','),
            );
        });
    });

    describe('describeError()', ({ it }) => {
        it('uses the row of an error whose code has one', () => {
            const report = describeError(new CommandNotAvailableError('Not yet.'));

            assertEqual('CommandNotAvailable', report.code);
            assertEqual(4, report.exitCode);
            assertEqual('Not yet.', report.message);
            assertEqual('code,exitCode,message', Object.keys(report).join(','));
        });

        it('uses the row for a code on an error of any class', () => {
            // T3's project errors are matched by code, the same way.
            const error = Object.assign(new Error('No project here.'), { code: 'ProjectNotFound' });

            assertEqual(3, describeError(error).exitCode);
            assertEqual('ProjectNotFound', describeError(error).code);
        });

        it('exits 2 for a UsageError', () => {
            const report = describeError(new UsageError('Fix it.'));

            assertEqual('UsageError', report.code);
            assertEqual(2, report.exitCode);
        });

        it('exits 2 for a UsageError subclass and keeps its code', () => {
            class OutOfPaintError extends UsageError {}

            const report = describeError(new OutOfPaintError('Buy paint.'));

            assertEqual('OutOfPaintError', report.code);
            assertEqual(2, report.exitCode);
        });

        it('exits 2 for a project ValidationError and carries its problems', () => {
            const error = makeNamedError('ValidationError', 'Invalid manifest.');
            error.errors = [
                { message: 'name is required', source: 'plugin.json', extra: true },
                { message: 'version is required' },
            ];

            const report = describeError(error);

            assertEqual('ValidationError', report.code);
            assertEqual(2, report.exitCode);
            assertEqual('Invalid manifest.', report.message);
            assertEqual(2, report.problems.length);
            assertEqual('message,source', Object.keys(report.problems[0]).join(','));
            assertEqual('plugin.json', report.problems[0].source);
            assertEqual(null, report.problems[1].source);
        });

        it('leaves problems out when a ValidationError has no errors array', () => {
            const report = describeError(makeNamedError('ValidationError', 'Invalid.'));

            assertEqual(2, report.exitCode);
            assert(!Object.hasOwn(report, 'problems'), 'no problems key');
        });

        it('exits 2 for a project OperationalError', () => {
            const report = describeError(makeNamedError('OperationalError', 'Missing file.'));

            assertEqual('OperationalError', report.code);
            assertEqual(2, report.exitCode);
            assert(!Object.hasOwn(report, 'problems'), 'no problems key');
        });

        it('exits 1 for everything else', () => {
            const errors = [
                new Error('Broken.'),
                new TypeError('Broken.'),
                makeNamedError('AssertionError', 'Broken.'),
                Object.assign(new Error('Broken.'), { code: 'ENOENT' }),
                Object.assign(new Error('Broken.'), { code: 'Success' }),
            ];

            for (const error of errors) {
                const report = describeError(error);

                assertEqual('UnexpectedError', report.code);
                assertEqual(1, report.exitCode);
                assertEqual('Broken.', report.message);
            }
        });

        it('describes a thrown value that is not an error', () => {
            assertEqual('a string', describeError('a string').message);
            assertEqual('undefined', describeError(undefined).message);
            assertEqual('null', describeError(null).message);
            assertEqual(1, describeError(null).exitCode);
        });
    });

    describe('getExitCodeForError()', ({ it }) => {
        it('returns the exit code alone', () => {
            assertEqual(2, getExitCodeForError(new UsageError('Fix it.')));
            assertEqual(4, getExitCodeForError(new CommandNotAvailableError('Not yet.')));
            assertEqual(1, getExitCodeForError(new Error('Broken.')));
        });
    });
});
