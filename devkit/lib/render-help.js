/**
 * Help for the CLI, as data and as text. The data is what `--help --json`
 * returns; the text is rendered from the same data, so the two cannot
 * disagree.
 * @module render-help
 */

import { DIRECTORY_POSITIONAL, acceptsDirectory } from './command-positionals.js';
import { CONSOLE_LINE_WIDTH, collapseWhitespace, wrapWords } from './text-wrap.js';


const PROGRAM_NAME = 'kixx-dev';

/**
 * Printed by a placeholder's help, and beside its name in a command list.
 * @type {string}
 */
export const NOT_AVAILABLE_NOTICE = `Not available in this version of ${ PROGRAM_NAME }.`;

// The flags the runner handles for every command, in the shape commands use
// to declare their own.
const GLOBAL_OPTIONS = Object.freeze({
    help: {
        type: 'boolean',
        short: 'h',
        description: 'Show this help',
    },
    version: {
        type: 'boolean',
        short: 'v',
        description: `Print the ${ PROGRAM_NAME } version`,
    },
    json: {
        type: 'boolean',
        description: 'Write the result to stdout as one JSON object',
    },
});


/**
 * @typedef {Object} CommandHelp
 * @property {string} name - Registered command name
 * @property {boolean} available - False for a placeholder
 * @property {string} description - On one line
 * @property {string} usage - The full usage line, starting with the program name
 * @property {Array<{name: string, description: string, required: boolean}>} positionals
 * @property {Array<{name: string, short: string|null, type: string, multiple: boolean, default: *, description: string}>} options
 * @property {string[]} requiredConfig - Dotted key paths in `.kixx/config.json`
 * @property {string[]} requiredSecrets - Dotted key paths in `.kixx/secrets.json`
 * @property {boolean} requiresProject
 */

/**
 * Describes a command from its static declarations. This is the `data` of the
 * command's `--help --json` envelope: change it by addition only.
 * @param {string} name - Registered command name
 * @param {Function} Command - The command class
 * @returns {CommandHelp}
 */
export function describeCommand(name, Command) {
    const available = Command.available !== false;

    const positionals = (Command.positionals ?? []).map((positional) => ({
        name: positional.name,
        description: collapseWhitespace(positional.description),
        required: true,
    }));

    if (acceptsDirectory(Command)) {
        positionals.push({ ...DIRECTORY_POSITIONAL, required: false });
    }

    const options = Object.entries(Command.options ?? {}).map(([ flagName, option ]) => ({
        name: flagName,
        short: option.short ?? null,
        type: option.type,
        multiple: option.multiple === true,
        default: option.default ?? null,
        description: collapseWhitespace(option.description ?? ''),
    }));

    return {
        name,
        available,
        description: collapseWhitespace(Command.description ?? ''),
        usage: formatUsage(name, { available, positionals }),
        positionals,
        options,
        requiredConfig: [ ...(Command.requiredConfig ?? []) ],
        requiredSecrets: [ ...(Command.requiredSecrets ?? []) ],
        requiresProject: Command.requiresProject === true,
    };
}

/**
 * Renders one command's help.
 * @param {CommandHelp} help - From `describeCommand()`
 * @returns {string} Text ending in a newline
 */
export function renderCommandHelp(help) {
    const sections = [
        [ `Usage: ${ help.usage }` ],
        wrapDescription(help.description, '  '),
    ];

    if (!help.available) {
        sections.push([ `  ${ NOT_AVAILABLE_NOTICE }` ]);
    }

    if (help.positionals.length > 0) {
        sections.push([
            'Arguments:',
            ...alignEntries(help.positionals.map(({ name, description }) => [ name, description ])),
        ]);
    }

    const options = [
        ...Object.entries(GLOBAL_OPTIONS).map(([ name, option ]) => ({ name, ...option })),
        ...help.options,
    ];

    sections.push([
        'Options:',
        ...alignEntries(options.map((option) => [ formatOptionLabel(option), option.description ])),
    ]);

    if (help.requiredConfig.length > 0) {
        sections.push([
            'Required .kixx/config.json settings:',
            ...help.requiredConfig.map((keyPath) => `  ${ keyPath }`),
        ]);
    }

    if (help.requiredSecrets.length > 0) {
        sections.push([
            'Required .kixx/secrets.json settings:',
            ...help.requiredSecrets.map((keyPath) => `  ${ keyPath }`),
        ]);
    }

    return joinSections(sections);
}

