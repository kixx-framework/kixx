import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import createPlaceholderCommand, { CommandNotAvailableError } from '../../lib/placeholder-command.js';
import UsageError from '../../lib/usage-error.js';
import { findCommandProblems } from '../../lib/command-registry.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('placeholder-command', ({ describe }) => {

    describe('createPlaceholderCommand()', ({ it }) => {
        it('returns a class with the description and available false', () => {
            const Placeholder = createPlaceholderCommand('Deploy the app');

            assertEqual('Deploy the app', Placeholder.description);
            assertEqual(false, Placeholder.available);
            assertEqual(undefined, Placeholder.options);
            assertEqual(undefined, Placeholder.positionals);
        });

        it('returns a class that meets the command contract', () => {
            assertEqual(0, findCommandProblems(createPlaceholderCommand('Deploy the app')).length);
        });

        it('returns a new class each time', () => {
            assert(createPlaceholderCommand('One') !== createPlaceholderCommand('Two'), 'distinct classes');
        });

        it('requires a description', () => {
            const error = catchError(() => createPlaceholderCommand(''));

            assertEqual('AssertionError', error.name);
        });

        it('throws CommandNotAvailableError from run(), naming the command', () => {
            const Placeholder = createPlaceholderCommand('Deploy the app');
            const error = catchError(() => new Placeholder({ commandName: 'deploy' }).run());

            assert(error instanceof CommandNotAvailableError, 'the error class');
            assertEqual('The "deploy" command is not available in this version of kixx-dev.', error.message);
        });

        it('throws without a command name too', () => {
            const Placeholder = createPlaceholderCommand('Deploy the app');
            const error = catchError(() => new Placeholder().run());

            assertEqual('This command is not available in this version of kixx-dev.', error.message);
        });
    });

    describe('CommandNotAvailableError', ({ it }) => {
        it('is a UsageError whose code is the exit-code row\'s name', () => {
            const error = new CommandNotAvailableError('Not yet.');

            assert(error instanceof UsageError, 'a UsageError');
            assertEqual('CommandNotAvailableError', error.name);
            assertEqual('CommandNotAvailable', error.code);
        });
    });

    describe('UsageError', ({ it }) => {
        it('uses the class name as its code unless the class declares one', () => {
            class PlainError extends UsageError {}

            assertEqual('UsageError', new UsageError('x').code);
            assertEqual('PlainError', new PlainError('x').code);
            assertEqual('PlainError', new PlainError('x').name);
        });
    });
});
