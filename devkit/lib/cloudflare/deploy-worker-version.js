import { isNonEmptyString } from '../vendor/kixx-assert/mod.js';
import defaultFileSystem from '../file-system.js';
import UsageError from '../usage-error.js';
import readWorkerConfig from './read-worker-config.js';
import {
    getStateFilepath,
    readWorkerVersionState,
    writeWorkerVersionState,
} from './worker-version-state.js';

/**
 * Routes all traffic to an existing Worker version and keeps the local
 * version state's `deployed` flag truthful.
 * @module deploy-worker-version
 */

/**
 * @typedef {Object} WorkerDeploymentResult
 * @property {string} environment - Deployed application environment
 * @property {string} workerName - Cloudflare Worker receiving traffic
 * @property {string} versionId - Version routed to all traffic
 * @property {?string} buildId - `BUILD_ID` read from the version, or null when it has none
 * @property {?string} stateFilepath - State file rewritten, or null when none exists
 * @property {Object} deployment - Cloudflare deployment response
 */

/**
 * Deploys a Worker version to 100% of traffic.
 *
 * There is no content guard: the operator decides what to deploy. When a
 * state file exists it is rewritten with `deployed` true only if the deployed
 * version is the recorded one, so deploying an older version marks the
 * recorded version as undeployed. No state file is created, and state is left
 * untouched when Cloudflare refuses the deployment.
 *
 * @param {Object} args - Deployment options
 * @param {string} args.projectDirectory - Absolute project root
 * @param {string} args.environment - Cloudflare environment name
 * @param {Object} args.cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {import('./cloudflare-api-client.js').default} args.apiClient - Cloudflare API client
 * @param {string} [args.versionId] - Version to deploy, defaulting to the recorded state
 * @param {import('../file-system.js').FileSystem} [args.fileSystem] - Filesystem adapter
 * @returns {Promise<WorkerDeploymentResult>} Successful deployment details
 * @throws {UsageError} When configuration, the version id, or the remote version is missing
 */
export async function deployWorkerVersion(args) {
    const {
        projectDirectory,
        environment,
        cloudflareConfig,
        apiClient,
        versionId: requestedVersionId,
        fileSystem = defaultFileSystem,
    } = args ?? {};

    const workerName = readWorkerConfig(cloudflareConfig, environment).name;

    // Read before deploying so a corrupt state file fails without moving traffic.
    const state = await readWorkerVersionState({ projectDirectory, environment, fileSystem });
    const versionId = resolveVersionId(requestedVersionId, state, environment);

    const version = await getVersion(apiClient, workerName, versionId);

    const deployment = await apiClient.createDeployment(workerName, {
        strategy: 'percentage',
        versions: [
            { version_id: versionId, percentage: 100 },
        ],
    });

    let stateFilepath = null;

    if (state) {
        stateFilepath = getStateFilepath({ projectDirectory, environment });

        const nextState = { ...state, deployed: versionId === state.versionId };

        try {
            await writeWorkerVersionState({ projectDirectory, environment, state: nextState, fileSystem });
        } catch (cause) {
            throw new Error(
                `Deployed version ${ versionId } to 100% of traffic, but could not update ${ stateFilepath }. ` +
                `Set "deployed" to ${ nextState.deployed } in that file.`,
                { cause },
            );
        }
    }

    return {
        environment,
        workerName,
        versionId,
        buildId: readBuildId(version),
        stateFilepath,
        deployment,
    };
}

function resolveVersionId(requestedVersionId, state, environment) {
    if (requestedVersionId !== undefined) {
        if (!isNonEmptyString(requestedVersionId)) {
            throw new UsageError('The version-id argument must be a non-empty string');
        }
        return requestedVersionId;
    }

    if (!isNonEmptyString(state?.versionId)) {
        throw new UsageError(
            `No Worker version was given, and none is recorded in .kixx/cloudflare-state.${ environment }.json`,
        );
    }

    return state.versionId;
}

async function getVersion(apiClient, workerName, versionId) {
    try {
        return await apiClient.getWorkerVersion(workerName, versionId);
    } catch (error) {
        if (error?.status === 404) {
            throw new UsageError(
                `Worker version ${ versionId } does not exist for Worker "${ workerName }"`,
                { cause: error },
            );
        }
        throw error;
    }
}

// Informational only: a version made outside devkit may lack a BUILD_ID, and
// that is no reason to refuse a deployment the operator asked for.
function readBuildId(version) {
    const bindings = Array.isArray(version?.bindings) ? version.bindings : [];
    const binding = bindings.find((entry) => entry?.type === 'plain_text' && entry.name === 'BUILD_ID');

    return isNonEmptyString(binding?.text) ? binding.text : null;
}
