import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ConflictError } from '../../../../../../src/kixx/errors/mod.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { getBuild, putBuild } from '../../../../../../src/app/presentation/request-handlers/publishing-api/builds.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';
import { hashBlob } from '../../../../../../src/kixx/content-addressable-store/addressing.js';


async function makeRequest(headers, requestedReleaseId) {
    const releaseId = requestedReleaseId ?? await hashBlob(new TextEncoder().encode('release-new').buffer);
    return {
        pathnameParams: { buildId: 'future-build' },
        headers: new Headers(headers),
        getContentMediaType: () => JSON_API_CONTENT_TYPE,
        json: async () => ({
            data: {
                type: 'Build',
                id: 'future-build',
                attributes: { releaseId, reason: 'publish' },
            },
        }),
    };
}

async function makeRaceContext() {
    const assignedReleaseId = await hashBlob(new TextEncoder().encode('release-assigned').buffer);
    const laterReleaseId = await hashBlob(new TextEncoder().encode('release-later').buffer);
    const assignedAt = '2026-09-01T13:00:00.000Z';
    let currentPointer = {
        rootHash: assignedReleaseId,
        assignedAt,
    };
    const store = {
        getBuildPointer() {
            throw new Error('putBuild must not reread the pointer');
        },
        async assignRelease() {
            return {
                buildId: 'future-build',
                releaseId: assignedReleaseId,
                assignedAt,
                isChanged: true,
                previousReleaseId: null,
            };
        },
    };
    return {
        assignedReleaseId,
        laterReleaseId,
        currentPointer: () => currentPointer,
        user: { id: 'token-1' },
        getService: () => store,
        getCollection: () => ({
            async append() {
                currentPointer = {
                    rootHash: laterReleaseId,
                    assignedAt: '2026-09-01T14:00:00.000Z',
                };
            },
        }),
        logger: { error() {} },
    };
}

function makeContext(assignImplementation) {
    const preconditions = [];
    const store = {
        getBuildPointer: async () => ({ rootHash: 'release-old', assignedAt: '2026-09-01T12:00:00.000Z' }),
        async assignRelease(_context, _buildId, assignment) {
            preconditions.push(assignment.precondition);
            if (assignImplementation) {
                return await assignImplementation();
            }
            return {
                buildId: 'future-build',
                releaseId: 'release-new',
                assignedAt: '2026-09-01T13:00:00.000Z',
                isChanged: true,
                previousReleaseId: 'release-old',
            };
        },
    };
    return {
        preconditions,
        user: { id: 'token-1' },
        getService: () => store,
        getCollection: () => ({ append: async () => {} }),
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

    it('requires a pointer precondition', async () => {
        const request = await makeRequest();
        const error = await catchError(() => putBuild(makeContext(), request, new ServerResponse()));
        assert(error);
        assertEqual(428, error.httpStatusCode);
        assertEqual('PreconditionRequired', error.code);
    });

    it('maps a stale pointer to precondition failed', async () => {
        const context = makeContext(() => {
            throw new ConflictError('stale', { code: 'BuildPointerConflict' });
        });
        const priorReleaseId = await hashBlob(new TextEncoder().encode('release-old').buffer);
        const request = await makeRequest({ 'if-match': `"${ priorReleaseId }"` });
        const error = await catchError(() => putBuild(
            context,
            request,
            new ServerResponse(),
        ));

        assertEqual(412, error.httpStatusCode);
        assertEqual('BuildPointerConflict', error.code);
    });

    it('maps If-None-Match star to an unassigned precondition', async () => {
        const context = makeContext();
        const response = await putBuild(
            context,
            await makeRequest({ 'if-none-match': '*' }),
            new ServerResponse(),
        );

        assertEqual(null, context.preconditions[0]);
        assertEqual('"release-new"', response.headers.get('etag'));
        assertEqual('no-transform', response.headers.get('cache-control'));
    });

    it('reports If-None-Match conflict on an assigned build', async () => {
        const context = makeContext(() => {
            throw new ConflictError('assigned', { code: 'BuildPointerConflict' });
        });
        const request = await makeRequest({ 'if-none-match': '*' });
        const error = await catchError(() => putBuild(context, request, new ServerResponse()));

        assertEqual(412, error.httpStatusCode);
        assertEqual(null, context.preconditions[0]);
    });

    it('keeps a valid no-op private and returns its preserved timestamp', async () => {
        const releaseId = await hashBlob(new TextEncoder().encode('release-current').buffer);
        const assignedAt = '2020-01-01T00:00:00.000Z';
        const context = makeContext(() => ({
            buildId: 'future-build',
            releaseId,
            assignedAt,
            isChanged: false,
            previousReleaseId: releaseId,
        }));
        const response = await putBuild(
            context,
            await makeRequest({ 'if-match': `"${ releaseId }"` }, releaseId),
            new ServerResponse(),
        );

        const document = JSON.parse(response.body);
        assertEqual(200, response.status);
        assertEqual(releaseId, document.data.attributes.releaseId);
        assertEqual(assignedAt, document.data.attributes.assignedAt);
        assertEqual(undefined, document.data.attributes.isChanged);
        assertEqual(undefined, document.data.attributes.previousReleaseId);
        assertEqual(`"${ releaseId }"`, response.headers.get('etag'));
    });

    it('responds with the assignment result when a later write completes first', async () => {
        const context = await makeRaceContext();
        const response = await putBuild(
            context,
            await makeRequest(
                { 'if-match': `"${ context.assignedReleaseId }"` },
                context.assignedReleaseId,
            ),
            new ServerResponse(),
        );

        const document = JSON.parse(response.body);
        assertEqual(context.laterReleaseId, context.currentPointer().rootHash);
        assertEqual(context.assignedReleaseId, document.data.attributes.releaseId);
        assertEqual('2026-09-01T13:00:00.000Z', document.data.attributes.assignedAt);
        assertEqual(`"${ context.assignedReleaseId }"`, response.headers.get('etag'));
    });

    it('rejects a quoted non-hash ETag before calling the service', async () => {
        const context = makeContext();
        const request = await makeRequest({ 'if-match': '"not-a-hash"' });
        const error = await catchError(() => putBuild(context, request, new ServerResponse()));

        assertEqual('BadRequestError', error.name);
        assertEqual(0, context.preconditions.length);
    });

    it('reads a pointer for a build that is not running', async () => {
        const response = await getBuild(makeContext(), await makeRequest(), new ServerResponse());
        assertEqual(200, response.status);
        assertEqual('"release-old"', response.headers.get('etag'));
        assertEqual('no-transform', response.headers.get('cache-control'));
    });
});
