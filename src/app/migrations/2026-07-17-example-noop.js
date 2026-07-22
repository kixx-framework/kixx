/**
 * Demonstrates the migration module contract without reading or writing data.
 *
 * @param {Object} _context - Active RequestContext used for registered Collections and gateways.
 * @param {Object} _params - Batch execution parameters.
 * @param {string|null} _params.cursor - Opaque cursor from the previous committed batch.
 * @param {boolean} _params.dryRun - Whether application and external mutations are forbidden.
 * @returns {Promise<{done: boolean, cursor: null, stats: {scanned: number}}>} Terminal no-op batch result.
 */
export async function migrate(_context, _params) {
    // A real migration performs only one bounded batch here. Pass Collection
    // cursors through unchanged: never parse, synthesize, or modify them.
    //
    // Before each write, inspect current record state so replaying a batch is
    // idempotent. Dry runs must use identical reads and decisions while omitting
    // every mutation. This no-op meets both contracts by doing no I/O at all.
    return {
        done: true,
        cursor: null,
        stats: { scanned: 0 },
    };
}
