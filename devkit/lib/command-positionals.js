import UsageError from './usage-error.js';
import { isNonEmptyString, isPlainObject } from './vendor/kixx-assert/mod.js';


const POSITIONAL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// The runner owns the trailing optional directory argument.
const RESERVED_POSITIONAL_NAME = 'directory';


/**
 * Checks a command's static `positionals` declaration.
 * @param {*} declared - The `positionals` static; `undefined` means none.
 * @returns {string|null} A description of the first problem, or null when valid.
 */
export function findPositionalsProblem(declared) {
    if (declared === undefined) {
        return null;
    }

    if (!Array.isArray(declared)) {
        return 'positionals must be an array';
    }

    const seen = new Set();

    for (const entry of declared) {
        if (!isPlainObject(entry)) {
            return 'each positional must be an object';
        }

        const { name, description } = entry;

        if (!isNonEmptyString(name) || !POSITIONAL_NAME_PATTERN.test(name)) {
            return `positional name "${ name }" must match ${ POSITIONAL_NAME_PATTERN }`;
        }
        if (name === RESERVED_POSITIONAL_NAME) {
            return `positional name "${ name }" is reserved for the project directory`;
        }
        if (seen.has(name)) {
            return `positional name "${ name }" is declared twice`;
        }
        if (!isNonEmptyString(description?.trim())) {
            return `positional "${ name }" needs a description`;
        }

        seen.add(name);
    }

    return null;
}

/**
 * The optional trailing positional the runner owns.
 * @type {Readonly<{name: string, description: string}>}
 */
export const DIRECTORY_POSITIONAL = Object.freeze({
    name: RESERVED_POSITIONAL_NAME,
    description: 'A directory in the project; defaults to the current directory',
});

/**
 * Says whether a command runs inside a project. `requiresTooling` implies
 * `requiresProject`.
 * @param {Function} Command - A command class
 * @returns {boolean}
 */
export function requiresProject(Command) {
    return Command.requiresProject === true || Command.requiresTooling === true;
}

/**
 * Says whether a command takes the trailing directory. Only a command that
 * runs inside a project does: the directory is where the runner starts
 * looking for the project. A placeholder takes no arguments at all.
 * @param {Function} Command - A command class
 * @returns {boolean}
 */
export function acceptsDirectory(Command) {
    return Command.available !== false && requiresProject(Command);
}

/**
 * Splits command-line positionals into a command's required leading values
 * and the optional trailing project directory.
 * @param {Array<{name: string}>} declared - The command's declared positionals.
 * @param {string[]} positionals - Positionals after the command names.
 * @param {Object} [options]
 * @param {string} [options.commandLabel] - The command's name, for the help hint.
 * @param {boolean} [options.acceptsDirectory=true] - False for a command that runs outside a project.
 * @returns {{values: Object<string, string>, directory: string|undefined}}
 * @throws {UsageError} When a required value is missing or extra values remain.
 */
export function splitPositionals(declared, positionals, options) {
    const { commandLabel, acceptsDirectory: takesDirectory = true } = options ?? {};
    const required = declared ?? [];
    const values = {};

    for (let i = 0; i < required.length; i += 1) {
        const { name } = required[i];

        if (i >= positionals.length) {
            const hint = commandLabel ? ` Run "kixx-dev ${ commandLabel } --help" for usage.` : '';
            throw new UsageError(`Missing required argument <${ name }>.${ hint }`);
        }

        values[name] = positionals[i];
    }

    const remaining = positionals.slice(required.length);

    if (!takesDirectory) {
        if (remaining.length > 0) {
            const expected = required.length === 0
                ? 'This command takes no positional arguments.'
                : `Expected only ${ required.map(({ name }) => `<${ name }>`).join(' ') }.`;

            throw new UsageError(`Unexpected argument "${ remaining[0] }". ${ expected }`);
        }

        return { values, directory: undefined };
    }

    const [ directory, ...extraArguments ] = remaining;

    if (extraArguments.length > 0) {
        const expected = required.length === 0
            ? `Only one positional argument, the ${ RESERVED_POSITIONAL_NAME }, is accepted.`
            : `Expected ${ required.map(({ name }) => `<${ name }>`).join(' ') } and an optional ${ RESERVED_POSITIONAL_NAME }.`;

        throw new UsageError(`Unexpected argument "${ extraArguments[0] }". ${ expected }`);
    }

    return { values, directory };
}
