import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    isFunction,
    isNonEmptyString,
    isPlainObject,
} from '../../lib/vendor/kixx-assert/mod.js';
import commandModules from '../../commands/index.js';
import { findPositionalsProblem } from '../../lib/command-positionals.js';


const COMMANDS_DIRECTORY = fileURLToPath(new URL('../../commands/', import.meta.url));

const OPTION_TYPES = [ 'string', 'boolean' ];

// kixx.js handles these before a sub-command runs, so a sub-command which
// declared them would never see them.
const RESERVED_FLAG_NAMES = [ 'help', 'version' ];
const RESERVED_SHORT_FLAGS = [ 'h', 'v' ];

const REQUIRED_SETTINGS_KEYS = [
    'requiredConfig',
    'requiredSecrets',
];


describe('commands/index.js registry', ({ it }) => {

    it('registers every command directory', async () => {
        const entries = await fsp.readdir(COMMANDS_DIRECTORY, { withFileTypes: true });

        const directories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();

        assertEqual(directories.join(','), Object.keys(commandModules).sort().join(','));
    });

    it('registers every sub-command module under its file basename', async () => {
        for (const [ commandName, mod ] of Object.entries(commandModules)) {
            const directory = path.join(COMMANDS_DIRECTORY, commandName);
            // eslint-disable-next-line no-await-in-loop
            const files = await fsp.readdir(directory);

            const basenames = files
                .filter((file) => file.endsWith('.js') && file !== 'index.js')
                .map((file) => path.basename(file, '.js'))
                .sort();

            assertEqual(
                basenames.join(','),
                Object.keys(mod.subcommands).sort().join(','),
                `sub-commands of "${ commandName }"`,
            );

            for (const basename of basenames) {
                const href = pathToFileURL(path.join(directory, `${ basename }.js`)).href;
                // eslint-disable-next-line no-await-in-loop
                const subCommandModule = await import(href);

                assertEqual(
                    subCommandModule.default,
                    mod.subcommands[basename],
                    `"${ commandName } ${ basename }" maps to its module's default export`,
                );
            }
        }
    });

    it('gives every command a description', () => {
        for (const [ commandName, mod ] of Object.entries(commandModules)) {
            assert(isNonEmptyString(mod.description?.trim()), `description of "${ commandName }"`);
            assert(isPlainObject(mod.subcommands), `subcommands of "${ commandName }"`);
        }
    });

    it('declares the documented static contract on every sub-command', () => {
        for (const [ commandName, mod ] of Object.entries(commandModules)) {
            for (const [ subCommandName, Command ] of Object.entries(mod.subcommands)) {
                const label = `"${ commandName } ${ subCommandName }"`;

                assert(isFunction(Command), `${ label } is a constructor`);
                assert(isNonEmptyString(Command.description?.trim()), `${ label } description`);

                assertOptions(label, Command.options);
                // Required leading positionals only; the runner owns the
                // trailing app directory.
                const problem = findPositionalsProblem(Command.positionals);
                assertEqual(null, problem, `${ label } positionals`);

                for (const key of REQUIRED_SETTINGS_KEYS) {
                    assertKeyPaths(`${ label } ${ key }`, Command[key]);
                }

                // The runner no longer checks this contract, so a declaration
                // would silently do nothing.
                assertEqual(undefined, Command.requiredCloudflareConfig, `${ label } requiredCloudflareConfig`);
            }
        }
    });
});


function assertOptions(label, options) {
    if (options === undefined) {
        return;
    }

    assert(isPlainObject(options), `${ label } options is an object`);

    for (const [ flagName, option ] of Object.entries(options)) {
        assert(
            OPTION_TYPES.includes(option.type),
            `${ label } --${ flagName } type is one of ${ OPTION_TYPES.join(', ') }`,
        );
        assert(!RESERVED_FLAG_NAMES.includes(flagName), `${ label } --${ flagName } is reserved`);
        assert(!RESERVED_SHORT_FLAGS.includes(option.short), `${ label } -${ option.short } is reserved`);
    }
}

function assertKeyPaths(label, keyPaths) {
    if (keyPaths === undefined) {
        return;
    }

    assert(Array.isArray(keyPaths), `${ label } is an array`);

    for (const keyPath of keyPaths) {
        assert(isNonEmptyString(keyPath), `${ label } entries are key path strings`);
    }
}
