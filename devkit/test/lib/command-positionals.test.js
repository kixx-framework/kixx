import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import { findPositionalsProblem, splitPositionals } from '../../lib/command-positionals.js';


const NAME = { name: 'name', description: 'Instance name' };

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('command-positionals', ({ describe }) => {

    describe('splitPositionals() with none declared', ({ it }) => {
        it('returns empty values and no directory', () => {
            const result = splitPositionals([], []);
            assertEqual(0, Object.keys(result.values).length);
            assertEqual(undefined, result.directory);
        });

        it('treats an undefined declaration as none', () => {
            assertEqual('../app', splitPositionals(undefined, [ '../app' ]).directory);
        });

        it('returns the directory', () => {
            assertEqual('../app', splitPositionals([], [ '../app' ]).directory);
        });

        it('rejects a second positional with the existing message', () => {
            const error = catchError(() => splitPositionals([], [ '.', 'extra' ]));

            assert(error, 'expected an error');
            assertEqual('UsageError', error.name);
            assertEqual(
                'Unexpected argument "extra". Only one positional argument, the directory, is accepted.',
                error.message,
            );
        });
    });

    describe('splitPositionals() with one declared', ({ it }) => {
        it('returns the value without a directory', () => {
            const result = splitPositionals([ NAME ], [ 'alpha' ]);
            assertEqual('alpha', result.values.name);
            assertEqual(undefined, result.directory);
        });

        it('returns the value and the directory', () => {
            const result = splitPositionals([ NAME ], [ 'alpha', '../app' ]);
            assertEqual('alpha', result.values.name);
            assertEqual('../app', result.directory);
        });

        it('rejects a missing value, naming it and the help command', () => {
            const error = catchError(() => splitPositionals([ NAME ], [], { commandLabel: 'local create' }));

            assert(error, 'expected an error');
            assertEqual('UsageError', error.name);
            assertEqual(
                'Missing required argument <name>. Run "kixx local create --help" for usage.',
                error.message,
            );
        });

        it('rejects a third positional', () => {
            const error = catchError(() => splitPositionals([ NAME ], [ 'alpha', '.', 'extra' ]));

            assert(error, 'expected an error');
            assertEqual('UsageError', error.name);
            assertMatches('Unexpected argument "extra"', error.message);
            assertMatches('<name>', error.message);
        });
    });

    describe('findPositionalsProblem()', ({ it }) => {
        it('accepts undefined, an empty array, and well-formed entries', () => {
            assertEqual(null, findPositionalsProblem(undefined));
            assertEqual(null, findPositionalsProblem([]));
            assertEqual(null, findPositionalsProblem([ NAME, { name: 'release-id', description: 'Release' } ]));
        });

        it('rejects malformed declarations', () => {
            const malformed = [
                'name',
                [ 'name' ],
                [ { name: 'Name', description: 'x' } ],
                [ { name: '1st', description: 'x' } ],
                [ { name: '', description: 'x' } ],
                [ { name: 'directory', description: 'x' } ],
                [ { name: 'name' } ],
                [ { name: 'name', description: '  ' } ],
                [ NAME, NAME ],
            ];

            for (const declared of malformed) {
                assert(
                    typeof findPositionalsProblem(declared) === 'string',
                    `expected a problem for ${ JSON.stringify(declared) }`,
                );
            }
        });
    });
});
