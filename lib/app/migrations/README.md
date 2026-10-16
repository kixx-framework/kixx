# Data Migrations

Migrations are statically registered modules that an operator advances from the admin panel (`/admin/migrations`) or through the Admin API, one bounded batch per request. The `Migration` ledger records committed real-run progress; dry-run progress belongs to the caller. Endpoints and the run lifecycle (resume, `force`, conflicts) are in `usage-docs/kixx-app/admin-api.md`.

## Running from the Admin Panel

Developers → Data Migrations (`/admin/migrations`) lists every registered migration; each detail page shows its ledger record and offers Run, Dry run, and Force re-run. Listing needs `urn:kixx:list` and running needs `urn:kixx:run` on `urn:kixx:admin:migrations` (Developer and Root Admin). The panel calls the same Transaction Scripts as the Admin API.

- **One batch per request.** Without JavaScript, each click runs one batch. With JavaScript, Run and Dry run keep posting batches until done, the first error, or Stop (which lets the batch in flight finish).
- **Run** resumes from the ledger's committed cursor and is hidden once the migration is `applied`.
- **Dry run** writes nothing. The page carries the dry-run cursor in a hidden form field; the server never stores it. With JavaScript:
  - Totals accumulate in the page.
  - If a batch fails (other than an invalid cursor), its cursor and the totals are kept, so pressing the button again retries that batch.
  - After Stop, the button becomes "Continue dry run". Reload the page to start over.
  - An expired form shows its message in place.
- **Force re-run** (only for `applied` or `failed`) goes through a confirmation page. It resets the ledger record and runs the first batch; it never undoes data changes.
- **Unexpected batch failures** are logged at error level and shown as a notice, and the server keeps running. The Admin API instead lets them propagate; see [Sanctioned Exception: Admin Panel Migration Runs](../../docs/server-error-handling.md#sanctioned-exception-admin-panel-migration-runs).

## Registration

Ids are permanent and unique: `YYYY-MM-DD-short-kebab-description` (e.g. `2026-07-17-backfill-user-roles`). Never rename or reuse an id after deployment, even after retiring its entry.

1. Add `<id>.js` in this directory exporting `async migrate(context, params)`. `2026-07-17-example-noop.js` is a minimal template.
2. Import it statically in `mod.js` and add a `Map` entry: `[ id, { id, description, migrate } ]`. The key must equal `id`; `description` is operator-facing.

No runtime file discovery or I/O while building the registry. Registry order is the order the status API lists. Keep deployed entries so their ledger history stays visible.

## Module Contract

```js
export async function migrate(context, params) {
    const { cursor, dryRun } = params;

    // Process one bounded batch through registered Collections or gateways.

    return {
        done: false,
        cursor: nextCursor,                    // null exactly when done
        stats: { scanned: 100, updated: 12 },  // finite numbers only
    };
}
```

- **Input.** `context` is the RequestContext; access data only through its Collections or gateways. `params.cursor` is `null` on the first batch, otherwise the previous batch's cursor (from the ledger for real runs, from the caller for dry runs).
- **Output.** `done` is a boolean. `cursor` is `null` exactly when `done`, otherwise a non-empty string different from the input. `stats` holds finite numeric counters; keep names stable so real runs can sum them.
- **Cursors are opaque.** Pass Collection cursors through unchanged; never parse, alter, combine, or synthesize them. Rebuild the identical scan/query (type, index, order, bounds) on every batch.
- **One bounded batch per call**, with comfortable headroom under every runtime limit. The caller drives the next batch.
- **Idempotent writes.** Check current state and skip writes already applied. Application writes and the ledger commit are not atomic, so a batch may replay after an interruption or ledger race.
- **Dry runs** (`params.dryRun`) do the same reads, selection, skips, and counting as a real run, but no application-data writes or external mutations.
- **Errors.** Handle expected record-level concurrency and domain failures deliberately. On a real run any throw marks the ledger `failed` (best effort), and the next run resumes from the last committed cursor. Expected errors (`error.expected === true`) reach the operator unchanged; others are wrapped in `AssertionError`. `InvalidCursorError` becomes a `409` requiring `force`.

## Expand/Contract Deployment

1. Deploy code that accepts both old and new data shapes.
2. Deploy the migration with that compatible code.
3. Dry-run or run it in each environment, staging first.
4. Confirm the ledger reports `applied` and review the stats.
5. Remove support for the old shape only in a later deployment.

A migration must never depend on code absent from its deployed build.

## Authoring Checklist

Confirm every item before calling a migration ready to deploy:

- [ ] Id is permanent, unique, date-prefixed, and registered in `mod.js`.
- [ ] The deployed build tolerates both old and new data shapes.
- [ ] One call processes one bounded batch that fits every runtime limit with headroom.
- [ ] Data access goes only through Collections or gateways, with identical scan/query options on every batch.
- [ ] The Collection cursor is returned unchanged, differs from the input, and is `null` exactly at completion.
- [ ] Every write has a current-state idempotency check.
- [ ] Dry runs share real-run selection logic and perform no writes or external mutations.
- [ ] Stats are finite numeric counters with stable names.
- [ ] Expected concurrency and domain errors are handled deliberately.
