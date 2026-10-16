import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getAdminMigration,
    getAdminMigrations,
    getMigrationForceConfirmation,
    postMigrationDryRun,
    postMigrationForce,
    postMigrationRun,
} from '../../../../../app/presentation/request-handlers/admin-panel/admin-migrations.js';


const NOOP_ID = '2026-07-17-example-noop';


describe('Admin migration list', ({ it }) => {
    it('returns registry-ordered rows with compiled detail links', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminMigrations(context, makeRequest({}), response);

        const [ row ] = response.props.migrations;
        assertEqual(NOOP_ID, row.id);
        assert(row.description.length > 0);
        assertEqual('pending', row.status);
        assertEqual(`/admin/migrations/${ NOOP_ID }`, row.links.detail);
        assertEqual('/admin/migrations', response.props.links.list);
        assertEqual(null, response.props.notice);
    });

    it('accepts the not-found notice', async () => {
        const response = makeResponse();

        await getAdminMigrations(
            makeContext({}),
            makeRequest({ queryParams: { notice: 'migration_not_found' } }),
            response,
        );

        assertEqual('migration_not_found', response.props.notice.code);
        assertEqual('error', response.props.notice.tone);
    });

    it('discards disallowed, unknown, and markup-like notices', async () => {
        for (const notice of [ 'already_applied', 'nope', '<script>alert(1)</script>' ]) {
            const response = makeResponse();

            await getAdminMigrations(makeContext({}), makeRequest({ queryParams: { notice } }), response);

            assertEqual(null, response.props.notice, notice);
        }
    });
});

describe('Admin migration detail', ({ it }) => {
    it('returns the pending projection with an empty stats list', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminMigration(context, makeRequest({ pathnameParams: { id: NOOP_ID } }), response);

        const { migration } = response.props;
        assertEqual(200, response.status);
        assertEqual(NOOP_ID, migration.id);
        assertEqual('pending', migration.status);
        assertEqual(null, migration.lastBatchAt);
        assertEqual(0, migration.statsList.length);
        assertEqual(null, response.props.notice);
        assertEqual('/admin/migrations', response.props.links.list);
        assertEqual(`/admin/migrations/${ NOOP_ID }`, response.props.links.detail);
        assertEqual(1, context.reads.length);
    });

    it('returns every ledger field and the stats list for an applied record', async () => {
        const context = makeContext({
            [NOOP_ID]: makeRecord({
                status: 'applied',
                cursor: 'secret-cursor',
                stats: { scanned: 30, updated: 4 },
                batchCount: 3,
                startedBy: 'admin-1',
                startedAt: '2026-10-16T10:00:00.000Z',
                lastBatchAt: '2026-10-16T10:02:00.000Z',
                completedAt: '2026-10-16T10:02:00.000Z',
                error: null,
            }),
        });
        const response = makeResponse();

        await getAdminMigration(context, makeRequest({ pathnameParams: { id: NOOP_ID } }), response);

        const { migration } = response.props;
        assertEqual('applied', migration.status);
        assertEqual(3, migration.batchCount);
        assertEqual('admin-1', migration.startedBy);
        assertEqual('2026-10-16T10:00:00.000Z', migration.startedAt);
        assertEqual('2026-10-16T10:02:00.000Z', migration.lastBatchAt);
        assertEqual('2026-10-16T10:02:00.000Z', migration.completedAt);
        assertEqual(null, migration.error);
        assert(!Object.hasOwn(migration, 'cursor'));
        assertEqual(2, migration.statsList.length);
        assertEqual('scanned', migration.statsList[0].name);
        assertEqual(30, migration.statsList[0].value);
        assertEqual('updated', migration.statsList[1].name);
        assertEqual(4, migration.statsList[1].value);
    });

    it('accepts detail notices and rejects others', async () => {
        const accepted = makeResponse();
        await getAdminMigration(
            makeContext({}),
            makeRequest({ pathnameParams: { id: NOOP_ID }, queryParams: { notice: 'batch_failed_unexpected' } }),
            accepted,
        );
        assertEqual('batch_failed_unexpected', accepted.props.notice.code);

        for (const notice of [ 'migration_not_found', 'dry_run_done', 'nope' ]) {
            const response = makeResponse();

            await getAdminMigration(
                makeContext({}),
                makeRequest({ pathnameParams: { id: NOOP_ID }, queryParams: { notice } }),
                response,
            );

            assertEqual(null, response.props.notice, notice);
        }
    });

    it('renders the not-found state for an unknown id without reading the ledger', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await getAdminMigration(
            context,
            makeRequest({ pathnameParams: { id: '2026-01-01-not-registered' }, queryParams: { notice: 'applied' } }),
            response,
        );

        assertEqual(404, response.status);
        assertEqual(true, response.props.missing);
        assertEqual('/admin/migrations', response.props.links.list);
        assertEqual(undefined, response.props.migration);
        assertEqual(undefined, response.props.notice);
        assertEqual(0, context.reads.length);
    });
});


