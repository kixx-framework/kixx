import { NotFoundError } from '../../../../kixx/errors/mod.js';
import { evaluatePermissions } from '../../../../kixx/permissions/permission-validation.js';
import { getRelease } from '../../../transaction-scripts/publishing/get-release.js';
import { listReleases } from '../../../transaction-scripts/publishing/list-releases.js';
import { listActivations } from '../../../transaction-scripts/publishing/list-activations.js';
import { assignReleaseToRunningBuild } from '../../../transaction-scripts/publishing/assign-release-to-running-build.js';
import AssignReleaseForm from '../../forms/publishing/assign-release-form.js';
import {
    INVALID_CSRF_TOKEN_CODE,
    getCsrfFormContext,
    validateCsrfFormData,
} from '../../lib/csrf.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
    rethrowInvalidCursorAsBadRequest,
} from '../../lib/pagination.js';


// Notice codes the overview page renders as a callout after a redirect. An
// unrecognized `notice` query parameter is discarded rather than echoed, so
// the redirect notice cannot be used to inject arbitrary text into the page.
const ALLOWED_OVERVIEW_NOTICES = new Set([
    'form_expired',
    'release_assigned',
    'pointer_conflict',
    'build_mismatch',
    'build_unassigned',
    'release_not_found',
]);

// Maps assignReleaseToRunningBuild()'s expected error codes onto the overview
// notice shown after the redirect. Any other error propagates.
const ASSIGN_ERROR_NOTICES = {
    RunningBuildMismatch: 'build_mismatch',
    RunningBuildUnassigned: 'build_unassigned',
    BuildPointerConflict: 'pointer_conflict',
    ReleaseNotFound: 'release_not_found',
};

const ASSIGN_UPDATE_DECISION = {
    action: 'urn:kixx:update',
    resource: 'urn:kixx:publishing:builds',
};

function getOverviewPathname(context) {
    return context.getHttpTarget('admin-panel/publishing/render-overview').compilePathname().pathname;
}

function getBuildPathname(context, buildId) {
    return context.getHttpTarget('admin-panel/publishing-build/render-build').compilePathname({ buildId }).pathname;
}

function getReleasePathname(context, releaseId) {
    return context.getHttpTarget('admin-panel/publishing-release/render-release').compilePathname({ releaseId }).pathname;
}

// A viewer without the update grant sees Release rows with no assign button,
// rather than a button that would yield a 403 on submission.
function canAssignRelease(context) {
    return evaluatePermissions(context.user.permissions, ASSIGN_UPDATE_DECISION);
}

// Duplicates the timestamp comparison assignReleaseToRunningBuild() makes to
// decide the audit `reason`; this only informs the button label so a single
// click is directionally clear. The Transaction Script alone decides what
// reason is actually recorded.
function computeDirection(candidate, current) {
    if (current && new Date(candidate.createdAt) < new Date(current.createdAt)) {
        return 'rollback';
    }
    return 'forward';
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

function mapReleaseRow(context, release, runningBuild, currentRelease) {
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
        direction: computeDirection(release, currentRelease),
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
    const rawNotice = request.queryParams.notice;
    const notice = ALLOWED_OVERVIEW_NOTICES.has(rawNotice) ? rawNotice : null;

    const store = context.getService('ContentAddressableStore');
    const runningBuild = await loadRunningBuild(context);

    const currentRelease = runningBuild?.releaseId
        ? await getRelease(context, runningBuild.releaseId)
        : null;

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
    const releases = items.map((release) => mapReleaseRow(context, release, runningBuild, currentRelease));

    const overviewPathname = getOverviewPathname(context);
    const links = {
        ...createCursorPaginationLinks({
            pathname: overviewPathname,
            cursor: pagination.cursor,
            history: pagination.history,
            nextCursor,
        }),
    };

    const props = {
        runningBuild,
        builds,
        releases,
        showPagination: Boolean(links.nextPage || links.previousPage),
        links,
        notice,
    };

    // The assign control only ever moves the running build off its current
    // Release, so it has nothing to render without an assigned pointer, and a
    // viewer lacking the update grant sees rows with no button at all.
    if (runningBuild?.releaseId && canAssignRelease(context)) {
        props.form = await getCsrfFormContext(context, request, response, new AssignReleaseForm());
    }

    return response.updateProps(props);
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
 * Renders one Release's audit metadata and the build pointers that reference
 * it, with an assign-to-running-build control when applicable.
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

    const props = {
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
    };

    if (runningBuild?.releaseId && !isCurrent && canAssignRelease(context)) {
        const currentRelease = await getRelease(context, runningBuild.releaseId);
        props.runningBuild = runningBuild;
        props.direction = computeDirection(release, currentRelease);
        props.form = await getCsrfFormContext(context, request, response, new AssignReleaseForm());
    }

    return response.updateProps(props);
}

/**
 * Assigns a Release to the running build and redirects to the overview.
 *
 * Always redirects (post-redirect-get) and always carries a notice, so a
 * refresh cannot repeat the assignment and every outcome is reported.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase; this route renders no page of its own.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect to the overview.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 * @throws {ValidationError} When a hidden field is missing or malformed.
 */
export async function postAssignRelease(context, request, response, skip) {
    let formData;
    try {
        formData = await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code !== INVALID_CSRF_TOKEN_CODE) {
            throw error;
        }
        skip();
        return response.respondWithRedirect(303, `${ getOverviewPathname(context) }?notice=form_expired`);
    }

    // A forged hidden field is not a recoverable operator mistake, so a
    // ValidationError here propagates to the admin error handler.
    const form = AssignReleaseForm.fromFormData(formData);
    form.validate();

    let notice = 'release_assigned';
    try {
        await assignReleaseToRunningBuild(context, {
            buildId: form.build_id,
            releaseId: form.release_id,
            expectedReleaseId: form.expected_release_id,
            activatedBy: context.user.id,
        });
    } catch (error) {
        const mappedNotice = ASSIGN_ERROR_NOTICES[error.code];
        if (!mappedNotice) {
            throw error;
        }
        notice = mappedNotice;
    }

    skip();
    return response.respondWithRedirect(303, `${ getOverviewPathname(context) }?notice=${ notice }`);
}
