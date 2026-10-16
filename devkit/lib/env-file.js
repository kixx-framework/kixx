import path from 'node:path';
import UsageError from './usage-error.js';
import defaultFileSystem from './file-system.js';

/**
 * Reads `.env.<environment>`, the committed, non-secret values a Worker
 * version binds as plain text. Parsing is deliberately minimal: no inline
 * comments, variable expansion, or multi-line values.
 * @module env-file
 */

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A value made only of these characters needs no quoting in either parser.
const BARE_VALUE_PATTERN = /^[A-Za-z0-9_\-./:@+,]*$/;

const DEFAULT_RESERVED_NAMES = Object.freeze([ 'BUILD_ID' ]);

/**
 * Reads and parses `<project>/.env.<environment>`. An authored `ENVIRONMENT`
 * is dropped: the Node.js server needs it in this file, but a Worker takes it
 * from `--environment`.
 * @param {Object} args
 * @param {string} args.projectDirectory - Absolute path to the project root
 * @param {string} args.environment - Environment name, such as `production`
 * @param {import('./file-system.js').FileSystem} [args.fileSystem]
 * @returns {Promise<Object<string, string>>} Parsed values, including empty strings
 * @throws {UsageError} When the file is missing, or a line is malformed, has an
 *     invalid or duplicate name, or declares `BUILD_ID`
 */
export async function readEnvFile(args) {
    const {
        projectDirectory,
        environment,
        fileSystem = defaultFileSystem,
    } = args ?? {};

    const filepath = path.join(projectDirectory, `.env.${ environment }`);

    // Required even though the server treats it as optional: a missing file
    // is far more likely a mistyped environment than an environment with no
    // values, and the resulting Worker would fail long after this succeeds.
    let text;
    try {
        text = await fileSystem.readFile(filepath);
    } catch (cause) {
        throw new UsageError(`Missing environment file: ${ filepath }`, { cause });
    }

    const values = parseEnvFile(text, filepath);
    delete values.ENVIRONMENT;

    return values;
}

/**
 * @param {string} text - Dotenv file text
 * @param {string} filepath - Path named in error messages
 * @param {Object} [options]
 * @param {string[]} [options.reservedNames=['BUILD_ID']] - Names the file may not declare
 * @returns {Object<string, string>} Names to unquoted values
 * @throws {UsageError} When a line is malformed, has an invalid or duplicate
 *     name, or declares a reserved name
 */
export function parseEnvFile(text, filepath, options) {
    const { reservedNames = DEFAULT_RESERVED_NAMES } = options ?? {};
    const values = Object.create(null);
    const lineNumbers = new Map();
    const lines = text.split(/\r\n|\n/);

    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('#')) {
            return;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            throw new UsageError(`Malformed line ${ lineNumber } in ${ filepath }: expected NAME=value`);
        }

        const name = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();

        if (!NAME_PATTERN.test(name)) {
            throw new UsageError(`Invalid name "${ name }" on line ${ lineNumber } in ${ filepath }`);
        }

        if (reservedNames.includes(name)) {
            throw new UsageError(
                `"${ name }" on line ${ lineNumber } in ${ filepath } is reserved; the deploy tool generates it`,
            );
        }

        if (lineNumbers.has(name)) {
            throw new UsageError(
                `Duplicate name "${ name }" on lines ${ lineNumbers.get(name) } and ${ lineNumber } in ${ filepath }`,
            );
        }

        lineNumbers.set(name, lineNumber);
        values[name] = unquote(rawValue);
    });

    return values;
}

/**
 * Formats names and values as dotenv text that both `parseEnvFile` and the
 * Node.js server's `util.parseEnv` read back unchanged. Values outside a safe
 * bare character set are single-quoted, which both parsers treat literally.
 * @param {Object<string, string>} values - Names to values
 * @returns {string} One `NAME=value` line per entry, ending in a newline
 * @throws {UsageError} When a name is invalid, or a value holds a single
 *     quote, carriage return, or line feed
 */
export function formatEnvFile(values) {
    const lines = Object.entries(values).map(([ name, value ]) => {
        if (!NAME_PATTERN.test(name)) {
            throw new UsageError(`Invalid dotenv name "${ name }"`);
        }

        const text = String(value);

        if (BARE_VALUE_PATTERN.test(text)) {
            return `${ name }=${ text }`;
        }

        if (/['\r\n]/.test(text)) {
            throw new UsageError(`The value of ${ name } cannot be written to a dotenv file: it holds a quote or line break`);
        }

        return `${ name }='${ text }'`;
    });

    return `${ lines.join('\n') }\n`;
}

function unquote(value) {
    const isDoubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.length >= 2 && value.startsWith('\'') && value.endsWith('\'');

    if (isDoubleQuoted || isSingleQuoted) {
        return value.slice(1, -1);
    }

    return value;
}
