/**
 * Adapts a Node.js `DatabaseSync` to the synchronous `SqlExecutor` the shared
 * JobStateStore expects (see job-state-store.js).
 *
 * Transactions use `BEGIN IMMEDIATE`, taking the write lock up front so several
 * processes sharing one database file serialize their writers instead of
 * failing on a lock upgrade mid-transaction. The store never nests them.
 *
 * @param {import('node:sqlite').DatabaseSync} database - Open, prepared connection.
 * @returns {import('../../../kixx/jobs/job-state-store.js').SqlExecutor}
 */
export function createSqliteExecutor(database) {
    return {
        all(sql, ...params) {
            return database.prepare(sql).all(...params);
        },

        run(sql, ...params) {
            database.prepare(sql).run(...params);
        },

        transaction(fn) {
            database.exec('BEGIN IMMEDIATE');

            let result;

            try {
                result = fn();
            } catch (error) {
                database.exec('ROLLBACK');
                throw error;
            }

            database.exec('COMMIT');
            return result;
        },
    };
}
