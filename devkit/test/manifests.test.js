import { describe } from 'kixx-test';
import { assert, assertEqual, isNonEmptyString } from '../lib/vendor/kixx-assert/mod.js';
import denoManifest from '../deno.json' with { type: 'json' };
import npmManifest from '../package.json' with { type: 'json' };


describe('package manifests', ({ it }) => {

    it('publish the same version to npm and JSR', () => {
        assert(isNonEmptyString(denoManifest.version), 'deno.json version');
        assertEqual(denoManifest.version, npmManifest.version, 'package.json version');
    });

    it('install the kixx-dev executable from kixx-dev.js on both registries', () => {
        assertEqual('kixx-dev', npmManifest.name, 'package.json name');
        assertEqual('@kixx/dev', denoManifest.name, 'deno.json name');
        assertEqual('./kixx-dev.js', npmManifest.bin?.['kixx-dev'], 'package.json bin["kixx-dev"]');
        assertEqual(1, Object.keys(npmManifest.bin ?? {}).length, 'package.json bin has one executable');
        // The default export is what `deno run jsr:@kixx/dev` resolves.
        assertEqual('./kixx-dev.js', denoManifest.exports?.['.'], 'deno.json exports["."]');
    });

    it('ship the entry point in both published file lists', () => {
        assert(npmManifest.files?.includes('kixx-dev.js'), 'package.json files has kixx-dev.js');
        assert(denoManifest.publish?.include?.includes('kixx-dev.js'), 'deno.json publish.include has kixx-dev.js');
        // --version reads deno.json, so npm must ship it too.
        assert(npmManifest.files?.includes('deno.json'), 'package.json files has deno.json');
    });

    // Third-party runtime code is vendored under lib/vendor/. Dev tools come
    // from package.json devDependencies on both runtimes.
    it('declare no runtime dependencies', () => {
        assertEqual(undefined, npmManifest.dependencies, 'package.json dependencies');
        assertEqual(undefined, denoManifest.imports, 'deno.json imports');
    });

    it('leave tests out of both published file lists', () => {
        const npmFiles = npmManifest.files ?? [];
        const denoIncludes = denoManifest.publish?.include ?? [];
        const denoExcludes = denoManifest.publish?.exclude ?? [];

        assert(npmFiles.length > 0, 'package.json files is set');
        assert(!npmFiles.some(isTestPath), 'package.json files includes test/');
        assert(!denoIncludes.some(isTestPath), 'deno.json publish.include includes test/');
        assert(denoExcludes.includes('test/'), 'deno.json publish.exclude has test/');
    });
});


function isTestPath(entry) {
    return /^(?:\.\/)?test(?:\/|$)/.test(entry);
}
