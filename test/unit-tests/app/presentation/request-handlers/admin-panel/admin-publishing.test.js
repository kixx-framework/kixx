import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getPublishingBuild,
    getPublishingOverview,
    getPublishingRelease,
    postAssignRelease,
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
        permissions = [ { action: '*', resource: '*' } ],
        assignOutcome,
    } = options ?? {};

    const appendCalls = [];
    const assignCalls = [];

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
        async append(_context, attributes) {
            appendCalls.push(attributes);
        },
    };
    const store = {
        async getBuildPointer(_context, buildId) {
            return pointers[buildId] ?? null;
        },
        async listBuilds() {
            return buildList;
        },
        async assignRelease(_context, buildId, assignment) {
            assignCalls.push({ buildId, ...assignment });
            if (assignOutcome) {
                return assignOutcome(buildId, assignment);
            }
            return { buildId, releaseId: assignment.releaseId, assignedAt: '2026-09-01T00:00:00.000Z' };
        },
    };
    const csrfSigner = {
        async sign() {
            return 'fresh-csrf-token';
        },
        async verify() {
            return true;
        },
    };

    const targets = {
        'admin-panel/publishing/render-overview': () => '/admin/publishing',
        'admin-panel/publishing-build/render-build': (params) => `/admin/publishing/builds/${ params.buildId }`,
        'admin-panel/publishing-release/render-release': (params) => `/admin/publishing/releases/${ params.releaseId }`,
        'admin-panel/publishing-assign/assign': () => '/admin/publishing/assign',
    };

    return {
        runtime: { build: { id: runningBuildId } },
        user: { id: 'admin-1', permissions },
        appendCalls,
        assignCalls,
        getService(name) {
            if (name === 'ContentAddressableStore') {
                return store;
            }
            if (name === 'CsrfTokenSigner') {
                return csrfSigner;
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
        formFields = null,
    } = options ?? {};

    return {
        calls: { formData: 0 },
        queryParams,
        pathnameParams,
        url: new URL('https://example.com/admin/publishing'),
        async formData() {
            this.calls.formData += 1;
            const formData = new FormData();
            formData.set('csrf_token', 'submitted-token');
            for (const [ name, value ] of Object.entries(formFields ?? {})) {
                formData.set(name, value);
            }
            return formData;
        },
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'browser-session' : null;
        },
    };
}

function makeResponse() {
    return {
        props: {},
        redirect: null,
        status: 200,
        setCookie() {
            return this;
        },
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        respondWithRedirect(status, location) {
            this.redirect = { status, location };
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
        assertEqual(undefined, response.props.form);
    });

    it('reports an unassigned running build with a null Release', async () => {
        const context = makeContext({ runningBuildId: 'build-1', pointers: {} });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assertEqual('build-1', response.props.runningBuild.id);
        assertEqual(null, response.props.runningBuild.releaseId);
        assertEqual(undefined, response.props.form);
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
        assertEqual('rollback', response.props.releases[1].direction);
        assert(response.props.form, 'expected an assign form context');
    });

    it('omits the assign control for a principal lacking the update grant', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-current', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: { 'release-current': makeRelease({ id: 'release-current' }) },
            permissions: [ { action: 'urn:kixx:get', resource: 'urn:kixx:publishing:*' } ],
        });
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest(), response);

        assertEqual(undefined, response.props.form);
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

    it('discards an unrecognized notice code', async () => {
        const context = makeContext();
        const response = makeResponse();

        await getPublishingOverview(context, makeRequest({ queryParams: { notice: 'not-a-real-code' } }), response);

        assertEqual(null, response.props.notice);
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

    it('omits the assign control for the current Release', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-1', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: { 'release-1': makeRelease({ id: 'release-1' }) },
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(undefined, response.props.form);
    });

    it('omits the assign control when the running build has no pointer', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: {},
            releases: { 'release-1': makeRelease({ id: 'release-1' }) },
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(undefined, response.props.form);
    });

    it('omits the assign control for a principal lacking the update grant', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-current', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: {
                'release-1': makeRelease({ id: 'release-1' }),
                'release-current': makeRelease({ id: 'release-current' }),
            },
            permissions: [ { action: 'urn:kixx:get', resource: 'urn:kixx:publishing:*' } ],
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assertEqual(undefined, response.props.form);
    });

    it('renders the assign control with a rollback direction for an older Release', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: 'release-current', assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: {
                'release-1': makeRelease({ id: 'release-1', createdAt: '2026-08-01T00:00:00.000Z' }),
                'release-current': makeRelease({ id: 'release-current', createdAt: '2026-08-15T00:00:00.000Z' }),
            },
        });
        const response = makeResponse();

        await getPublishingRelease(context, makeRequest({ pathnameParams: { releaseId: 'release-1' } }), response);

        assert(response.props.form, 'expected an assign form context');
        assertEqual('rollback', response.props.direction);
    });
});

