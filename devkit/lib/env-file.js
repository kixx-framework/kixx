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
 * @returns {Object<string, string>} Names to unquoted values
 * @throws {UsageError} When a line is malformed, has an invalid or duplicate
 *     name, or declares `BUILD_ID`
 */
export function parseEnvFile(text, filepath) {
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

        if (name === 'BUILD_ID') {
            throw new UsageError(
                `"BUILD_ID" on line ${ lineNumber } in ${ filepath } is reserved; the deploy tool generates it`,
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

function unquote(value) {
    const isDoubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.length >= 2 && value.startsWith('\'') && value.endsWith('\'');

    if (isDoubleQuoted || isSingleQuoted) {
        return value.slice(1, -1);
    }

    return value;
}
