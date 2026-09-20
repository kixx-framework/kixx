import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getPublishingBuild,
    getPublishingOverview,
    getPublishingRelease,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-publishing.js';


function makeRelease(overrides) {
    return Object.assign({
        releaseId: 'release-1',
        id: 'release-1',
        createdAt: '2026-08-01T00:00:00.000Z',
        createdBy: 'someone',
        objectCount: 1,
        totalBytes: 10,
        contractVersion: 1,
        provenance: {},
    }, overrides);
}

function makeContext(options) {
    const {
        runningBuildId = 'build-1',
        pointers = {},
        buildList = [],
        releases = {},
        releasePage = { items: [], cursor: null },
        activationPage = { items: [], cursor: null },
    } = options ?? {};

    const releaseCollection = {
        async get(_context, id) {
            const data = releases[id];
            return data ? { toObject: () => data } : null;
        },
        async listPage() {
            if (releasePage instanceof Error) {
                throw releasePage;
            }
            return releasePage;
        },
    };
    const activationCollection = {
        async listPage() {
            if (activationPage instanceof Error) {
                throw activationPage;
            }
            return activationPage;
        },
    };
    const store = {
        async getBuildPointer(_context, buildId) {
            return pointers[buildId] ?? null;
        },
        async listBuilds() {
            return buildList;
        },
    };

    const targets = {
        'admin-panel/publishing/render-overview': () => '/admin/publishing',
        'admin-panel/publishing-build/render-build': (params) => `/admin/publishing/builds/${ params.buildId }`,
        'admin-panel/publishing-release/render-release': (params) => `/admin/publishing/releases/${ params.releaseId }`,
    };

    return {
        runtime: { build: { id: runningBuildId } },
        user: { id: 'admin-1' },
        getService(name) {
            if (name === 'ContentAddressableStore') {
                return store;
            }
            throw new Error(`unexpected service "${ name }"`);
        },
        getCollection(name) {
            if (name === 'Release') {
                return releaseCollection;
            }
            if (name === 'Activation') {
                return activationCollection;
            }
            throw new Error(`unexpected collection "${ name }"`);
        },
        getHttpTarget(name) {
            const compile = targets[name];
            if (!compile) {
                throw new Error(`unexpected target "${ name }"`);
            }
            return {
                compilePathname(params) {
                    return { method: 'GET', pathname: compile(params ?? {}) };
                },
            };
        },
    };
}

function makeRequest(options) {
    const {
        queryParams = {},
        pathnameParams = {},
    } = options ?? {};

    return {
        queryParams,
        pathnameParams,
        url: new URL('https://example.com/admin/publishing'),
    };
}

function makeResponse() {
    return {
        props: {},
        status: 200,
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
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


describe('getPublishingOverview', ({ it }) => {

    it('reports no running build when the runtime has no build id', async () => {
        const context = makeContext({ runningBuildId: null });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assertEqual(null, response.props.runningBuild);
    });

    it('reports an unassigned running build with a null Release', async () => {
        const context = makeContext({ runningBuildId: 'build-1', pointers: {} });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assertEqual('build-1', response.props.runningBuild.id);
        assertEqual(null, response.props.runningBuild.releaseId);
    });

    it('reports the running build and marks the current Release', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-current', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: { 'release-current': makeRelease({ id: 'release-current', createdAt: '2026-08-15T00:00:00.000Z' }) },
            releasePage: {
                items: [
                    { toObject: () => makeRelease({ id: 'release-current', createdAt: '2026-08-15T00:00:00.000Z' }) },
                    { toObject: () => makeRelease({ id: 'release-old', createdAt: '2026-08-01T00:00:00.000Z' }) },
                ],
                cursor: null,
            },
        });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assertEqual('release-current', response.props.runningBuild.releaseId);
        assertEqual(true, response.props.releases[0].isCurrent);
        assertEqual(false, response.props.releases[1].isCurrent);
    });

    it('builds pagination links from the next cursor', async () => {
        const context = makeContext({
            releasePage: { items: [], cursor: 'cursor-2' },
        });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assert(response.props.links.nextPage.includes('cursor=cursor-2'));
        assertEqual(true, response.props.showPagination);
    });

    it('responds 400 for an invalid cursor', async () => {
        const cursorError = new Error('bad cursor');
        cursorError.name = 'InvalidCursorError';
        const context = makeContext({ releasePage: cursorError });
        const response = makeResponse();

        const error = await catchAsyncError(() => getPublishingOverview(context, makeRequest(), response));

        assert(error);
        assertEqual('BadRequestError', error.name);
    });
});

