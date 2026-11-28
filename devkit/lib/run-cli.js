/**
 * The command runner: one path from a command line to an exit code, for every
 * command. It owns dispatch, help, argument parsing, settings, the `--json`
 * envelope, and the mapping from a thrown error to an exit code. See
 * `commands/README.md` for the contract.
 * @module run-cli
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { inspect, parseArgs } from 'node:util';
import CommandRegistry from './command-registry.js';
import UsageError from './usage-error.js';
import { splitPositionals } from './command-positionals.js';
import { findMissingKeys, loadConfiguration } from './config-loader.js';
import { EXIT_CODES, EXIT_CODE_BY_ERROR_CODE, describeError } from './exit-codes.js';
import { describeCommand, renderCommandHelp, renderCommandList } from './render-help.js';
import { wrapText } from './text-wrap.js';
import { isPlainObject, isUndefined } from './vendor/kixx-assert/mod.js';
import manifest from '../deno.json' with { type: 'json' };


const PROGRAM_NAME = 'kixx-dev';

// The flags that work with or without a command, anywhere on the command
// line. No command may declare one (a registry test enforces it).
const GLOBAL_FLAGS = Object.freeze({
    '--help': 'help',
    '-h': 'help',
    '--version': 'version',
    '-v': 'version',
    '--json': 'json',
});


// A command line that names no runnable command. Text mode prints the list of
// what exists under the message.
class UnknownCommandError extends UsageError {
    static code = 'UsageError';

    constructor(message, helpText) {
        super(message);
        this.helpText = helpText;
    }
}


/**
 * Runs one command line and resolves its exit code. It never rejects for a
 * failure of the command: every error becomes a row of the exit-code table.
 *
 * With `--json`, stdout receives exactly one line, the envelope, and the
 * command's human text goes to stderr. Without it, the command's text goes to
 * stdout and errors go to stderr.
 * @param {Object} args
 * @param {string[]} args.argv - Arguments after the program name
 * @param {string} args.cwd - Working directory; a relative directory argument resolves against it
 * @param {string} args.homeDirectory - Directory holding the home settings layer
 * @param {{write: function(string): *}} args.stdout
 * @param {{write: function(string): *}} args.stderr
 * @param {Object<string, Function>} args.commands - Command name to command class
 * @param {Object<string, string>} [args.groups] - Group name to description
 * @param {string} [args.version] - Defaults to the version in `deno.json`
 * @returns {Promise<number>} The process exit code
 */
export default async function runCli(args) {
    const {
        argv,
        cwd,
        homeDirectory,
        stdout,
        stderr,
        commands,
        groups,
        version = manifest.version,
    } = args ?? {};

    const { flags, rest } = extractGlobalFlags(argv);

    // Shared with the catch block, so an error names the command it came from.
    const state = { commandName: null };

    try {
        const data = await dispatch({
            flags,
            rest,
            state,
            cwd,
            homeDirectory,
            stdout,
            stderr,
            registry: new CommandRegistry(commands, groups),
            version,
        });

        if (flags.json) {
            writeEnvelope(stdout, { ok: true, command: state.commandName, data });
        }

        return 0;
    } catch (error) {
        const report = describeError(error);
        const isDefect = report.exitCode === EXIT_CODE_BY_ERROR_CODE.UnexpectedError;

        if (flags.json) {
            writeEnvelope(stdout, { ok: false, command: state.commandName, error: report });
        } else if (!isDefect) {
            stderr.write(`${ wrapText(report.message) }\n`);

            if (error instanceof UnknownCommandError) {
                stderr.write(`\n${ error.helpText }`);
            }
        }

        // A defect prints in full, cause chain included, in both modes: the
        // stack is what the developer needs.
        if (isDefect) {
            stderr.write(`Failed to run command:\n${ inspect(error) }\n`);
        }

        return report.exitCode;
    }
}

// Resolves the `data` of a successful run, and writes help and version text
// when the result is not going into an envelope.
async function dispatch(context) {
    const { flags, rest, state, registry, stdout, version } = context;

    // Checked before command resolution, so the flag wins wherever it is.
    if (flags.version) {
        if (!flags.json) {
            stdout.write(`${ version }\n`);
        }

        return { version };
    }

    const words = takeLeadingWords(rest);
    const resolved = registry.resolve(words);

    if (!resolved) {
        return resolveWithoutCommand({ flags, words, registry, stdout, version });
    }

    const { name, Command, wordCount } = resolved;

    state.commandName = name;

    if (flags.help) {
        const help = describeCommand(name, Command);

        if (!flags.json) {
            stdout.write(renderCommandHelp(help));
        }

        return help;
    }

    return await runCommand({
        ...context,
        name,
        Command,
        commandArgv: rest.slice(wordCount),
    });
}

