import path from 'node:path';
import { isString } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import defaultFileSystem from '../file-system.js';
import { RESERVED_NAMES } from './worker-bindings.js';

/**
 * Reads `example.env.secrets`, the committed manifest of the secret names
 * every deployment must provide. A port of `parseSecretsManifest` from repo
 * `lib/kixx/config/secrets-manifest.js`; the grammar must stay identical.
 * @module secrets-manifest
 */

export const SECRETS_MANIFEST_FILE_NAME = 'example.env.secrets';

const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Compared against the trimmed line so the directive can be indented with the
// comment block it belongs to.
const OPTIONAL_DIRECTIVE = '# @optional';

/**
 * @typedef {Object} SecretsManifest
 * @property {string[]} required - Secret names every deployment must provide, sorted
 * @property {string[]} optional - Secret names a deployment may omit, sorted
 */

/**
 * Reads and parses `<project>/example.env.secrets`.
 * @param {Object} args
 * @param {string} args.projectDirectory - Absolute path to the project root
 * @param {import('../file-system.js').FileSystem} [args.fileSystem]
 * @returns {Promise<SecretsManifest>}
 * @throws {UsageError} When the file is missing or invalid, naming its path
 */
export async function readSecretsManifest(args) {
    const { projectDirectory, fileSystem = defaultFileSystem } = args ?? {};
    const filepath = path.join(projectDirectory, SECRETS_MANIFEST_FILE_NAME);

    let text;
    try {
        text = await fileSystem.readFile(filepath);
    } catch (cause) {
        // A missing manifest is far more likely a wrong project directory than
        // an application that declares no secrets; an empty file says the latter.
        throw new UsageError(`Missing secrets manifest: ${ filepath }`, { cause });
    }

    return parseSecretsManifest(text, { filepath });
}

/**
 * Parses manifest text into required and optional secret names. A comment
 * line reading exactly `# @optional` marks the next entry optional; only
 * comment lines may come between the directive and its entry.
 * @param {string} text - Full text of the manifest
 * @param {Object} [options]
 * @param {string} [options.filepath] - Path named in error messages
 * @returns {SecretsManifest} Both lists sorted, with no name in both
 * @throws {UsageError} When a line is malformed, a name is invalid, duplicated,
 *     or reserved, or a directive has no entry to mark
 */
export function parseSecretsManifest(text, options) {
    const label = options?.filepath ?? SECRETS_MANIFEST_FILE_NAME;

    if (!isString(text)) {
        throw new TypeError('parseSecretsManifest: text must be a string');
    }

    const required = [];
    const optional = [];
    const declaredNames = new Set();

    // Line number of an unresolved `# @optional` directive, or 0.
    let optionalDirectiveLine = 0;

    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index].trim();

        if (line === '') {
            if (optionalDirectiveLine > 0) {
                throw unresolvedDirectiveError(label, optionalDirectiveLine);
            }
            continue;
        }

        if (line.startsWith('#')) {
            if (line === OPTIONAL_DIRECTIVE) {
                if (optionalDirectiveLine > 0) {
                    throw manifestError(label, lineNumber, 'a second @optional directive before any entry');
                }
                optionalDirectiveLine = lineNumber;
            }
            continue;
        }

        const separatorIndex = line.indexOf('=');

        if (separatorIndex < 0) {
            // The line is not echoed: it may hold a pasted secret value.
            throw manifestError(label, lineNumber, 'expected a blank line, a comment, or NAME=value');
        }

        const name = line.slice(0, separatorIndex);

        if (!SECRET_NAME_PATTERN.test(name)) {
            throw manifestError(label, lineNumber, `invalid secret name "${ name }"`);
        }

        if (declaredNames.has(name)) {
            throw manifestError(label, lineNumber, `duplicate secret name "${ name }"`);
        }

        // Lib accepts these, but the deploy tool generates both as plain_text
        // bindings, so a secret of the same name could never be bound.
        if (RESERVED_NAMES.includes(name)) {
            throw manifestError(label, lineNumber, `"${ name }" is reserved by the deployment tool`);
        }

        declaredNames.add(name);

        if (optionalDirectiveLine > 0) {
            optional.push(name);
            optionalDirectiveLine = 0;
        } else {
            required.push(name);
        }
    }

    if (optionalDirectiveLine > 0) {
        throw unresolvedDirectiveError(label, optionalDirectiveLine);
    }

    required.sort();
    optional.sort();

    return { required, optional };
}

function unresolvedDirectiveError(label, lineNumber) {
    return manifestError(
        label,
        lineNumber,
        'the @optional directive must be followed by an entry, with only comment lines between them',
    );
}

function manifestError(label, lineNumber, detail) {
    return new UsageError(`Invalid ${ label } on line ${ lineNumber }: ${ detail }`);
}
