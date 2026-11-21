import { parseArgs } from 'node:util';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import AdminRunMigrationCommand from '../../../commands/admin/run-migration.js';
import {
    MigrationAlreadyAppliedError,
    MigrationCursorConflictError,
    MigrationConcurrencyError,
} from '../../../lib/admin/admin-api-error.js';
import captureOutput from '../../helpers/capture-output.js';

const APPLIED = { done: true, status: 'applied', stats: {}, cursor: null, dryRun: false };


describe('admin run-migration', ({ it }) => {

    it('sends exactly one real batch and prints done, status, stats, and cursor', async () => {
        const output = captureOutput();
        const calls = [];
        const command = makeCommand({
            output,
            client: {
                runMigration: async (id, options) => {
                    calls.push({ id, options });
                    return { done: true, status: 'applied', stats: { scanned: 1 }, cursor: null, dryRun: false };
                },
            },
        });

        const code = await command.run({ environment: 'production', migration: 'example-noop' });
        const text = output.chunks.at(-1);

        assertEqual(0, code);
        assertEqual(1, calls.length);
        assertEqual('example-noop', calls[0].id);
        assertEqual(false, calls[0].options.force);
        assertMatches('done: true', text);
        assertMatches('status: applied', text);
        assertMatches('stats: {"scanned":1}', text);
    });

    it('sends force true on --force without any prompt beyond credentials', async () => {
        const prompts = [];
        const received = {};
        const command = makeCommand({
            onPrompt: (options) => prompts.push(options.envVar),
            client: {
                runMigration: async (_id, options) => {
                    Object.assign(received, options);
                    return APPLIED;
                },
            },
        });

        const code = await command.run({ environment: 'production', force: true, migration: 'example-noop' });

        assertEqual(0, code);
        assertEqual(true, received.force);
        assertEqual(false, received.dryRun);
        assertEqual('KIXX_ADMIN_EMAIL,KIXX_ADMIN_PASSWORD', prompts.join(','));
    });

    it('declares no --yes option, so parseArgs rejects it as unknown', () => {
        assertEqual(false, Object.hasOwn(AdminRunMigrationCommand.options, 'yes'));

        const caught = catchError(() => parseArgs({
            args: [ '-m', 'example-noop', '--force', '--yes' ],
            allowPositionals: true,
            allowNegative: true,
            options: AdminRunMigrationCommand.options,
        }));

        assert(caught, 'expected parseArgs to reject --yes');
        assertMatches('--yes', caught.message);
    });

    it('prints the resolved environment and origin before a real run', async () => {
        const output = captureOutput();
        const command = makeCommand({
            output,
            client: { runMigration: async () => APPLIED },
        });

        await command.run({ environment: 'production', migration: 'example-noop' });

        assertMatches('Running on production (https://admin.example.test)', output.chunks[0]);
    });

    it('does not print the target echo for a dry run and sends dryRun true', async () => {
        const output = captureOutput();
        const received = {};
        const command = makeCommand({
            output,
            client: {
                runMigration: async (_id, options) => {
                    Object.assign(received, options);
                    return { done: false, status: 'pending', stats: {}, cursor: 'next-cursor', dryRun: true };
                },
            },
        });

        await command.run({ environment: 'production', 'dry-run': true, cursor: 'c-1', migration: 'example-noop' });

        assertEqual(true, received.dryRun);
        assertEqual('c-1', received.cursor);
        assertEqual(1, output.chunks.length);
    });

    it('fails with a UsageError when --dry-run and --force are both passed', async () => {
        const command = makeCommand({ client: {} });

        const caught = await catchAsyncError(() => {
            return command.run({ environment: 'production', 'dry-run': true, force: true, migration: 'example-noop' });
        });

        assertEqual('UsageError', caught?.name);
    });

    it('fails with a UsageError when --cursor is passed without --dry-run', async () => {
        const command = makeCommand({ client: {} });

        const caught = await catchAsyncError(() => {
            return command.run({ environment: 'production', cursor: 'abc', migration: 'example-noop' });
        });

        assertEqual('UsageError', caught?.name);
    });

    it('states the next invocation to run when the batch is not done', async () => {
        const dryOutput = captureOutput();
        const dryCommand = makeCommand({
            output: dryOutput,
            client: {
                runMigration: async () => ({
                    done: false, status: 'pending', stats: {}, cursor: 'cursor-2', dryRun: true,
                }),
            },
        });

        await dryCommand.run({ environment: 'production', 'dry-run': true, migration: 'example-noop' });

        assertMatches(
            'Next: kixx admin run-migration -e production -m example-noop --dry-run --cursor cursor-2',
            dryOutput.chunks.at(-1),
        );

        const realOutput = captureOutput();
        const realCommand = makeCommand({
            output: realOutput,
            client: {
                runMigration: async () => ({
                    done: false, status: 'running', stats: {}, cursor: 'opaque', dryRun: false,
                }),
            },
        });

        await realCommand.run({ environment: 'production', migration: 'example-noop' });

        assertMatches('Next: kixx admin run-migration -e production -m example-noop\n', realOutput.chunks.at(-1));
    });

    it('renders distinct guidance for each migration conflict error', async () => {
        const cases = [
            [ MigrationAlreadyAppliedError, 'Pass --force to rerun' ],
            [ MigrationCursorConflictError, 'Restart it with --force' ],
            [ MigrationConcurrencyError, 'retry without --force' ],
        ];

        for (const [ ErrorClass, expectedPhrase ] of cases) {
            const command = makeCommand({
                client: {
                    runMigration: async () => {
                        throw new ErrorClass('failed', {
                            status: 409, method: 'POST', url: 'https://x', attempts: 1,
                        });
                    },
                },
            });

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => command.run({ environment: 'production', migration: 'example-noop' }));

            assert(caught, `expected an error to be thrown for ${ ErrorClass.name }`);
            assertEqual('UsageError', caught.name);
            assertMatches(expectedPhrase, caught.message);
        }
    });

    it('fails with a UsageError when --migration is missing', async () => {
        const command = makeCommand({ client: {} });

        const caught = await catchAsyncError(() => command.run({ environment: 'production' }));

        assertEqual('UsageError', caught?.name);
        assertMatches('--migration', caught.message);
    });
});

function makeCommand(args) {
    const { client, onPrompt = () => {}, output = captureOutput() } = args;

    return new AdminRunMigrationCommand({
        output,
        config: { app: { environments: { production: { origin: 'https://admin.example.test' } } } },
        createClient: () => client,
        promptForValue: async (options) => {
            onPrompt(options);
            return 'stub-value';
        },
    });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
