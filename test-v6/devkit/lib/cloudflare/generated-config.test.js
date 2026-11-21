import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import {
    GENERATED_CONFIG_FILE_NAME,
    renderGeneratedConfig,
    writeGeneratedConfig,
} from '../../../lib/cloudflare/generated-config.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';

const CLOUDFLARE_CONFIG = {
    name: 'my-app',
    environments: {
        staging: { WORKER: { name: 'staging-worker' }, SECRET_THING: 'staging-only' },
        production: { WORKER: { name: 'prod-worker' }, KEY_VALUE_STORE: { namespaceId: 'kv' } },
    },
    trailing: { kept: true },
};


describe('cloudflare/generated-config', ({ it }) => {

    it('keeps only the selected environment and every top-level field in source order', () => {
        const text = renderGeneratedConfig({ environment: 'production', cloudflareConfig: CLOUDFLARE_CONFIG });
        const value = parseModule(text);

        assertEqual('name,environments,trailing', Object.keys(value).join(','));
        assertEqual('production', Object.keys(value.environments).join(','));
        assertEqual('prod-worker', value.environments.production.WORKER.name);
        assertEqual(true, value.trailing.kept);
        assertEqual(false, text.includes('staging'));
    });

    it('renders a header, LF line endings, four-space JSON, and one trailing newline', () => {
        const text = renderGeneratedConfig({ environment: 'production', cloudflareConfig: CLOUDFLARE_CONFIG });
        const lines = text.split('\n');

        assertEqual('// Generated from cloudflare-config.jsonc by `kixx cloudflare create-worker-version`. Do not edit or commit.', lines[0]);
        assertEqual('export default {', lines[1]);
        assertEqual('    "name": "my-app",', lines[2]);
        assertEqual('};', lines.at(-2));
        assertEqual('', lines.at(-1));
        assertEqual(false, text.includes('\r'));
    });

    it('is byte-stable across runs and unaffected by other environments', () => {
        const first = renderGeneratedConfig({ environment: 'production', cloudflareConfig: CLOUDFLARE_CONFIG });
        const second = renderGeneratedConfig({ environment: 'production', cloudflareConfig: structuredClone(CLOUDFLARE_CONFIG) });
        const otherChanged = structuredClone(CLOUDFLARE_CONFIG);
        otherChanged.environments.staging.WORKER.name = 'renamed';

        assertEqual(first, second);
        assertEqual(first, renderGeneratedConfig({ environment: 'production', cloudflareConfig: otherChanged }));
    });

    it('rejects an environment that is missing or not an object', () => {
        for (const environment of [ 'qa', 'toString' ]) {
            const error = catchError(() => renderGeneratedConfig({ environment, cloudflareConfig: CLOUDFLARE_CONFIG }));

            assertEqual('UsageError', error.name);
            assertMatches(`environments.${ environment }`, error.message);
        }
    });

    it('writes the module into the project directory', async () => {
        const fileSystem = createMemoryFileSystem();

        const filepath = await writeGeneratedConfig({
            projectDirectory: '/app',
            environment: 'production',
            cloudflareConfig: CLOUDFLARE_CONFIG,
            fileSystem,
        });

        assertEqual(`/app/${ GENERATED_CONFIG_FILE_NAME }`, filepath);
        assertEqual(
            renderGeneratedConfig({ environment: 'production', cloudflareConfig: CLOUDFLARE_CONFIG }),
            fileSystem.files.get(filepath),
        );
    });
});

function parseModule(text) {
    const body = text.slice(text.indexOf('export default ') + 'export default '.length, text.lastIndexOf(';'));
    return JSON.parse(body);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
