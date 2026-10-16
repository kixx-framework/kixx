import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getAdminJob,
    getAdminJobs,
} from '../../../../../app/presentation/request-handlers/admin-panel/admin-jobs.js';
import { ValidationError } from '../../../../../kixx/errors/mod.js';


const JOB_ID = '6f1c1b1e-0000-4000-8000-000000000001';

const TARGET_PATTERNS = {
    'admin-panel/jobs/render-list': '/admin/jobs',
    'admin-panel/job-detail/render-detail': '/admin/jobs/:id',
};

const TONE_ROLES = {
    info: 'status',
    success: 'status',
    warning: 'alert',
    error: 'alert',
};

const LIST_NOTICE_CODES = [ 'job_not_found' ];

const DETAIL_NOTICE_CODES = [
    'retry_queued',
    'retry_conflict',
    'run_now_enqueued',
    'run_now_already_queued',
    'form_expired',
];


describe('Admin jobs list', ({ it }) => {
    it('lists jobs with detail links and no filters', async () => {
        const context = makeContext({ listResult: { jobs: [ makeJob() ], cursor: null } });
        const response = makeResponse();

        await getAdminJobs(context, makeRequest({}), response);

        assertEqual(1, context.calls.list.length);
        const [ options ] = context.calls.list;
        assertEqual('limit', Object.keys(options).join(','));
        assertEqual(50, options.limit);

        const [ row ] = response.props.jobs;
        assertEqual(JOB_ID, row.id);
        assertEqual('send-email', row.name);
        assertEqual('failed', row.status);
        assertEqual(3, row.attempt);
        assertEqual(5, row.maxAttempts);
        assertEqual('2026-10-16T10:00:00.000Z', row.createdAt);
        assertEqual('2026-10-16T10:01:00.000Z', row.runAt);
        assertEqual('2026-10-16T10:02:00.000Z', row.finishedAt);
        assertEqual(`/admin/jobs/${ JOB_ID }`, row.links.detail);
        assert(!Object.hasOwn(row, 'payload'));

        assertEqual('/admin/jobs', response.props.links.jobs);
        assertEqual(false, response.props.showPagination);
        assertEqual('list', response.props.jobsView);
        assertEqual(false, response.props.queueDisabled);
        assertEqual(null, response.props.notice);
        assertEqual('', response.props.filters.name);
        assertEqual(false, response.props.filters.isFiltered);
        assertEqual(
            'pending,running,completed,failed',
            response.props.filters.statusOptions.map(({ value }) => value).join(','),
        );
        assertEqual(0, response.props.filters.statusOptions.filter(({ selected }) => selected).length);
    });

    it('passes the status and trimmed name filters through', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminJobs(context, makeRequest({ queryParams: { status: 'failed', name: '  send-email ' } }), response);

        const [ options ] = context.calls.list;
        assertEqual('failed', options.status);
        assertEqual('send-email', options.name);
        assertEqual('send-email', response.props.filters.name);
        assertEqual(true, response.props.filters.isFiltered);

        const selected = response.props.filters.statusOptions.filter((option) => option.selected);
        assertEqual(1, selected.length);
        assertEqual('failed', selected[0].value);
    });

    it('omits blank filters', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminJobs(context, makeRequest({ queryParams: { status: '', name: '   ' } }), response);

        const [ options ] = context.calls.list;
        assertEqual('limit', Object.keys(options).join(','));
        assertEqual(false, response.props.filters.isFiltered);
        assertEqual('', response.props.filters.name);
    });

    it('rejects repeated filter parameters', async () => {
        for (const queryParams of [ { status: [ 'failed', 'pending' ] }, { name: [ 'a', 'b' ] } ]) {
            const context = makeContext({});

            const error = await catchAsyncError(() => getAdminJobs(context, makeRequest({ queryParams }), makeResponse()));

            assert(error);
            assertEqual('BadRequestError', error.name);
            assertEqual(0, context.calls.list.length);
        }
    });

    it('turns a queue ValidationError into a BadRequestError with its message', async () => {
        const cause = new ValidationError('status must be one of pending, running, completed, failed');
        const context = makeContext({ listError: cause });

        const error = await catchAsyncError(() => {
            return getAdminJobs(context, makeRequest({ queryParams: { status: 'bogus' } }), makeResponse());
        });

        assert(error);
        assertEqual('BadRequestError', error.name);
        assertEqual(cause.message, error.message);
        assertEqual(cause, error.cause);
        assertEqual('bogus', context.calls.list[0].status);
    });

    it('rethrows other list errors', async () => {
        const cause = new Error('boom');
        const context = makeContext({ listError: cause });

        const error = await catchAsyncError(() => getAdminJobs(context, makeRequest({}), makeResponse()));

        assertEqual(cause, error);
    });

    it('keeps the filters on the next page link', async () => {
        const context = makeContext({ listResult: { jobs: [ makeJob() ], cursor: 'next-1' } });
        const response = makeResponse();

        await getAdminJobs(context, makeRequest({ queryParams: { status: 'failed', name: 'send-email' } }), response);

        const next = new URL(response.props.links.nextPage, 'http://localhost');
        assertEqual('/admin/jobs', next.pathname);
        assertEqual('failed', next.searchParams.get('status'));
        assertEqual('send-email', next.searchParams.get('name'));
        assertEqual('next-1', next.searchParams.get('cursor'));
        assertEqual('', next.searchParams.getAll('history').join(','));
        assertEqual(1, next.searchParams.getAll('history').length);
        assertEqual(true, response.props.showPagination);
        assert(!response.props.links.previousPage);
    });

    it('keeps the filters on the previous page link from page two', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminJobs(
            context,
            makeRequest({ queryParams: { status: 'failed', name: 'send-email', cursor: 'next-1', history: '' } }),
            response,
        );

        assertEqual('next-1', context.calls.list[0].cursor);

        const previous = new URL(response.props.links.previousPage, 'http://localhost');
        assertEqual('/admin/jobs', previous.pathname);
        assertEqual('failed', previous.searchParams.get('status'));
        assertEqual('send-email', previous.searchParams.get('name'));
        assertEqual(null, previous.searchParams.get('cursor'));
        assertEqual(0, previous.searchParams.getAll('history').length);
        assert(!response.props.links.nextPage);
    });

    it('applies the list notice allow-list', async () => {
        for (const code of LIST_NOTICE_CODES) {
            const response = makeResponse();
            await getAdminJobs(makeContext({}), makeRequest({ queryParams: { notice: code } }), response);
            assertNotice(code, response.props.notice);
        }

        for (const notice of [ 'retry_queued', 'nope', '<script>', [ 'job_not_found' ], 'toString' ]) {
            const response = makeResponse();
            await getAdminJobs(makeContext({}), makeRequest({ queryParams: { notice } }), response);
            assertEqual(null, response.props.notice, String(notice));
        }
    });

    it('flags the queue as disabled only when enabled is false', async () => {
        for (const [ enabled, expected ] of [ [ false, true ], [ true, false ], [ undefined, false ] ]) {
            const response = makeResponse();
            await getAdminJobs(makeContext({ enabled }), makeRequest({}), response);
            assertEqual(expected, response.props.queueDisabled, String(enabled));
        }
    });
});

