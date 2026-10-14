import defaultFileSystem from '../file-system.js';
import UsageError from '../usage-error.js';
import { hashValue } from '../canonical-hash.js';
import { generateShortId } from '../crypto.js';
import { readEnvFile } from '../env-file.js';
import { formatBuildId } from './build-id.js';
import CloudflareWorkerVersion from './cloudflare-worker-version.js';
import { buildDurableObjectExports } from './durable-object-exports.js';
import { writeGeneratedConfig } from './generated-config.js';
import { resolveSecretSource } from './resolve-secret-source.js';
import { readSecretsManifest } from './secrets-manifest.js';
import { verifyResources } from './verify-resources.js';
import { buildDurableObjectBindings, buildWorkerBindings } from './worker-bindings.js';
import { packageWorkerModules } from './worker-modules.js';
import { readWorkerRecord } from './worker-record.js';
import { readWorkerVersionConfig } from './worker-version-config.js';
import { getStateFilepath, readWorkerVersionState, writeWorkerVersionState } from './worker-version-state.js';

/**
 * Turns a Kixx application's source tree into a Cloudflare Worker version.
 *
 * Every precondition (configuration, Worker, secret source, secret parity,
 * resources, and the Durable Object deployment policy) is checked before
 * anything is written locally or remotely. The run then either skips because
 * nothing changed, uploads an undeployed version, or (with `deploy`) uploads
 * and deploys a version that introduces a Durable Object class. No D1, KV,
 * R2, or secret endpoint that writes is ever called.
 * @module create-worker-version
 */

export const TRIGGERED_BY = 'kixx cloudflare create-worker-version';

/**
 * @typedef {Object} CreateWorkerVersionResult
 * @property {'skipped'|'created'} outcome - What happened
 * @property {string} environment - Environment name
 * @property {string} workerName - Worker name
 * @property {string} stateFilepath - Absolute path of this environment's state file
 * @property {string} generatedConfigFilepath - Absolute path of the written `cloudflare-config.generated.js`
 * @property {?string} adoptedVersionId - Latest version adopted as the secret source when no state existed
 * @property {?Object} previousState - State read before the run
 * @property {?Object} state - State written by the run, or null when skipped
 * @property {{ modules: boolean, bindings: boolean, config: boolean }} changes - Which hashes differ from `previousState`
 * @property {number} moduleCount - Number of bundled modules
 * @property {?string} buildId - `BUILD_ID` of the created version
 * @property {?string} versionId - Created version id
 * @property {boolean} deployed - Whether the created version was deployed
 * @property {string[]} provisionedClasses - Durable Object classes the deployment provisioned; empty unless deployed
 * @property {?Object} reconciliation - Cloudflare's `exports_reconciliation` report, when present
 */

/**
 * @param {Object} args
 * @param {string} args.projectDirectory - Absolute project root
 * @param {string} args.environment - Value of `--environment`
 * @param {Object} args.cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {import('./cloudflare-api-client.js').default} args.apiClient - Cloudflare API client
 * @param {boolean} [args.force=false] - Upload even when nothing changed
 * @param {boolean} [args.deploy=false] - Deploy on upload; only allowed when a bound Durable Object class is unprovisioned
 * @param {import('../file-system.js').FileSystem} [args.fileSystem] - Filesystem adapter
 * @param {Function} [args.bundleModules] - Bundler, for tests
 * @param {() => Date} [args.now] - Clock
 * @param {() => string} [args.generateUniqueId] - `BUILD_ID` suffix generator
 * @returns {Promise<CreateWorkerVersionResult>}
 * @throws {UsageError} For any precondition failure. Secret parity, resource,
 *     and Durable Object problems are reported together in one error.
 */
