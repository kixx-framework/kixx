import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import fileSystem from '../../lib/file-system.js';
import { parseJsonc } from '../../lib/parse-jsonc.js';
import { GENERATED_CONFIG_FILE_NAME, renderGeneratedConfig } from '../../lib/cloudflare/generated-config.js';
import { packageWorkerModules } from '../../lib/cloudflare/worker-modules.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit
// produces exactly what the application accepts.
import { readConfig } from '../../../lib/kixx/config/read-config.js';


const LIB_DIRECTORY = fileURLToPath(new URL('../../../lib/', import.meta.url)).replace(/\/$/, '');
const GENERATED_FILEPATH = path.join(LIB_DIRECTORY, GENERATED_CONFIG_FILE_NAME);

// The full lib graph is a few hundred files.
const TIMEOUT = 10000;


describe('Worker bundle conformance with lib', ({ it }) => {

    it('produces a generated config that lib readConfig accepts', async () => {
        const cloudflareConfig = await readLibCloudflareConfig();
        const text = renderGeneratedConfig({ environment: 'production', cloudflareConfig });

        const { default: generated } = await import(`data:text/javascript,${ encodeURIComponent(text) }`);
        const config = readConfig(generated, 'production');

        assertEqual('production', config.environment);
        assertEqual(cloudflareConfig.environments.production.WORKER.name, config.env.WORKER.name);
    });

    it('bundles lib/cloudflare-server.js without writing into lib/', async () => {
        const cloudflareConfig = await readLibCloudflareConfig();
        const generatedText = renderGeneratedConfig({ environment: 'production', cloudflareConfig });
        const writes = [];

        // Serves the generated module virtually; everything else is the real
        // file system, read-only.
        const overlay = {
            ...fileSystem,
            async readFile(filepath) {
                return filepath === GENERATED_FILEPATH ? generatedText : fileSystem.readFile(filepath);
            },
            async isFile(filepath) {
                return filepath === GENERATED_FILEPATH || fileSystem.isFile(filepath);
            },
            async realpath(filepath) {
                return filepath === GENERATED_FILEPATH ? filepath : fileSystem.realpath(filepath);
            },
            async writeFile(filepath) {
                writes.push(filepath);
            },
        };

        const result = await packageWorkerModules({ projectDirectory: LIB_DIRECTORY, fileSystem: overlay });
        const names = result.modules.map((mod) => mod.name);

        assertEqual('cloudflare-server.js', result.mainModule);
        assertEqual('cloudflare-server.js', names[0]);
        assert(names.includes(GENERATED_CONFIG_FILE_NAME), 'expected the generated config module');

        // The bundler strips the header comment and keeps the line.
        const generatedModule = result.modules.find((mod) => mod.name === GENERATED_CONFIG_FILE_NAME);
        assertEqual(generatedText.slice(generatedText.indexOf('\n')), generatedModule.content);

        assertEqual(64, result.modulesHash.length);
        assertEqual(0, writes.length);

        for (const name of names) {
            assert(!name.startsWith('..') && !name.startsWith('/'), `module outside lib/: ${ name }`);
        }
    }, { timeout: TIMEOUT });
});

async function readLibCloudflareConfig() {
    return parseJsonc(await fsp.readFile(path.join(LIB_DIRECTORY, 'cloudflare-config.jsonc'), 'utf8'));
}