// Top-level help, a group's help, or the usage error for a command line that
// names nothing registered.
function resolveWithoutCommand(args) {
    const { flags, words, registry, stdout, version } = args;
    const [ firstWord ] = words;
    const isGroup = !isUndefined(firstWord) && registry.hasGroup(firstWord);

    const topLevelCommands = registry.listCommands();
    const groupCommands = isGroup ? registry.listCommands(firstWord) : [];

    const helpText = isGroup
        ? renderCommandList({ group: firstWord, description: registry.describeGroup(firstWord), commands: groupCommands })
        : renderCommandList({ commands: topLevelCommands });

    if (flags.help && words.length === 0) {
        if (!flags.json) {
            stdout.write(helpText);
        }

        return { version, commands: topLevelCommands, exitCodes: EXIT_CODES };
    }

    if (flags.help && isGroup && words.length === 1) {
        if (!flags.json) {
            stdout.write(helpText);
        }

        return { group: firstWord, description: registry.describeGroup(firstWord), commands: groupCommands };
    }

    if (words.length === 0) {
        throw new UnknownCommandError(`A command name is required. Run "${ PROGRAM_NAME } --help" for the list.`, helpText);
    }

    if (isGroup && words.length === 1) {
        throw new UnknownCommandError(
            `"${ firstWord }" needs a command name after it. Run "${ PROGRAM_NAME } ${ firstWord } --help" for the list.`,
            helpText,
        );
    }

    if (isGroup) {
        throw new UnknownCommandError(
            `The command "${ firstWord } ${ words[1] }" does not exist. Run "${ PROGRAM_NAME } ${ firstWord } --help" for the list.`,
            helpText,
        );
    }

    throw new UnknownCommandError(
        `The command "${ firstWord }" does not exist. Run "${ PROGRAM_NAME } --help" for the list.`,
        helpText,
    );
}

async function runCommand(args) {
    const {
        flags,
        name,
        Command,
        commandArgv,
        cwd,
        homeDirectory,
        stdout,
        stderr,
    } = args;

    // Under --json, stdout holds only the envelope, so everything a command
    // writes for a person goes to stderr.
    const streams = {
        output: flags.json ? stderr : stdout,
        stdout: flags.json ? stderr : stdout,
        stderr,
    };

    // A placeholder's real options don't exist yet, so its arguments are not
    // parsed, and it needs no project or settings to say it is not available.
    if (Command.available === false) {
        const placeholder = new Command({ commandName: name, ...streams });
        return toData(name, await placeholder.run({}, {}));
    }

    let parsed;

    try {
        parsed = parseArgs({
            args: commandArgv,
            allowPositionals: true,
            allowNegative: true,
            options: Command.options ?? {},
        });
    } catch (cause) {
        // Unknown or malformed flags are operator mistakes, not crashes.
        throw new UsageError(`${ cause.message }\nRun "${ PROGRAM_NAME } ${ name } --help" for usage.`, { cause });
    }

    const { values: positionals, directory } = splitPositionals(
        Command.positionals,
        parsed.positionals,
        { commandLabel: name },
    );

    const startDirectory = await resolveStartDirectory(cwd, directory);

    // Loaded here rather than at startup so help output and unresolved command
    // names still work in a directory holding a malformed config file.
    const configuration = await loadConfiguration({ startDirectory, homeDirectory });

    assertRequiredSettings({
        commandLabel: name,
        settingsLabel: 'configuration settings',
        source: configuration.config,
        keyPaths: Command.requiredConfig,
        filepaths: configuration.configFilepaths,
    });

    assertRequiredSettings({
        commandLabel: name,
        settingsLabel: 'secrets',
        source: configuration.secrets,
        keyPaths: Command.requiredSecrets,
        filepaths: configuration.secretsFilepaths,
    });

    const command = new Command({
        projectDirectory: configuration.projectDirectory,
        config: configuration.config,
        secrets: configuration.secrets,
        ...streams,
    });

    return toData(name, await command.run(parsed.values, positionals));
}

// Turns what run() resolved into the envelope's `data`.
function toData(name, result) {
    if (isUndefined(result)) {
        return {};
    }

    // Transitional: the commands kept from v6 still return 0 for success.
    if (result === 0) {
        return {};
    }

    if (!isPlainObject(result)) {
        throw new TypeError(`The "${ name }" command resolved ${ inspect(result) }; a command resolves a plain object or undefined`);
    }

    return result;
}

// Removes the global flags from the command line, wherever they are, and
// reports which were set. Tokens after "--" are positionals and stay.
function extractGlobalFlags(argv) {
    const flags = { help: false, version: false, json: false };
    const rest = [];

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];

        if (token === '--') {
            rest.push(...argv.slice(i));
            break;
        }

        if (Object.hasOwn(GLOBAL_FLAGS, token)) {
            flags[GLOBAL_FLAGS[token]] = true;
        } else {
            rest.push(token);
        }
    }

    return { flags, rest };
}

// The command words are the leading tokens before any flag.
function takeLeadingWords(argv) {
    const end = argv.findIndex((token) => token.startsWith('-'));
    return end === -1 ? [ ...argv ] : argv.slice(0, end);
}

async function resolveStartDirectory(cwd, directory) {
    if (isUndefined(directory)) {
        return cwd;
    }

    const startDirectory = path.resolve(cwd, directory);

    let stats;

    try {
        stats = await fsp.stat(startDirectory);
    } catch {
        stats = null;
    }

    if (!stats?.isDirectory()) {
        throw new UsageError(`The application directory ${ startDirectory } does not exist or is not a directory.`);
    }

    return startDirectory;
}

// Fails before the command is constructed so a command never runs partially
// configured, and so the message can name the files the value belongs in
// rather than surfacing as an assertion failure deep inside an API client.
function assertRequiredSettings(args) {
    const {
        commandLabel,
        settingsLabel,
        source,
        keyPaths,
        filepaths,
    } = args;

    const missing = findMissingKeys(source, keyPaths);

    if (missing.length === 0) {
        return;
    }

    const lines = [ `Missing required ${ settingsLabel } for "${ commandLabel }":` ];

    for (const keyPath of missing) {
        lines.push(`  ${ keyPath }`);
    }

    lines.push('');
    lines.push('Set them in one of these files:');

    for (const filepath of filepaths) {
        lines.push(`  ${ filepath }`);
    }

    throw new UsageError(lines.join('\n'));
}

function writeEnvelope(stdout, envelope) {
    stdout.write(`${ JSON.stringify(envelope) }\n`);
}