/**
 * Renders the help for the whole CLI, or for one group of commands.
 * @param {Object} args
 * @param {Array<{name: string, description: string, available: boolean}>} args.commands - Commands to list
 * @param {string} [args.group] - Group name; omit for the top level
 * @param {string} [args.description] - The group's description
 * @returns {string} Text ending in a newline
 */
export function renderCommandList(args) {
    const { commands, group, description } = args ?? {};

    const usage = group
        ? `${ PROGRAM_NAME } ${ group } <command> [options] [...args]`
        : `${ PROGRAM_NAME } <command> [options] [...args]`;

    const sections = [ [ `Usage: ${ usage }` ] ];

    if (description) {
        sections.push(wrapDescription(description, '  '));
    }

    sections.push([
        'Commands:',
        ...alignEntries(commands.map((command) => {
            const text = command.available
                ? command.description
                : `${ command.description } (${ NOT_AVAILABLE_NOTICE })`;

            return [ command.name, text ];
        })),
    ]);

    sections.push([
        'Options:',
        ...alignEntries(Object.entries(GLOBAL_OPTIONS).map(([ name, option ]) => {
            return [ formatOptionLabel({ name, ...option }), option.description ];
        })),
    ]);

    sections.push([ `Run "${ PROGRAM_NAME } <command> --help" for a command's arguments and options.` ]);

    return joinSections(sections);
}

function formatUsage(name, args) {
    const { available, positionals } = args;

    // A placeholder's real arguments don't exist yet, so none are promised.
    if (!available) {
        return `${ PROGRAM_NAME } ${ name }`;
    }

    const tokens = positionals.map((positional) => {
        return positional.required ? `<${ positional.name }>` : `[${ positional.name }]`;
    });

    return [ PROGRAM_NAME, name, '[options]', ...tokens ].join(' ');
}

function joinSections(sections) {
    const blocks = sections
        .filter((lines) => lines.length > 0)
        .map((lines) => lines.join('\n'));

    return `${ blocks.join('\n\n') }\n`;
}

function wrapDescription(description, initialPrefix) {
    let prefix = initialPrefix;
    const lines = [];

    // Keep space available for description text when an unusually long label
    // would otherwise consume the entire line width.
    if (prefix.length >= CONSOLE_LINE_WIDTH) {
        lines.push(prefix.trimEnd());
        prefix = '    ';
    }

    const descriptionLines = wrapWords(collapseWhitespace(description), CONSOLE_LINE_WIDTH - prefix.length);

    if (descriptionLines.length === 0) {
        const label = prefix.trimEnd();
        return label ? [ ...lines, label ] : lines;
    }

    lines.push(`${ prefix }${ descriptionLines[0] }`);

    const continuationPrefix = ' '.repeat(prefix.length);

    for (const line of descriptionLines.slice(1)) {
        lines.push(`${ continuationPrefix }${ line }`);
    }

    return lines;
}

// Pads every label to the longest one so descriptions share a column.
function alignEntries(entries) {
    const labelWidth = Math.max(0, ...entries.map(([ label ]) => label.length));

    return entries.flatMap(([ label, description ]) => {
        return wrapDescription(description ?? '', `  ${ label.padEnd(labelWidth) }  `);
    });
}

// Long flags line up whether or not an option has a short alias.
function formatOptionLabel(option) {
    const shortLabel = option.short ? `-${ option.short }, ` : '    ';
    let label = `${ shortLabel }--${ option.name }`;

    if (option.type === 'string') {
        label += option.multiple ? ' <string>...' : ' <string>';
    }

    return label;
}
