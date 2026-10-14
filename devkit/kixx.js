#!/usr/bin/env node

import process from 'node:process';
import { parseArgs } from 'node:util';
import commandModules from './commands/index.js';
import CommandRegistry from './lib/command-registry.js';
import UsageError from './lib/usage-error.js';
import { CONSOLE_LINE_WIDTH, wrapText, wrapWords } from './lib/text-wrap.js';
import { loadCloudflareConfig } from './lib/cloudflare-config-loader.js';
import { findMissingKeys, loadConfiguration } from './lib/config-loader.js';
import { toCloudflareAuthUsageError } from './lib/cloudflare/cloudflare-auth-guidance.js';
import manifest from './deno.json' with { type: 'json' };


function appendWrappedDescription(lines, description, initialPrefix) {
    let prefix = initialPrefix;

    // Keep space available for description text when an unusually long label
    // would otherwise consume the entire line width.
    if (prefix.length >= CONSOLE_LINE_WIDTH) {
        lines.push(prefix.trimEnd());
        prefix = '    ';
    }

    // Descriptions are often indented template literals, so their line breaks
    // and indentation are source formatting rather than intended layout.
    const normalizedDescription = description.trim().replace(/\s+/g, ' ');
    const descriptionLines = wrapWords(normalizedDescription, CONSOLE_LINE_WIDTH - prefix.length);

    if (descriptionLines.length === 0) {
        lines.push(prefix.trimEnd());
        return;
    }

    lines.push(`${ prefix }${ descriptionLines[0] }`);

    const continuationPrefix = ' '.repeat(prefix.length);
    for (const line of descriptionLines.slice(1)) {
        lines.push(`${ continuationPrefix }${ line }`);
    }
}

function renderHelp(sections) {
    const {
        message,
        usage,
        description,
        positionals,
        options,
        commands,
        subCommands,
        requiredConfig,
        requiredSecrets,
    } = sections;

    const lines = [];

    if (message) {
        lines.push(message);
        lines.push('');
    }

    if (usage) {
        lines.push(`Usage: kixx ${ usage }`);
        lines.push('');
    }

    if (description) {
        appendWrappedDescription(lines, description, '  ');
        lines.push('');
    }

    if (positionals && positionals.length > 0) {
        lines.push('Arguments:');
        for (const positional of positionals) {
            appendWrappedDescription(lines, positional.description, `  ${ positional.name }  `);
        }
        lines.push('');
    }

    if (commands && commands.length > 0) {
        lines.push('');
        lines.push('Commands:');
        for (const cmd of commands) {
            appendWrappedDescription(lines, cmd.description, `  ${ cmd.name }  `);
        }
    }

    if (subCommands && subCommands.length > 0) {
        lines.push('');
        lines.push('Sub-commands:');
        for (const cmd of subCommands) {
            appendWrappedDescription(lines, cmd.description, `  ${ cmd.name }  `);
        }
    }

    if (options) {
        const globalOptions = {
            help: {
                type: 'boolean',
                description: 'Show this help',
            },
            version: {
                type: 'boolean',
                description: 'Print the kixx version',
            },
        };

        const opts = Object.assign({}, globalOptions, options);

        lines.push('');
        lines.push('Options:');

        for (const [ flagName, opt ] of Object.entries(opts)) {
            appendWrappedDescription(lines, opt.description || '', `  --${ flagName }  ${ opt.type }  `);
        }
    }

    appendRequiredSettings(lines, 'Required .kixx/config.json settings:', requiredConfig);
    appendRequiredSettings(lines, 'Required .kixx/secrets.json settings:', requiredSecrets);

    process.stdout.write(`${ lines.join('\n') }\n`);
}

function appendRequiredSettings(lines, heading, keyPaths) {
    if (!keyPaths || keyPaths.length === 0) {
        return;
    }

    lines.push('');
    lines.push(heading);

    for (const keyPath of keyPaths) {
        lines.push(`  ${ keyPath }`);
    }
}

function createCommandUsage(commandName, subCommandName, positionals = []) {
    const usageParts = [ commandName, subCommandName, '[options]' ];

    for (const positional of positionals) {
        const label = positional.required === false
            ? `[${ positional.name }]`
            : `<${ positional.name }>`;
        usageParts.push(label);
    }

    return usageParts.join(' ');
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
    } = args ?? {};

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

