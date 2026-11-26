import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createFakeDurableObjectStorage } from '../../../../../fakes/durable-object-storage.js';
import initializeSchema from '../../../../../../kixx/adapters/cloudflare/content-store/lib/initialize-schema.js';
import assignBuild from '../../../../../../kixx/adapters/cloudflare/content-store/lib/assign-build.js';


const STAMPS = Object.freeze({
    now: () => Date.now(),
    randomUUID: () => crypto.randomUUID(),
});

function makeStorage(options) {
    const storage = createFakeDurableObjectStorage(options);
    initializeSchema(storage.sql);
    return storage;
}

function saveClosure(sql, rootHash) {
    sql.exec("INSERT INTO closure_entries (root_hash, pathname, kind, hash) VALUES (?, ?, 'tree', ?)", rootHash, '/', rootHash);
}

// Every assignment needs an Activation; most tests do not care what it says.
function assignment(fields) {
    return {
        activation: { reason: 'publish', actor: { type: 'deploy-key', id: 'test-key' } },
        ...fields,
    };
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

        const first = assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: null }), STAMPS);
        sql.exec('UPDATE builds SET assigned_at = ? WHERE build_id = ?', '2000-01-01T00:00:00.000Z', 'build');
        const unchanged = assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId }), STAMPS);
        const conflict = assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: crypto.randomUUID() }), STAMPS);
        const replacement = assignBuild(sql, 'build', assignment({ rootHash: 'second', expectedAssignmentId: first.pointer.assignmentId }), STAMPS);

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
        const first = assignBuild(sql, 'build', assignment({ rootHash: 'first' }), STAMPS);
        const second = assignBuild(sql, 'build', assignment({ rootHash: 'second', expectedAssignmentId: first.pointer.assignmentId }), STAMPS);
        const third = assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: second.pointer.assignmentId }), STAMPS);
        initializeSchema(sql);

        assertEqual(3, new Set([ first, second, third ].map((result) => result.pointer.assignmentId)).size);
        assertEqual('first', first.pointer.rootHash);
        assertEqual(null, first.previousRootHash);
        assertEqual('conflict', assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId }), STAMPS).outcome);
        assertEqual('conflict', assignBuild(sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: null }), STAMPS).outcome);
        assertEqual(third.pointer.assignmentId, readAssignmentId(sql));
        assertEqual(0, sql.exec("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'pending_build_assignments%'").one().count);
    });

    it('rejects incompatible schemas without silently resetting them', () => {
        const statements = [
            'UPDATE content_schema SET version = 2',
            'UPDATE content_schema SET version = 3',
            'UPDATE content_schema SET version = 4',
            'UPDATE content_schema SET version = 6',
            'DROP TABLE content_schema',
        ];
        for (const statement of statements) {
            const sql = makeSql();
            saveClosure(sql, 'first');
            const assigned = assignBuild(sql, 'build', assignment({ rootHash: 'first' }), STAMPS);
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
        const assigned = assignBuild(sql, 'build', assignment({ rootHash: 'first' }), STAMPS);
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
            const first = assignBuild(storage.sql, 'build', assignment({ rootHash: 'first' }), STAMPS);
            storage.close();
            storage = makeStorage({ path: filename });
            const unchanged = assignBuild(storage.sql, 'build', assignment({ rootHash: 'first', expectedAssignmentId: first.pointer.assignmentId }), STAMPS);

            assertEqual('unchanged', unchanged.outcome);
            assertEqual(JSON.stringify(first.pointer), JSON.stringify(unchanged.pointer));
        } finally {
            storage?.close();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('stamps the pointer and its Activation from the given clock and id source', () => {
        const sql = makeSql();
        saveClosure(sql, 'first');
        const stamps = {
            now: () => Date.UTC(2027, 0, 15, 12),
            randomUUID: () => '11111111-1111-4111-8111-111111111111',
        };

        const result = assignBuild(sql, 'build', assignment({ rootHash: 'first' }), stamps);
        const row = sql.exec('SELECT * FROM activations').one();

        assertEqual('2027-01-15T12:00:00.000Z', result.pointer.assignedAt);
        assertEqual('11111111-1111-4111-8111-111111111111', result.pointer.assignmentId);
        assertEqual(null, result.pointer.code);
        assertEqual('build', row.build_id);
        assertEqual('11111111-1111-4111-8111-111111111111', row.assignment_id);
        assertEqual(null, row.from_release_id);
        assertEqual('first', row.to_release_id);
        assertEqual('2027-01-15T12:00:00.000Z', row.activated_at);
        assertEqual('publish', row.reason);
        assertEqual('deploy-key', row.actor_type);
        assertEqual('test-key', row.actor_id);
        assertEqual(null, row.actor_name);
    });

    it('requires an Activation, a clock, and an id source before reading storage', () => {
        const sql = makeSql();
        saveClosure(sql, 'first');
        const attempts = [
            () => assignBuild(sql, 'build', { rootHash: 'first' }, STAMPS),
            () => assignBuild(sql, 'build', assignment({ rootHash: 'first', code: { revision: 'r' } }), STAMPS),
            () => assignBuild(sql, 'build', assignment({ rootHash: 'first' })),
            () => assignBuild(sql, 'build', assignment({ rootHash: 'first' }), { now: STAMPS.now }),
        ];

        for (const attempt of attempts) {
            let caught;
            try {
                attempt();
            } catch (error) {
                caught = error;
            }
            assertEqual('AssertionError', caught?.name);
        }
        assertEqual(0, sql.exec('SELECT COUNT(*) AS count FROM builds').one().count);
        assertEqual(0, sql.exec('SELECT COUNT(*) AS count FROM activations').one().count);
    });

    it('preserves missing-closure precedence over a failed precondition', () => {
        const sql = makeSql();

        const result = assignBuild(sql, 'build', assignment({ rootHash: 'missing', expectedAssignmentId: crypto.randomUUID() }), STAMPS);

        assertEqual('missingClosure', result.outcome);
    });
});
