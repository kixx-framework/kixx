import path from 'node:path';
import { isString } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import defaultFileSystem from '../file-system.js';
import { RESERVED_NAMES } from './worker-bindings.js';

/**
 * Reads `example.env.secrets`, the committed manifest of the secret names
 * every deployment must provide. A port of `parseSecretsManifest` from core's
 * `kixx/config/secrets-manifest.js`; the grammar must stay identical. Only the
 * result differs: core returns `# @required-outside-development` names in a
 * third list, and this port returns them in `required`, because every
 * environment the devkit deploys or runs is outside development.
 * @module secrets-manifest
 */

export const SECRETS_MANIFEST_FILE_NAME = 'example.env.secrets';

const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Compared against the trimmed line so the directive can be indented with the
// comment block it belongs to.
const OPTIONAL_DIRECTIVE = '# @optional';
const REQUIRED_OUTSIDE_DEVELOPMENT_DIRECTIVE = '# @required-outside-development';

/**
 * @typedef {Object} SecretsManifest
 * @property {string[]} required - Secret names every deployment must provide,
 *     `# @required-outside-development` names included, sorted
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
 * line reading exactly `# @optional` marks the next entry optional, and one
 * reading exactly `# @required-outside-development` marks it required outside
 * development, which here means required. Only comment lines may come between
 * a directive and its entry.
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

    // The unresolved directive, if any: the list it sends the next entry to,
    // its name for messages, and its line number, which the errors report.
    let pending = null;

    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index].trim();

        if (line === '') {
            if (pending) {
                throw unresolvedDirectiveError(label, pending);
            }
            continue;
        }

        if (line.startsWith('#')) {
            const directive = readDirective(line, lineNumber, { required, optional });

            if (directive) {
                if (pending) {
                    throw manifestError(label, lineNumber, `a second directive, ${ directive.name }, before any entry`);
                }
                pending = directive;
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

        if (pending) {
            pending.list.push(name);
            pending = null;
        } else {
            required.push(name);
        }
    }

    if (pending) {
        throw unresolvedDirectiveError(label, pending);
    }

    required.sort();
    optional.sort();

    return { required, optional };
}

// Reads a comment line as a directive, or returns null for a plain comment.
function readDirective(line, lineNumber, lists) {
    if (line === OPTIONAL_DIRECTIVE) {
        return { name: '@optional', list: lists.optional, lineNumber };
    }

    if (line === REQUIRED_OUTSIDE_DEVELOPMENT_DIRECTIVE) {
        return { name: '@required-outside-development', list: lists.required, lineNumber };
    }

    return null;
}

function unresolvedDirectiveError(label, directive) {
    return manifestError(
        label,
        directive.lineNumber,
        `the ${ directive.name } directive must be followed by an entry, with only comment lines between them`,
    );
}

function manifestError(label, lineNumber, detail) {
    return new UsageError(`Invalid ${ label } on line ${ lineNumber }: ${ detail }`);
}
