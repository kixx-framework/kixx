import { describe } from 'kixx-test';
import { assertEqual, assertNotEqual } from 'kixx-assert';

import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import { buildDeveloperIndex } from '../../../../src/plugins/node-content-store/lib/developer-index.js';


function makeIdentity(filepath, mtimeMs, size) {
    return { filepath, mtimeMs, size };
}

describe('buildDeveloperIndex', ({ it }) => {
    it('builds a stable table accepted by ContentAddressableIndex', async () => {
        const manifest = new Map([
            [ '/pages/page.json', { kind: 'file', sources: [ makeIdentity('/source/page.json', 1, 12) ], manifests: [] } ],
            [ '/pages/__page-includes-bundle', { kind: 'includes', sources: [], manifests: [ makeIdentity('/source/page.json', 1, 12) ] } ],
        ]);

        const first = await buildDeveloperIndex(manifest);
        const second = await buildDeveloperIndex(manifest);
        const index = new ContentAddressableIndex(first);

        assertEqual(JSON.stringify(first), JSON.stringify(second));
        assertEqual('blob', index.getNode('/pages/page.json').kind);
        assertEqual(12, index.getNode('/pages/page.json').size);
        assertEqual(0, index.getNode('/pages/__page-includes-bundle').size);
    });

    it('changes only dependent blobs and their ancestor trees', async () => {
        const page = makeIdentity('/source/page.json', 1, 12);
        const asset = makeIdentity('/source/logo.svg', 1, 4);
        const original = new Map([
            [ '/pages/page.json', { kind: 'file', sources: [ page ], manifests: [] } ],
            [ '/pages/__page-includes-bundle', { kind: 'includes', sources: [], manifests: [ page ] } ],
            [ '/assets/logo.svg', { kind: 'file', sources: [ asset ], manifests: [] } ],
        ]);
        const changedPage = { ...page, mtimeMs: 2 };
        const changed = new Map([
            [ '/pages/page.json', { kind: 'file', sources: [ changedPage ], manifests: [] } ],
            [ '/pages/__page-includes-bundle', { kind: 'includes', sources: [], manifests: [ changedPage ] } ],
            [ '/assets/logo.svg', { kind: 'file', sources: [ asset ], manifests: [] } ],
        ]);

        const before = new ContentAddressableIndex(await buildDeveloperIndex(original));
        const after = new ContentAddressableIndex(await buildDeveloperIndex(changed));

        assertNotEqual(before.getNode('/').hash, after.getNode('/').hash);
        assertNotEqual(before.getNode('/pages').hash, after.getNode('/pages').hash);
        assertNotEqual(before.getNode('/pages/page.json').hash, after.getNode('/pages/page.json').hash);
        assertNotEqual(before.getNode('/pages/__page-includes-bundle').hash, after.getNode('/pages/__page-includes-bundle').hash);
        assertEqual(before.getNode('/assets').hash, after.getNode('/assets').hash);
        assertEqual(before.getNode('/assets/logo.svg').hash, after.getNode('/assets/logo.svg').hash);
    });
});
