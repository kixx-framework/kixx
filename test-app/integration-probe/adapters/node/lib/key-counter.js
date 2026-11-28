/**
 * Counts the keys under a prefix in the Node.js key/value store's SQLite
 * file, for a test that asks whether anything was written there. The port
 * has no listing, so this reads the adapter's table through a read-only
 * connection of its own.
 *
 * @param {Object} options
 * @param {Function} options.DatabaseSync - `DatabaseSync` from `node:sqlite`
 * @param {function(string): boolean} options.fileExists
 * @param {string} options.path - The store's file
 * @returns {function(string): number} Takes a prefix. Zero while the store has no file: it is created on first use.
 */
export function createKeyCounter({ DatabaseSync, fileExists, path }) {
    return function countKeyValueKeys(prefix) {
        if (!fileExists(path)) {
            return 0;
        }

        const database = new DatabaseSync(path, { readOnly: true });

        try {
            // Not LIKE: a prefix may hold its wildcards.
            const row = database
                .prepare('SELECT COUNT(*) AS count FROM kv WHERE substr(key, 1, length(?)) = ?')
                .get(prefix, prefix);

            return Number(row.count);
        } finally {
            database.close();
        }
    };
}
