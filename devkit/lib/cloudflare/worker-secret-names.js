/**
 * Reads which secrets a remote Worker version holds and compares them with
 * `example.env.secrets`. `compareDeclaredSecrets` is the only place the
 * secret parity rule (plan Decision 5) lives.
 * @module worker-secret-names
 */

// A plain_text binding sharing a declared name must not count: inheriting it
// would carry a non-secret value into the new version under a secret's name.
const SECRET_BINDING_TYPES = new Set([ 'secret_text', 'secret_key' ]);

/**
 * @typedef {Object} DeclaredSecretComparison
 * @property {string[]} missingRequired - Required names the remote version lacks, sorted
 * @property {string[]} undeclared - Remote secret names neither required nor optional, sorted
 * @property {string[]} inheritedNames - Names to inherit: every required name plus each optional name present remotely, sorted
 */

/**
 * @param {Object} binding - Binding from a remote Worker version
 * @returns {boolean} Whether the binding holds a secret value
 */
export function isSecretBinding(binding) {
    return SECRET_BINDING_TYPES.has(binding?.type);
}

/**
 * @param {Object} version - Worker version from Cloudflare's get-version endpoint
 * @returns {string[]} Sorted unique names of the version's secret bindings
 * @throws {Error} When the version carries no bindings list, because treating
 *     that as "no secrets" would be a guess
 */
export function readSecretBindingNames(version) {
    const bindings = version?.resources?.bindings ?? version?.bindings;

    if (!Array.isArray(bindings)) {
        throw new Error(`Cloudflare returned Worker version ${ version?.id ?? '(unknown)' } without a bindings list`);
    }

    const names = bindings
        .filter(isSecretBinding)
        .map((binding) => binding.name);

    return Array.from(new Set(names)).sort();
}

/**
 * Compares the secrets manifest with a remote version's secret names. Every
 * required name must be present; optional names are inherited only when
 * present; any other remote secret is undeclared. The caller fails the build
 * when `missingRequired` or `undeclared` is non-empty.
 * @param {Object} args
 * @param {import('./secrets-manifest.js').SecretsManifest} args.manifest - Parsed `example.env.secrets`
 * @param {string[]} args.remoteNames - Secret binding names on the remote version
 * @returns {DeclaredSecretComparison}
 */
export function compareDeclaredSecrets(args) {
    const { manifest, remoteNames } = args ?? {};
    const { required, optional } = manifest;

    const remote = new Set(remoteNames);
    const declared = new Set(required.concat(optional));

    const missingRequired = required.filter((name) => !remote.has(name));
    const undeclared = Array.from(remote).filter((name) => !declared.has(name));

    const inheritedNames = required.concat(optional.filter((name) => remote.has(name)));

    return {
        missingRequired: missingRequired.sort(),
        undeclared: undeclared.sort(),
        inheritedNames: inheritedNames.sort(),
    };
}
