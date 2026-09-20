import { NotFoundError } from '../../../../kixx/errors/mod.js';
import { getRelease } from '../../../transaction-scripts/publishing/get-release.js';
import { listReleases } from '../../../transaction-scripts/publishing/list-releases.js';
import { listActivations } from '../../../transaction-scripts/publishing/list-activations.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
    rethrowInvalidCursorAsBadRequest,
} from '../../lib/pagination.js';


function getOverviewPathname(context) {
    return context.getHttpTarget('admin-panel/publishing/render-overview').compilePathname().pathname;
}

function getBuildPathname(context, buildId) {
    return context.getHttpTarget('admin-panel/publishing-build/render-build').compilePathname({ buildId }).pathname;
}

function getReleasePathname(context, releaseId) {
    return context.getHttpTarget('admin-panel/publishing-release/render-release').compilePathname({ releaseId }).pathname;
}

async function loadRunningBuild(context) {
    const runningBuildId = context.runtime.build.id ?? null;
    if (!runningBuildId) {
        return null;
    }

    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, runningBuildId);

    return {
        id: runningBuildId,
        releaseId: pointer?.rootHash ?? null,
        assignedAt: pointer?.assignedAt ?? null,
    };
}

function mapReleaseRow(context, release, runningBuild) {
    const isCurrent = Boolean(runningBuild) && release.id === runningBuild.releaseId;

    return {
        id: release.id,
        createdAt: release.createdAt,
        createdBy: release.createdBy,
        objectCount: release.objectCount,
        totalBytes: release.totalBytes,
        provenance: release.provenance,
        isCurrent,
        href: getReleasePathname(context, release.id),
    };
}

/**
 * Renders the publishing overview: the running build, every registered build
 * pointer, and paginated Release history.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying overview props.
 * @throws {BadRequestError} When the `cursor` query parameter is not a valid signed cursor.
 */
export async function getPublishingOverview(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);

    const store = context.getService('ContentAddressableStore');
    const runningBuild = await loadRunningBuild(context);

    const builds = (await store.listBuilds(context)).map((pointer) => ({
        id: pointer.buildId,
        releaseId: pointer.rootHash,
        assignedAt: pointer.assignedAt,
        isRunning: pointer.buildId === runningBuild?.id,
        href: getBuildPathname(context, pointer.buildId),
    }));

    let page;
    try {
        page = await listReleases(context, { cursor: pagination.cursor });
    } catch (cause) {
        // Never returns — translates an InvalidCursorError into a 400 or rethrows.
        rethrowInvalidCursorAsBadRequest(cause);
    }
    const { items, cursor: nextCursor } = page;
    const releases = items.map((release) => mapReleaseRow(context, release, runningBuild));

    const overviewPathname = getOverviewPathname(context);
    const links = {
        ...createCursorPaginationLinks({
            pathname: overviewPathname,
            cursor: pagination.cursor,
            history: pagination.history,
            nextCursor,
        }),
    };

    return response.updateProps({
        runningBuild,
        builds,
        releases,
        showPagination: Boolean(links.nextPage || links.previousPage),
        links,
    });
}

/**
 * Renders one build pointer and its activation history.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying build and activation props.
 * @throws {NotFoundError} With code `BuildNotFound` when the build is not registered.
 * @throws {BadRequestError} When the `cursor` query parameter is not a valid signed cursor.
 */
export async function getPublishingBuild(context, request, response) {
    const { buildId } = request.pathnameParams;
    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);

    if (!pointer) {
        throw new NotFoundError(`Build "${ buildId }" was not found`, { code: 'BuildNotFound' });
    }

    const pagination = getCursorPaginationQueryParams(request.queryParams);

    let page;
    try {
        page = await listActivations(context, { buildId, cursor: pagination.cursor });
    } catch (cause) {
        rethrowInvalidCursorAsBadRequest(cause);
    }
    const { items, cursor: nextCursor } = page;

    const activations = items.map((activation) => ({
        id: activation.id,
        fromReleaseId: activation.fromReleaseId,
        toReleaseId: activation.toReleaseId,
        activatedAt: activation.activatedAt,
        activatedBy: activation.activatedBy,
        reason: activation.reason,
        fromReleaseHref: activation.fromReleaseId ? getReleasePathname(context, activation.fromReleaseId) : null,
        toReleaseHref: getReleasePathname(context, activation.toReleaseId),
    }));

    const buildPathname = getBuildPathname(context, buildId);
    const links = {
        overview: getOverviewPathname(context),
        ...createCursorPaginationLinks({
            pathname: buildPathname,
            cursor: pagination.cursor,
            history: pagination.history,
            nextCursor,
        }),
    };

    return response.updateProps({
        build: {
            id: buildId,
            releaseId: pointer.rootHash,
            assignedAt: pointer.assignedAt,
            isRunning: buildId === (context.runtime.build.id ?? null),
            releaseHref: getReleasePathname(context, pointer.rootHash),
        },
        activations,
        showPagination: Boolean(links.nextPage || links.previousPage),
        links,
    });
}

/**
 * Renders one Release's audit metadata and the build pointers that reference it.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying Release props.
 * @throws {NotFoundError} With code `ReleaseNotFound` when the Release does not exist.
 */
export async function getPublishingRelease(context, request, response) {
    const { releaseId } = request.pathnameParams;
    const release = await getRelease(context, releaseId);

    if (!release) {
        throw new NotFoundError(`Release "${ releaseId }" was not found`, { code: 'ReleaseNotFound' });
    }

    const store = context.getService('ContentAddressableStore');
    const runningBuild = await loadRunningBuild(context);
    const isCurrent = Boolean(runningBuild) && runningBuild.releaseId === releaseId;

    const allBuilds = await store.listBuilds(context);
    const referencingBuilds = allBuilds
        .filter((pointer) => pointer.rootHash === releaseId)
        .map((pointer) => ({
            id: pointer.buildId,
            assignedAt: pointer.assignedAt,
            isRunning: pointer.buildId === runningBuild?.id,
            href: getBuildPathname(context, pointer.buildId),
        }));

    return response.updateProps({
        release: {
            id: release.id,
            createdAt: release.createdAt,
            createdBy: release.createdBy,
            objectCount: release.objectCount,
            totalBytes: release.totalBytes,
            contractVersion: release.contractVersion,
            provenance: release.provenance,
            // The template's #with helper treats an empty object as present, so
            // the empty-provenance state needs an explicit flag rather than
            // relying on provenance truthiness.
            hasProvenance: Object.keys(release.provenance ?? {}).length > 0,
            isCurrent,
        },
        referencingBuilds,
        links: { overview: getOverviewPathname(context) },
    });
}
