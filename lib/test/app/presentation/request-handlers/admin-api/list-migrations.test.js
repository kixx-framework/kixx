import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { listMigrations } from '../../../../../app/presentation/request-handlers/admin-api/list-migrations.js';


function makeRecord(attributes) {
    return {
        get(name) {
            return attributes[name];
        },
    };
}

function makeContext(record) {
    return {
        getCollection(name) {
            assertEqual('Migration', name);
            return {
                async getByMigrationId() {
                    return record;
                },
            };
        },
    };
}

function makeResponse() {
    return { respondWithJSON: (status, body, options) => ({ status, body, options }) };
}


describe('Admin API listMigrations handler', ({ it }) => {

    it('keeps the JSON attributes unchanged when the projection grows', async () => {
        const record = makeRecord({
            status: 'applied',
            cursor: 'secret-cursor',
            stats: { scanned: 30 },
            batchCount: 3,
            startedBy: 'admin-1',
            startedAt: '2026-10-16T10:00:00.000Z',
            lastBatchAt: '2026-10-16T10:02:00.000Z',
            completedAt: '2026-10-16T10:02:00.000Z',
            error: null,
        });

        const result = await listMigrations(makeContext(record), {}, makeResponse());

        assertEqual(200, result.status);

        const [ resource ] = result.body.data;
        assertEqual('Migration', resource.type);
        assertEqual(
            [
                'description',
                'status',
                'stats',
                'batchCount',
                'startedBy',
                'startedAt',
                'completedAt',
                'error',
            ].join(','),
            Object.keys(resource.attributes).join(','),
        );
    });
});
