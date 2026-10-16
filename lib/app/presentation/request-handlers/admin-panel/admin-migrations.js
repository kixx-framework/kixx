import { getMigration } from '../../../transaction-scripts/migrations/get-migration.js';
import { listMigrations } from '../../../transaction-scripts/migrations/list-migrations.js';
import {
    DETAIL_NOTICE_CODES,
    LIST_NOTICE_CODES,
    getMigrationNotice,
} from '../../lib/migration-run-outcomes.js';


function getListPathname(context) {
    return context.getHttpTarget('admin-panel/migrations/render-list').compilePathname().pathname;
}

function getDetailPathname(context, id) {
    return context.getHttpTarget('admin-panel/migration-detail/render-detail').compilePathname({ id }).pathname;
}

// Stats are rendered as rows in object key order. An array lets the template
// show an empty state, and the browser can rebuild the same list from JSON.
function toStatsList(stats) {
    if (!stats) {
        return [];
    }

    return Object.keys(stats).map((name) => {
        return { name, value: stats[name] };
    });
}

// Builds the detail page props shared by every render of one migration.
function getMigrationDetailProps(context, migration, notice) {
    return {
        migration: Object.assign({}, migration, { statsList: toStatsList(migration.stats) }),
        notice,
        links: {
            list: getListPathname(context),
            detail: getDetailPathname(context, migration.id),
        },
    };
}

/**
 * Renders every registered migration with its ledger status.
 *
 * Only allow-listed `notice` codes are shown; anything else in the query
 * string is discarded rather than echoed into the page.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the migration rows and notice.
 * @throws {AssertionError} When an unexpected ledger read fails.
 */
export async function getAdminMigrations(context, request, response) {
    const migrations = await listMigrations(context);

    const rows = migrations.map(({ id, description, status }) => {
        return {
            id,
            description,
            status,
            links: { detail: getDetailPathname(context, id) },
        };
    });

    return response.updateProps({
        migrations: rows,
        notice: getMigrationNotice(request.queryParams.notice, LIST_NOTICE_CODES),
        links: { list: getListPathname(context) },
    });
}

/**
 * Renders one migration's ledger record.
 *
 * An unregistered id renders the page's "not found" state with status 404,
 * without reading the ledger or echoing the id.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the migration detail props.
 * @throws {AssertionError} When an unexpected ledger read fails.
 */
export async function getAdminMigration(context, request, response) {
    const { id } = request.pathnameParams;
    const migration = await getMigration(context, id);

    if (!migration) {
        response.status = 404;
        return response.updateProps({
            missing: true,
            links: { list: getListPathname(context) },
        });
    }

    const notice = getMigrationNotice(request.queryParams.notice, DETAIL_NOTICE_CODES);

    return response.updateProps(getMigrationDetailProps(context, migration, notice));
}