describe('Admin migration detail actions', ({ it }) => {
    it('offers run and dry run but not force for a pending migration', async () => {
        const response = makeResponse();

        await getAdminMigration(makeContext({}), makeRequest({ pathnameParams: { id: NOOP_ID } }), response);

        const { props } = response;
        assertEqual(true, props.canRun);
        assertEqual(false, props.canForce);
        assertEqual('fresh-csrf-token', props.csrf.token);
        assertEqual('csrf_token', props.csrf.fieldName);
        assertEqual(`/admin/migrations/${ NOOP_ID }/run`, props.links.run);
        assertEqual(`/admin/migrations/${ NOOP_ID }/dry-run`, props.links.dryRun);
        assertEqual(`/admin/migrations/${ NOOP_ID }/force`, props.links.forceConfirm);
    });

    it('hides run and offers force for an applied migration', async () => {
        const response = makeResponse();
        const context = makeContext({ [NOOP_ID]: makeAppliedRecord() });

        await getAdminMigration(context, makeRequest({ pathnameParams: { id: NOOP_ID } }), response);

        assertEqual(false, response.props.canRun);
        assertEqual(true, response.props.canForce);
    });
});

describe('Admin migration run', ({ it }) => {
    it('creates the ledger record and redirects with the applied notice', async () => {
        const store = {};
        const context = makeContext(store);
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(303, response.redirect.status);
        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=applied`, response.redirect.location);
        assertEqual('create', context.writes[0].op);
        assertEqual('admin-1', store[NOOP_ID].get('startedBy'));
        assertEqual('applied', store[NOOP_ID].get('status'));
        assertEqual(0, context.logged.length);
    });

    it('redirects with already_applied and writes nothing for an applied record', async () => {
        const context = makeContext({ [NOOP_ID]: makeAppliedRecord() });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=already_applied`, response.redirect.location);
        assertEqual(0, context.writes.length);
    });

    it('redirects with concurrent_run on a version conflict', async () => {
        const context = makeContext({ [NOOP_ID]: makeRecord(runningState()) }, {
            updateError: { name: 'VersionConflictError', message: 'stale' },
        });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=concurrent_run`, response.redirect.location);
        assertEqual(0, context.logged.length);
    });

    it('redirects with concurrent_run when another request created the record', async () => {
        const context = makeContext({}, {
            createError: { name: 'DocumentAlreadyExistsError', message: 'exists' },
        });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=concurrent_run`, response.redirect.location);
    });

    it('redirects an unregistered id to the list notice', async () => {
        const context = makeContext({});
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest({ id: '2026-01-01-not-registered' }), response);

        assertEqual(303, response.redirect.status);
        assertEqual('/admin/migrations?notice=migration_not_found', response.redirect.location);
        assertEqual(0, context.reads.length);
    });

    it('redirects with form_expired and touches no ledger on a CSRF failure', async () => {
        const context = makeContext({}, { csrfValid: false });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=form_expired`, response.redirect.location);
        assertEqual(0, context.reads.length);
        assertEqual(0, context.writes.length);
    });

    it('logs and redirects with batch_failed_unexpected when the ledger read fails', async () => {
        const readError = new Error('storage offline');
        const context = makeContext({}, { readError });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(303, response.redirect.status);
        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=batch_failed_unexpected`, response.redirect.location);
        assertUnexpectedLog(context, { dryRun: false, force: false, cause: readError });
    });

    it('logs and redirects with batch_failed_unexpected when a ledger write fails', async () => {
        const updateError = new Error('disk full');
        const context = makeContext({ [NOOP_ID]: makeRecord(runningState()) }, { updateError });
        const response = makeResponse();

        await postMigrationRun(context, makePostRequest(), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=batch_failed_unexpected`, response.redirect.location);
        assertUnexpectedLog(context, { dryRun: false, force: false, cause: updateError });
    });

    it('rethrows a CSRF failure that is not an expired token', async () => {
        const context = makeContext({}, { csrfError: new Error('signer broken') });
        let caught;

        try {
            await postMigrationRun(context, makePostRequest(), makeResponse());
        } catch (error) {
            caught = error;
        }

        assertEqual('signer broken', caught && caught.message);
        assertEqual(0, context.logged.length);
    });
});

describe('Admin migration dry run', ({ it }) => {
    it('renders the batch result for a blank cursor without writing', async () => {
        const context = makeContext({});
        const response = makeResponse();
        const skip = makeSkip();

        await postMigrationDryRun(context, makePostRequest({ fields: { cursor: '' } }), response, skip);

        const { dryRun } = response.props;
        assertEqual(200, response.status);
        assertEqual(false, skip.called);
        assertEqual(null, response.redirect);
        assertEqual(true, dryRun.done);
        assertEqual(false, dryRun.failed);
        assertEqual(false, dryRun.canContinue);
        assertEqual(null, dryRun.cursor);
        assertEqual('dry_run_done', dryRun.notice.code);
        assertEqual(1, dryRun.statsList.length);
        assertEqual('scanned', dryRun.statsList[0].name);
        assertEqual(0, dryRun.statsList[0].value);
        assertEqual('fresh-csrf-token', response.props.csrf.token);
        assertEqual(null, response.props.notice);
        assertEqual(NOOP_ID, response.props.migration.id);
        assertEqual(0, context.writes.length);
    });

    it('renders dry_run_cursor_invalid for a non-string cursor without running', async () => {
        const context = makeContext({});
        const response = makeResponse();
        const skip = makeSkip();

        await postMigrationDryRun(
            context,
            makePostRequest({ fields: { cursor: new Blob([ 'x' ]) } }),
            response,
            skip,
        );

        assertEqual(400, response.status);
        assertEqual(false, skip.called);
        assertEqual('dry_run_cursor_invalid', response.props.dryRun.notice.code);
        assertEqual(true, response.props.dryRun.failed);
        assertEqual(null, response.props.dryRun.detail);
        assertEqual(0, context.logged.length);
    });

    it('skips and redirects an unregistered id to the list notice', async () => {
        const context = makeContext({});
        const response = makeResponse();
        const skip = makeSkip();

        await postMigrationDryRun(context, makePostRequest({ id: '2026-01-01-not-registered' }), response, skip);

        assertEqual(true, skip.called);
        assertEqual('/admin/migrations?notice=migration_not_found', response.redirect.location);
    });

    it('skips and redirects with form_expired on a CSRF failure', async () => {
        const context = makeContext({}, { csrfValid: false });
        const response = makeResponse();
        const skip = makeSkip();

        await postMigrationDryRun(context, makePostRequest(), response, skip);

        assertEqual(true, skip.called);
        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=form_expired`, response.redirect.location);
        assertEqual(0, context.reads.length);
    });

    it('rethrows a failed status pre-read without logging', async () => {
        const context = makeContext({}, { readError: new Error('storage offline') });
        let caught;

        try {
            await postMigrationDryRun(context, makePostRequest(), makeResponse(), makeSkip());
        } catch (error) {
            caught = error;
        }

        assertEqual('AssertionError', caught && caught.name);
        assertEqual(0, context.logged.length);
    });
});

