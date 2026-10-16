import { BadRequestError } from '../../../../kixx/errors/mod.js';
import { listRegisteredJobs } from '../../../transaction-scripts/jobs/list-registered-jobs.js';
import { INVALID_CSRF_TOKEN_CODE, getCsrfToken, validateCsrfFormData } from '../../lib/csrf.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
} from '../../lib/pagination.js';


// The queue's default page size, passed explicitly so paging is predictable.
const PAGE_SIZE = 50;

// Options for the status filter <select> only. The queue validates the
// submitted value, so this list is never used to accept or reject input.
const STATUS_OPTIONS = [ 'pending', 'running', 'completed', 'failed' ];

const LIST_TARGET = 'admin-panel/jobs/render-list';
const DETAIL_TARGET = 'admin-panel/job-detail/render-detail';
const SCHEDULES_TARGET = 'admin-panel/job-schedules/render-list';
const REGISTRY_TARGET = 'admin-panel/job-registry/render-list';
const RETRY_TARGET = 'admin-panel/job-retry/retry';

const ROLE_FOR_TONE = {
    info: 'status',
    success: 'status',
    warning: 'alert',
    error: 'alert',
};

function defineNotice(code, tone, title, message) {
    return Object.freeze({ code, tone, role: ROLE_FOR_TONE[tone], title, message });
}

// Operator-facing notices keyed by code. The text is static and never
// interpolates request data or error details.
const NOTICES = Object.freeze({
    job_not_found: defineNotice(
        'job_not_found',
        'error',
        'Job not found',
        'No job has that id. It may have been purged after its retention period.',
    ),
    retry_queued: defineNotice(
        'retry_queued',
        'success',
        'Retry queued',
        'The job was reset to attempt 0 and is due now.',
    ),
    retry_conflict: defineNotice(
        'retry_conflict',
        'warning',
        'Could not retry',
        'Only failed jobs can be retried, and not while another active job holds its dedupe key or schedule.',
    ),
    run_now_enqueued: defineNotice(
        'run_now_enqueued',
        'success',
        'Job queued',
        'The job was queued to run now.',
    ),
    run_now_already_queued: defineNotice(
        'run_now_already_queued',
        'info',
        'Already queued',
        'A manual run of this job is already pending or running, so no new job was queued. This is that job.',
    ),
    job_not_registered: defineNotice(
        'job_not_registered',
        'error',
        'Job not registered',
        'That job is not registered in this build.',
    ),
    form_expired: defineNotice(
        'form_expired',
        'warning',
        'Page expired',
        'Nothing ran because the page expired. Reload and try again.',
    ),
});

const LIST_NOTICES = new Set([ 'job_not_found' ]);

const REGISTERED_NOTICES = new Set([ 'job_not_registered', 'form_expired' ]);

const DETAIL_NOTICES = new Set([
    'retry_queued',
    'retry_conflict',
    'run_now_enqueued',
    'run_now_already_queued',
    'form_expired',
]);


function getNotice(raw, allowed) {
    if (typeof raw !== 'string' || !allowed.has(raw)) {
        return null;
    }
    return NOTICES[raw];
}

function getPathname(context, target, params) {
    return context.getHttpTarget(target).compilePathname(params).pathname;
}

// Notice codes are allow-listed constants, never request data, so they are
// safe to put in the query string as-is.
function getNoticeLocation(context, target, params, code) {
    return `${ getPathname(context, target, params) }?notice=${ code }`;
}

// Reads the form and verifies its CSRF token. Returns null for an expired or
// mismatched token so the caller can redirect with a notice; any other
// failure is unexpected and rethrown.
async function readVerifiedFormData(context, request) {
    try {
        return await validateCsrfFormData(context, request);
    } catch (error) {
        if (error.code === INVALID_CSRF_TOKEN_CODE) {
            return null;
        }
        throw error;
    }
}

