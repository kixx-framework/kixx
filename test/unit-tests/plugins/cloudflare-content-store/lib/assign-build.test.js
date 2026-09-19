import { DatabaseSync } from 'node:sqlite';

import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import assignBuild from '../../../../../src/plugins/cloudflare-content-store/lib/assign-build.js';


function makeSql() {
    const database = new DatabaseSync(':memory:');
    database.exec(`
        CREATE TABLE closure_entries (root_hash TEXT NOT NULL, pathname TEXT NOT NULL);
        CREATE TABLE builds (build_id TEXT NOT NULL PRIMARY KEY, root_hash TEXT NOT NULL, assigned_at TEXT NOT NULL);
    `);
    return {
        database,
        exec(statement, ...parameters) {
            const prepared = database.prepare(statement);
            const isQuery = statement.trimStart().startsWith('SELECT');
            if (!isQuery) {
                prepared.run(...parameters);
            }
            return { toArray: () => isQuery ? prepared.all(...parameters) : [] };
        },
    };
}

function saveClosure(sql, rootHash) {
    sql.database.prepare('INSERT INTO closure_entries (root_hash, pathname) VALUES (?, ?)').run(rootHash, '/');
}

describe('assignBuild', ({ after, it }) => {
    const databases = [];

    after(() => {
        databases.forEach((database) => database.close());
    });

    it('returns operation metadata for assignments, no-ops, and conflicts', () => {
        const sql = makeSql();
        databases.push(sql.database);
        saveClosure(sql, 'first');
        saveClosure(sql, 'second');

        const first = assignBuild(sql, 'build', { rootHash: 'first', expectedRootHash: null });
        sql.database.prepare('UPDATE builds SET assigned_at = ? WHERE build_id = ?').run('2000-01-01T00:00:00.000Z', 'build');
        const unchanged = assignBuild(sql, 'build', { rootHash: 'first', expectedRootHash: 'first' });
        const conflict = assignBuild(sql, 'build', { rootHash: 'first', expectedRootHash: 'second' });
        const replacement = assignBuild(sql, 'build', { rootHash: 'second', expectedRootHash: 'first' });

        assertEqual('assigned', first.outcome);
        assertEqual(null, first.previousRootHash);
        assertEqual('unchanged', unchanged.outcome);
        assertEqual('2000-01-01T00:00:00.000Z', unchanged.pointer.assignedAt);
        assertEqual('first', unchanged.previousRootHash);
        assertEqual('conflict', conflict.outcome);
        assertEqual('assigned', replacement.outcome);
        assertEqual('first', replacement.previousRootHash);
    });

    it('preserves missing-closure precedence over a failed precondition', () => {
        const sql = makeSql();
        databases.push(sql.database);

        const result = assignBuild(sql, 'build', { rootHash: 'missing', expectedRootHash: 'stale' });

        assertEqual('missingClosure', result.outcome);
    });
});
