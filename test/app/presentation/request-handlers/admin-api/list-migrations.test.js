import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { migrations } from '../../../../../src/app/migrations/mod.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../src/app/presentation/lib/json-api.js';
import { listMigrations } from '../../../../../src/app/presentation/request-handlers/admin-api/list-migrations.js';


describe('listMigrations admin API handler', ({ it }) => {
    it('returns registry-ordered Migration resources with pending and stored attributes', async () => {
        await withRegistry(async () => {
            const storedRecord = {
                status: 'applied',
                stats: { scanned: 4 },
                batchCount: 2,
                startedBy: 'admin-1',
                startedAt: '2026-07-17T12:00:00.000Z',
                completedAt: '2026-07-17T12:05:00.000Z',
                error: null,
            };
            const collection = {
                async getByMigrationId(_context, id) {
                    return id === '2026-07-17-second-test' ? storedRecord : null;
                },
            };
            const context = {
                getCollection(name) {
                    assertEqual('Migration', name);
                    return collection;
                },
            };
            const response = makeResponse();

            await listMigrations(context, {}, response);

            assertEqual(200, response.status);
            assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
            assertEqual(2, response.document.data.length);
            assertEqual('2026-07-17-first-test', response.document.data[0].id);
            assertEqual('pending', response.document.data[0].attributes.status);
            assertEqual(null, response.document.data[0].attributes.stats);
            assertEqual(null, response.document.data[0].attributes.batchCount);
            assertEqual('2026-07-17-second-test', response.document.data[1].id);
            assertEqual('Second migration.', response.document.data[1].attributes.description);
            assertEqual('applied', response.document.data[1].attributes.status);
            assertEqual(4, response.document.data[1].attributes.stats.scanned);
            assertEqual(2, response.document.data[1].attributes.batchCount);
            assertEqual(undefined, response.document.data[1].attributes.cursor);
        });
    });
});

function makeResponse() {
    return {
        respondWithJSON(status, document, options) {
            this.status = status;
            this.document = document;
            this.options = options;
            return this;
        },
    };
}

async function withRegistry(fn) {
    const originalEntries = Array.from(migrations.entries());
    migrations.clear();
    migrations.set('2026-07-17-first-test', {
        id: '2026-07-17-first-test',
        description: 'First migration.',
        migrate: async () => ({ done: true, cursor: null, stats: {} }),
    });
    migrations.set('2026-07-17-second-test', {
        id: '2026-07-17-second-test',
        description: 'Second migration.',
        migrate: async () => ({ done: true, cursor: null, stats: {} }),
    });

    try {
        await fn();
    } finally {
        migrations.clear();
        for (const [ id, entry ] of originalEntries) {
            migrations.set(id, entry);
        }
    }
}
