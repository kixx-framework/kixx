/**
 * Hyperview's rendered-page cache on a real key/value store: entries are
 * written only when HYPERVIEW.usePageCache is on.
 *
 * The count comes from the test app's plugin, which reads the store's own
 * file. The test never opens it.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { assertEqual } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { publishTestAppContent } from '../test-helpers/publish.js';
import { copyBuild, removeDirectory, startLocalServer } from '../test-helpers/local-server.js';


// The prefix of every rendered-page cache key (kixx/hyperview/).
const PAGE_CACHE_PREFIX = 'hyperview_page_cache#';

const COUNT_PATHNAME = `/integration-probe/key-value-keys?prefix=${ encodeURIComponent(PAGE_CACHE_PREFIX) }`;

// The skeleton's config, with the page cache turned on.
const CONFIG_WITH_PAGE_CACHE = {
    name: 'kixx-app',
    environments: {
        production: {
            LOGGER: { level: 'INFO' },
            HYPERVIEW: { usePageCache: true },
        },
    },
};


describeOnTarget([ 'local' ], 'local: page cache', ({ it }) => {
    it('writes no page cache entry with the skeleton\'s config, where it is off', async () => {
        const server = await startLocalServer();

        try {
            await publishTestAppContent({}, { baseUrl: server.origin, deployKey: server.deployKey.key });

            assertEqual(200, await render(server, '/'));
            assertEqual(200, await render(server, '/about'));
            assertEqual(0, await countPageCacheKeys(server));
        } finally {
            await server.close();
        }
    });

    it('writes one entry for a page with HYPERVIEW.usePageCache on, and none for a second request', async () => {
        const projectDirectory = await copyBuild();
        let server = null;

        try {
            await fsp.writeFile(
                path.join(projectDirectory, 'node-config.jsonc'),
                `${ JSON.stringify(CONFIG_WITH_PAGE_CACHE, null, 4) }\n`,
            );

            server = await startLocalServer({ projectDirectory });

            await publishTestAppContent({}, { baseUrl: server.origin, deployKey: server.deployKey.key });

            assertEqual(0, await countPageCacheKeys(server));

            assertEqual(200, await render(server, '/'));
            assertEqual(1, await countPageCacheKeys(server));

            // A hit: the same key.
            assertEqual(200, await render(server, '/'));
            assertEqual(1, await countPageCacheKeys(server));

            assertEqual(200, await render(server, '/about'));
            assertEqual(2, await countPageCacheKeys(server));
        } finally {
            await server?.close();
            await removeDirectory(projectDirectory);
        }
    });
});


async function render(server, pathname) {
    const response = await server.fetch(pathname);

    await response.arrayBuffer();

    return response.status;
}

async function countPageCacheKeys(server) {
    const response = await server.fetch(COUNT_PATHNAME);
    const body = await response.json();

    assertEqual(200, response.status);

    return body.count;
}
