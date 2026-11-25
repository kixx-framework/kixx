import {
    assert,
    assertArray,
    isNonEmptyString,
    isObjectNotNull,
    isString,
} from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';


// A secret name is a dotenv key: the POSIX shell variable name shape, which is
// also what every deploy target accepts as a binding name.
const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Each directive marks the next entry. Compared against the trimmed line so a
// directive can be indented with the comment block it belongs to.
const OPTIONAL_DIRECTIVE = '# @optional';
const REQUIRED_OUTSIDE_DEVELOPMENT_DIRECTIVE = '# @required-outside-development';

// The environment in which a secret required outside development may be absent.
const DEVELOPMENT_ENVIRONMENT = 'development';


/**
 * @typedef {Object} SecretsManifest
 * @property {string[]} required - Secret names every deployment must provide, sorted
 * @property {string[]} optional - Secret names a deployment may omit, sorted
 * @property {string[]} requiredOutsideDevelopment - Secret names every deployment except development must provide, sorted
 */

/**
 * @typedef {Object} SecretNameComparison
 * @property {string[]} missing - Required names absent from the live set, sorted
 * @property {string[]} extra - Live names the manifest does not declare, sorted
 */

/**
 * Parses the text of a secrets manifest into the lists of required, optional,
 * and required-outside-development secret names.
 *
 * The manifest is `example.env.secrets`, a committed file generated from the
 * secrets that core, the installed plugins, and the app declare in their
 * manifests. It serves two purposes at once: developers copy it to create a
 * local secrets file, and deployments read it as the authoritative list of
 * secret *names* an environment must provide. Only the names are meaningful
 * here; the value after `=` is a placeholder and is discarded.
 *
 * A comment line reading exactly `# @optional` marks the next entry optional,
 * and one reading exactly `# @required-outside-development` marks the next
 * entry required in every environment except development. An entry with no
 * directive is required everywhere. Further comment lines may follow a
 * directive, so it can be placed at the top of an entry's explanatory comment
 * block, but a blank line, a second directive of either kind, or the end of
 * the file may not: a directive must resolve to an entry, because one that
 * silently evaporated or attached to the wrong entry would reclassify a
 * secret and disarm the deploy guard.
 *
 * @param {string} text - The full text of the manifest file
 * @returns {SecretsManifest} The declared names, each list sorted, with no name in two lists
 * @throws {OperationalError} When a line is malformed, a name is invalid or duplicated, or a directive has no entry to mark
 */
export function parseSecretsManifest(text) {
    assert(isString(text), 'parseSecretsManifest: text must be a string');

    const required = [];
    const optional = [];
    const requiredOutsideDevelopment = [];
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
                throw unresolvedDirectiveError(pending);
            }
            continue;
        }

        if (line.startsWith('#')) {
            const directive = readDirective(line, lineNumber, { optional, requiredOutsideDevelopment });

            if (directive) {
                if (pending) {
                    throw manifestError(lineNumber, `a second directive, ${ directive.name }, before any entry`);
                }
                pending = directive;
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

        if (pending) {
            pending.list.push(name);
            pending = null;
        } else {
            required.push(name);
        }
    }

    if (pending) {
        throw unresolvedDirectiveError(pending);
    }

    required.sort();
    optional.sort();
    requiredOutsideDevelopment.sort();

    return { required, optional, requiredOutsideDevelopment };
}

/**
 * Compares a manifest against the secret names a deployment actually has live.
 *
 * The comparison is deliberately asymmetric in meaning, though not in shape:
 * a `missing` name is a required secret the deployment cannot run without,
 * while an `extra` name is only a leftover to clean up. Optional names appear
 * in neither list, since they are legitimate whether present or absent. A
 * name required outside development is missing when absent from any
 * environment but development.
 *
 * @param {Object} options
 * @param {SecretsManifest} options.manifest - The parsed manifest
 * @param {string[]} options.liveNames - Secret names currently live on the deployment
 * @param {string} options.environment - The deployment's environment name
 * @returns {SecretNameComparison} The two differences between the manifest and the live set
 */
