import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ConflictError, NotFoundError } from '../../../../../../src/kixx/errors/mod.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { getBuild, listBuilds, putBuild } from '../../../../../../src/app/presentation/request-handlers/publishing-api/builds.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';

const RELEASE_ID = 'a'.repeat(26);
const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000001';
const NEXT_ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000002';

function makeRequest(attributes = {}, headers = {}) {
    return {
        pathnameParams: { buildId: 'future-build' },
        headers: new Headers(headers),
        getContentMediaType: () => JSON_API_CONTENT_TYPE,
        json: async () => ({
            data: {
                type: 'Build',
                id: 'future-build',
                attributes: { releaseId: RELEASE_ID, reason: 'publish', ...attributes },
            },
        }),
    };
}

function makeContext(assignImplementation) {
    const assignments = [];
    const appends = [];
    const pointer = { rootHash: RELEASE_ID, assignedAt: '2020-01-01T00:00:00.000Z', assignmentId: ASSIGNMENT_ID };
    const store = {
        getBuildPointer: async () => pointer,
        listBuilds: async () => [ { buildId: 'future-build', ...pointer, metadata: { private: 'value' } } ],
        async assignRelease(_context, _buildId, assignment) {
            assignments.push(assignment);
            if (assignImplementation) {
                return await assignImplementation(assignment);
            }
            return {
                buildId: 'future-build',
                releaseId: RELEASE_ID,
                assignedAt: '2026-09-01T13:00:00.000Z',
                assignmentId: NEXT_ASSIGNMENT_ID,
                isChanged: true,
                previousReleaseId: 'release-old',
            };
        },
    };
    return {
        assignments,
        appends,
        store,
        user: { id: 'token-1' },
        getService: () => store,
        getCollection: () => ({ append: async (_context, attributes) => appends.push(attributes) }),
        logger: { error() {} },
    };
}