describe('Admin migration force', ({ it }) => {
    it('renders the confirmation for applied and failed records', async () => {
        for (const status of [ 'applied', 'failed' ]) {
            const context = makeContext({ [NOOP_ID]: makeRecord(Object.assign(runningState(), { status })) });
            const response = makeResponse();
            const skip = makeSkip();

            await getMigrationForceConfirmation(context, makeRequest({ pathnameParams: { id: NOOP_ID } }), response, skip);

            assertEqual(false, skip.called, status);
            assertEqual(status, response.props.migration.status);
            assertEqual('fresh-csrf-token', response.props.csrf.token);
            assertEqual(`/admin/migrations/${ NOOP_ID }/force`, response.props.links.force);
            assertEqual(`/admin/migrations/${ NOOP_ID }`, response.props.links.detail);
        }
    });

    it('redirects pending and running migrations with force_unavailable', async () => {
        const stores = [ {}, { [NOOP_ID]: makeRecord(runningState()) } ];

        for (const store of stores) {
            const response = makeResponse();
            const skip = makeSkip();

            await getMigrationForceConfirmation(
                makeContext(store),
                makeRequest({ pathnameParams: { id: NOOP_ID } }),
                response,
                skip,
            );

            assertEqual(true, skip.called);
            assertEqual(`/admin/migrations/${ NOOP_ID }?notice=force_unavailable`, response.redirect.location);
        }
    });

    it('redirects an unknown id on the confirmation page to the list notice', async () => {
        const response = makeResponse();
        const skip = makeSkip();

        await getMigrationForceConfirmation(
            makeContext({}),
            makeRequest({ pathnameParams: { id: '2026-01-01-not-registered' } }),
            response,
            skip,
        );

        assertEqual(true, skip.called);
        assertEqual('/admin/migrations?notice=migration_not_found', response.redirect.location);
    });

    it('redirects to the confirmation page without confirm_force', async () => {
        const context = makeContext({ [NOOP_ID]: makeAppliedRecord() });
        const response = makeResponse();

        await postMigrationForce(context, makePostRequest({ fields: { confirm_force: 'no' } }), response);

        assertEqual(303, response.redirect.status);
        assertEqual(`/admin/migrations/${ NOOP_ID }/force`, response.redirect.location);
        assertEqual(0, context.writes.length);
    });

    it('resets an applied record and runs its first batch', async () => {
        const store = { [NOOP_ID]: makeAppliedRecord() };
        const context = makeContext(store);
        context.user = { id: 'admin-2' };
        const response = makeResponse();

        await postMigrationForce(context, makePostRequest({ fields: { confirm_force: 'yes' } }), response);

        const record = store[NOOP_ID];
        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=applied`, response.redirect.location);
        assertEqual('applied', record.get('status'));
        assertEqual(1, record.get('batchCount'));
        assertEqual('admin-2', record.get('startedBy'));
    });

    it('redirects a running record with force_unavailable without running', async () => {
        const context = makeContext({ [NOOP_ID]: makeRecord(runningState()) });
        const response = makeResponse();

        await postMigrationForce(context, makePostRequest({ fields: { confirm_force: 'yes' } }), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=force_unavailable`, response.redirect.location);
        assertEqual(0, context.writes.length);
    });

    it('logs and redirects with batch_failed_unexpected when the reset write fails', async () => {
        const updateError = new Error('disk full');
        const context = makeContext({ [NOOP_ID]: makeAppliedRecord() }, { updateError });
        const response = makeResponse();

        await postMigrationForce(context, makePostRequest({ fields: { confirm_force: 'yes' } }), response);

        assertEqual(`/admin/migrations/${ NOOP_ID }?notice=batch_failed_unexpected`, response.redirect.location);
        assertUnexpectedLog(context, { dryRun: false, force: true, cause: updateError });
    });
});


