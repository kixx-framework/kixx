import process from 'node:process';
import { isNonEmptyString, isUndefined } from '../../lib/vendor/kixx-assert/mod.js';

import publishRelease from '../../lib/publishing/publish-release.js';
import { renderPublishResult } from '../../lib/publishing/render-publish-result.js';
import resolvePublishingEnvironment from '../../lib/publishing/resolve-publishing-environment.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

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
        const result = await publishRelease({
            client: connection.client,
            projectDirectory: this.#args.projectDirectory,
            buildId,
            dryRun: options?.['dry-run'] ?? false,
            fileSystem: this.#args.fileSystem,
            scan: this.#args.scan,
            publishContent: this.#args.publishContent,
            assignRelease: this.#args.assignRelease,
            formatRecovery: ({ releaseId }) => 'Recover with: kixx app assign-build -e ' +
                `${ connection.environment } --build-id ${ buildId } --release-id ${ releaseId }`,
        });

        (this.#args.output ?? process.stdout).write(wrapText(renderPublishResult({
            result,
            environment: connection.environment,
            origin: connection.origin,
            verbose: options?.verbose ?? false,
        })));
        return 0;
    }
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
