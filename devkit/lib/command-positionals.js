import UsageError from './usage-error.js';
import { isNonEmptyString, isPlainObject } from './vendor/kixx-assert/mod.js';


const POSITIONAL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// The runner owns the trailing optional directory argument.
const RESERVED_POSITIONAL_NAME = 'directory';


/**
 * Checks a sub-command's static `positionals` declaration.
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
            return `positional name "${ name }" is reserved for the application directory`;
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
 * Splits command-line positionals into a command's required leading values
 * and the optional trailing application directory.
 * @param {Array<{name: string}>} declared - The command's declared positionals.
 * @param {string[]} positionals - Positionals after the command names.
 * @param {Object} [options]
 * @param {string} [options.commandLabel] - "<command> <subcommand>", for the help hint.
 * @returns {{values: Object<string, string>, directory: string|undefined}}
 * @throws {UsageError} When a required value is missing or extra values remain.
 */
export function splitPositionals(declared, positionals, options) {
    const { commandLabel } = options ?? {};
    const required = declared ?? [];
    const values = {};

    for (let i = 0; i < required.length; i += 1) {
        const { name } = required[i];

        if (i >= positionals.length) {
            const hint = commandLabel ? ` Run "kixx ${ commandLabel } --help" for usage.` : '';
            throw new UsageError(`Missing required argument <${ name }>.${ hint }`);
        }

        values[name] = positionals[i];
    }

    const [ directory, ...extraArguments ] = positionals.slice(required.length);

    if (extraArguments.length > 0) {
        const expected = required.length === 0
            ? `Only one positional argument, the ${ RESERVED_POSITIONAL_NAME }, is accepted.`
            : `Expected ${ required.map(({ name }) => `<${ name }>`).join(' ') } and an optional ${ RESERVED_POSITIONAL_NAME }.`;

        throw new UsageError(`Unexpected argument "${ extraArguments[0] }". ${ expected }`);
    }

    return { values, directory };
}