describe('getPublishingBuild', ({ it }) => {

    it('renders a registered build and its activation history', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' } },
            activationPage: {
                items: [
                    {
                        toObject: () => ({
                            id: 'activation-1',
                            buildId: 'build-1',
                            fromReleaseId: null,
                            toReleaseId: 'release-1',
                            activatedAt: '2026-08-15T00:00:00.000Z',
                            activatedBy: 'admin-1',
                            reason: 'publish',
                        }),
                    },
                ],
                cursor: null,
            },
        });
        const response = makeResponse();

        await getPublishingBuild(context, makeRequest({ pathnameParams: { buildId: 'build-1' } }), response);

        assertEqual('build-1', response.props.build.id);
        assertEqual(true, response.props.build.isRunning);
        assertEqual(null, response.props.activations[0].fromReleaseHref);
        assertEqual('/admin/publishing/releases/release-1', response.props.activations[0].toReleaseHref);
    });

    it('throws BuildNotFound for an unregistered build', async () => {
        const context = makeContext({ pointers: {} });
        const response = makeResponse();

        const error = await catchAsyncError(() => getPublishingBuild(
            context,
            makeRequest({ pathnameParams: { buildId: 'build-missing' } }),
            response,
        ));

        assert(error);
        assertEqual('NotFoundError', error.name);
        assertEqual('BuildNotFound', error.code);
    });

    it('builds pagination links against this build\'s own pathname', async () => {
        const context = makeContext({
            pointers: { 'build-1': { rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' } },
            activationPage: { items: [], cursor: 'cursor-2' },
        });
        const response = makeResponse();

        await getPublishingBuild(context, makeRequest({ pathnameParams: { buildId: 'build-1' } }), response);

        assert(response.props.links.nextPage.startsWith('/admin/publishing/builds/build-1?'));
    });

    it('responds 400 for an invalid cursor', async () => {
        const cursorError = new Error('bad cursor');
        cursorError.name = 'InvalidCursorError';
        const context = makeContext({
            pointers: { 'build-1': { rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' } },
            activationPage: cursorError,
        });
        const response = makeResponse();

        const error = await catchAsyncError(() => getPublishingBuild(
            context,
            makeRequest({ pathnameParams: { buildId: 'build-1' } }),
            response,
        ));

        assert(error);
        assertEqual('BadRequestError', error.name);
    });
});

describe('getPublishingRelease', ({ it }) => {

    it('renders a known Release and the builds referencing it', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' } },
            buildList: [
                { buildId: 'build-1', rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' },
                { buildId: 'build-2', rootHash: 'release-other', assignedAt: '2026-08-01T00:00:00.000Z' },
            ],
            releases: { 'release-1': makeRelease({ id: 'release-1' }) },
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(true, response.props.release.isCurrent);
        assertEqual(1, response.props.referencingBuilds.length);
        assertEqual('build-1', response.props.referencingBuilds[0].id);
        assertEqual(true, response.props.referencingBuilds[0].isRunning);
    });

    it('marks a Release the running build does not point at as not current', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-current', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: { 'release-1': makeRelease({ id: 'release-1' }) },
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(false, response.props.release.isCurrent);
    });

    it('shows the empty-provenance state for a Release with no provenance', async () => {
        const context = makeContext({ releases: { 'release-1': makeRelease({ id: 'release-1', provenance: {} }) } });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(false, response.props.release.hasProvenance);
    });

    it('throws ReleaseNotFound for an unknown Release', async () => {
        const context = makeContext();
        const response = makeResponse();

        const error = await catchAsyncError(() => getPublishingRelease(
            context,
            makeRequest({ pathnameParams: { releaseId: 'release-missing' } }),
            response,
        ));

        assert(error);
        assertEqual('NotFoundError', error.name);
        assertEqual('ReleaseNotFound', error.code);
    });
});
