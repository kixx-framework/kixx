import { isNonEmptyString, isUndefined } from '../vendor/kixx-assert/mod.js';

import resolveEnvironmentOrigin from '../resolve-environment-origin.js';
import UsageError from '../usage-error.js';
import PublishingAPIClient from './publishing-api-client.js';

/**
 * Resolves one environment's Publishing API connection settings.
 * @param {Object} args - Environment inputs and dependencies
 * @param {string} args.environment - Environment name
 * @param {Object} args.config - Merged Kixx configuration
 * @param {Object} args.secrets - Merged Kixx secrets
 * @param {string} [args.origin] - Explicit origin override
 * @param {string} [args.token] - Explicit token override
 * @param {Function} [args.createClient] - Publishing client factory
 * @returns {{environment: string, origin: string, client: Object}} Resolved connection
 * @throws {UsageError} When an environment or setting is missing
 */
export default function resolvePublishingEnvironment(args) {
    const {
        environment,
        config,
        secrets,
        origin: originOverride,
        token: tokenOverride,
        createClient = (options) => new PublishingAPIClient(options),
    } = args ?? {};

    const origin = resolveEnvironmentOrigin({
        environment,
        config,
        origin: originOverride,
    });
    const token = resolveSetting({
        override: tokenOverride,
        configured: secrets?.app?.environments?.[environment]?.publishingToken,
        optionName: 'token',
        filepath: '.kixx/secrets.json',
        keyPath: `app.environments.${ environment }.publishingToken`,
    });

    return {
        environment,
        origin,
        client: createClient({ origin, token }),
    };
}

function resolveSetting(args) {
    const { override, configured, optionName, filepath, keyPath } = args;

    if (!isUndefined(override)) {
        if (isNonEmptyString(override)) {
            return override;
        }

        throw new UsageError(`The --${ optionName } option must be a non-empty string`);
    }

    if (isNonEmptyString(configured)) {
        return configured;
    }

    throw new UsageError(`Missing required setting ${ keyPath } in ${ filepath }`);
}
