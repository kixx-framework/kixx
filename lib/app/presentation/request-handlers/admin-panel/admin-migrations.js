import { getMigration } from '../../../transaction-scripts/migrations/get-migration.js';
import { listMigrations } from '../../../transaction-scripts/migrations/list-migrations.js';
import { runMigration } from '../../../transaction-scripts/migrations/run-migration.js';
import RunMigrationForm from '../../forms/migrations/run-migration-form.js';
import { normalizeOptionalStringAttribute } from '../../forms/utils.js';
import { INVALID_CSRF_TOKEN_CODE, getCsrfToken, validateCsrfFormData } from '../../lib/csrf.js';
import {
    DETAIL_NOTICE_CODES,
    LIST_NOTICE_CODES,
    MIGRATION_NOTICES,
    classifyMigrationRunError,
    getMigrationNotice,
    getMigrationOutcomeStatus,
    recoverUnexpectedRunError,
} from '../../lib/migration-run-outcomes.js';


const FORCE_CONFIRMATION_FIELD = 'confirm_force';

const LIST_TARGET = 'admin-panel/migrations/render-list';
const DETAIL_TARGET = 'admin-panel/migration-detail/render-detail';
const FORCE_CONFIRM_TARGET = 'admin-panel/migration-force/render-confirm';


function getPathname(context, targetName, params) {
    return context.getHttpTarget(targetName).compilePathname(params).pathname;
}

function getListPathname(context) {
    return getPathname(context, LIST_TARGET);
}

function getDetailPathname(context, id) {
    return getPathname(context, DETAIL_TARGET, { id });
}

// Notice codes are allow-listed constants, never request data, so they are
// safe to put in the query string as-is.
function redirectWithNotice(context, response, targetName, params, code) {
    const pathname = getPathname(context, targetName, params);
    return response.respondWithRedirect(303, code ? `${ pathname }?notice=${ code }` : pathname);
}

function redirectNotFound(context, response) {
    return redirectWithNotice(context, response, LIST_TARGET, undefined, 'migration_not_found');
}