function runningState() {
    return {
        status: 'running',
        cursor: null,
        stats: { scanned: 10 },
        batchCount: 1,
        startedBy: 'admin-1',
        startedAt: '2026-10-16T10:00:00.000Z',
        lastBatchAt: '2026-10-16T10:01:00.000Z',
        completedAt: null,
        error: null,
    };
}

function makeAppliedRecord() {
    return makeRecord({
        status: 'applied',
        cursor: null,
        stats: { scanned: 30 },
        batchCount: 3,
        startedBy: 'admin-1',
        startedAt: '2026-10-16T10:00:00.000Z',
        lastBatchAt: '2026-10-16T10:02:00.000Z',
        completedAt: '2026-10-16T10:02:00.000Z',
        error: null,
    });
}

function assertUnexpectedLog(context, { dryRun, force, cause }) {
    assertEqual(1, context.logged.length);

    const [ entry ] = context.logged;
    assertEqual('error', entry.level);
    assertEqual('unexpected error while running migration batch from admin panel', entry.message);
    assertEqual('req-1', entry.info.requestId);
    assertEqual(NOOP_ID, entry.info.migrationId);
    assertEqual(dryRun, entry.info.dryRun);
    assertEqual(force, entry.info.force);
    assertEqual('AssertionError', entry.error.name);
    assertEqual(cause, entry.error.cause);
}

