/**
 * A real server process outside development with no BUILD_ID (OP-B): it
 * boots, answers 503 for pages, and keeps running.
 */
import { assertEqual } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { startLocalServer, tail } from '../test-helpers/local-server.js';


describeOnTarget([ 'local' ], 'local: no BUILD_ID', ({ it }) => {
    it('answers 503 for a page twice, still answers discovery, and exits 0 when stopped', async () => {
        const server = await startLocalServer({ buildId: null });

        try {
            for (const attempt of [ 'first', 'second' ]) {
                // eslint-disable-next-line no-await-in-loop
                const page = await server.fetch('/');

                // eslint-disable-next-line no-await-in-loop
                const body = await page.json();

                assertEqual(503, page.status, `the ${ attempt } page request`);
                assertEqual('BuildNotServable', body.errors[0].code, `the ${ attempt } page request`);
            }

            const discovery = await server.fetch('/publishing-api/v1/');
            const document = await discovery.json();

            assertEqual(200, discovery.status);
            assertEqual(null, document.data.attributes.runningBuildId);

            // Still up after all of it.
            const environment = await server.fetch('/integration-probe/environment');
            const answered = await environment.json();

            assertEqual(200, environment.status);
            assertEqual(null, answered.buildId);

            const exit = await server.close();

            assertEqual(0, exit.code, tail(exit.output));
        } finally {
            await server.close();
        }
    });
});
