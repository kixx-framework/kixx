import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import resolvePublishingEnvironment from '../../../lib/publishing/resolve-publishing-environment.js';

const CONFIG = { app: { environments: { production: { origin: 'https://app.example.test' } } } };
const SECRETS = { app: { environments: { production: { publishingToken: 'configured-token' } } } };


describe('publishing/resolve-publishing-environment', ({ it }) => {

    it('builds a client from the configured origin and token', () => {
        const connection = resolvePublishingEnvironment({
            environment: 'production',
            config: CONFIG,
            secrets: SECRETS,
            createClient: (options) => options,
        });

        assertEqual('production', connection.environment);
        assertEqual('https://app.example.test', connection.origin);
        assertEqual('https://app.example.test', connection.client.origin);
        assertEqual('configured-token', connection.client.token);
    });

    it('prefers --origin and --token overrides', () => {
        const connection = resolvePublishingEnvironment({
            environment: 'production',
            config: CONFIG,
            secrets: SECRETS,
            origin: 'https://override.example.test',
            token: 'override-token',
            createClient: (options) => options,
        });

        assertEqual('https://override.example.test', connection.client.origin);
        assertEqual('override-token', connection.client.token);
    });

    it('names the secrets key when no token is configured', () => {
        const caught = catchError(() => resolvePublishingEnvironment({
            environment: 'production',
            config: CONFIG,
            secrets: {},
            createClient: (options) => options,
        }));

        assertEqual('UsageError', caught?.name);
        assertMatches('app.environments.production.publishingToken in .kixx/secrets.json', caught.message);
    });

    it('rejects an empty --token override', () => {
        const caught = catchError(() => resolvePublishingEnvironment({
            environment: 'production',
            config: CONFIG,
            secrets: SECRETS,
            token: '',
            createClient: (options) => options,
        }));

        assertEqual('UsageError', caught?.name);
        assertMatches('--token', caught.message);
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
