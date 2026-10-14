import path from 'node:path';
import process from 'node:process';
import CloudflareAPIClient from '../../lib/cloudflare/cloudflare-api-client.js';
import { createWorkerVersion } from '../../lib/cloudflare/create-worker-version.js';
import { wrapText } from '../../lib/text-wrap.js';


export default class CloudflareCreateWorkerVersionCommand {

    static description = 'Bundle, check, and upload a Cloudflare Worker version when its inputs changed';

    static options = {
        environment: {
            type: 'string',
            short: 'e',
            description: 'Required environment to build and upload a Worker version for',
        },
        force: {
            type: 'boolean',
            description: 'Upload a version even when nothing has changed',
        },
        deploy: {
            type: 'boolean',
            description: 'Upload and deploy to 100% of traffic; required, and only allowed, when the version binds an unprovisioned Durable Object class',
        },
    };

    static requiredSecrets = [
        'cloudflare.accountId',
        'cloudflare.apiToken',
    ];

    #projectDirectory;
    #cloudflareConfig;
    #secrets;
    #fileSystem;
    #bundleModules;
    #output;
    #createClient;
    #now;
    #generateUniqueId;

    constructor(args) {
        const {
            projectDirectory,
            cloudflareConfig,
            secrets,
            fileSystem,
            bundleModules,
            now,
            generateUniqueId,
            output = process.stdout,
            createClient = (options) => new CloudflareAPIClient(options),
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#cloudflareConfig = cloudflareConfig;
        this.#secrets = secrets;
        this.#fileSystem = fileSystem;
        this.#bundleModules = bundleModules;
        this.#now = now;
        this.#generateUniqueId = generateUniqueId;
        this.#output = output;
        this.#createClient = createClient;
    }

    async run(options) {
        const { environment, force = false, deploy = false } = options ?? {};

        const result = await createWorkerVersion({
            projectDirectory: this.#projectDirectory,
            environment,
            cloudflareConfig: this.#cloudflareConfig,
            apiClient: this.#createClient(this.#secrets.cloudflare),
            force,
            deploy,
            fileSystem: this.#fileSystem,
            bundleModules: this.#bundleModules,
            now: this.#now,
            generateUniqueId: this.#generateUniqueId,
        });

        if (result.outcome === 'skipped') {
            this.#output.write(wrapText(renderSkipped(result)));
            return 0;
        }

        const relativeStateFilepath = path.relative(this.#projectDirectory, result.stateFilepath);

        this.#output.write(wrapText(renderCreated(result, relativeStateFilepath)));

        // Unwrapped: a command broken across lines is no longer copyable.
        this.#output.write(renderNextSteps(result));

        return 0;
    }
}

// Cloudflare's exports_reconciliation report, in the order a developer reads
// it: what changed, then what needs attention. Empty sections are omitted.
const RECONCILIATION_SECTIONS = [
    [ 'created', 'Created' ],
    [ 'updated', 'Updated' ],
    [ 'deleted', 'Deleted' ],
    [ 'renamed', 'Renamed' ],
    [ 'transferred', 'Transferred' ],
    [ 'transfer_pending', 'Transfer pending' ],
    [ 'warnings', 'Warnings' ],
    [ 'info', 'Info' ],
];

export function renderSkipped(result) {
    const lines = renderHeader(result);
    const versionId = result.previousState?.versionId ?? 'unknown';
    const buildId = result.previousState?.buildId ?? 'unknown';

    lines.push(
        '',
        `Nothing changed since version ${ versionId } (build ${ buildId }).`,
        'No version created. Pass --force to upload anyway.',
        '',
    );

    return lines.join('\n');
}

export function renderCreated(result, relativeStateFilepath) {
    const { previousState, state, changes, moduleCount } = result;
    const lines = renderHeader(result);

    lines.push(
        '',
        `Bundled ${ moduleCount } module${ moduleCount === 1 ? '' : 's' }`,
        renderHashLine('modules', changes.modules, previousState?.modulesHash, state.modulesHash),
        renderHashLine('bindings', changes.bindings, previousState?.bindingsHash, state.bindingsHash),
        renderHashLine('config', changes.config, previousState?.configHash, state.configHash),
        '',
        `BUILD_ID: ${ result.buildId }`,
        `Created version ${ result.versionId }`,
    );

    if (result.deployed) {
        lines.push(
            'Deployed to 100% of traffic (--deploy); Durable Object namespaces provisioned for: ' +
            result.provisionedClasses.join(', '),
        );
        lines.push(...renderReconciliation(result.reconciliation));
    } else {
        lines.push('Created undeployed');
    }

    lines.push(`Wrote ${ relativeStateFilepath }`, '');

    return lines.join('\n');
}

export function renderNextSteps(result) {
    const publish = `kixx app publish -e ${ result.environment } --build-id ${ result.buildId }`;

    if (result.deployed) {
        return [
            '',
            wrapText(
                'Warning: this version is already serving traffic, but no content is assigned to its BUILD_ID. ' +
                'Content routes return 503 until you run:',
            ),
            `  ${ publish }`,
            '',
        ].join('\n');
    }

    return [
        '',
        'Next steps:',
        `  ${ publish }`,
        `  kixx cloudflare deploy-version -e ${ result.environment }`,
        '',
    ].join('\n');
}

function renderHeader(result) {
    const lines = [
        `Environment: ${ result.environment }`,
        `Worker:      ${ result.workerName }`,
    ];

    if (result.adoptedVersionId) {
        lines.push(`Adopted latest version ${ result.adoptedVersionId } as the secret source`);
    }

    return lines;
}

function renderHashLine(label, changed, oldHash, newHash) {
    if (!changed) {
        return `  ${ label.padEnd(9) } unchanged`;
    }

    const from = oldHash ? abbreviate(oldHash) : '(none)';

    return `  ${ label.padEnd(9) } changed    ${ from } -> ${ abbreviate(newHash) }`;
}

function abbreviate(hash) {
    return `${ hash.slice(0, 6) }…`;
}

// Absent on an undeployed upload, which is normal: Cloudflare reconciles at
// deployment. Say nothing rather than warning about the absence.
function renderReconciliation(reconciliation) {
    if (!reconciliation) {
        return [];
    }

    const lines = [];

    for (const [ key, label ] of RECONCILIATION_SECTIONS) {
        const entries = toEntries(reconciliation[key]);

        if (entries.length === 0) {
            continue;
        }

        lines.push(`  ${ label }:`);

        for (const entry of entries) {
            lines.push(...renderReconciliationEntry(entry));
        }
    }

    lines.push(...renderRemovableEntries(reconciliation.removable_entries));

    if (lines.length > 0) {
        lines.unshift('', 'Durable Objects:');
        lines.push('');
    }

    return lines;
}

function renderReconciliationEntry(entry) {
    const lines = [ `    ${ describeEntry(entry) }` ];

    // Other Workers still bound to the affected class. Removing a tombstone
    // while this is non-empty orphans their bindings, so it is never elided.
    const referencing = toEntries(entry?.referencing_scripts);

    if (referencing.length > 0) {
        lines.push(`      still referenced by: ${ referencing.map(describeEntry).join(', ') }`);
    }

    return lines;
}

function renderRemovableEntries(removableEntries) {
    const entries = toEntries(removableEntries);

    if (entries.length === 0) {
        return [];
    }

    const lines = [ '  Stale declarations, now safe to delete from DURABLE_OBJECT_MIGRATIONS:' ];

    for (const entry of entries) {
        lines.push(...renderReconciliationEntry(entry));
    }

    return lines;
}

function toEntries(value) {
    return Array.isArray(value) ? value : [];
}

// Cloudflare's entry shapes vary by section and are not fully documented, so
// prefer the readable fields and fall back to the raw entry rather than
// dropping information the developer may need.
function describeEntry(entry) {
    if (typeof entry === 'string') {
        return entry;
    }

    if (entry && typeof entry === 'object') {
        const name = entry.class_name ?? entry.name ?? entry.export_name ?? entry.class ?? null;
        const message = entry.message ?? entry.description ?? null;

        if (name && message) {
            return `${ name } — ${ message }`;
        }

        if (name || message) {
            return name ?? message;
        }
    }

    return JSON.stringify(entry);
}
