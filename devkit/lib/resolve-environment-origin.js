import { isNonEmptyString, isUndefined } from './vendor/kixx-assert/mod.js';

import UsageError from './usage-error.js';

/**
 * Resolves one environment's origin: an `--origin` override wins, otherwise
 * falls back to the configured `app.environments.<environment>.origin`.
 *
 * Shared by the Publishing API and Admin API environment resolvers so both
 * report a missing or empty origin with the same message naming the same
 * file and key path.
 * @param {Object} args - Origin inputs
 * @param {string} args.environment - Environment name
 * @param {Object} args.config - Merged Kixx configuration
 * @param {string} [args.origin] - Explicit origin override
 * @returns {string} Resolved origin
 * @throws {UsageError} When the environment is missing, the override is an empty string, or no origin is configured
 */
export default function resolveEnvironmentOrigin(args) {
    const { environment, config, origin: originOverride } = args ?? {};

    if (!isNonEmptyString(environment)) {
        throw new UsageError('The --environment option is required');
    }

    if (!isUndefined(originOverride)) {
        if (isNonEmptyString(originOverride)) {
            return originOverride;
        }

        throw new UsageError('The --origin option must be a non-empty string');
    }

    const configured = config?.app?.environments?.[environment]?.origin;
    if (isNonEmptyString(configured)) {
        return configured;
    }

    throw new UsageError(
        `Missing required setting app.environments.${ environment }.origin in .kixx/config.json`,
    );
}