// Links for the jobs section subnav, shared by all four pages.
function getSectionLinks(context) {
    return {
        jobs: getPathname(context, LIST_TARGET),
        schedules: getPathname(context, SCHEDULES_TARGET),
        registered: getPathname(context, REGISTRY_TARGET),
    };
}

// The jobs list filtered to one job name.
function getRunsPathname(context, name) {
    return getFilterBase(getPathname(context, LIST_TARGET), { name });
}

function isQueueDisabled(context) {
    return context.config.env.JOB_QUEUE.enabled === false;
}

// `request.queryParams` promotes a repeated key to an array. A blank value
// means no filter.
function readFilterParam(queryParams, key) {
    const value = queryParams[key];

    if (Array.isArray(value)) {
        throw new BadRequestError(`Query parameter "${ key }" must appear at most once.`);
    }

    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === 'string') {
        const trimmed = key === 'name' ? value.trim() : value;
        return trimmed === '' ? undefined : trimmed;
    }

    return value;
}

// Paging links are built on this base, so they carry the active filters.
function getFilterBase(listPathname, filters) {
    const url = new URL(listPathname, 'http://localhost');

    if (filters.status !== undefined) {
        url.searchParams.set('status', filters.status);
    }
    if (filters.name !== undefined) {
        url.searchParams.set('name', filters.name);
    }

    return `${ url.pathname }${ url.search }`;
}

function toJobRow(context, job) {
    return {
        id: job.id,
        name: job.name,
        status: job.status,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        runAt: job.runAt,
        finishedAt: job.finishedAt,
        links: { detail: getPathname(context, DETAIL_TARGET, { id: job.id }) },
    };
}

async function getJobDetailProps(context, request, response, job, notice) {
    const links = Object.assign(getSectionLinks(context), {
        detail: getPathname(context, DETAIL_TARGET, { id: job.id }),
        retry: getPathname(context, RETRY_TARGET, { id: job.id }),
    });

    return {
        job: Object.assign({}, job, {
            payloadJson: JSON.stringify(job.payload, null, 2),
            canRetry: job.status === 'failed',
        }),
        links,
        notice,
        csrf: await getCsrfToken(context, request, response),
        jobsView: 'list',
        queueDisabled: isQueueDisabled(context),
    };
}


/**
 * Renders the jobs list, newest first, with status and name filters and
 * cursor paging that keeps the filters.
 *
 * Only allow-listed `notice` codes are shown; anything else in the query
 * string is discarded rather than echoed into the page.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the job rows, filters, and paging links.
 * @throws {BadRequestError} When a filter is repeated, or the queue rejects the status or cursor.
 */
export async function getAdminJobs(context, request, response) {
    const { queryParams } = request;

    const status = readFilterParam(queryParams, 'status');
    const name = readFilterParam(queryParams, 'name');
    const pagination = getCursorPaginationQueryParams(queryParams);

    const options = { limit: PAGE_SIZE };
    if (status !== undefined) {
        options.status = status;
    }
    if (name !== undefined) {
        options.name = name;
    }
    if (pagination.cursor !== undefined) {
        options.cursor = pagination.cursor;
    }

    let result;
    try {
        result = await context.getService('JobQueue').list(context, options);
    } catch (cause) {
        // The only client-owned input the queue can reject is the status or cursor.
        if (cause.name === 'ValidationError') {
            throw new BadRequestError(cause.message, { cause });
        }
        throw cause;
    }

    const listPathname = getPathname(context, LIST_TARGET);
    const pagingLinks = createCursorPaginationLinks({
        pathname: getFilterBase(listPathname, { status, name }),
        cursor: pagination.cursor,
        history: pagination.history,
        nextCursor: result.cursor,
    });

    const statusOptions = STATUS_OPTIONS.map((value) => {
        return { value, label: value, selected: value === status };
    });

    return response.updateProps({
        jobs: result.jobs.map((job) => toJobRow(context, job)),
        filters: {
            name: name ?? '',
            statusOptions,
            isFiltered: status !== undefined || name !== undefined,
        },
        showPagination: Boolean(pagingLinks.nextPage || pagingLinks.previousPage),
        links: Object.assign(getSectionLinks(context), pagingLinks),
        jobsView: 'list',
        queueDisabled: isQueueDisabled(context),
        notice: getNotice(queryParams.notice, LIST_NOTICES),
    });
}

