/**
 * Adapts Durable Object SQLite storage to the synchronous `SqlExecutor` the
 * shared JobStateStore expects (see job-state-store.js).
 *
 * @param {DurableObjectStorage} storage - `ctx.storage`.
 * @returns {import('../../../kixx/jobs/job-state-store.js').SqlExecutor}
 */
export function createDurableObjectSqlExecutor(storage) {
    return {
        all(sql, ...params) {
            return storage.sql.exec(sql, ...params).toArray();
        },

        run(sql, ...params) {
            // Consuming the cursor guarantees the statement has finished.
            storage.sql.exec(sql, ...params).toArray();
        },

        transaction(fn) {
            return storage.transactionSync(fn);
        },
    };
}
