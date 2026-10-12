import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import initializeSchema from '../../../../../src/plugins/cloudflare-content-store/lib/initialize-schema.js';
import assignBuild from '../../../../../src/plugins/cloudflare-content-store/lib/assign-build.js';


function makeSql(filename = ':memory:') {
    const database = new DatabaseSync(filename);
    const sql = {
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
    initializeSchema(sql);
    return sql;
}

function saveClosure(sql, rootHash) {
    sql.database.prepare("INSERT INTO closure_entries (root_hash, pathname, kind, hash) VALUES (?, ?, 'tree', ?)").run(rootHash, '/', rootHash);
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

        const first = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: null });
        sql.database.prepare('UPDATE builds SET assigned_at = ? WHERE build_id = ?').run('2000-01-01T00:00:00.000Z', 'build');
        const unchanged = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId });
        const conflict = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: crypto.randomUUID() });
        const replacement = assignBuild(sql, 'build', { rootHash: 'second', expectedAssignmentId: first.pointer.assignmentId });

        assertEqual('assigned', first.outcome);
        assertEqual(null, first.previousRootHash);
        assertEqual('unchanged', unchanged.outcome);
        assertEqual('2000-01-01T00:00:00.000Z', unchanged.pointer.assignedAt);
        assertEqual(first.pointer.assignmentId, unchanged.pointer.assignmentId);
        assertEqual('first', unchanged.previousRootHash);
        assertEqual('conflict', conflict.outcome);
        assertEqual('assigned', replacement.outcome);
        assertEqual('first', replacement.previousRootHash);
    });

    it('detects A to B to A and preserves captured results through schema reopen', () => {
        const sql = makeSql();
        databases.push(sql.database);
        saveClosure(sql, 'first');
        saveClosure(sql, 'second');
        const first = assignBuild(sql, 'build', { rootHash: 'first' });
        const second = assignBuild(sql, 'build', { rootHash: 'second', expectedAssignmentId: first.pointer.assignmentId });
        const third = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: second.pointer.assignmentId });
        initializeSchema(sql);

        assertEqual(3, new Set([ first, second, third ].map((result) => result.pointer.assignmentId)).size);
        assertEqual('first', first.pointer.rootHash);
        assertEqual(null, first.previousRootHash);
        assertEqual('conflict', assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId }).outcome);
        assertEqual('conflict', assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: null }).outcome);
        assertEqual(third.pointer.assignmentId, sql.database.prepare('SELECT assignment_id FROM builds').get().assignment_id);
        assertEqual(0, sql.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'pending_build_assignments%'").get().count);
    });

    it('rejects incompatible schemas without silently resetting them', () => {
        for (const statement of [ 'UPDATE content_schema SET version = 2', 'DROP TABLE content_schema' ]) {
            const sql = makeSql();
            databases.push(sql.database);
            saveClosure(sql, 'first');
            const assigned = assignBuild(sql, 'build', { rootHash: 'first' });
            sql.database.exec(statement);
            let caught;
            try {
                initializeSchema(sql);
            } catch (error) {
                caught = error;
            }

            assert(caught);
            assertEqual('AssertionError', caught.name);
            assertEqual(assigned.pointer.assignmentId, sql.database.prepare('SELECT assignment_id FROM builds').get().assignment_id);
        }
    });

    it('accepts a store which retains an unused table from an earlier schema', () => {
        const sql = makeSql();
        databases.push(sql.database);
        saveClosure(sql, 'first');
        const assigned = assignBuild(sql, 'build', { rootHash: 'first' });
        sql.database.exec('CREATE TABLE pending_build_assignments (sequence INTEGER PRIMARY KEY AUTOINCREMENT)');
        initializeSchema(sql);

        assertEqual(assigned.pointer.assignmentId, sql.database.prepare('SELECT assignment_id FROM builds').get().assignment_id);
    });

    it('preserves identities when reopening the production schema on disk', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kixx-cloudflare-schema-'));
        const filename = path.join(directory, 'index.sqlite');
        let sql;
        try {
            sql = makeSql(filename);
            saveClosure(sql, 'first');
            const first = assignBuild(sql, 'build', { rootHash: 'first' });
            sql.database.close();
            sql = makeSql(filename);
            const unchanged = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId });

            assertEqual('unchanged', unchanged.outcome);
            assertEqual(JSON.stringify(first.pointer), JSON.stringify(unchanged.pointer));
        } finally {
            sql?.database.close();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('preserves missing-closure precedence over a failed precondition', () => {
        const sql = makeSql();
        databases.push(sql.database);

        const result = assignBuild(sql, 'build', { rootHash: 'missing', expectedAssignmentId: crypto.randomUUID() });

        assertEqual('missingClosure', result.outcome);
    });
});