async function catchError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('Publishing API builds', ({ it }) => {
    it('requires a JSON precondition even when legacy headers are present', async () => {
        for (const headers of [ {}, { 'if-match': `"${ RELEASE_ID }"` }, { 'if-none-match': '*' } ]) {
            const context = makeContext();
            const error = await catchError(() => putBuild(context, makeRequest({}, headers), new ServerResponse()));
            assertEqual(428, error.httpStatusCode);
            assertEqual('PreconditionRequired', error.code);
            assertEqual(0, context.assignments.length);
        }
    });

    it('reports malformed tokens as field validation errors before any write', async () => {
        for (const expectedAssignmentId of [ undefined, '', RELEASE_ID, 42, false, {}, [], ` ${ ASSIGNMENT_ID } ` ]) {
            const context = makeContext();
            const error = await catchError(() => putBuild(context, makeRequest({ expectedAssignmentId }), new ServerResponse()));
            assertEqual(422, error.httpStatusCode);
            assertEqual('InvalidBuildAssignment', error.code);
            assert(error.errors.some((item) => item.source === 'attributes.expectedAssignmentId'));
            assertEqual(0, context.assignments.length);
        }
    });

    it('rejects either legacy header when a valid JSON precondition is present', async () => {
        for (const headers of [ { 'if-match': `"${ ASSIGNMENT_ID }"` }, { 'if-none-match': '*' },
            { 'if-match': '' }, { 'if-none-match': '' }, { 'if-match': 'bad', 'if-none-match': '*' } ]) {
            const context = makeContext();
            const error = await catchError(() => putBuild(context, makeRequest({ expectedAssignmentId: null }, headers), new ServerResponse()));
            assertEqual(400, error.httpStatusCode);
            assert(error.message.includes('JSON attributes.expectedAssignmentId'));
            assertEqual(0, context.assignments.length);
        }
    });

    it('preserves validation of the resource id, Release and reason', async () => {
        const request = makeRequest({ releaseId: 'bad', reason: 'bad', expectedAssignmentId: null });
        request.pathnameParams.buildId = 'different-build';
        const context = makeContext();
        const error = await catchError(() => putBuild(context, request, new ServerResponse()));
        assertEqual('InvalidBuildAssignment', error.code);
        assertEqual(3, error.errors.length);
        assertEqual(0, context.assignments.length);
    });

    it('passes explicit null for a first assignment and returns its identity', async () => {
        const context = makeContext();
        const response = await putBuild(context, makeRequest({ expectedAssignmentId: null }), new ServerResponse());
        assertEqual(null, context.assignments[0].expectedAssignmentId);
        assertEqual(NEXT_ASSIGNMENT_ID, JSON.parse(response.body).data.attributes.assignmentId);
    });

    it('maps stale and null conflicts to 412 while preserving the cause', async () => {
        for (const expectedAssignmentId of [ null, ASSIGNMENT_ID ]) {
            const cause = new ConflictError('stale', { code: 'BuildPointerConflict' });
            const context = makeContext(() => {
                throw cause;
            });
            const error = await catchError(() => putBuild(context, makeRequest({ expectedAssignmentId }), new ServerResponse()));
            assertEqual(412, error.httpStatusCode);
            assertEqual('BuildPointerConflict', error.code);
            assertEqual(cause, error.cause);
            assertEqual(expectedAssignmentId, context.assignments[0].expectedAssignmentId);
            assertEqual(0, context.appends.length);
        }
    });

    it('preserves missing-Release errors from the atomic assignment', async () => {
        const cause = new NotFoundError('missing', { code: 'ReleaseNotFound' });
        const context = makeContext(() => {
                throw cause;
            });
        const error = await catchError(() => putBuild(context, makeRequest({ expectedAssignmentId: ASSIGNMENT_ID }), new ServerResponse()));
        assertEqual(cause, error);
        assertEqual(404, error.httpStatusCode);
        assertEqual(0, context.appends.length);
    });

    it('keeps a valid no-op private and preserves its timestamp and identity', async () => {
        const context = makeContext(() => ({
            buildId: 'future-build', releaseId: RELEASE_ID, assignedAt: '2020-01-01T00:00:00.000Z',
            assignmentId: ASSIGNMENT_ID, isChanged: false, previousReleaseId: RELEASE_ID,
            assignmentEvent: { metadata: { private: 'value' } }, attemptCount: 2,
        }));
        const response = await putBuild(context, makeRequest({ expectedAssignmentId: ASSIGNMENT_ID }), new ServerResponse());
        const attributes = JSON.parse(response.body).data.attributes;
        assertEqual('assignedAt,assignmentId,releaseId', Object.keys(attributes).sort().join(','));
        assertEqual('2020-01-01T00:00:00.000Z', attributes.assignedAt);
        assertEqual(ASSIGNMENT_ID, attributes.assignmentId);
        assertEqual(0, context.appends.length);
    });

    it('uses captured assignment metadata even when a later write completes first', async () => {
        const context = makeContext();
        context.store.getBuildPointer = () => {
            throw new Error('PUT must not reread the pointer');
        };
        context.getCollection = () => ({
            async append() {
                context.store.getBuildPointer = async () => ({ rootHash: 'b'.repeat(26), assignmentId: crypto.randomUUID() });
            },
        });
        const response = await putBuild(context, makeRequest({ expectedAssignmentId: ASSIGNMENT_ID }), new ServerResponse());
        const attributes = JSON.parse(response.body).data.attributes;
        assertEqual(RELEASE_ID, attributes.releaseId);
        assertEqual(NEXT_ASSIGNMENT_ID, attributes.assignmentId);
        assertEqual('2026-09-01T13:00:00.000Z', attributes.assignedAt);
    });

    it('exposes identity in GET and list without private storage fields', async () => {
        const context = makeContext();
        const response = await getBuild(context, makeRequest(), new ServerResponse());
        assertEqual(ASSIGNMENT_ID, JSON.parse(response.body).data.attributes.assignmentId);
        const listing = await listBuilds(context, makeRequest(), new ServerResponse());
        const attributes = JSON.parse(listing.body).data[0].attributes;
        assertEqual(ASSIGNMENT_ID, attributes.assignmentId);
        assertEqual('assignedAt,assignmentId,releaseId', Object.keys(attributes).sort().join(','));
    });

    it('carries the assignment identity in JSON alone, with no header validator', async () => {
        const context = makeContext();
        const read = await getBuild(context, makeRequest(), new ServerResponse());
        assertEqual(null, read.headers.get('etag'));
        assertEqual(null, read.headers.get('cache-control'));

        // The only identity a client can copy is the one in the body.
        const expectedAssignmentId = JSON.parse(read.body).data.attributes.assignmentId;
        const response = await putBuild(context, makeRequest({ expectedAssignmentId }), new ServerResponse());
        assertEqual(200, response.status);
        assertEqual(null, response.headers.get('etag'));
        assertEqual(ASSIGNMENT_ID, context.assignments[0].expectedAssignmentId);
    });
});
