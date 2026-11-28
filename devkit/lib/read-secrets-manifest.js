/**
 * Reads a project's `example.env.secrets`, the committed manifest of the
 * secret names a deployment provides. The grammar belongs to the project's
 * own Kixx, so the parser is passed in: `parseSecretsManifest` from the
 * project's tooling (`lib/project/load-project-tooling.js`).
 * @module read-secrets-manifest
 */

import path from 'node:path';
import UsageError from './usage-error.js';
import defaultFileSystem from './file-system.js';
import { RESERVED_NAMES } from './cloudflare/worker-bindings.js';
import { assertFunction } from './vendor/kixx-assert/mod.js';


export const SECRETS_MANIFEST_FILE_NAME = 'example.env.secrets';

const NOT_SHOWN = '(not shown)';

/**
 * @typedef {Object} SecretsManifest
 * @property {string[]} required - Secret names every environment must provide, sorted
 * @property {string[]} optional - Secret names a deployment may omit, sorted
 * @property {string[]} requiredOutsideDevelopment - Secret names required in every environment but `development`, sorted
 */

/**
 * Reads and parses `<project>/example.env.secrets`.
 * @param {Object} args
 * @param {string} args.projectDirectory - Absolute path to the project root
 * @param {function(string): SecretsManifest} args.parseSecretsManifest - The project's own parser
 * @param {import('./file-system.js').FileSystem} [args.fileSystem]
 * @returns {Promise<SecretsManifest>}
 * @throws {UsageError} When the file is missing or invalid, or declares a
 *     name the deployment tool owns. The message names the file, and never
 *     holds the text of a line.
 */
export async function readSecretsManifest(args) {
    const { projectDirectory, parseSecretsManifest, fileSystem = defaultFileSystem } = args ?? {};

    assertFunction(parseSecretsManifest, 'readSecretsManifest() requires parseSecretsManifest');

    const filepath = path.join(projectDirectory, SECRETS_MANIFEST_FILE_NAME);

    let text;

    try {
        text = await fileSystem.readFile(filepath);
    } catch (cause) {
        // A missing manifest is far more likely a wrong project directory than
        // an application that declares no secrets; an empty file says the latter.
        throw new UsageError(`Missing secrets manifest: ${ filepath }`, { cause });
    }

    let manifest;

    try {
        manifest = parseSecretsManifest(text);
    } catch (cause) {
        // The parser is the project's code, so its error class is not ours:
        // match the name, never instanceof.
        if (cause?.name !== 'OperationalError') {
            throw cause;
        }

        // No cause is attached: the parser's own message may quote the line.
        throw new UsageError(`Invalid secrets manifest ${ filepath }: ${ withoutLineText(cause.message, text) }`);
    }

    const required = [ ...manifest.required ].sort();
    const optional = [ ...manifest.optional ].sort();
    const requiredOutsideDevelopment = [ ...(manifest.requiredOutsideDevelopment ?? []) ].sort();

    // Core accepts these names, but the deployment tool generates both as
    // plain text bindings, so a secret of the same name could never be bound.
    for (const name of [ ...required, ...optional, ...requiredOutsideDevelopment ]) {
        if (RESERVED_NAMES.includes(name)) {
            throw new UsageError(`Invalid secrets manifest ${ filepath }: "${ name }" is reserved by the deployment tool`);
        }
    }

    return { required, optional, requiredOutsideDevelopment };
}

// A line of this file may hold a pasted secret value, and core's parser
// quotes the line it could not read. Remove each quoted line from the
// message, so it keeps the line number and the reason and nothing else.
// Only a quoted whole line is removed: a short line, such as `e` or `12`, is
// also part of ordinary words and numbers in the message.
function withoutLineText(message, text) {
    const quotedLines = text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => `"${ line }"`)
        // Longest first, so a line that contains another is removed whole.
        .sort((a, b) => b.length - a.length);

    let safe = String(message);

    for (const quoted of quotedLines) {
        safe = safe.split(quoted).join(NOT_SHOWN);
    }

    return safe;
}
