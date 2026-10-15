import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import AppAssignBuildCommand from '../../../commands/app/assign-build.js';
import PublishingAPIClient from '../../../lib/publishing/publishing-api-client.js';
import captureOutput from '../../helpers/capture-output.js';

const ORIGIN = 'https://app.example.test';
const TOKEN = 'publishing-secret';
const ASSIGNMENT_ID = '4a2f7b2e-6d1c-4f0a-9b83-1c5d7e9a0f21';
const NEXT_ASSIGNMENT_ID = '8f3c1d40-52ab-4e19-8d77-6b0e2a4c9153';
const OTHER_ASSIGNMENT_ID = '1b2c3d4e-0000-4000-8000-000000000000';

const DISCOVERY = {
    data: {
        type: 'PublishingApi',
        id: 'v1',
        attributes: {
            runningBuildId: 'production',
            contentContractVersion: 1,
            addressingFormat: 4,
            buildAssignmentProtocolVersion: 2,
            limits: { maxObjectBytes: 26214400, maxObjectStatusIds: 100, maxManifestEntries: 10000 },
        },
    },
};


describe('app assign-build', ({ it }) => {

    it('makes a first assignment with a null precondition', async () => {
        const fetchMock = makeServer({
            getBuild: () => [ 404, { errors: [ { status: '404', code: 'BuildNotFound' } ] } ],
            putBuild: (body) => [ 200, buildDocument('next', body.data.attributes.releaseId, NEXT_ASSIGNMENT_ID) ],
        });
        const output = captureOutput();

        const code = await makeCommand(fetchMock, output).run({
            environment: 'production',
            'build-id': 'next',
            'release-id': 'release-a',
        });

        const put = fetchMock.calls.find((call) => call.method === 'PUT');

        assertEqual(0, code);
        assertEqual('GET /publishing-api/v1/,GET /publishing-api/v1/builds/next,PUT /publishing-api/v1/builds/next', fetchMock.summary());
        assertEqual(null, put.body.data.attributes.expectedAssignmentId);
        assertEqual('publish', put.body.data.attributes.reason);
        assertEqual(`Bearer ${ TOKEN }`, put.headers.authorization);
        assertEqual('application/vnd.api+json', put.headers['content-type']);
        assertMatches(`Assignment:  ${ NEXT_ASSIGNMENT_ID }`, output.chunks.join(''));
    });

    it('reassigns conditionally on the observed assignment id', async () => {
        const fetchMock = makeServer({
            getBuild: () => [ 200, buildDocument('production', 'release-a', ASSIGNMENT_ID) ],
            putBuild: (body) => [ 200, buildDocument('production', body.data.attributes.releaseId, NEXT_ASSIGNMENT_ID) ],
        });
        const output = captureOutput();

        await makeCommand(fetchMock, output).run({
            environment: 'production',
            'build-id': 'production',
            'release-id': 'release-b',
            reason: 'rollback',
        });

        const put = fetchMock.calls.find((call) => call.method === 'PUT');

        assertEqual(ASSIGNMENT_ID, put.body.data.attributes.expectedAssignmentId);
        assertEqual('release-b', put.body.data.attributes.releaseId);
        assertEqual('rollback', put.body.data.attributes.reason);
        assertMatches('Release:     release-b', output.chunks.join(''));
    });

    it('reports a 412 conflict with intended, expected, and current, and never retries', async () => {
        let reads = 0;
        const fetchMock = makeServer({
            getBuild: () => {
                reads += 1;
                return reads === 1
                    ? [ 200, buildDocument('production', 'release-a', ASSIGNMENT_ID) ]
                    : [ 200, buildDocument('production', 'release-z', OTHER_ASSIGNMENT_ID) ];
            },
            putBuild: () => [ 412, { errors: [ { status: '412', code: 'BuildPointerConflict' } ] } ],
        });

        const caught = await catchAsyncError(() => makeCommand(fetchMock).run({
            environment: 'production',
            'build-id': 'production',
            'release-id': 'release-b',
        }));

        const puts = fetchMock.calls.filter((call) => call.method === 'PUT');

        assertEqual('BuildPointerConflictError', caught?.name);
        assertEqual(1, puts.length);
        assertMatches('Intended:  Release release-b', caught.message);
        assertMatches(`Expected:  assignment ${ ASSIGNMENT_ID }`, caught.message);
        assertMatches(`Observed:  Release release-z, assignment ${ OTHER_ASSIGNMENT_ID }`, caught.message);
    });

    it('rejects an unknown --reason before any request', async () => {
        const fetchMock = makeServer({});

        const caught = await catchAsyncError(() => makeCommand(fetchMock).run({
            environment: 'production',
            'build-id': 'production',
            'release-id': 'release-b',
            reason: 'because',
        }));

        assertEqual('UsageError', caught?.name);
        assertMatches('publish, rollback, carry-forward, restore', caught.message);
        assertEqual(0, fetchMock.calls.length);
    });

    it('requires --build-id and --release-id', async () => {
        for (const missing of [ 'build-id', 'release-id' ]) {
            const options = { environment: 'production', 'build-id': 'b', 'release-id': 'r' };
            delete options[missing];

            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(() => makeCommand(makeServer({})).run(options));

            assertEqual('UsageError', caught?.name);
            assertMatches(`--${ missing }`, caught.message);
        }
    });

    it('reports an inactive publishing token as a usage error', async () => {
        const fetchMock = async () => response(403, {
            errors: [ { status: '403', code: 'PublishingApiTokenInactive', detail: 'inactive' } ],
        });
        fetchMock.calls = [];

        const caught = await catchAsyncError(() => makeCommand(fetchMock).run({
            environment: 'production',
            'build-id': 'b',
            'release-id': 'r',
        }));

        assert(caught, 'expected an error');
        assertEqual('PublishingApiTokenInactiveError', caught.name);
        assertMatches('kixx admin create-publishing-token', caught.message);
    });
});

function makeCommand(fetchMock, output = captureOutput()) {
    return new AppAssignBuildCommand({
        output,
        config: { app: { environments: { production: { origin: ORIGIN } } } },
        secrets: { app: { environments: { production: { publishingToken: TOKEN } } } },
        createClient: (options) => new PublishingAPIClient({ ...options, fetch: fetchMock, wait: async () => {} }),
    });
}

function makeServer(handlers) {
    const fetchMock = async (url, init) => {
        const body = init.body ? JSON.parse(init.body) : undefined;
        fetchMock.calls.push({ method: init.method, pathname: url.pathname, headers: init.headers, body });

        if (url.pathname === '/publishing-api/v1/') {
            return response(200, DISCOVERY);
        }

        const [ status, document ] = init.method === 'PUT'
            ? handlers.putBuild(body)
            : handlers.getBuild();

        return response(status, document);
    };

    fetchMock.calls = [];
    fetchMock.summary = () => fetchMock.calls.map((call) => `${ call.method } ${ call.pathname }`).join(',');

    return fetchMock;
}

function buildDocument(buildId, releaseId, assignmentId) {
    return {
        data: {
            type: 'Build',
            id: buildId,
            attributes: { releaseId, assignedAt: '2026-10-14T00:00:00.000Z', assignmentId },
        },
    };
}

function response(status, document) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(document);
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