export async function createWorkerVersion(args) {
    const {
        projectDirectory,
        environment,
        cloudflareConfig,
        apiClient,
        force = false,
        deploy = false,
        fileSystem = defaultFileSystem,
        bundleModules,
        now = () => new Date(),
        generateUniqueId = generateShortId,
    } = args ?? {};

    // 1. Local configuration. Everything here fails fast: later checks depend on it.
    const {
        environmentConfig,
        workerConfig,
        workerVersionConfig,
    } = readWorkerVersionConfig(cloudflareConfig, environment);

    const workerName = workerConfig.name;
    const stateFilepath = getStateFilepath({ projectDirectory, environment });

    const state = await readWorkerVersionState({ projectDirectory, environment, fileSystem });
    const manifest = await readSecretsManifest({ projectDirectory, fileSystem });
    const envars = await readEnvFile({ projectDirectory, environment, fileSystem });

    const { exports, liveClasses } = buildDurableObjectExports({ environmentConfig, environment });
    const durableObjectBindings = buildDurableObjectBindings({ environmentConfig, environment });

    // 2. Worker.
    const worker = await getWorker({ apiClient, workerName, environment });
    const { provisionedClasses } = readWorkerRecord(worker, workerName);

    // 3. Secret source.
    const source = await resolveSecretSource({ apiClient, workerName, environment, state, manifest });

    // 4. Resources.
    const resourceProblems = await verifyResources({ environmentConfig, environment, apiClient });

    // 5. Durable Object policy, then every collected problem at once.
    const unprovisioned = findUnprovisionedBindings({
        bindings: durableObjectBindings,
        liveClasses,
        provisionedClasses,
    });

    const problemReport = renderProblems({
        environment,
        workerName,
        source,
        resourceProblems,
        unprovisioned,
        deploy,
    });

    if (problemReport) {
        throw new UsageError(problemReport);
    }

    const bindings = buildWorkerBindings({
        environmentConfig,
        environment,
        envars,
        inheritedSecretNames: source.comparison.inheritedNames,
        secretVersionId: source.versionId ?? undefined,
    });

    // 6. Package. The generated config is written only now, after every
    // remote check passed, and immediately before the bundler reads it.
    const generatedConfigFilepath = await writeGeneratedConfig({
        projectDirectory,
        environment,
        cloudflareConfig,
        fileSystem,
    });

    const { mainModule, modules, modulesHash } = await packageWorkerModules({
        projectDirectory,
        fileSystem,
        bundleModules,
    });

    // Exports are folded into the bindings hash so a tombstone-only config
    // edit triggers an upload without adding a fourth hash to the state.
    const bindingsHash = hashValue({ bindings, exports });
    const configHash = hashValue(workerVersionConfig);

    const changes = {
        modules: !state || state.modulesHash !== modulesHash,
        bindings: !state || state.bindingsHash !== bindingsHash,
        config: !state || state.configHash !== configHash,
    };

    const baseResult = {
        environment,
        workerName,
        stateFilepath,
        generatedConfigFilepath,
        adoptedVersionId: source.adopted ? source.versionId : null,
        previousState: state,
        changes,
        moduleCount: modules.length,
    };

    // 7. Decide. An unprovisioned class has, by definition, not been deployed
    // yet, so matching hashes must not skip it.
    const shouldUpload = force || !state || changes.modules || changes.bindings || changes.config ||
        unprovisioned.length > 0;

    if (!shouldUpload) {
        return {
            ...baseResult,
            outcome: 'skipped',
            state: null,
            buildId: null,
            versionId: null,
            deployed: false,
            provisionedClasses: [],
            reconciliation: null,
        };
    }

    // 8. Upload.
    const createdAt = now();
    const buildId = formatBuildId(createdAt, generateUniqueId());

    const version = new CloudflareWorkerVersion({
        ...workerVersionConfig,
        annotations: {
            'workers/tag': buildId,
            'workers/triggered_by': TRIGGERED_BY,
        },
    });

    for (const mod of modules) {
        version.addModule({ name: mod.name, content: mod.content, main: mod.name === mainModule });
    }

    for (const binding of bindings) {
        version.addBinding(binding);
    }

    version.addBinding({ type: 'plain_text', name: 'BUILD_ID', text: buildId });

    for (const [ className, entry ] of Object.entries(exports)) {
        version.addExport(className, entry);
    }

    const created = await apiClient.createWorkerVersion(workerName, version.toJSON(), {
        deploy,
        strictBindingsInheritance: true,
    });

    // 9. State. The next run inherits from the new version, so the recorded
    // bindings hash points the inherit bindings at it; otherwise every run
    // after this one would look changed.
    const nextBindings = bindings.map((binding) => {
        return binding.type === 'inherit' ? { ...binding, version_id: created.id } : binding;
    });

    const nextState = {
        workerName,
        buildId,
        versionId: created.id,
        createdAt: createdAt.toISOString(),
        deployed: deploy,
        modulesHash,
        bindingsHash: hashValue({ bindings: nextBindings, exports }),
        configHash,
    };

    try {
        await writeWorkerVersionState({ projectDirectory, environment, state: nextState, fileSystem });
    } catch (cause) {
        const trafficChanged = deploy
            ? 'Traffic changed: this version was deployed to 100% of traffic.'
            : 'Traffic changed: no; this version was not deployed.';

        throw new Error(
            `Created Worker version ${ created.id } with BUILD_ID ${ buildId }, but could not write local state. ` +
            `${ trafficChanged } Save the following JSON to ${ stateFilepath } before another Worker operation:\n` +
            `${ JSON.stringify(nextState, null, 4) }`,
            { cause },
        );
    }

    return {
        ...baseResult,
        outcome: 'created',
        state: nextState,
        buildId,
        versionId: created.id,
        deployed: deploy,
        provisionedClasses: deploy ? unprovisioned.map((binding) => binding.class_name) : [],
        reconciliation: created.exports_reconciliation ?? null,
    };
}

