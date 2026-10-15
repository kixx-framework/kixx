import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { parseJsonc } from '../../lib/parse-jsonc.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit accepts
// exactly what the application accepts.
import { parseJsonc as parseLibJsonc } from '../../../lib/kixx/config/parse-jsonc.js';


const LIB_CONFIG_FILES = [
    new URL('../../../lib/cloudflare-config.jsonc', import.meta.url),
    new URL('../../../lib/node-config.jsonc', import.meta.url),
];

const EDGE_CASES = [
    '{"a": [1, 2, ], "b": {"c": 3, /* x */ }, }',
    '{"url": "https://example.com/*x*/", "list": "a,]", "quote": "say \\"//hi\\""}',
    '{\r\n    "a": 1, // comment\r\n    "b": 2,\r\n}',
    '// only a comment\n[ "x", ]',
];

const INVALID_CASES = [
    '[1,,]',
    '{"a": 1 /* never closed',
    '{a: 1}',
    '{"a": \'x\'}',
];


describe('parseJsonc conformance with lib', ({ it }) => {

    it('parses the repo lib config files identically', async () => {
        for (const url of LIB_CONFIG_FILES) {
            // eslint-disable-next-line no-await-in-loop
            const source = await fsp.readFile(url, 'utf8');

            assertEqual(
                JSON.stringify(parseLibJsonc(source)),
                JSON.stringify(parseJsonc(source)),
                url.pathname,
            );
        }
    });

    it('parses dialect edge cases identically', () => {
        for (const source of EDGE_CASES) {
            assertEqual(JSON.stringify(parseLibJsonc(source)), JSON.stringify(parseJsonc(source)), source);
        }
    });

    it('rejects the same invalid sources', () => {
        for (const source of INVALID_CASES) {
            assert(throws(() => parseLibJsonc(source)), `lib accepts ${ source }`);
            assert(throws(() => parseJsonc(source)), `devkit accepts ${ source }`);
        }
    });
});


function throws(fn) {
    try {
        fn();
    } catch {
        return true;
    }
    return false;
}
