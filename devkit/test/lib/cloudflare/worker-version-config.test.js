import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { readWorkerVersionConfig } from '../../../lib/cloudflare/worker-version-config.js';


describe('cloudflare/worker-version-config', ({ it }) => {
    it('returns the environment, WORKER, and WORKER_VERSION blocks', () => {
        const config = makeConfig({ compatibility_date: '2026-07-10', cache_options: { enabled: true } });

        const result = readWorkerVersionConfig(config, 'production');

        assertEqual(config.environments.production, result.environmentConfig);
        assertEqual('app', result.workerConfig.name);
        assertEqual('2026-07-10', result.workerVersionConfig.compatibility_date);
    });

    it('returns an empty WORKER_VERSION when absent', () => {
        const config = makeConfig();
        delete config.environments.production.WORKER_VERSION;

        const result = readWorkerVersionConfig(config, 'production');

        assertEqual(0, Object.keys(result.workerVersionConfig).length);
    });

    it('requires --environment', () => {
        const caught = catchError(() => readWorkerVersionConfig(makeConfig(), undefined));

        assert(caught, 'expected an error');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('--environment'), caught.message);
    });

    it('rejects a missing environment naming environments.<env>', () => {
        for (const environment of [ 'staging', 'toString' ]) {
            const caught = catchError(() => readWorkerVersionConfig(makeConfig(), environment));

            assert(caught, 'expected an error');
            assertEqual('UsageError', caught.name);
            assert(caught.message.endsWith(`environments.${ environment }`), caught.message);
        }
    });

    it('rejects a missing or empty WORKER.name', () => {
        for (const WORKER of [ undefined, {}, { name: '' } ]) {
            const config = makeConfig();
            config.environments.production.WORKER = WORKER;

            const caught = catchError(() => readWorkerVersionConfig(config, 'production'));

            assert(caught, 'expected an error');
            assertEqual('UsageError', caught.name);
            assert(caught.message.includes('environments.production.WORKER'), caught.message);
        }
    });

    it('rejects an unknown WORKER_VERSION key naming its config path', () => {
        const caught = catchError(() => readWorkerVersionConfig(makeConfig({ compatibilty_date: 'x' }), 'production'));

        assert(caught, 'expected an error');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('cloudflare-config.jsonc'), caught.message);
        assert(caught.message.includes('environments.production.WORKER_VERSION.compatibilty_date'), caught.message);
    });

    it('rejects annotations naming its config path', () => {
        const caught = catchError(() => {
            return readWorkerVersionConfig(makeConfig({ annotations: { 'workers/message': 'x' } }), 'production');
        });

        assert(caught, 'expected an error');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('environments.production.WORKER_VERSION.annotations'), caught.message);
    });

    it('rejects a non-object WORKER_VERSION', () => {
        const caught = catchError(() => readWorkerVersionConfig(makeConfig([]), 'production'));

        assert(caught, 'expected an error');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes('environments.production.WORKER_VERSION must be an object'), caught.message);
    });

    it('reports an invalid WORKER_VERSION value as a usage error', () => {
        const caught = catchError(() => readWorkerVersionConfig(makeConfig({ limits: { cpu_ms: 0 } }), 'production'));

        assert(caught, 'expected an error');
        assertEqual('UsageError', caught.name);
        assertEqual(
            'Invalid cloudflare-config.jsonc: environments.production.WORKER_VERSION: limits.cpu_ms must be a positive integer',
            caught.message,
        );
    });
});

function makeConfig(workerVersion) {
    return {
        name: 'app',
        environments: {
            production: {
                WORKER: { name: 'app' },
                WORKER_VERSION: workerVersion ?? { compatibility_date: '2026-07-10' },
            },
        },
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