function makeSkip() {
    const skip = () => {
        skip.called = true;
    };
    skip.called = false;
    return skip;
}

const TARGET_PATTERNS = {
    'admin-panel/migrations/render-list': '/admin/migrations',
    'admin-panel/migration-detail/render-detail': '/admin/migrations/:id',
    'admin-panel/migration-run/run': '/admin/migrations/:id/run',
    'admin-panel/migration-dry-run/dry-run': '/admin/migrations/:id/dry-run',
    'admin-panel/migration-force/render-confirm': '/admin/migrations/:id/force',
    'admin-panel/migration-force/force': '/admin/migrations/:id/force',
};

function makeRecord(attributes) {
    const data = Object.assign({}, attributes);

    return {
        get(name) {
            return data[name];
        },
        merge(patch) {
            Object.assign(data, patch);
            return this;
        },
    };
}

function makeContext(store, options = {}) {
    const {
        readError,
        createError,
        updateError,
        csrfValid = true,
        csrfError,
    } = options;

    const reads = [];
    const writes = [];
    const logged = [];

    const migrationCollection = {
        async getByMigrationId(_context, id) {
            reads.push(id);
            if (readError) {
                throw readError;
            }
            return store[id] || null;
        },
        async createLedgerRecord(_context, id, attributes) {
            writes.push({ op: 'create', id });
            if (createError) {
                throw createError;
            }
            store[id] = makeRecord(Object.assign({}, attributes, { id }));
            return store[id];
        },
        async updateLedgerRecord(_context, record) {
            writes.push({ op: 'update' });
            if (updateError) {
                throw updateError;
            }
            return record;
        },
    };

    const logger = {};
    for (const level of [ 'error', 'warn', 'info', 'debug' ]) {
        logger[level] = (message, info, error) => {
            logged.push({ level, message, info, error });
        };
    }

    return {
        reads,
        writes,
        logged,
        logger,
        requestId: 'req-1',
        user: { id: 'admin-1' },
        getCollection(name) {
            assertEqual('Migration', name);
            return migrationCollection;
        },
        getService() {
            return {
                async sign() {
                    return 'fresh-csrf-token';
                },
                async verify() {
                    if (csrfError) {
                        throw csrfError;
                    }
                    return csrfValid;
                },
            };
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
        url: new URL('https://example.com/admin/migrations'),
        headers: { get: () => null },
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'browser-session' : null;
        },
    };
}

function makePostRequest(options = {}) {
    const { id = NOOP_ID, fields = {} } = options;
    const request = makeRequest({ pathnameParams: { id } });
    const formData = new FormData();

    formData.set('csrf_token', 'submitted-token');
    for (const [ name, value ] of Object.entries(fields)) {
        formData.set(name, value);
    }

    let reads = 0;
    request.formData = async () => {
        reads += 1;
        assertEqual(1, reads, 'formData() read more than once');
        return formData;
    };

    return request;
}

function makeResponse() {
    return {
        props: {},
        status: 200,
        redirect: null,
        json: null,
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
        respondWithJSON(status, body) {
            this.status = status;
            this.json = { status, body };
            return this;
        },
    };
}
