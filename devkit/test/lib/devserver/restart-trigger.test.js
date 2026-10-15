import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { isRestartTrigger } from '../../../lib/devserver/restart-trigger.js';


const TRIGGERS = [
    'node-server.js',
    'virtual-hosts.js',
    'node-environment.js',
    'app/foo.js',
    'routes/x.mjs',
    'plugins/a/lib/b.js',
    'kixx/static-assets/static-asset-request-handler.js',
    'app/presentation/forms/pages/put-page-metadata-form.js',
    'node-config.jsonc',
    '.env',
    '.env.development',
    '.env.development.secrets',
    'example.env.secrets',
    null,
    undefined,
    '',
];

const NON_TRIGGERS = [
    'pages/index.js',
    'templates/base/x.js',
    'static-assets/site.js',
    'public/a.js',
    'emails/x.js',
    'test/unit.test.js',
    'node_modules/x/index.js',
    'plugins/a/node_modules/b.js',
    '.git/hooks/x.js',
    '.kixx/config.json',
    'app/.cache/x.js',
    'app/readme.md',
    'templates/base/page.html',
    'cloudflare-config.jsonc',
    'example.env',
    'package.json',
    'deno.json',
];


describe('isRestartTrigger()', ({ it }) => {
    it('returns true for server code, config, and env files', () => {
        for (const path of TRIGGERS) {
            assertEqual(true, isRestartTrigger(path), String(path));
        }
    });

    it('returns false for excluded directories and other files', () => {
        for (const path of NON_TRIGGERS) {
            assertEqual(false, isRestartTrigger(path), path);
        }
    });

    it('treats Windows separators the same as forward slashes', () => {
        assertEqual(true, isRestartTrigger('app\\foo.js'));
        assertEqual(false, isRestartTrigger('pages\\x.js'));
        assertEqual(false, isRestartTrigger('plugins\\a\\node_modules\\b.js'));
    });
});