async function getWorker({ apiClient, workerName, environment }) {
    try {
        return await apiClient.getWorker(workerName);
    } catch (error) {
        if (error?.status === 404) {
            throw new UsageError(
                `Worker "${ workerName }" does not exist. Run \`kixx cloudflare create-worker -e ${ environment }\` first.`,
                { cause: error },
            );
        }
        throw error;
    }
}

/**
 * Bound Durable Object classes Cloudflare has no namespace for yet. A binding
 * to a class the exports map does not keep live is left for Cloudflare to
 * reject in its own, more precise terms.
 */
function findUnprovisionedBindings({ bindings, liveClasses, provisionedClasses }) {
    return bindings
        .filter((binding) => liveClasses.includes(binding.class_name))
        .filter((binding) => !provisionedClasses.includes(binding.class_name))
        .sort((a, b) => (a.class_name < b.class_name ? -1 : 1));
}

function renderProblems({ environment, workerName, source, resourceProblems, unprovisioned, deploy }) {
    const sections = [];
    const { missingRequired, undeclared } = source.comparison;

    if (missingRequired.length > 0 || undeclared.length > 0) {
        const adopted = source.adopted ? ', adopted as the latest version' : '';
        const lines = [ `Secrets (source version ${ source.versionId }${ adopted }):` ];

        for (const name of missingRequired) {
            lines.push(`  - ${ name }: required, but not set on the source version`);
        }
        for (const name of undeclared) {
            lines.push(`  - ${ name }: set on the source version, but not declared in example.env.secrets`);
        }

        lines.push(
            'Set missing secrets in the Cloudflare dashboard or with Wrangler. Declare each undeclared secret ' +
            'in example.env.secrets (mark it `# @optional` if some deployments omit it), or delete it from the Worker.',
        );

        sections.push(lines.join('\n'));
    }

    if (resourceProblems.length > 0) {
        const lines = [ 'Resources:' ];

        for (const problem of resourceProblems) {
            lines.push(`  - ${ problem.configPath }: ${ problem.resource }, ${ problem.cause }`);
        }

        lines.push(
            'devkit does not create resources. Create them in the Cloudflare dashboard or with Wrangler, ' +
            'then record their IDs in cloudflare-config.jsonc.',
        );

        sections.push(lines.join('\n'));
    }

    if (unprovisioned.length > 0 && !deploy) {
        const lines = [ 'Durable Objects:' ];

        for (const binding of unprovisioned) {
            lines.push(
                `  - ${ binding.name } binds class ${ binding.class_name }, which has no namespace on ` +
                `Worker "${ workerName }" yet`,
            );
        }

        lines.push(
            'Cloudflare only provisions a namespace when the version declaring it is deployed. ' +
            'Re-run with --deploy to upload this version and deploy it to 100% of traffic.',
        );

        sections.push(lines.join('\n'));
    }

    if (unprovisioned.length === 0 && deploy) {
        sections.push([
            'Durable Objects:',
            `  - --deploy is only allowed when a version introduces an unprovisioned Durable Object class, ` +
            `and every bound class already has a namespace on Worker "${ workerName }".`,
            `Run without --deploy, then \`kixx cloudflare deploy-version -e ${ environment }\`.`,
        ].join('\n'));
    }

    if (sections.length === 0) {
        return null;
    }

    return [
        `Cannot create a Worker version for environment "${ environment }". Nothing was uploaded.`,
        ...sections,
    ].join('\n\n');
}