describe('Admin job detail', ({ it }) => {
    it('returns every job field with pretty JSON and canRetry', async () => {
        const job = makeJob();
        const context = makeContext({ jobs: { [JOB_ID]: job } });
        const response = makeResponse();

        await getAdminJob(context, makeRequest({ pathnameParams: { id: JOB_ID } }), response);

        assertEqual(200, response.status);
        assertEqual(JOB_ID, context.calls.get[0]);

        const props = response.props.job;
        for (const key of Object.keys(job)) {
            assertEqual(job[key], props[key], key);
        }
        assertEqual(JSON.stringify(job.payload, null, 2), props.payloadJson);
        assert(props.payloadJson.includes('\n  "to"'));
        assertEqual(true, props.canRetry);

        assertEqual('/admin/jobs', response.props.links.jobs);
        assertEqual(`/admin/jobs/${ JOB_ID }`, response.props.links.detail);
        assertEqual('list', response.props.jobsView);
        assertEqual(false, response.props.queueDisabled);
        assertEqual(null, response.props.notice);
        assert(!response.props.missing);
    });

    it('allows retry only for failed jobs', async () => {
        for (const status of [ 'pending', 'running', 'completed' ]) {
            const context = makeContext({ jobs: { [JOB_ID]: makeJob({ status, lastError: null }) } });
            const response = makeResponse();

            await getAdminJob(context, makeRequest({ pathnameParams: { id: JOB_ID } }), response);

            assertEqual(false, response.props.job.canRetry, status);
        }
    });

    it('renders the missing state with status 404 for an unknown id', async () => {
        const context = makeContext({ enabled: false });
        const response = makeResponse();

        await getAdminJob(
            context,
            makeRequest({ pathnameParams: { id: 'unknown' }, queryParams: { notice: 'retry_queued' } }),
            response,
        );

        assertEqual(404, response.status);
        assertEqual(true, response.props.missing);
        assertEqual('/admin/jobs', response.props.links.jobs);
        assertEqual('list', response.props.jobsView);
        assertEqual(true, response.props.queueDisabled);
        assert(!Object.hasOwn(response.props, 'job'));
        assert(!Object.hasOwn(response.props, 'notice'));
    });

    it('applies the detail notice allow-list', async () => {
        for (const code of DETAIL_NOTICE_CODES) {
            const context = makeContext({ jobs: { [JOB_ID]: makeJob() } });
            const response = makeResponse();

            await getAdminJob(context, makeRequest({ pathnameParams: { id: JOB_ID }, queryParams: { notice: code } }), response);

            assertNotice(code, response.props.notice);
        }

        for (const notice of [ 'job_not_found', 'job_not_registered', 'nope', 42 ]) {
            const context = makeContext({ jobs: { [JOB_ID]: makeJob() } });
            const response = makeResponse();

            await getAdminJob(context, makeRequest({ pathnameParams: { id: JOB_ID }, queryParams: { notice } }), response);

            assertEqual(null, response.props.notice, String(notice));
        }
    });
});


