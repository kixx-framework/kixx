import { describe } from 'kixx-test';
import { assert, assertEqual, isNonEmptyString } from '../lib/vendor/kixx-assert/mod.js';
import denoManifest from '../deno.json' with { type: 'json' };
import npmManifest from '../package.json' with { type: 'json' };


describe('package manifests', ({ it }) => {

    it('publish the same version to npm and JSR', () => {
        assert(isNonEmptyString(denoManifest.version), 'deno.json version');
        assertEqual(denoManifest.version, npmManifest.version, 'package.json version');
    });

    it('install the kixx executable from kixx.js on both registries', () => {
        assertEqual('./kixx.js', npmManifest.bin?.kixx, 'package.json bin.kixx');
        assertEqual('./kixx.js', denoManifest.exports?.['./kixx'], 'deno.json exports["./kixx"]');
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
