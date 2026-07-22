import RunMigrationForm from '../../forms/migrations/run-migration-form.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { runMigration as runMigrationBatch } from '../../../transaction-scripts/migrations/run-migration.js';
import { BadRequestError } from '../../../../kixx/errors/mod.js';


/**
 * Runs one authenticated migration batch and returns its JSON:API projection.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Migration-run JSON response.
 * @throws {BadRequestError} When the client supplied an invalid dry-run cursor.
 */
export async function runMigration(context, request, response) {
    assertJsonApiContentType(request);

    const resource = await parseJsonApiResource(request, 'MigrationRun');
    const form = RunMigrationForm.fromJsonApi(resource);
    form.validate();

    const id = request.pathnameParams.id;
    const params = form.toJSON();

    let result;
    try {
        result = await runMigrationBatch(context, {
            id,
            ...params,
            startedBy: context.user.id,
            now: new Date().toISOString(),
        });
    } catch (cause) {
        // Only a dry-run cursor is client-owned. Real cursor failures have
        // already been translated to a restart conflict by the script.
        if (params.dryRun && cause.name === 'InvalidCursorError') {
            throw new BadRequestError('The dry-run cursor is invalid.', { cause });
        }
        throw cause;
    }

    return response.respondWithJSON(
        200,
        jsonApiResource({
            type: 'MigrationRun',
            id,
            attributes: {
                done: result.done,
                cursor: result.cursor,
                stats: result.stats,
                status: result.status,
                dryRun: result.dryRun,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
