import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
    assertUndefined,
} from '../../../lib/vendor/kixx-assert/mod.js';

import PublishingAPIClient from '../../../lib/publishing/publishing-api-client.js';
import UsageError from '../../../lib/usage-error.js';

const ORIGIN = 'https://app.example.test';
const TOKEN = 'publishing-secret';
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

// Opaque to this client, but shaped like the server's version-4 UUIDs.
const ASSIGNMENT_ID = '4a2f7b2e-6d1c-4f0a-9b83-1c5d7e9a0f21';
const NEXT_ASSIGNMENT_ID = '8f3c1d40-52ab-4e19-8d77-6b0e2a4c9153';


describe('publishing/publishing-api-client', ({ it }) => {
    it('discovers publishing capabilities without making a write', async () => {
        const capabilities = {
            runningBuildId: 'production',
            contentContractVersion: 1,
            addressingFormat: 4,
            buildAssignmentProtocolVersion: 2,
            limits: {
                maxObjectBytes: 26_214_400,
                maxObjectStatusIds: 100,
                maxManifestEntries: 10_000,
            },
        };
        const fetchMock = makeRecordingFetch(() => makeResponse(200, {
            data: { type: 'PublishingApi', id: 'v1', attributes: capabilities },
        }));
        const client = makeClient(fetchMock);

        const result = await client.discover();

        assertEqual(JSON.stringify(capabilities), JSON.stringify(result));
        assertEqual('/publishing-api/v1/', fetchMock.calls[0].url.pathname);
        assertEqual('GET', fetchMock.calls[0].init.method);
        assertEqual(`Bearer ${ TOKEN }`, fetchMock.calls[0].init.headers.authorization);
    });

    it('issues one discovery request for repeated and concurrent callers', async () => {
        const fetchMock = makeRecordingFetch(() => makeResponse(200, {
            data: {
                type: 'PublishingApi',
                id: 'v1',
                attributes: { runningBuildId: 'production' },
            },
        }));
        const client = makeClient(fetchMock);

        const [ first, second ] = await Promise.all([ client.discover(), client.discover() ]);
        const third = await client.discover();

        assertEqual(1, fetchMock.calls.length);
        assertEqual('production', first.runningBuildId);
        assertEqual('production', second.runningBuildId);
        assertEqual('production', third.runningBuildId);
    });

    it('retries discovery after a failure instead of caching the rejection', async () => {
        let serverIsDown = true;
        const fetchMock = makeRecordingFetch(() => {
            if (serverIsDown) {
                return makeResponse(500, { errors: [ { status: '500' } ] });
            }
            return makeResponse(200, {
                data: {
                    type: 'PublishingApi',
                    id: 'v1',
                    attributes: { runningBuildId: 'production' },
                },
            });
        });
        const client = makeClient(fetchMock);

        // The first call exhausts the retry loop and rejects. The client must
        // not stay broken for the rest of the process.
        const caught = await catchAsyncError(() => client.discover());
        serverIsDown = false;
        const capabilities = await client.discover();

        assert(caught);
        assertEqual('production', capabilities.runningBuildId);
    });

    it('deduplicates and batches object status requests using the discovered limit', async () => {
        const requestedIds = Array.from({ length: 205 }, (_, index) => `object-${ index }`);
        const fetchMock = makeRecordingFetch((_url, init) => {
            const ids = JSON.parse(init.body).data.attributes.objectIds;
            return makeResponse(200, {
                data: ids
                    .filter((_id, index) => index % 2 === 0)
                    .reverse()
                    .map((id) => ({
                        type: 'Object',
                        id,
                        attributes: { size: id.length },
                    })),
            });
        });
        const client = makeClient(fetchMock);

        const stored = await client.getObjectStatus(
            [ ...requestedIds, 'object-0', 'object-100' ],
            { maxObjectStatusIds: 100 },
        );

        assertEqual(3, fetchMock.calls.length);
        assertEqual('100,100,5', fetchMock.calls.map((call) => {
            return JSON.parse(call.init.body).data.attributes.objectIds.length;
        }).join(','));
        assertEqual(103, stored.length);
        const storedIds = new Set(stored.map(({ objectId }) => objectId));
        assert(storedIds.has('object-0'));
        assert(storedIds.has('object-204'));
        assert(!storedIds.has('object-1'));

        const sentIds = fetchMock.calls.flatMap((call) => {
            assertEqual('/publishing-api/v1/objects/status', call.url.pathname);
            assertEqual('POST', call.init.method);
            assertEqual(JSON_API_CONTENT_TYPE, call.init.headers['content-type']);
            return JSON.parse(call.init.body).data.attributes.objectIds;
        });
        assertEqual(205, new Set(sentIds).size);
    });

    it('returns an empty status without sending an empty request', async () => {
        const fetchMock = makeRecordingFetch();
        const client = makeClient(fetchMock);

        const stored = await client.getObjectStatus([], { maxObjectStatusIds: 100 });

        assertEqual(0, stored.length);
        assertEqual(0, fetchMock.calls.length);
    });

    it('uploads raw bytes and distinguishes created from already present', async () => {
        const statuses = [ 201, 200 ];
        const fetchMock = makeRecordingFetch((url, init) => makeResponse(statuses.shift(), {
            data: {
                type: 'Object',
                id: decodeURIComponent(url.pathname.split('/').at(-1)),
                attributes: { size: init.body.byteLength },
            },
        }));
        const client = makeClient(fetchMock);
        const binary = Uint8Array.from([ 1, 2, 3 ]).buffer;

        const created = await client.uploadObject('text/id', 'hello', { maxObjectBytes: 5 });
        const present = await client.uploadObject('binary-id', binary, { maxObjectBytes: 3 });

        assertEqual('text/id', created.objectId);
        assertEqual(5, created.size);
        assertEqual(true, created.created);
        assertEqual(false, present.created);
        // Byte buffers, never strings or streams, so fetch sets Content-Length.
        assert(fetchMock.calls[0].init.body instanceof Uint8Array, 'text body is not a Uint8Array');
        assert(fetchMock.calls[1].init.body instanceof Uint8Array, 'binary body is not a Uint8Array');
        assertEqual('1,2,3', Array.from(fetchMock.calls[1].init.body).join(','));
        assertEqual('PUT', fetchMock.calls[0].init.method);
        assertEqual(`Bearer ${ TOKEN }`, fetchMock.calls[0].init.headers.authorization);
        assertUndefined(fetchMock.calls[0].init.headers['content-type']);
        assertEqual('/publishing-api/v1/objects/text%2Fid', fetchMock.calls[0].url.pathname);
    });

    it('rejects an oversized object before sending a request', async () => {
        const fetchMock = makeRecordingFetch();
        const client = makeClient(fetchMock);

        const caught = await catchAsyncError(() => {
            return client.uploadObject('object-id', 'hello', { maxObjectBytes: 4 });
        });

        assert(caught, 'expected an error to be thrown');
        assertMatches('5 bytes', caught.message);
        assertMatches('4 bytes', caught.message);
        assertEqual(0, fetchMock.calls.length);
    });

    it('retries 429 and 503 responses before succeeding', async () => {
        const statuses = [ 429, 503, 201 ];
        const waits = [];
        const client = makeClient(async () => makeObjectResponse(statuses.shift()), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.5,
        });

        const result = await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(true, result.created);
        assertEqual(2, waits.length);
        // 429 keeps the fast backoff; a bare 503 backs off from 1 s.
        assertEqual(100, waits[0]);
        assertEqual(2000, waits[1]);
    });

    it('waits for a Retry-After delay plus jitter on a 503', async () => {
        const responses = [
            makeResponse(503, { errors: [] }, { 'retry-after': '5' }),
            makeObjectResponse(201),
        ];
        const waits = [];
        const client = makeClient(async () => responses.shift(), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.25,
        });

        const result = await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(true, result.created);
        assertEqual(1, waits.length);
        assertEqual(5000 + (0.25 * 1000), waits[0]);
    });

    it('caps a long Retry-After delay at 30 seconds', async () => {
        const responses = [
            makeResponse(503, { errors: [] }, { 'retry-after': '120' }),
            makeObjectResponse(201),
        ];
        const waits = [];
        const client = makeClient(async () => responses.shift(), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.25,
        });

        await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(30000 + (0.25 * 1000), waits[0]);
    });

    it('honors an HTTP-date Retry-After using the injected clock', async () => {
        const nowMs = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
        const responses = [
            makeResponse(503, { errors: [] }, { 'retry-after': 'Wed, 21 Oct 2026 07:28:03 GMT' }),
            makeObjectResponse(201),
        ];
        const waits = [];
        const client = makeClient(async () => responses.shift(), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0,
            now: () => nowMs,
        });

        await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(3000, waits[0]);
    });

    it('honors Retry-After on a 429', async () => {
        const responses = [
            makeResponse(429, { errors: [] }, { 'retry-after': '2' }),
            makeObjectResponse(201),
        ];
        const waits = [];
        const client = makeClient(async () => responses.shift(), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.25,
        });

        await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(2000 + (0.25 * 1000), waits[0]);
    });

    it('backs off from one second on a bare 503', async () => {
        const waits = [];
        const client = makeClient(async () => makeResponse(503, { errors: [] }), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.25,
        });

        const caught = await catchAsyncError(() => client.discover());

        assertEqual(JSON.stringify([ 750, 1500, 3000 ]), JSON.stringify(waits));
        assertEqual(503, caught.status);
        assertEqual(4, caught.attempts);
    });

    it('falls back to the 503 backoff when Retry-After is invalid', async () => {
        const responses = [
            makeResponse(503, { errors: [] }, { 'retry-after': 'soon' }),
            makeObjectResponse(201),
        ];
        const waits = [];
        const client = makeClient(async () => responses.shift(), {
            wait: async (milliseconds) => waits.push(milliseconds),
            random: () => 0.25,
        });

        await client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });

        assertEqual(750, waits[0]);
    });

    it('keeps the fast backoff for 500 responses and network failures', async () => {
        const serverWaits = [];
        const serverClient = makeClient(async () => makeResponse(500, { errors: [] }), {
            wait: async (milliseconds) => serverWaits.push(milliseconds),
            random: () => 0.25,
        });
        const networkWaits = [];
        const networkClient = makeClient(async () => {
            throw new Error('connection reset');
        }, {
            wait: async (milliseconds) => networkWaits.push(milliseconds),
            random: () => 0.25,
        });

        await catchAsyncError(() => serverClient.discover());
        await catchAsyncError(() => networkClient.discover());

        assertEqual(JSON.stringify([ 75, 150, 300 ]), JSON.stringify(serverWaits));
        assertEqual(JSON.stringify([ 75, 150, 300 ]), JSON.stringify(networkWaits));
    });

    it('reports serverOverloaded after any 503, and only a 503', async () => {
        const responses = [ makeResponse(503, { errors: [] }), makeObjectResponse(201) ];
        const recovered = makeClient(async () => responses.shift());

        assertEqual(false, recovered.serverOverloaded);
        await recovered.uploadObject('object-id', 'x', { maxObjectBytes: 1 });
        assertEqual(true, recovered.serverOverloaded);

        const assignFetch = makeRecordingFetch(() => makeResponse(503, { errors: [] }));
        const assignClient = makeClient(assignFetch);
        await catchAsyncError(() => {
            return assignClient.assignBuild('production', 'release-id', { expectedAssignmentId: null });
        });
        assertEqual(1, assignFetch.calls.length);
        assertEqual(true, assignClient.serverOverloaded);

        for (const responder of [
            async () => makeResponse(429, { errors: [] }),
            async () => makeResponse(500, { errors: [] }),
            async () => {
                throw new Error('connection reset');
            },
        ]) {
            const client = makeClient(responder);
            await catchAsyncError(() => client.discover());
            assertEqual(false, client.serverOverloaded);
        }
    });

    it('requires now to be a function', () => {
        let caught = null;
        try {
            makeClient(async () => makeObjectResponse(200), { now: 1 });
        } catch (error) {
            caught = error;
        }

        assert(caught, 'expected an error to be thrown');
        assertMatches('now function', caught.message);
    });

    it('raises after the fourth retryable response', async () => {
        let callCount = 0;
        const client = makeClient(async () => {
            callCount += 1;
            return makeResponse(503, { errors: [ { status: '503', detail: 'Unavailable' } ] });
        });

        const caught = await catchAsyncError(() => client.discover());

        assert(caught, 'expected an error to be thrown');
        assertEqual('PublishingApiError', caught.name);
        assertEqual(503, caught.status);
        assertEqual(4, caught.attempts);
        assertEqual(4, callCount);
    });

    it('retries network failures without exposing their text', async () => {
        let callCount = 0;
        const client = makeClient(async () => {
            callCount += 1;
            throw new Error(`network rejected ${ TOKEN }`);
        });

        const caught = await catchAsyncError(() => client.discover());

        assertEqual(4, callCount);
        assertEqual(null, caught.status);
        assertEqual(4, caught.attempts);
        assertNotMatches(TOKEN, caught.message);
        assertEqual(undefined, caught.cause);
    });

    it('raises immediately for object protocol errors', async () => {
        for (const [ status, code ] of [
            [ 413, 'PAYLOAD_TOO_LARGE_ERROR' ],
            [ 422, 'ObjectIdMismatch' ],
            [ 422, 'ObjectIdInvalid' ],
        ]) {
            let callCount = 0;
            const client = makeClient(async () => {
                callCount += 1;
                return makeResponse(status, {
                    errors: [ { status: String(status), code, detail: `Rejected ${ code }` } ],
                });
            });

            const caught = await catchAsyncError(() => {
                return client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });
            });

            assertEqual(1, callCount);
            assertEqual(status, caught.status);
            assertEqual(code, caught.errors[0].code);
            assertMatches(`code ${ code }`, caught.message);
        }
    });

    it('turns 401 and 403 into publishing-token instructions', async () => {
        for (const status of [ 401, 403 ]) {
            const client = makeClient(async () => makeResponse(status, { errors: [] }));

            const caught = await catchAsyncError(() => client.discover());

            assertMatches('.kixx/secrets.json', caught.message);
            assertMatches('app.environments.<environment>.publishingToken', caught.message);
        }
    });

    it('redacts the token from response text and structured errors', async () => {
        const client = makeClient(async () => makeResponse(422, {
            errors: [
                { status: '422', code: 'echo', detail: `Rejected ${ TOKEN }` },
            ],
        }));

        const caught = await catchAsyncError(() => {
            return client.uploadObject('object-id', 'x', { maxObjectBytes: 1 });
        });

        assertNotMatches(TOKEN, caught.message);
        assertNotMatches(TOKEN, JSON.stringify(caught.errors));
        assertMatches('[redacted]', caught.message);
    });

    it('creates byte-identical Releases without an idempotency key', async () => {
        const release = {
            type: 'Release',
            id: 'release-id',
            attributes: { objectCount: 2, totalBytes: 12, contractVersion: 1 },
        };
        const fetchMock = makeRecordingFetch(() => makeResponse(201, { data: release }));
        const client = makeClient(fetchMock);
        const manifest = { staticAssets: {}, pages: {}, emails: {} };

        const first = await client.createRelease(manifest, { client: 'devkit' });
        const second = await client.createRelease(manifest, { client: 'devkit' });

        assertEqual('release-id', first.releaseId);
        assertEqual('release-id', second.releaseId);
        assertEqual(2, first.objectCount);
        for (const call of fetchMock.calls) {
            assertEqual('POST', call.init.method);
            assertEqual('/publishing-api/v1/releases', call.url.pathname);
            assertUndefined(call.init.headers['idempotency-key']);
            const resource = JSON.parse(call.init.body).data;
            assertEqual('Release', resource.type);
            assertEqual(JSON.stringify(manifest), JSON.stringify(resource.attributes.manifest));
        }
    });

    it('gets a build with its opaque assignment identity', async () => {
        const fetchMock = makeRecordingFetch(() => makeResponse(200, {
            data: {
                type: 'Build',
                id: 'production',
                attributes: {
                    releaseId: 'release-id',
                    assignedAt: '2026-09-01T00:00:00.000Z',
                    assignmentId: ASSIGNMENT_ID,
                },
            },
        }));
        const client = makeClient(fetchMock);

        const build = await client.getBuild('build/id');

        assertEqual('GET', fetchMock.calls[0].init.method);
        assertEqual('/publishing-api/v1/builds/build%2Fid', fetchMock.calls[0].url.pathname);
        assertEqual(`Bearer ${ TOKEN }`, fetchMock.calls[0].init.headers.authorization);
        assertEqual('production', build.buildId);
        assertEqual('release-id', build.releaseId);
        assertEqual('2026-09-01T00:00:00.000Z', build.assignedAt);

        // The identity travels in the body alone; protocol 2 removed the
        // Build ETag, and nothing may fall back to a response header.
        assertEqual(ASSIGNMENT_ID, build.assignmentId);
        assertUndefined(build.etag);
    });

    it('sends the Bearer token and JSON:API media type on JSON writes', async () => {
        const fetchMock = makeRecordingFetch((url) => {
            return url.pathname.endsWith('/status')
                ? makeResponse(200, { data: [] })
                : makeResponse(201, { data: { type: 'Release', id: 'r', attributes: {} } });
        });
        const client = makeClient(fetchMock);

        await client.getObjectStatus([ 'a' ], { maxObjectStatusIds: 10 });
        await client.createRelease({ staticAssets: {}, pages: {}, emails: {} });

        for (const call of fetchMock.calls) {
            assertEqual('POST', call.init.method);
            assertEqual(`Bearer ${ TOKEN }`, call.init.headers.authorization);
            assertEqual(JSON_API_CONTENT_TYPE, call.init.headers['content-type']);
        }

        assertEqual('/publishing-api/v1/objects/status', fetchMock.calls[0].url.pathname);
        assertEqual('ObjectStatus', JSON.parse(fetchMock.calls[0].init.body).data.type);
        assertEqual('/publishing-api/v1/releases', fetchMock.calls[1].url.pathname);
        assertUndefined(JSON.parse(fetchMock.calls[1].init.body).data.attributes.provenance);
    });

    it('turns PublishingApiTokenInactive into a usage error naming create-publishing-token', async () => {
        const client = makeClient(async () => makeResponse(403, {
            errors: [ { status: '403', code: 'PublishingApiTokenInactive', detail: `Token ${ TOKEN } inactive` } ],
        }));

        const caught = await catchAsyncError(() => client.discover());

        assertEqual('PublishingApiTokenInactiveError', caught.name);
        assert(caught instanceof UsageError, 'expected a UsageError');
        assertEqual(403, caught.status);
        assertMatches('expired or revoked', caught.message);
        assertMatches('kixx admin create-publishing-token', caught.message);
        assertNotMatches(TOKEN, caught.message);
    });

    it('sends the observed assignment identity as the JSON precondition', async () => {
        const fetchMock = makeRecordingFetch(() => makeResponse(200, {
            data: {
                type: 'Build',
                id: 'production',
                attributes: {
                    releaseId: 'new-release',
                    assignedAt: 'now',
                    assignmentId: NEXT_ASSIGNMENT_ID,
                },
            },
        }));
        const client = makeClient(fetchMock);

        const assigned = await client.assignBuild('production', 'new-release', {
            expectedAssignmentId: ASSIGNMENT_ID,
            reason: 'rollback',
        });

        assertEqual('new-release', assigned.releaseId);

        // The response carries the identity the next write must quote.
        assertEqual(NEXT_ASSIGNMENT_ID, assigned.assignmentId);

        const { init } = fetchMock.calls[0];
        assertEqual('PUT', init.method);
        assertEqual(JSON_API_CONTENT_TYPE, init.headers['content-type']);
        assertUndefined(init.headers['if-match']);
        assertUndefined(init.headers['if-none-match']);

        const resource = JSON.parse(init.body).data;
        assertEqual('Build', resource.type);
        assertEqual('production', resource.id);
        assertEqual('new-release', resource.attributes.releaseId);
        assertEqual(ASSIGNMENT_ID, resource.attributes.expectedAssignmentId);
        assertEqual('rollback', resource.attributes.reason);
    });

    it('serializes a never-assigned precondition as JSON null', async () => {
        const fetchMock = makeRecordingFetch(() => makeResponse(200, {
            data: {
                type: 'Build',
                id: 'next',
                attributes: { releaseId: 'release-id', assignmentId: ASSIGNMENT_ID },
            },
        }));
        const client = makeClient(fetchMock);

        await client.assignBuild('next', 'release-id', { expectedAssignmentId: null });

        const { attributes } = JSON.parse(fetchMock.calls[0].init.body).data;

        // Omitting the field is 428, so null must survive serialization.
        assert(Object.hasOwn(attributes, 'expectedAssignmentId'));
        assertEqual(null, attributes.expectedAssignmentId);
        assertEqual('publish', attributes.reason);
    });

    it('rejects an omitted or malformed precondition locally', async () => {
        const fetchMock = makeRecordingFetch();
        const client = makeClient(fetchMock);

        const omitted = await catchAsyncError(() => {
            return client.assignBuild('build-id', 'release-id', {});
        });
        const noOptions = await catchAsyncError(() => {
            return client.assignBuild('build-id', 'release-id');
        });
        const empty = await catchAsyncError(() => {
            return client.assignBuild('build-id', 'release-id', { expectedAssignmentId: '' });
        });

        assertMatches('requires expectedAssignmentId', omitted.message);
        assertMatches('requires expectedAssignmentId', noOptions.message);
        assertMatches('requires expectedAssignmentId', empty.message);
        assertEqual(0, fetchMock.calls.length);
    });

    it('attempts a build assignment exactly once', async () => {
        // Protocol 2 has no idempotent retry: a resend after a lost response
        // fails its precondition even though the first attempt committed.
        const retryableFetch = makeRecordingFetch(() => makeResponse(503, {
            errors: [ { status: '503' } ],
        }));
        const retryableClient = makeClient(retryableFetch);

        const serverFailure = await catchAsyncError(() => {
            return retryableClient.assignBuild('production', 'release-id', {
                expectedAssignmentId: ASSIGNMENT_ID,
            });
        });

        const networkFetch = makeRecordingFetch(() => {
            throw new Error('connection reset');
        });
        const networkClient = makeClient(networkFetch);

        const networkFailure = await catchAsyncError(() => {
            return networkClient.assignBuild('production', 'release-id', {
                expectedAssignmentId: null,
            });
        });

        assertEqual(1, retryableFetch.calls.length);
        assertEqual(503, serverFailure.status);
        assertEqual(1, serverFailure.attempts);
        assertEqual(1, networkFetch.calls.length);
        assertEqual(null, networkFailure.status);
        assertEqual(1, networkFailure.attempts);
    });

    it('surfaces build protocol failures as distinct error classes', async () => {
        for (const [ status, code, expectedName ] of [
            [ 404, 'BuildNotFound', 'BuildNotFoundError' ],
            [ 404, 'ReleaseNotFound', 'ReleaseNotFoundError' ],
            [ 412, 'BuildPointerConflict', 'BuildPointerConflictError' ],
            [ 422, 'InvalidBuildAssignment', 'InvalidBuildAssignmentError' ],
            [ 428, 'PreconditionRequired', 'PreconditionRequiredError' ],
        ]) {
            const client = makeClient(async () => makeResponse(status, {
                errors: [ { status: String(status), code, detail: code } ],
            }));

            const caught = await catchAsyncError(() => {
                return client.assignBuild('build-id', 'release-id', {
                    expectedAssignmentId: null,
                });
            });

            assertEqual(expectedName, caught.name);
            assertEqual(status, caught.status);
            assertEqual(1, caught.attempts);
        }
    });
});

function makeClient(fetchImpl, options) {
    return new PublishingAPIClient({
        origin: ORIGIN,
        token: TOKEN,
        fetch: fetchImpl,
        wait: async () => {},
        random: () => 0,
        ...options,
    });
}

function makeRecordingFetch(responder = () => makeObjectResponse(200)) {
    const fetchMock = async (url, init) => {
        fetchMock.calls.push({ url, init });
        return await responder(url, init);
    };
    fetchMock.calls = [];
    return fetchMock;
}

function makeObjectResponse(status) {
    return makeResponse(status, {
        data: {
            type: 'Object',
            id: 'object-id',
            attributes: { size: 1 },
        },
    });
}

function makeResponse(status, document, headers) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return headers?.[name.toLowerCase()] ?? null;
            },
        },
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
