import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertNonEmptyString } from '../../lib/vendor/kixx-assert/mod.js';
import { parseEnvFile } from '../../lib/env-file.js';
import { createInstance, getInstancePaths } from '../../lib/local/instance-store.js';
// Dev-only: conformance tests may read the repo's lib/ to prove the generated
// instance files are what the application's own readers expect.
import {
    createResolveFilepath,
    readOptionalDotEnvFile,
    readSourceConfigFile,
} from '../../../lib/node-environment.js';
import { parseSecretsManifest } from '../../../lib/kixx/config/secrets-manifest.js';
import { readConfig } from '../../../lib/kixx/config/read-config.js';


const LIB_DIRECTORY = fileURLToPath(new URL('../../../lib/', import.meta.url));


describe('local instance env conformance with lib/', ({ before, after, it }) => {
    let root;
    let paths;

    before(async () => {
        // A space in the path forces DATA_DIRECTORY to be quoted.
        root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local conformance-')));
        const instancesDirectory = path.join(root, 'instances');

        await createInstance({
            sourceDirectory: LIB_DIRECTORY,
            instancesDirectory,
            name: 'alpha',
            getFreePort: async () => 5555,
        });

        paths = getInstancePaths(instancesDirectory, 'alpha');
    });

    after(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('parses both dotenv files to the values devkit wrote', async () => {
        for (const filepath of [ paths.dotenv, paths.dotenvSecrets ]) {
            // eslint-disable-next-line no-await-in-loop
            const written = parseEnvFile(await fsp.readFile(filepath, 'utf8'), filepath, { reservedNames: [] });
            const parsed = readOptionalDotEnvFile(filepath);

            assertEqual(
                JSON.stringify(Object.entries(written).sort()),
                JSON.stringify(Object.entries(parsed).sort()),
                filepath,
            );
        }

        const env = readOptionalDotEnvFile(paths.dotenv);

        assertEqual('local', env.ENVIRONMENT);
        assertEqual(paths.directory, env.DATA_DIRECTORY);
    });

    it('provides every required secret named by lib/example.env.secrets', async () => {
        const manifest = parseSecretsManifest(await fsp.readFile(path.join(LIB_DIRECTORY, 'example.env.secrets'), 'utf8'));
        const secrets = readOptionalDotEnvFile(paths.dotenvSecrets);

        assert(manifest.required.length > 0, 'lib declares required secrets');

        for (const name of manifest.required) {
            assertNonEmptyString(secrets[name], name);
        }

        assertNonEmptyString(secrets.ADMIN_BOOTSTRAP_TOKEN, 'ADMIN_BOOTSTRAP_TOKEN');
    });

    it('resolves every local store path inside the instance directory', () => {
        const env = readOptionalDotEnvFile(paths.dotenv);

        const resolveFilepath = createResolveFilepath({
            baseDirectory: LIB_DIRECTORY,
            dataDirectory: env.DATA_DIRECTORY,
        });

        const config = readConfig(
            readSourceConfigFile(path.join(LIB_DIRECTORY, 'node-config.jsonc')),
            env.ENVIRONMENT,
            { resolveFilepath },
        );

        const storePaths = [
            config.env.DOCUMENT_STORE.path,
            config.env.KEY_VALUE_STORE.path,
            config.env.JOB_QUEUE.path,
            config.env.OBJECT_STORE.path,
            config.env.CONTENT_STORE.rootDirectory,
        ];

        for (const storePath of storePaths) {
            assertNonEmptyString(storePath);

            const resolved = config.resolveFilepath(storePath);

            assert(
                resolved.startsWith(`${ paths.directory }${ path.sep }`),
                `${ storePath } resolved to ${ resolved }`,
            );
        }
    });
});
