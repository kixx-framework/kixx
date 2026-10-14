import { isNonEmptyString } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import { compareDeclaredSecrets, readSecretBindingNames } from './worker-secret-names.js';

/**
 * Picks the exact remote Worker version a new version inherits its secrets
 * from, and compares that version's secret names with `example.env.secrets`.
 *
 * With a state file, the source is the recorded version, which must still be
 * the Worker's latest. Without one, the latest version is adopted. Pinning an
 * exact version keeps a build from inheriting secrets from a version another
 * checkout made and this one never saw.
 * @module resolve-secret-source
 */

const REQUIRED_STATE_FIELDS = [ 'workerName', 'versionId' ];

/**
 * @typedef {Object} SecretSource
 * @property {?string} versionId - Version to inherit secrets from, or null when the Worker has no versions
 * @property {boolean} adopted - Whether the latest version was adopted because no state file exists
 * @property {import('./worker-secret-names.js').DeclaredSecretComparison} comparison - Manifest vs. source version.
 *     The caller reports `missingRequired` and `undeclared` as problems.
 */

/**
 * @param {Object} args
 * @param {import('./cloudflare-api-client.js').default} args.apiClient - Cloudflare API client
 * @param {string} args.workerName - Configured `WORKER.name`
 * @param {string} args.environment - Environment name
 * @param {?import('./worker-version-state.js').WorkerVersionState} args.state - Recorded state, or null
 * @param {import('./secrets-manifest.js').SecretsManifest} args.manifest - Parsed `example.env.secrets`
 * @returns {Promise<SecretSource>}
 * @throws {UsageError} When the state is incomplete, names another Worker,
 *     records a missing or stale version, or the Worker has no versions while
 *     required secrets are declared
 */
export async function resolveSecretSource(args) {
    const { apiClient, workerName, environment, state, manifest } = args ?? {};
    const stateLabel = `.kixx/cloudflare-state.${ environment }.json`;

    if (state) {
        validateState({ state, workerName, stateLabel });

        const version = await getRecordedVersion({ apiClient, workerName, versionId: state.versionId, stateLabel });
        const latest = await getLatestVersionSummary(apiClient, workerName);

        if (latest?.id !== state.versionId) {
            throw new UsageError(
                `Cloudflare state is stale for Worker "${ workerName }": ${ stateLabel } records version ` +
                `${ state.versionId }, but the latest version is ${ latest?.id ?? '(none)' }. ` +
                'Changing a secret in the dashboard or with Wrangler creates a new version. ' +
                'Either restore the state file from the checkout that made the latest version, ' +
                `or delete ${ stateLabel } so the next run adopts the latest version.`,
            );
        }

        return { versionId: state.versionId, adopted: false, comparison: compare(manifest, version) };
    }

    const latest = await getLatestVersionSummary(apiClient, workerName);

    if (!latest) {
        if (manifest.required.length > 0) {
            throw new UsageError(
                `Worker "${ workerName }" has no versions, so there is no version to inherit secrets from. ` +
                'Set the declared secrets in the Cloudflare dashboard or with Wrangler first: ' +
                `${ manifest.required.join(', ') }`,
            );
        }

        return { versionId: null, adopted: false, comparison: compareDeclaredSecrets({ manifest, remoteNames: [] }) };
    }

    // The list endpoint does not return bindings, so read the version itself.
    const version = await apiClient.getWorkerVersion(workerName, latest.id);

    return { versionId: latest.id, adopted: true, comparison: compare(manifest, version) };
}

function validateState({ state, workerName, stateLabel }) {
    for (const field of REQUIRED_STATE_FIELDS) {
        if (!isNonEmptyString(state[field])) {
            throw new UsageError(`${ stateLabel } requires "${ field }"`);
        }
    }

    // The state file is scoped by environment, not Worker, so its hashes and
    // version describe the recorded Worker only.
    if (state.workerName !== workerName) {
        throw new UsageError(
            `${ stateLabel } records Worker "${ state.workerName }", but cloudflare-config.jsonc names ` +
            `"${ workerName }". Delete ${ stateLabel } to adopt the latest version of "${ workerName }".`,
        );
    }
}

async function getRecordedVersion({ apiClient, workerName, versionId, stateLabel }) {
    try {
        return await apiClient.getWorkerVersion(workerName, versionId);
    } catch (error) {
        if (error?.status === 404) {
            throw new UsageError(
                `${ stateLabel } records Worker version ${ versionId }, which does not exist for Worker ` +
                `"${ workerName }". Either restore the state file from the checkout that made the latest ` +
                `version, or delete ${ stateLabel } so the next run adopts the latest version.`,
                { cause: error },
            );
        }
        throw error;
    }
}

async function getLatestVersionSummary(apiClient, workerName) {
    const [ latest ] = await apiClient.listWorkerVersions(workerName, { page: 1, per_page: 1 });
    return latest ?? null;
}

function compare(manifest, version) {
    return compareDeclaredSecrets({ manifest, remoteNames: readSecretBindingNames(version) });
}
