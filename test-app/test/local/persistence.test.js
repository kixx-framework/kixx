/**
 * Published content outlasts a restart: a second server process over the
 * same data directory, running the same build, serves what the first took.
 */
import { assertEqual, assertMatches } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { publishTestAppContent } from '../test-helpers/publish.js';
import { makeTemporaryDirectory, removeDirectory, startLocalServer, tail } from '../test-helpers/local-server.js';


describeOnTarget([ 'local' ], 'local: persistence', ({ it }) => {
    it('renders a published page after a restart on the same data directory', async () => {
        const dataDirectory = await makeTemporaryDirectory();
        let first = null;
        let second = null;

        try {
            first = await startLocalServer({ dataDirectory });

            const published = await publishTestAppContent({}, { baseUrl: first.origin, deployKey: first.deployKey.key });

            assertEqual('prestage', published.intent);
            assertEqual(first.buildId, published.buildId);

            const before = await first.fetch('/');

            assertEqual(200, before.status);
            assertMatches('<h1>Welcome to Kixx</h1>', await before.text());

            const exit = await first.close();

            assertEqual(0, exit.code, tail(exit.output));

            second = await startLocalServer({
                dataDirectory,
                buildId: first.buildId,
                deployKey: first.deployKey,
            });

            const after = await second.fetch('/');

            assertEqual(200, after.status);
            assertMatches('<h1>Welcome to Kixx</h1>', await after.text());

            // The assignment is there too, not only the objects.
            const build = await second.fetch(`/publishing-api/v1/builds/${ encodeURIComponent(first.buildId) }`);
            const document = await build.json();

            assertEqual(200, build.status);
            assertEqual(published.assignmentId, document.data.attributes.assignmentId);
        } finally {
            await first?.close();
            await second?.close();
            await removeDirectory(dataDirectory);
        }
    });
});
