import { assert, assertArray, isString } from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';


// A secret name is a dotenv key: the POSIX shell variable name shape, which is
// also what every deploy target accepts as a binding name.
const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Marks the next entry as optional. Compared against the trimmed line so the
// directive can be indented with the comment block it belongs to.
const OPTIONAL_DIRECTIVE = '# @optional';


/**
 * @typedef {Object} SecretsManifest
 * @property {string[]} required - Secret names every deployment must provide, sorted
 * @property {string[]} optional - Secret names a deployment may omit, sorted
 */

/**
 * @typedef {Object} SecretNameComparison
 * @property {string[]} missing - Required names absent from the live set, sorted
 * @property {string[]} extra - Live names the manifest does not declare, sorted
 */

/**
 * Parses the text of a secrets manifest into the sets of required and optional
 * secret names.
 *
 * The manifest is the committed `example.env.secrets` template, which serves
 * two purposes at once: developers copy it to create a local secrets file, and
 * deployments read it as the authoritative list of secret *names* an
 * environment must provide. Only the names are meaningful here; the value
 * after `=` is a placeholder and is discarded.
 *
 * A comment line reading exactly `# @optional` marks the next entry optional.
 * Further comment lines may follow the directive, so it can be placed at the
 * top of an entry's explanatory comment block, but a blank line, a second
 * directive, or the end of the file may not: the directive must resolve to an
 * entry, because a directive that silently evaporated would reclassify a
 * required secret as optional and disarm the deploy guard.
 *
 * @param {string} text - The full text of the manifest file
 * @returns {SecretsManifest} The declared names, each list sorted and unique across both
 * @throws {OperationalError} When a line is malformed, a name is invalid or duplicated, or a directive has no entry to mark
 */
export function parseSecretsManifest(text) {
    assert(isString(text), 'parseSecretsManifest: text must be a string');

    const required = [];
    const optional = [];
    const declaredNames = new Set();

    // Holds the line number of an unresolved `# @optional` directive, which is
    // also what the error messages below report.
    let optionalDirectiveLine = 0;

    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index].trim();

        if (line === '') {
            if (optionalDirectiveLine > 0) {
                throw unresolvedDirectiveError(optionalDirectiveLine);
            }
            continue;
        }

        if (line.startsWith('#')) {
            if (line === OPTIONAL_DIRECTIVE) {
                if (optionalDirectiveLine > 0) {
                    throw manifestError(lineNumber, 'a second @optional directive before any entry');
                }
                optionalDirectiveLine = lineNumber;
            }
            continue;
        }

        const separatorIndex = line.indexOf('=');

        if (separatorIndex < 0) {
            throw manifestError(lineNumber, `expected a blank line, a comment, or NAME=value: "${ line }"`);
        }

        const name = line.slice(0, separatorIndex);

        if (!SECRET_NAME_PATTERN.test(name)) {
            throw manifestError(lineNumber, `invalid secret name "${ name }"`);
        }

        if (declaredNames.has(name)) {
            throw manifestError(lineNumber, `duplicate secret name "${ name }"`);
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
        throw unresolvedDirectiveError(optionalDirectiveLine);
    }

    required.sort();
    optional.sort();

    return { required, optional };
}

/**
 * Compares a manifest against the secret names a deployment actually has live.
 *
 * The comparison is deliberately asymmetric in meaning, though not in shape:
 * a `missing` name is a required secret the deployment cannot run without,
 * while an `extra` name is only a leftover to clean up. Optional names appear
 * in neither list, since they are legitimate whether present or absent.
 *
 * @param {Object} options
 * @param {SecretsManifest} options.manifest - The parsed manifest
 * @param {string[]} options.liveNames - Secret names currently live on the deployment
 * @returns {SecretNameComparison} The two differences between the manifest and the live set
 */
export function compareSecretNames(options) {
    const { manifest, liveNames } = options ?? {};
    const { required, optional } = manifest ?? {};

    assertArray(required, 'compareSecretNames: manifest.required');
    assertArray(optional, 'compareSecretNames: manifest.optional');
    assertArray(liveNames, 'compareSecretNames: liveNames');

    const liveSet = new Set(liveNames);
    const declaredSet = new Set(required.concat(optional));

    const missing = required.filter((name) => !liveSet.has(name));

    // Iterate the deduplicated live set rather than the array, so a name
    // Cloudflare happens to report twice is reported once.
    const extra = Array.from(liveSet).filter((name) => !declaredSet.has(name));

    missing.sort();
    extra.sort();

    return { missing, extra };
}

// A blank line and the end of the file are one condition, not two: a file
// ending in the directive plus a newline reaches the blank-line branch, so
// separate messages would only mislabel that case.
function unresolvedDirectiveError(lineNumber) {
    return manifestError(
        lineNumber,
        'the @optional directive must be followed by an entry, with only comment lines between them',
    );
}

function manifestError(lineNumber, detail) {
    return new OperationalError(
        `Invalid secrets manifest on line ${ lineNumber }: ${ detail }`,
        {},
        manifestError,
    );
}
