import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { parseSecretsManifest } from '../../lib/cloudflare/secrets-manifest.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit accepts
// exactly what the application accepts.
import { parseSecretsManifest as parseLibSecretsManifest } from '../../../lib/kixx/config/secrets-manifest.js';


const VALID_CASES = [
    '',
    'A=1',
    'B=1\nA=2\n',
    '# @optional\nA=1\nB=2',
    '  # @optional  \n# note\n   C=x\r\nA=\r\n',
    '# comment = with equals\nNAME=value=with=equals',
];

// Lib accepts BUILD_ID and ENVIRONMENT; devkit deliberately rejects them, so
// they are not conformance cases.
const INVALID_CASES = [
    'no separator',
    '1BAD=x',
    'A=1\nA=2',
    'NAME WITH SPACE=x',
    'A =1',
    '# @optional',
    '# @optional\n\nA=1',
    '# @optional\n# @optional\nA=1',
];


describe('parseSecretsManifest conformance with lib', ({ it }) => {

    it('parses repo lib/example.env.secrets identically', async () => {
        const url = new URL('../../../lib/example.env.secrets', import.meta.url);
        const text = await fsp.readFile(url, 'utf8');

        const devkit = parseSecretsManifest(text);

        assertEqual(JSON.stringify(parseLibSecretsManifest(text)), JSON.stringify(devkit));
        assert(devkit.optional.includes('ADMIN_BOOTSTRAP_TOKEN'), 'expected the lib optional name');
    });

    it('parses valid manifests identically', () => {
        for (const text of VALID_CASES) {
            assertEqual(
                JSON.stringify(parseLibSecretsManifest(text)),
                JSON.stringify(parseSecretsManifest(text)),
                JSON.stringify(text),
            );
        }
    });

    it('rejects the same invalid manifests on the same line', () => {
        for (const text of INVALID_CASES) {
            const libError = catchError(() => parseLibSecretsManifest(text));
            const devkitError = catchError(() => parseSecretsManifest(text));

            assert(libError, `expected lib to reject ${ JSON.stringify(text) }`);
            assert(devkitError, `expected devkit to reject ${ JSON.stringify(text) }`);
            assertEqual(lineOf(libError), lineOf(devkitError), JSON.stringify(text));
        }
    });
});

function lineOf(error) {
    return /on line (\d+)/.exec(error.message)?.[1];
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