export function compareSecretNames(options) {
    const { manifest, liveNames, environment } = options ?? {};
    const { required, optional, requiredOutsideDevelopment } = manifest ?? {};

    assertArray(required, 'compareSecretNames: manifest.required');
    assertArray(optional, 'compareSecretNames: manifest.optional');
    assertArray(requiredOutsideDevelopment, 'compareSecretNames: manifest.requiredOutsideDevelopment');
    assertArray(liveNames, 'compareSecretNames: liveNames');
    assert(isNonEmptyString(environment), 'compareSecretNames: environment must be a non-empty string');

    const liveSet = new Set(liveNames);
    const declaredSet = new Set([ ...required, ...optional, ...requiredOutsideDevelopment ]);

    const missing = namesRequiredIn(environment, { required, requiredOutsideDevelopment })
        .filter((name) => !liveSet.has(name));

    // Iterate the deduplicated live set rather than the array, so a name
    // Cloudflare happens to report twice is reported once.
    const extra = Array.from(liveSet).filter((name) => !declaredSet.has(name));

    missing.sort();
    extra.sort();

    return { missing, extra };
}

/**
 * Checks that the environment provides every secret the installed code
 * declares as required. It runs at boot on every platform, so a deployment
 * that lacks a secret fails at once, not on the first request that reads it.
 *
 * A required name is missing when its value in `env` is not a non-empty
 * string. A name required outside development is checked the same way in
 * every environment but development. Optional names are never checked. Every
 * missing name is reported in one error, and the message holds names only:
 * never a value, and never the name of a secret that is present.
 *
 * @param {Object} env - Environment variables, secrets, and platform bindings
 * @param {SecretsManifest} secrets - The declared secret names
 * @param {Object} options
 * @param {string} options.environment - The environment being booted
 * @returns {void}
 * @throws {OperationalError} When one or more required secrets are missing
 */
export function assertDeclaredSecrets(env, secrets, options) {
    const { required, optional, requiredOutsideDevelopment } = secrets ?? {};
    const { environment } = options ?? {};

    assert(isObjectNotNull(env), 'assertDeclaredSecrets: env must be an object');
    assertArray(required, 'assertDeclaredSecrets: secrets.required');
    assertArray(optional, 'assertDeclaredSecrets: secrets.optional');
    assertArray(requiredOutsideDevelopment, 'assertDeclaredSecrets: secrets.requiredOutsideDevelopment');
    assert(isNonEmptyString(environment), 'assertDeclaredSecrets: options.environment must be a non-empty string');

    const missing = namesRequiredIn(environment, { required, requiredOutsideDevelopment })
        .filter((name) => !isNonEmptyString(env[name]));

    if (missing.length === 0) {
        return;
    }

    missing.sort();

    throw new OperationalError(
        `Missing required environment secrets: ${ missing.join(', ') }. Every declared secret is listed in example.env.secrets.`,
        {},
        assertDeclaredSecrets,
    );
}

// Returns a new array, so callers never reorder the declared lists.
function namesRequiredIn(environment, { required, requiredOutsideDevelopment }) {
    if (environment === DEVELOPMENT_ENVIRONMENT) {
        return required.slice();
    }

    return required.concat(requiredOutsideDevelopment);
}

function readDirective(line, lineNumber, lists) {
    if (line === OPTIONAL_DIRECTIVE) {
        return { name: '@optional', list: lists.optional, lineNumber };
    }

    if (line === REQUIRED_OUTSIDE_DEVELOPMENT_DIRECTIVE) {
        return { name: '@required-outside-development', list: lists.requiredOutsideDevelopment, lineNumber };
    }

    return null;
}

// A blank line and the end of the file are one condition, not two: a file
// ending in the directive plus a newline reaches the blank-line branch, so
// separate messages would only mislabel that case.
function unresolvedDirectiveError(directive) {
    return manifestError(
        directive.lineNumber,
        `the ${ directive.name } directive must be followed by an entry, with only comment lines between them`,
    );
}

function manifestError(lineNumber, detail) {
    return new OperationalError(
        `Invalid secrets manifest on line ${ lineNumber }: ${ detail }`,
        {},
        manifestError,
    );
}
