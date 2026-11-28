import { findPositionalsProblem, requiresProject } from './command-positionals.js';
import { collapseWhitespace } from './text-wrap.js';
import {
    isBoolean,
    isFunction,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from './vendor/kixx-assert/mod.js';


const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?$/;

const OPTION_TYPES = Object.freeze([ 'string', 'boolean' ]);

/**
 * Flags the runner handles for every command. A command that declared one
 * would never see it.
 * @type {ReadonlyArray<string>}
 */
export const RESERVED_FLAG_NAMES = Object.freeze([ 'help', 'version', 'json' ]);

/**
 * @type {ReadonlyArray<string>}
 */
export const RESERVED_SHORT_FLAGS = Object.freeze([ 'h', 'v' ]);


/**
 * @typedef {Object} CommandSummary
 * @property {string} name - Registered name, such as "dev" or "release list"
 * @property {string} description - Description on one line
 * @property {boolean} available - False for a placeholder
 */

/**
 * Looks up commands in one flat map from command name to command class.
 *
 * A name is one word (`dev`) or two (`release list`). The first word of a
 * two-word name is a group. The map is built from static imports (see
 * `commands/index.js`) rather than by reading the commands directory, so the
 * CLI also works when it is loaded from a registry URL, where there is no
 * directory to read.
 */
export default class CommandRegistry {

    #commands;
    #groups;

    /**
     * @param {Object<string, Function>} commands - Command name to command class
     * @param {Object<string, string>} [groups] - Group name to one-line description
     */
    constructor(commands, groups) {
        this.#commands = commands;
        this.#groups = groups ?? {};
    }

    /**
     * Finds the command named by the leading words of a command line. Two
     * words are tried before one, so `release list` never resolves as
     * `release` with an argument.
     * @param {string[]} words - Leading command-line tokens, before any flag
     * @returns {{name: string, Command: Function, wordCount: number}|null}
     */
    resolve(words) {
        const candidates = [ words.slice(0, 2), words.slice(0, 1) ];

        for (const candidate of candidates) {
            const name = candidate.join(' ');

            // hasOwn() keeps inherited names like "constructor" from resolving.
            if (candidate.length > 0 && Object.hasOwn(this.#commands, name)) {
                return { name, Command: this.#commands[name], wordCount: candidate.length };
            }
        }

        return null;
    }

    hasGroup(groupName) {
        return Object.hasOwn(this.#groups, groupName);
    }

    /**
     * @param {string} groupName
     * @returns {string} The group's description, or an empty string
     */
    describeGroup(groupName) {
        return this.hasGroup(groupName) ? collapseWhitespace(this.#groups[groupName]) : '';
    }

    /**
     * Lists commands in their declaration order in the map.
     * @param {string} [groupName] - Only the commands of this group
     * @returns {CommandSummary[]}
     */
    listCommands(groupName) {
        return Object.entries(this.#commands)
            .filter(([ name ]) => isUndefined(groupName) || name.startsWith(`${ groupName } `))
            .map(([ name, Command ]) => ({
                name,
                description: collapseWhitespace(Command.description ?? ''),
                available: Command.available !== false,
            }));
    }
}

/**
 * Checks the shape of a registry: its names, and that the groups are exactly
 * the first words of the two-word names.
 * @param {Object<string, Function>} commands - Command name to command class
 * @param {Object<string, string>} groups - Group name to description
 * @returns {string[]} A description of each problem; empty when valid
 */
export function findRegistryProblems(commands, groups) {
    const problems = [];
    const usedGroups = new Set();

    for (const name of Object.keys(commands)) {
        if (!COMMAND_NAME_PATTERN.test(name)) {
            problems.push(`command name "${ name }" must be one or two lowercase words`);
            continue;
        }

        const words = name.split(' ');

        if (words.length === 1) {
            // "release" as a command would hide every "release <verb>".
            if (Object.hasOwn(groups, name)) {
                problems.push(`"${ name }" is both a command and a group`);
            }

            continue;
        }

        usedGroups.add(words[0]);

        if (Object.hasOwn(commands, words[0])) {
            problems.push(`"${ words[0] }" is both a command and a group`);
        }

        if (!Object.hasOwn(groups, words[0])) {
            problems.push(`group "${ words[0] }" of "${ name }" has no description in groups`);
        }
    }

    for (const [ groupName, description ] of Object.entries(groups)) {
        if (!isNonEmptyString(description) || description.trim() === '') {
            problems.push(`group "${ groupName }" needs a description`);
        }

        if (!usedGroups.has(groupName) && !Object.hasOwn(commands, groupName)) {
            problems.push(`group "${ groupName }" has no command`);
        }
    }

    // A name that is both is reported from each side; say it once.
    return [ ...new Set(problems) ];
}

/**
 * Checks the static contract of one command class.
 * @param {*} Command - The registered value
 * @returns {string[]} A description of each problem; empty when valid
 */
export function findCommandProblems(Command) {
    if (!isFunction(Command)) {
        return [ 'the command must be a class' ];
    }

    const problems = [];

    if (!isNonEmptyString(Command.description) || Command.description.trim() === '') {
        problems.push('description must be a non-empty string');
    }

    if (!isUndefined(Command.available) && !isBoolean(Command.available)) {
        problems.push('available must be a boolean');
    }

    for (const key of [ 'requiresProject', 'requiresTooling' ]) {
        if (!isUndefined(Command[key]) && !isBoolean(Command[key])) {
            problems.push(`${ key } must be a boolean`);
        }
    }

    problems.push(...findOptionsProblems(Command.options));

    const positionalsProblem = findPositionalsProblem(Command.positionals);

    if (positionalsProblem) {
        problems.push(positionalsProblem);
    }

    for (const key of [ 'requiredConfig', 'requiredSecrets' ]) {
        const keyPaths = Command[key];

        if (isUndefined(keyPaths)) {
            continue;
        }

        if (!Array.isArray(keyPaths) || !keyPaths.every((keyPath) => isNonEmptyString(keyPath))) {
            problems.push(`${ key } must be an array of key path strings`);
        }

        // Settings are loaded only for a command that runs inside a project.
        if (Array.isArray(keyPaths) && keyPaths.length > 0 && !requiresProject(Command)) {
            problems.push(`${ key } needs requiresProject, because settings are loaded only inside a project`);
        }
    }

    return problems;
}

function findOptionsProblems(options) {
    if (isUndefined(options)) {
        return [];
    }

    if (!isPlainObject(options)) {
        return [ 'options must be an object' ];
    }

    const problems = [];

    for (const [ flagName, option ] of Object.entries(options)) {
        if (!isPlainObject(option) || !OPTION_TYPES.includes(option.type)) {
            problems.push(`--${ flagName } type must be one of ${ OPTION_TYPES.join(', ') }`);
            continue;
        }

        if (RESERVED_FLAG_NAMES.includes(flagName)) {
            problems.push(`--${ flagName } is reserved for the runner`);
        }

        if (RESERVED_SHORT_FLAGS.includes(option.short)) {
            problems.push(`-${ option.short } is reserved for the runner`);
        }
    }

    return problems;
}
