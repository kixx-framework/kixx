import { describe } from 'kixx-test';
import { assert, assertEqual, isNonEmptyString } from '../../lib/vendor/kixx-assert/mod.js';
import denoManifest from '../../deno.json' with { type: 'json' };
import npmManifest from '../../package.json' with { type: 'json' };
// Conformance tests may read the rest of the repository. Core, plugins, and
// the CLI share one version (D32), and the devkit's test and lint tools are
// installed from the root package.json.
import coreManifest from '../../../kixx/plugin.json' with { type: 'json' };
import rootManifest from '../../../package.json' with { type: 'json' };


describe('versions conformance with the repository', ({ it }) => {

    it('gives the CLI the version of core on npm and JSR', () => {
        assert(isNonEmptyString(coreManifest.version), 'kixx/plugin.json version');
        assertEqual(coreManifest.version, npmManifest.version, 'devkit/package.json version');
        assertEqual(coreManifest.version, denoManifest.version, 'devkit/deno.json version');
    });

    // The devkit has no node_modules/ of its own, so its runners resolve
    // these packages from the root's. A different version here would name a
    // tool the suite never ran with.
    it('pins every devkit devDependency to the root version', () => {
        const names = Object.keys(npmManifest.devDependencies ?? {});

        assert(names.length > 0, 'devkit/package.json has devDependencies');

        for (const name of names) {
            assertEqual(
                rootManifest.devDependencies?.[name],
                npmManifest.devDependencies[name],
                `devkit/package.json devDependencies["${ name }"]`,
            );
        }
    });
});
