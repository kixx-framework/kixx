import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import {
    DIRECTORY_POSITIONAL,
    acceptsDirectory,
    findPositionalsProblem,
    requiresProject,
    splitPositionals,
} from '../../lib/command-positionals.js';


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
                'Missing required argument <name>. Run "kixx-dev local create --help" for usage.',
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

    describe('splitPositionals() for a command that takes no directory', ({ it }) => {
        const options = { acceptsDirectory: false };

        it('returns the declared values and no directory', () => {
            const result = splitPositionals([ NAME ], [ 'alpha' ], options);

            assertEqual('alpha', result.values.name);
            assertEqual(undefined, result.directory);
        });

        it('rejects a positional when none is declared', () => {
            const error = catchError(() => splitPositionals([], [ '../app' ], options));

            assert(error, 'expected an error');
            assertEqual('UsageError', error.name);
            assertEqual('Unexpected argument "../app". This command takes no positional arguments.', error.message);
        });

        it('rejects a positional after the declared ones', () => {
            const error = catchError(() => splitPositionals([ NAME ], [ 'alpha', '../app' ], options));

            assert(error, 'expected an error');
            assertEqual('UsageError', error.name);
            assertEqual('Unexpected argument "../app". Expected only <name>.', error.message);
        });

        it('still rejects a missing value', () => {
            const error = catchError(() => splitPositionals([ NAME ], [], options));

            assertMatches('Missing required argument <name>', error.message);
        });
    });

    describe('requiresProject()', ({ it }) => {
        it('is true when the command declares requiresProject or requiresTooling', () => {
            assertEqual(false, requiresProject(class {}));
            assertEqual(true, requiresProject(class {
                static requiresProject = true;
            }));
            assertEqual(true, requiresProject(class {
                static requiresTooling = true;
            }));
            assertEqual(false, requiresProject(class {
                static requiresProject = false;
            }));
        });
    });

    describe('acceptsDirectory()', ({ it }) => {
        it('is true only for a command that runs inside a project', () => {
            assertEqual(false, acceptsDirectory(class {}));
            assertEqual(true, acceptsDirectory(class {
                static requiresProject = true;
            }));
            assertEqual(true, acceptsDirectory(class {
                static requiresTooling = true;
            }));
        });

        it('is false for a placeholder, which takes no arguments at all', () => {
            assertEqual(false, acceptsDirectory(class {
                static available = false;
            }));
            assertEqual(false, acceptsDirectory(class {
                static available = false;

                static requiresProject = true;
            }));
        });

        it('names the positional a command may not declare', () => {
            assertEqual('directory', DIRECTORY_POSITIONAL.name);
            assert(typeof findPositionalsProblem([ DIRECTORY_POSITIONAL ]) === 'string', 'reserved');
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