/**
 * Renders one job with every field, the pretty-printed payload, and the last
 * error.
 *
 * An unknown or purged id renders the page's "not found" state with status
 * 404, without echoing the id.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the job detail props.
 */
export async function getAdminJob(context, request, response) {
    const job = await context.getService('JobQueue').get(context, request.pathnameParams.id);

    if (!job) {
        response.status = 404;
        return response.updateProps({
            missing: true,
            links: getSectionLinks(context),
            jobsView: 'list',
            queueDisabled: isQueueDisabled(context),
        });
    }

    const notice = getNotice(request.queryParams.notice, DETAIL_NOTICES);
    const props = await getJobDetailProps(context, request, response, job, notice);

    return response.updateProps(props);
}

/**
 * Retries a failed job and redirects to its detail page with the outcome
 * notice (post/redirect/get).
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect carrying an outcome notice.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 */
export async function postJobRetry(context, request, response) {
    const { id } = request.pathnameParams;

    const formData = await readVerifiedFormData(context, request);
    if (!formData) {
        return response.respondWithRedirect(303, getNoticeLocation(context, DETAIL_TARGET, { id }, 'form_expired'));
    }

    try {
        await context.getService('JobQueue').retry(context, id);
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return response.respondWithRedirect(303, getNoticeLocation(context, LIST_TARGET, undefined, 'job_not_found'));
        }
        // Thrown when the job is not failed, or its key or schedule is held.
        if (error.name === 'ConflictError') {
            return response.respondWithRedirect(303, getNoticeLocation(context, DETAIL_TARGET, { id }, 'retry_conflict'));
        }
        throw error;
    }

    return response.respondWithRedirect(303, getNoticeLocation(context, DETAIL_TARGET, { id }, 'retry_queued'));
}

async function getRegistryPageProps(context, { notice }) {
    const registered = await listRegisteredJobs(context);

    const jobs = registered.map((job) => {
        return Object.assign({}, job, {
            links: { runs: getRunsPathname(context, job.name) },
        });
    });

    return {
        jobs,
        links: getSectionLinks(context),
        jobsView: 'registered',
        queueDisabled: isQueueDisabled(context),
        notice,
    };
}

/**
 * Renders the recurring schedules declared in this build, with links to each
 * job's runs and to the last enqueued occurrence.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} _request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the schedule rows.
 */
export async function getAdminJobSchedules(context, _request, response) {
    const schedules = await context.getService('JobQueue').listSchedules(context);

    const rows = schedules.map((schedule) => {
        const { name, cron, nextRunAt, lastEnqueuedAt, lastJobId } = schedule;

        return {
            name,
            cron,
            nextRunAt,
            lastEnqueuedAt,
            lastJobId,
            links: {
                runs: getRunsPathname(context, name),
                lastJob: lastJobId ? getPathname(context, DETAIL_TARGET, { id: lastJobId }) : null,
            },
        };
    });

    return response.updateProps({
        schedules: rows,
        links: getSectionLinks(context),
        jobsView: 'schedules',
        queueDisabled: isQueueDisabled(context),
    });
}

/**
 * Renders every job registered in this build with its resolved settings.
 *
 * Only allow-listed `notice` codes are shown; anything else in the query
 * string is discarded rather than echoed into the page.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the registered job rows.
 */
export async function getAdminJobRegistry(context, request, response) {
    const notice = getNotice(request.queryParams.notice, REGISTERED_NOTICES);
    const props = await getRegistryPageProps(context, { notice });

    return response.updateProps(props);
}
