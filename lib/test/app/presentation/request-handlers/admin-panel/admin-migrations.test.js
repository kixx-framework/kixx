import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getAdminMigration,
    getAdminMigrations,
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

function makeContext(store) {
    const reads = [];
    const writes = [];

    const migrationCollection = {
        async getByMigrationId(_context, id) {
            reads.push(id);
            return store[id] || null;
        },
        async createLedgerRecord(_context, id, attributes) {
            writes.push({ op: 'create', id });
            store[id] = makeRecord(Object.assign({}, attributes, { id }));
            return store[id];
        },
        async updateLedgerRecord(_context, record) {
            writes.push({ op: 'update' });
            return record;
        },
    };

    return {
        reads,
        writes,
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
                    return true;
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
