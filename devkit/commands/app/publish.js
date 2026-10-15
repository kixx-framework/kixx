import process from 'node:process';
import { isNonEmptyString, isUndefined } from '../../lib/vendor/kixx-assert/mod.js';

import assignRelease from '../../lib/publishing/assign-release.js';
import defaultFileSystem from '../../lib/file-system.js';
import publishContent from '../../lib/publishing/publish-content.js';
import { UnsupportedServerError } from '../../lib/publishing/negotiate-capabilities.js';
import resolvePublishingEnvironment from '../../lib/publishing/resolve-publishing-environment.js';
import scanContentSources from '../../lib/publishing/scan-content-sources.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

/**
 * A Release that was created successfully but could not be assigned to a
 * build pointer. Carries the Release id so an operator can complete the
 * assignment separately instead of losing track of already-written content.
 * Not a `UsageError`, because the runner wraps those and would break the
 * copyable recovery command.
 */
export class ReleaseAssignmentError extends Error {

    /**
     * @param {string} message - Operator-facing failure description
     * @param {Object} options - Failure details
     * @param {string} options.releaseId - Release that was created
     * @param {string} options.buildId - Build pointer that was not assigned
     * @param {Error} options.cause - Underlying assignment failure
     */
    constructor(message, options) {
        const { releaseId, buildId, cause } = options ?? {};

        super(message, { cause });

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: this.constructor.name,
            },
            code: {
                enumerable: true,
                value: this.constructor.name,
            },
            releaseId: {
                enumerable: true,
                value: releaseId,
            },
            buildId: {
                enumerable: true,
                value: buildId,
            },
        });
    }
}

export default class AppPublishCommand {

    static description = 'Create a content Release and assign it to the running or named build';
    static options = {
        environment: { type: 'string', short: 'e', description: 'Required application environment' },
        'build-id': { type: 'string', description: 'Build id; defaults to discovery\'s running build' },
        'dry-run': { type: 'boolean', description: 'Preview the server-backed object diff without writes' },
        verbose: { type: 'boolean', description: 'List every resource and disposition' },
        origin: { type: 'string', description: 'Override the configured Publishing API origin' },
        token: { type: 'string', description: 'Override the configured Publishing API token' },
    };

    #args;

    constructor(args) {
        this.#args = args ?? {};
    }

    async run(options) {
        const connection = resolvePublishingEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            secrets: this.#args.secrets,
            origin: options?.origin,
            token: options?.token,
            createClient: this.#args.createClient,
        });
        const buildId = await resolveBuildId(connection.client, options?.['build-id']);
        const scan = this.#args.scan ?? scanContentSources;
        const contentSources = await scan(this.#args.projectDirectory, {
            fileSystem: this.#args.fileSystem ?? defaultFileSystem,
        });
        const result = await (this.#args.publishContent ?? publishContent)({
            client: connection.client,
            contentSources,
            dryRun: options?.['dry-run'] ?? false,
            provenance: { client: 'kixx-devkit', intendedForBuildId: buildId },
        });

        let assignment;

        if (!result.dryRun) {
            try {
                assignment = await (this.#args.assignRelease ?? assignRelease)({
                    client: connection.client,
                    buildId,
                    releaseId: result.releaseId,
                    reason: 'publish',
                });
            } catch (cause) {
                // An incompatible server is refused before the assignment is
                // attempted, so there is no half-finished publish to recover.
                if (cause instanceof UnsupportedServerError) {
                    throw cause;
                }

                // The Release already exists on the server at this point.
                // Reporting only the assignment failure would hide that and
                // strand the operator without the id needed to recover.
                throw new ReleaseAssignmentError(
                    `Release "${ result.releaseId }" was created but could not be assigned to ` +
                    `build "${ buildId }": ${ cause.message }\n` +
                    'Recover with: kixx app assign-build -e ' +
                    `${ connection.environment } --build-id ${ buildId } --release-id ${ result.releaseId }`,
                    { releaseId: result.releaseId, buildId, cause },
                );
            }
        }

        (this.#args.output ?? process.stdout).write(wrapText(renderPublishResult({
            result: { ...result, buildId, assignmentId: assignment?.assignmentId },
            environment: connection.environment,
            origin: connection.origin,
            verbose: options?.verbose ?? false,
        })));
        return 0;
    }
}

/**
 * Formats a publish result without exposing credentials.
 * @param {Object} args - Output details
 * @param {Object} args.result - `publishContent()` result plus `buildId` and `assignmentId`
 * @param {string} args.environment - Application environment
 * @param {string} args.origin - Publishing API origin
 * @param {boolean} [args.verbose] - List every resource and its disposition
 * @returns {string} Terminal output ending in a newline
 */
export function renderPublishResult(args) {
    const { result, environment, origin, verbose } = args ?? {};
    const { buildId, assignmentId } = result;
    const totalCount = result.matchedCount + result.uploadedCount;
    const uploadLabel = result.dryRun ? 'would upload' : 'uploaded';
    const lines = [
        `Environment: ${ environment }`,
        `Origin:      ${ origin }`,
        `BUILD_ID:    ${ buildId }`,
    ];

    // The assignment identity is the only value tying this output to an entry
    // in the build's activation history.
    if (assignmentId) {
        lines.push(`Assignment:  ${ assignmentId }`);
    }

    lines.push(
        '',
        `Resources: ${ totalCount } total; ${ result.matchedCount } matched; ` +
            `${ result.uploadedCount } ${ uploadLabel }`,
        '',
        result.dryRun ? 'Resources that would upload:' : 'Uploaded resources:',
    );
    appendResources(lines, result.uploadedResources);
    lines.push('', 'Files not matched by a publishing convention:');
    appendValues(lines, result.unmatchedFiles);

    if (verbose) {
        lines.push('', 'All resources:');
        appendAllResources(lines, result.resources);
    }

    lines.push('');
    if (result.dryRun) {
        lines.push('Dry run: unvalidated preview; no objects, Release, or build pointer were written.');
    } else {
        lines.push(`Release: ${ result.releaseId }`);
        lines.push(`Objects: ${ result.objectCount }; ${ result.totalBytes } bytes`);
    }
    lines.push('');
    return lines.join('\n');
}

// An explicit --build-id wins; otherwise the build serving the origin. Lives
// here because publish is its only caller (assign-build requires --build-id).
async function resolveBuildId(client, buildId) {
    if (!isUndefined(buildId)) {
        if (!isNonEmptyString(buildId)) {
            throw new UsageError('The --build-id option must be a non-empty string');
        }
        return buildId;
    }

    const capabilities = await client.discover();

    if (!isNonEmptyString(capabilities.runningBuildId)) {
        throw new UsageError(
            'The target server reports no running build. Pass --build-id <id> to name a build, ' +
            'or create the Release and use kixx app assign-build.',
        );
    }

    return capabilities.runningBuildId;
}

function appendResources(lines, resources) {
    if (resources.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const resource of resources) {
        lines.push(`  ${ resource.type } ${ resource.pathname || '/' }`);
    }
}

function appendValues(lines, values) {
    if (values.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const value of values) {
        lines.push(`  ${ value }`);
    }
}

function appendAllResources(lines, resources) {
    if (resources.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const resource of resources) {
        lines.push(
            `  ${ resource.disposition.padEnd(8) } ${ resource.type } ` +
            `${ resource.pathname || '/' } ${ resource.hash } ${ resource.size } bytes`,
        );
    }
}
