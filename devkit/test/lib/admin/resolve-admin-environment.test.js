import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import resolveAdminEnvironment from '../../../lib/admin/resolve-admin-environment.js';

const CONFIG = { app: { environments: { production: { origin: 'https://admin.example.test' } } } };


describe('admin/resolve-admin-environment', ({ it }) => {

    it('resolves the origin without building a client', () => {
        let created = 0;

        const target = resolveAdminEnvironment({
            environment: 'production',
            config: CONFIG,
            createClient: () => {
                created += 1;
            },
        });

        assertEqual('production', target.environment);
        assertEqual('https://admin.example.test', target.origin);
        assertEqual(0, created);
    });

    it('builds a client with the origin and credentials on connect()', () => {
        const clientOptions = [];
        const fakeClient = {};

        const target = resolveAdminEnvironment({
            environment: 'production',
            config: CONFIG,
            createClient: (options) => {
                clientOptions.push(options);
                return fakeClient;
            },
        });

        const client = target.connect({ email: 'root@example.test', password: 'secret' });

        assertEqual(fakeClient, client);
        assertEqual('https://admin.example.test', clientOptions[0].origin);
        assertEqual('root@example.test', clientOptions[0].email);
        assertEqual('secret', clientOptions[0].password);
    });

    it('prefers an --origin override over the configured value', () => {
        const target = resolveAdminEnvironment({
            environment: 'production',
            config: CONFIG,
            origin: 'https://override.example.test',
        });

        assertEqual('https://override.example.test', target.origin);
    });

    it('throws a UsageError when the origin is not configured', () => {
        const caught = catchError(() => resolveAdminEnvironment({
            environment: 'staging',
            config: {},
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('app.environments.staging.origin'));
    });

    it('throws a UsageError when --environment is missing', () => {
        const caught = catchError(() => resolveAdminEnvironment({ config: {} }));

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