describe('postAssignRelease', ({ it }) => {

    // AssignReleaseForm rejects a release_id/expected_release_id that is not a
    // well-formed content hash, so submitted ids must match the digest pattern.
    const RELEASE_CURRENT_HASH = 'a'.repeat(26);
    const RELEASE_NEW_HASH = 'b'.repeat(26);
    const RELEASE_OLD_HASH = 'c'.repeat(26);
    const RELEASE_DIFFERENT_HASH = 'd'.repeat(26);

    function formFields(overrides) {
        return Object.assign({
            release_id: RELEASE_NEW_HASH,
            build_id: 'build-1',
            expected_release_id: RELEASE_CURRENT_HASH,
        }, overrides);
    }

    it('redirects with form_expired when CSRF validation fails', async () => {
        const context = makeContext();
        context.getService = (name) => {
            if (name === 'CsrfTokenSigner') {
                return { async verify() {
                    return false;
                } };
            }
            throw new Error(`unexpected service "${ name }"`);
        };
        const response = makeResponse();
        let skipCalls = 0;

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {
            skipCalls += 1;
        });

        assertEqual(1, skipCalls);
        assertEqual(303, response.redirect.status);
        assertEqual('/admin/publishing?notice=form_expired', response.redirect.location);
    });

    it('redirects with release_assigned on success and records the audit reason', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: RELEASE_CURRENT_HASH, assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: {
                [RELEASE_NEW_HASH]: makeRelease({ id: RELEASE_NEW_HASH, createdAt: '2026-09-01T00:00:00.000Z' }),
                [RELEASE_CURRENT_HASH]: makeRelease({ id: RELEASE_CURRENT_HASH, createdAt: '2026-08-15T00:00:00.000Z' }),
            },
        });
        const response = makeResponse();
        let skipCalls = 0;

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {
            skipCalls += 1;
        });

        assertEqual(1, skipCalls);
        assertEqual('/admin/publishing?notice=release_assigned', response.redirect.location);
        assertEqual('publish', context.appendCalls[0].reason);
        assertEqual(RELEASE_CURRENT_HASH, context.assignCalls[0].precondition);
        assertEqual('admin-1', context.appendCalls[0].activatedBy);
    });

    it('records rollback for an older Release', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: RELEASE_CURRENT_HASH, assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: {
                [RELEASE_OLD_HASH]: makeRelease({ id: RELEASE_OLD_HASH, createdAt: '2026-08-01T00:00:00.000Z' }),
                [RELEASE_CURRENT_HASH]: makeRelease({ id: RELEASE_CURRENT_HASH, createdAt: '2026-08-15T00:00:00.000Z' }),
            },
        });
        const response = makeResponse();

        await postAssignRelease(
            context,
            makeRequest({ formFields: formFields({ release_id: RELEASE_OLD_HASH }) }),
            response,
            () => {},
        );

        assertEqual('rollback', context.appendCalls[0].reason);
    });

    it('redirects with build_mismatch when the page was rendered for a different build', async () => {
        const context = makeContext({ runningBuildId: 'build-2' });
        const response = makeResponse();

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {});

        assertEqual('/admin/publishing?notice=build_mismatch', response.redirect.location);
    });

    it('redirects with build_unassigned when the running build has no pointer', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: {},
            releases: { [RELEASE_NEW_HASH]: makeRelease({ id: RELEASE_NEW_HASH }) },
        });
        const response = makeResponse();

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {});

        assertEqual('/admin/publishing?notice=build_unassigned', response.redirect.location);
    });

    it('redirects with pointer_conflict when the expected Release is stale', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: RELEASE_DIFFERENT_HASH, assignedAt: '2026-08-15T00:00:00.000Z' } },
            releases: { [RELEASE_NEW_HASH]: makeRelease({ id: RELEASE_NEW_HASH }) },
        });
        const response = makeResponse();

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {});

        assertEqual('/admin/publishing?notice=pointer_conflict', response.redirect.location);
    });

    it('redirects with release_not_found for an unknown Release', async () => {
        const context = makeContext({
            runningBuildId: 'build-1',
            pointers: { 'build-1': { rootHash: RELEASE_CURRENT_HASH, assignedAt: '2026-08-15T00:00:00.000Z' } },
        });
        const response = makeResponse();

        await postAssignRelease(context, makeRequest({ formFields: formFields() }), response, () => {});

        assertEqual('/admin/publishing?notice=release_not_found', response.redirect.location);
    });
});