function assertNotice(code, notice) {
    assert(notice, `expected notice ${ code }`);
    assertEqual(code, notice.code);
    assert(Object.hasOwn(TONE_ROLES, notice.tone), `tone for ${ code }`);
    assertEqual(TONE_ROLES[notice.tone], notice.role, code);
    assert(notice.title.length > 0, `title for ${ code }`);
    assert(notice.message.length > 0, `message for ${ code }`);
}

function makeJob(overrides = {}) {
    return Object.assign({
        id: JOB_ID,
        name: 'send-email',
        key: 'admin-run:send-email',
        scheduleName: null,
        payload: { to: 'someone@example.com', tags: [ 'a', 'b' ] },
        status: 'failed',
        attempt: 3,
        maxAttempts: 5,
        runAt: '2026-10-16T10:01:00.000Z',
        scheduledFor: null,
        createdAt: '2026-10-16T10:00:00.000Z',
        updatedAt: '2026-10-16T10:02:00.000Z',
        finishedAt: '2026-10-16T10:02:00.000Z',
        lastError: {
            name: 'ConflictError',
            message: 'Scratch failure',
            stack: 'ConflictError: Scratch failure\n    at handler',
            expected: true,
        },
    }, overrides);
}

function makeContext(options) {
    const {
        jobs = {},
        listResult = { jobs: [], cursor: null },
        listError,
        enabled = true,
    } = options;

    const calls = {
        list: [],
        get: [],
        retry: [],
        listSchedules: [],
        enqueue: [],
    };

    const queue = {
        async list(_context, listOptions) {
            calls.list.push(listOptions);
            if (listError) {
                throw listError;
            }
            return listResult;
        },
        async get(_context, id) {
            calls.get.push(id);
            return jobs[id] || null;
        },
        async retry(_context, id) {
            calls.retry.push(id);
            return jobs[id] || null;
        },
        async listSchedules() {
            calls.listSchedules.push(true);
            return [];
        },
        async enqueue(_context, name, payload, enqueueOptions) {
            calls.enqueue.push({ name, payload, options: enqueueOptions });
            return { id: 'job-9', created: true };
        },
    };

    const csrf = {
        async sign() {
            return 'fresh-csrf-token';
        },
        async verify() {
            return true;
        },
    };

    return {
        calls,
        user: { id: 'admin-1' },
        config: { env: { JOB_QUEUE: { enabled } } },
        getService(name) {
            return name === 'JobQueue' ? queue : csrf;
        },
        getHttpTarget(name) {
            const pattern = TARGET_PATTERNS[name];
            assert(pattern, `unknown target ${ name }`);
            return {
                compilePathname(params) {
                    const id = (params && params.id) || '';
                    return { pathname: pattern.replace(':id', id) };
                },
            };
        },
    };
}

function makeRequest(options) {
    const { queryParams = {}, pathnameParams = {} } = options;

    return {
        queryParams,
        pathnameParams,
        url: new URL('https://example.com/admin/jobs'),
        headers: {
            get() {
                return null;
            },
        },
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'browser-session' : null;
        },
    };
}

function makeResponse() {
    return {
        props: {},
        status: 200,
        redirect: null,
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
