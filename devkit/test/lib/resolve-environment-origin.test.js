import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';

import resolveEnvironmentOrigin from '../../lib/resolve-environment-origin.js';

describe('resolve-environment-origin', ({ it }) => {
    it('resolves the configured origin for the environment', () => {
        const origin = resolveEnvironmentOrigin({
            environment: 'production',
            config: { app: { environments: { production: { origin: 'https://prod.example.test' } } } },
        });

        assertEqual('https://prod.example.test', origin);
    });

    it('prefers an explicit override over the configured value', () => {
        const origin = resolveEnvironmentOrigin({
            environment: 'production',
            config: { app: { environments: { production: { origin: 'https://prod.example.test' } } } },
            origin: 'https://override.example.test',
        });

        assertEqual('https://override.example.test', origin);
    });

    it('throws when the override is an empty string rather than falling back to config', () => {
        const caught = catchError(() => resolveEnvironmentOrigin({
            environment: 'production',
            config: { app: { environments: { production: { origin: 'https://prod.example.test' } } } },
            origin: '',
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('--origin'));
    });

    it('throws naming the key path and file when no origin is configured', () => {
        const caught = catchError(() => resolveEnvironmentOrigin({
            environment: 'staging',
            config: {},
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('app.environments.staging.origin'));
        assert(caught.message.includes('.kixx/config.json'));
    });

    it('throws when the environment is missing', () => {
        const caught = catchError(() => resolveEnvironmentOrigin({ config: {} }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('--environment'));
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