function isForceAvailable(status) {
    return status === 'applied' || status === 'failed';
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

function getRunInputs(context) {
    return {
        startedBy: context.user.id,
        now: new Date().toISOString(),
    };
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

// Builds the detail page props shared by every render of one migration. The
// lifecycle flags are computed here so the template holds no lifecycle rules.
async function getMigrationDetailProps(context, request, response, migration, notice) {
    const { id, status } = migration;

    return {
        migration: decorateMigration(migration),
        notice,
        csrf: await getCsrfToken(context, request, response),
        canRun: status !== 'applied',
        canForce: isForceAvailable(status),
        links: {
            list: getListPathname(context),
            detail: getDetailPathname(context, id),
            run: getPathname(context, 'admin-panel/migration-run/run', { id }),
            dryRun: getPathname(context, 'admin-panel/migration-dry-run/dry-run', { id }),
            forceConfirm: getPathname(context, FORCE_CONFIRM_TARGET, { id }),
        },
    };
}

function decorateMigration(migration) {
    return Object.assign({}, migration, { statsList: toStatsList(migration.stats) });
}

async function renderDryRun(context, request, response, migration, dryRun) {
    const props = await getMigrationDetailProps(context, request, response, migration, null);
    return response.updateProps(Object.assign(props, { dryRun }));
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
    const props = await getMigrationDetailProps(context, request, response, migration, notice);

    return response.updateProps(props);
}

/**
 * Runs one real migration batch and redirects to the detail page with the
 * outcome notice (post/redirect/get).
 *
 * An unexpected error from runMigration() is logged and redirects with
 * `batch_failed_unexpected` instead of propagating; see the sanctioned
 * exception in `lib/docs/server-error-handling.md`.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect carrying an outcome notice.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 */
export async function postMigrationRun(context, request, response) {
    const { id } = request.pathnameParams;

    const formData = await readVerifiedFormData(context, request);
    if (!formData) {
        return redirectWithNotice(context, response, DETAIL_TARGET, { id }, 'form_expired');
    }

    const run = { id, dryRun: false, force: false };
    const { startedBy, now } = getRunInputs(context);

    let result;
    let runError;
    try {
        result = await runMigration(context, { id, dryRun: false, force: false, cursor: null, startedBy, now });
    } catch (error) {
        runError = error;
    }

    if (runError) {
        // Sanctioned exception (lib/docs/server-error-handling.md): an
        // unexpected runMigration() error is logged, not rethrown.
        const code = classifyMigrationRunError(runError, { dryRun: false })
            || recoverUnexpectedRunError(context, runError, run);

        return redirectAfterRunError(context, response, id, code);
    }

    const code = result.done ? 'applied' : 'batch_complete';
    return redirectWithNotice(context, response, DETAIL_TARGET, { id }, code);
}

/**
 * Dry-runs one migration batch and renders its result on the detail page.
 *
 * The result is rendered directly rather than redirected, because dry-run
 * stats and the next cursor exist nowhere but in this response. The next
 * cursor travels in a hidden form field and is validated like the Admin API's.
 * An unexpected error from runMigration() is logged and rendered as
 * `dry_run_failed_unexpected`; see the sanctioned exception in
 * `lib/docs/server-error-handling.md`.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over a redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the dry-run props, or a 303 redirect.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 * @throws {AssertionError} When the migration status cannot be read.
 */
export async function postMigrationDryRun(context, request, response, skip) {
    const { id } = request.pathnameParams;

    const formData = await readVerifiedFormData(context, request);
    if (!formData) {
        skip();
        return redirectWithNotice(context, response, DETAIL_TARGET, { id }, 'form_expired');
    }

    const migration = await getMigration(context, id);
    if (!migration) {
        skip();
        return redirectNotFound(context, response);
    }

    const cursor = normalizeOptionalStringAttribute(formData.get('cursor'));
    const form = new RunMigrationForm({ dryRun: true, force: false, cursor });

    try {
        form.validate();
    } catch (error) {
        if (error.name !== 'ValidationError') {
            throw error;
        }
        return renderDryRunFailure(context, request, response, migration, 'dry_run_cursor_invalid', error);
    }

    const run = { id, dryRun: true, force: false };
    const { startedBy, now } = getRunInputs(context);

    let result;
    let runError;
    try {
        result = await runMigration(context, { id, dryRun: true, force: false, cursor: form.cursor, startedBy, now });
    } catch (error) {
        runError = error;
    }

    if (runError) {
        // Sanctioned exception (lib/docs/server-error-handling.md): an
        // unexpected runMigration() error is logged, not rethrown.
        const code = classifyMigrationRunError(runError, { dryRun: true })
            || recoverUnexpectedRunError(context, runError, run);

        // The migration was registered a moment ago, so only a race with a
        // deploy gets here.
        if (code === 'migration_not_found') {
            skip();
            return redirectNotFound(context, response);
        }

        return renderDryRunFailure(context, request, response, migration, code, runError);
    }

    response.status = 200;

    return renderDryRun(context, request, response, migration, {
        failed: false,
        done: result.done,
        canContinue: !result.done,
        cursor: result.cursor,
        statsList: toStatsList(result.stats),
        notice: MIGRATION_NOTICES[result.done ? 'dry_run_done' : 'dry_run_batch'],
    });
}

/**
 * Renders the force re-run confirmation page for an applied or failed migration.
 *
 * Other statuses redirect to the detail page with `force_unavailable`, because
 * force does not reset a pending or running ledger record.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @param {Function} skip - Ends the request phase, so the Hyperview page handler does not render over a redirect.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Response carrying the confirmation props, or a 303 redirect.
 * @throws {AssertionError} When the migration status cannot be read.
 */
export async function getMigrationForceConfirmation(context, request, response, skip) {
    const { id } = request.pathnameParams;
    const migration = await getMigration(context, id);

    if (!migration) {
        skip();
        return redirectNotFound(context, response);
    }

    if (!isForceAvailable(migration.status)) {
        skip();
        return redirectWithNotice(context, response, DETAIL_TARGET, { id }, 'force_unavailable');
    }

    return response.updateProps({
        migration: decorateMigration(migration),
        csrf: await getCsrfToken(context, request, response),
        links: {
            force: getPathname(context, 'admin-panel/migration-force/force', { id }),
            detail: getDetailPathname(context, id),
        },
    });
}

/**
 * Resets an applied or failed migration's ledger record and runs its first
 * batch, once the operator has submitted the confirmation form.
 *
 * An unexpected error from runMigration() is logged and redirects with
 * `batch_failed_unexpected` instead of propagating; see the sanctioned
 * exception in `lib/docs/server-error-handling.md`.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 303 redirect carrying an outcome notice.
 * @throws {ForbiddenError} When CSRF validation fails for a reason other than an expired token.
 * @throws {AssertionError} When the migration status cannot be read.
 */
export async function postMigrationForce(context, request, response) {
    const { id } = request.pathnameParams;

    const formData = await readVerifiedFormData(context, request);
    if (!formData) {
        return redirectWithNotice(context, response, DETAIL_TARGET, { id }, 'form_expired');
    }

    // Recheck the confirmation so a crafted or scripted submission cannot
    // skip the confirmation page.
    if (formData.get(FORCE_CONFIRMATION_FIELD) !== 'yes') {
        return redirectWithNotice(context, response, FORCE_CONFIRM_TARGET, { id });
    }

    const migration = await getMigration(context, id);
    if (!migration) {
        return redirectNotFound(context, response);
    }

    if (!isForceAvailable(migration.status)) {
        return redirectWithNotice(context, response, DETAIL_TARGET, { id }, 'force_unavailable');
    }

    const run = { id, dryRun: false, force: true };
    const { startedBy, now } = getRunInputs(context);

    let result;
    let runError;
    try {
        result = await runMigration(context, { id, dryRun: false, force: true, cursor: null, startedBy, now });
    } catch (error) {
        runError = error;
    }

    if (runError) {
        // Sanctioned exception (lib/docs/server-error-handling.md): an
        // unexpected runMigration() error is logged, not rethrown.
        const code = classifyMigrationRunError(runError, { dryRun: false })
            || recoverUnexpectedRunError(context, runError, run);

        return redirectAfterRunError(context, response, id, code);
    }

    const code = result.done ? 'applied' : 'force_started';
    return redirectWithNotice(context, response, DETAIL_TARGET, { id }, code);
}

function redirectAfterRunError(context, response, id, code) {
    if (code === 'migration_not_found') {
        return redirectNotFound(context, response);
    }
    return redirectWithNotice(context, response, DETAIL_TARGET, { id }, code);
}

// Only an expected error's message is client-safe; the cursor and unexpected
// failures render their fixed notice text alone.
function renderDryRunFailure(context, request, response, migration, code, error) {
    response.status = getMigrationOutcomeStatus(code, error);

    return renderDryRun(context, request, response, migration, {
        failed: true,
        canContinue: false,
        notice: MIGRATION_NOTICES[code],
        detail: code === 'dry_run_failed' ? error.message : null,
    });
}
