import process from 'node:process';
import { isNonEmptyString } from '../../lib/vendor/kixx-assert/mod.js';

import assignRelease from '../../lib/publishing/assign-release.js';
import resolvePublishingEnvironment from '../../lib/publishing/resolve-publishing-environment.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

// The server's activation reasons (lib/app/collections/activation-record.js).
const REASONS = [ 'publish', 'rollback', 'carry-forward', 'restore' ];

export default class AppAssignBuildCommand {

    static description = 'Assign an existing Release to a build under a pointer precondition';

    static options = {
        environment: { type: 'string', short: 'e', description: 'Required application environment' },
        'build-id': { type: 'string', description: 'Required build pointer id' },
        'release-id': { type: 'string', description: 'Required Release id' },
        reason: { type: 'string', default: 'publish', description: `Assignment audit reason: ${ REASONS.join(', ') }` },
        origin: { type: 'string', description: 'Override the configured Publishing API origin' },
        token: { type: 'string', description: 'Override the configured Publishing API token' },
    };

    #args;
    #assign;

    constructor(args) {
        this.#args = args ?? {};
        this.#assign = this.#args.assignRelease ?? assignRelease;
    }

    async run(options) {
        const buildId = requireOption(options?.['build-id'], 'build-id');
        const releaseId = requireOption(options?.['release-id'], 'release-id');
        const reason = options?.reason ?? 'publish';

        if (!REASONS.includes(reason)) {
            throw new UsageError(`The --reason option must be one of: ${ REASONS.join(', ') }`);
        }

        const connection = resolvePublishingEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            secrets: this.#args.secrets,
            origin: options?.origin,
            token: options?.token,
            createClient: this.#args.createClient,
        });

        const result = await this.#assign({
            client: connection.client,
            buildId,
            releaseId,
            reason,
        });

        (this.#args.output ?? process.stdout).write(wrapText([
            `Environment: ${ connection.environment }`,
            `Origin:      ${ connection.origin }`,
            `BUILD_ID:    ${ result.buildId }`,
            `Release:     ${ result.releaseId }`,
            `Assignment:  ${ result.assignmentId }`,
            `Reason:      ${ reason }`,
            '',
        ].join('\n')));

        return 0;
    }
}

function requireOption(value, name) {
    if (!isNonEmptyString(value)) {
        throw new UsageError(`The --${ name } option is required`);
    }
    return value;
}
