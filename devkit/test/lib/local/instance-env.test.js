import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { buildInstanceEnv } from '../../../lib/local/instance-env.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';

const MANIFEST = [
    'B_SECRET=placeholder',
    'A_SECRET=placeholder',
    '# @optional',
    'ADMIN_BOOTSTRAP_TOKEN=placeholder',
    '# @optional',
    'THIRD_PARTY_KEY=placeholder',
    '',
].join('\n');

const EXAMPLE_ENV = [
    '# comment',
    'ENVIRONMENT=development',
    'TRUST_PROXY=false',
    'PORT=2026',
    '',
].join('\n');


describe('buildInstanceEnv()', ({ it }) => {

    it('keeps example.env values, drops PORT, and sets the instance values', async () => {
        const { plain } = await build({
            '/app/example.env.secrets': MANIFEST,
            '/app/example.env': EXAMPLE_ENV,
        });

        assertEqual(
            'ENVIRONMENT=local,TRUST_PROXY=false,BUILD_ID=local-a-1,DATA_DIRECTORY=/data/a',
            Object.entries(plain).map(([ name, value ]) => `${ name }=${ value }`).join(','),
        );
    });

    it('writes just the instance values without example.env', async () => {
        const { plain } = await build({ '/app/example.env.secrets': MANIFEST });

        assertEqual('ENVIRONMENT,BUILD_ID,DATA_DIRECTORY', Object.keys(plain).join(','));
    });

    it('generates required secrets plus ADMIN_BOOTSTRAP_TOKEN, each distinct', async () => {
        const { secrets } = await build({ '/app/example.env.secrets': MANIFEST });

        assertEqual('A_SECRET,B_SECRET,ADMIN_BOOTSTRAP_TOKEN', Object.keys(secrets).join(','));

        for (const value of Object.values(secrets)) {
            assertMatches(/^[0-9a-f]{64}$/, value);
        }

        assertEqual(3, new Set(Object.values(secrets)).size);
    });

    it('throws a UsageError when example.env.secrets is missing', async () => {
        let error = null;

        try {
            await build({});
        } catch (cause) {
            error = cause;
        }

        assertEqual('UsageError', error?.name);
        assertMatches('Missing secrets manifest: /app/example.env.secrets', error.message);
    });
});


function build(files) {
    return buildInstanceEnv({
        sourceDirectory: '/app',
        buildId: 'local-a-1',
        dataDirectory: '/data/a',
        fileSystem: createMemoryFileSystem(files),
    });
}
