import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createFakeDurableObjectStorage } from '../../../../../fakes/durable-object-storage.js';
import initializeSchema from '../../../../../../kixx/adapters/cloudflare/content-store/lib/initialize-schema.js';
import assignBuild from '../../../../../../kixx/adapters/cloudflare/content-store/lib/assign-build.js';


function makeStorage(options) {
    const storage = createFakeDurableObjectStorage(options);
    initializeSchema(storage.sql);
    return storage;
}

function saveClosure(sql, rootHash) {
    sql.exec("INSERT INTO closure_entries (root_hash, pathname, kind, hash) VALUES (?, ?, 'tree', ?)", rootHash, '/', rootHash);
}

function readAssignmentId(sql) {
    return sql.exec('SELECT assignment_id FROM builds').one().assignment_id;
}

describe('assignBuild', ({ after, it }) => {
    const storages = [];

    function makeSql() {
        const storage = makeStorage();
        storages.push(storage);
        return storage.sql;
    }

    after(() => {
        storages.forEach((storage) => storage.close());
    });

    it('returns operation metadata for assignments, no-ops, and conflicts', () => {
        const sql = makeSql();
        saveClosure(sql, 'first');
        saveClosure(sql, 'second');

        const first = assignBuild(sql, 'build', { rootHash: 'first', expectedAssignmentId: null });
        sql.exec('UPDATE builds SET assigned_at = ? WHERE build_id = ?', '2000-01-01T00:00:00.000Z', 'build');
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
        assertEqual(third.pointer.assignmentId, readAssignmentId(sql));
        assertEqual(0, sql.exec("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'pending_build_assignments%'").one().count);
    });

    it('rejects incompatible schemas without silently resetting them', () => {
        for (const statement of [ 'UPDATE content_schema SET version = 2', 'DROP TABLE content_schema' ]) {
            const sql = makeSql();
            saveClosure(sql, 'first');
            const assigned = assignBuild(sql, 'build', { rootHash: 'first' });
            sql.exec(statement);
            let caught;
            try {
                initializeSchema(sql);
            } catch (error) {
                caught = error;
            }

            assert(caught);
            assertEqual('AssertionError', caught.name);
            assertEqual(assigned.pointer.assignmentId, readAssignmentId(sql));
        }
    });

    it('accepts a store which retains an unused table from an earlier schema', () => {
        const sql = makeSql();
        saveClosure(sql, 'first');
        const assigned = assignBuild(sql, 'build', { rootHash: 'first' });
        sql.exec('CREATE TABLE pending_build_assignments (sequence INTEGER PRIMARY KEY AUTOINCREMENT)');
        initializeSchema(sql);

        assertEqual(assigned.pointer.assignmentId, readAssignmentId(sql));
    });

    it('preserves identities when reopening the production schema on disk', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kixx-cloudflare-schema-'));
        const filename = path.join(directory, 'index.sqlite');
        let storage;
        try {
            storage = makeStorage({ path: filename });
            saveClosure(storage.sql, 'first');
            const first = assignBuild(storage.sql, 'build', { rootHash: 'first' });
            storage.close();
            storage = makeStorage({ path: filename });
            const unchanged = assignBuild(storage.sql, 'build', { rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId });

            assertEqual('unchanged', unchanged.outcome);
            assertEqual(JSON.stringify(first.pointer), JSON.stringify(unchanged.pointer));
        } finally {
            storage?.close();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('preserves missing-closure precedence over a failed precondition', () => {
        const sql = makeSql();

        const result = assignBuild(sql, 'build', { rootHash: 'missing', expectedAssignmentId: crypto.randomUUID() });

        assertEqual('missingClosure', result.outcome);
    });
});
