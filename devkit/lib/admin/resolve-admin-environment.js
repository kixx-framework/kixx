import resolveEnvironmentOrigin from '../resolve-environment-origin.js';
import AdminAPIClient from './admin-api-client.js';

/**
 * Resolves one environment's Admin API target without touching credentials.
 *
 * Commands call this before prompting, so a bad `--environment` or missing
 * origin fails before the operator is asked for a secret. The returned
 * `connect()` builds the client once credentials are in hand.
 * @param {Object} args - Environment inputs and dependencies
 * @param {string} args.environment - Environment name
 * @param {Object} args.config - Merged Kixx configuration
 * @param {string} [args.origin] - Explicit origin override
 * @param {Function} [args.createClient] - Admin client factory
 * @returns {{environment: string, origin: string, connect: function(Object=): Object}} Resolved target
 * @throws {UsageError} When the environment or origin is missing
 */
export default function resolveAdminEnvironment(args) {
    const {
        environment,
        config,
        origin: originOverride,
        createClient = (options) => new AdminAPIClient(options),
    } = args ?? {};

    const origin = resolveEnvironmentOrigin({
        environment,
        config,
        origin: originOverride,
    });

    return {
        environment,
        origin,
        connect(credentials) {
            const { email, password } = credentials ?? {};
            return createClient({ origin, email, password });
        },
    };
}
