import { JSON_API_CONTENT_TYPE, jsonApiResource } from '../../lib/json-api.js';
import { listMigrations as listMigrationStatus } from '../../../transaction-scripts/migrations/list-migrations.js';


/**
 * Lists registry-authoritative migration status as JSON:API resources.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} _request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Migration collection response.
 */
export async function listMigrations(context, _request, response) {
    const migrations = await listMigrationStatus(context);
    const data = migrations.map((migration) => {
        const {
            id,
            description,
            status,
            stats,
            batchCount,
            startedBy,
            startedAt,
            completedAt,
            error,
        } = migration;

        return jsonApiResource({
            type: 'Migration',
            id,
            attributes: {
                description,
                status,
                stats,
                batchCount,
                startedBy,
                startedAt,
                completedAt,
                error,
            },
        }).data;
    });

    return response.respondWithJSON(
        200,
        { data },
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