async function main() {
    const args = parseArgs({
        strict: false,
        allowPositionals: true,
        allowNegative: false,
        options: {
            help: {
                type: 'boolean',
                short: 'h',
            },
            version: {
                type: 'boolean',
                short: 'v',
            },
        },
    });

    // Checked before command resolution so the flag works anywhere on the
    // command line. No sub-command may declare -v (enforced by a unit test).
    if (args.values.version) {
        process.stdout.write(`${ manifest.version }\n`);
        return 0;
    }

    const commandRegistry = new CommandRegistry(commandModules);

    const [ commandName, subCommandName ] = args.positionals;

    if (commandName) {
        const commandExists = commandRegistry.commandExists(commandName);
        if (!commandExists) {
            const commands = commandRegistry.listCommands();
            renderHelp({
                message: `The top level command "${ commandName }" does not exist.`,
                usage: '<command> <subcommand> [options] <...args>',
                commands,
                options: {},
            });
            return 1;
        }
    }

    let Command;

    if (commandName && subCommandName) {
        Command = commandRegistry.resolveCommand(commandName, subCommandName);
        if (!Command) {
            const subCommands = commandRegistry.listSubCommands(commandName);
            renderHelp({
                message: `The "${ commandName } ${ subCommandName }" sub command does not exist.`,
                usage: `${ commandName } <subcommand> [options] <...args>`,
                subCommands,
            });
            return 1;
        }
    }

    if (args.values.help) {
        if (Command) {
            renderHelp({
                usage: createCommandUsage(commandName, subCommandName, Command.positionals),
                description: Command.description,
                positionals: Command.positionals ?? [],
                options: Command.options ?? {},
                requiredConfig: Command.requiredConfig,
                requiredSecrets: Command.requiredSecrets,
            });
            return 0;
        }
        if (!commandName) {
            const commands = commandRegistry.listCommands();
            renderHelp({
                usage: '<command> <subcommand> [options] <...args>',
                commands,
                options: {},
            });
            return 0;
        }
        const subCommands = commandRegistry.listSubCommands(commandName);
        renderHelp({
            usage: `${ commandName } <subcommand> [options] <...args>`,
            subCommands,
        });
        return 0;
    }

    if (!commandName) {
        const commands = commandRegistry.listCommands();
        renderHelp({
            message: 'A top level command name is required as the first argument.',
            usage: '<command> <subcommand> [options] <...args>',
            commands,
            options: {},
        });
        return 1;
    }

    if (!subCommandName) {
        const subCommands = commandRegistry.listSubCommands(commandName);
        renderHelp({
            message: 'A subcommand name is required as the second argument.',
            usage: `${ commandName } <subcommand> [options] <...args>`,
            subCommands,
        });
        return 1;
    }

    let commandArgs;

    try {
        commandArgs = parseArgs({
            // The command names select the module; only the remaining
            // arguments belong to the command implementation.
            args: process.argv.slice(4),
            allowPositionals: true,
            allowNegative: true,
            options: Command.options ?? {},
        });
    } catch (cause) {
        // Unknown or malformed flags are operator mistakes, not crashes.
        throw new UsageError(`${ cause.message }\nRun "kixx ${ commandName } ${ subCommandName } --help" for usage.`, { cause });
    }

    // Loaded here rather than at startup so help output and unresolved command
    // names still work in a directory holding a malformed config file.
    const configuration = await loadConfiguration();
    let cloudflareConfig;

    if (commandName === 'cloudflare') {
        cloudflareConfig = await loadCloudflareConfig(configuration.projectDirectory);
    }

    assertRequiredSettings({
        commandLabel: `${ commandName } ${ subCommandName }`,
        settingsLabel: 'configuration settings',
        source: configuration.config,
        keyPaths: Command.requiredConfig,
        filepaths: configuration.configFilepaths,
    });

    assertRequiredSettings({
        commandLabel: `${ commandName } ${ subCommandName }`,
        settingsLabel: 'secrets',
        source: configuration.secrets,
        keyPaths: Command.requiredSecrets,
        filepaths: configuration.secretsFilepaths,
    });

    const command = new Command({
        projectDirectory: configuration.projectDirectory,
        cloudflareConfig,
        config: configuration.config,
        secrets: configuration.secrets,
    });

    try {
        return await command.run(commandArgs.values, ...commandArgs.positionals);
    } catch (error) {
        // An authentication failure is a configuration problem, not a crash.
        throw toCloudflareAuthUsageError(error, configuration.secretsFilepaths);
    }
}

main()
    .then((code) => {
        if (Number.isInteger(code)) {
            // Let Node flush any pending command output before exiting.
            process.exitCode = code;
        }
    })
    .catch((error) => {
        // Match the class, not the name: subclasses such as
        // UnsupportedServerError are also operator instructions, not crashes.
        if (error instanceof UsageError) {
            // eslint-disable-next-line no-console
            console.error(wrapText(error.message));
        } else {
            // eslint-disable-next-line no-console
            console.error('Failed to run command:');
            // eslint-disable-next-line no-console
            console.error(error);
        }
        process.exitCode = 1;
    });
