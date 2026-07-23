# Data Migrations

Data migrations are statically registered application modules advanced remotely through the authenticated Admin API. Each request executes exactly one bounded batch. The durable `Migration` ledger records only successfully committed real-run progress; dry-run progress belongs to the caller.

## Migration ids and registration

Choose a permanent, globally unique id in this form:

```text
YYYY-MM-DD-short-kebab-description
```

For example, `2026-07-17-backfill-user-roles`. Never rename or reuse an id after deployment, even if its registry entry is later retired.

To register a migration:

1. Add a module named after its id in this directory.
2. Export its asynchronous `migrate(context, params)` function.
3. Explicitly import that function in `mod.js`.
4. Add a `Map` entry whose key exactly equals its `entry.id`, with a non-empty operator-facing `description` and the imported `migrate` function.

Do not discover migration files at runtime or perform I/O while constructing the registry. Registry iteration order controls the order shown by the status API. Retain deployed entries whenever possible so historical ledger state remains visible.

## Module contract

```js
export async function migrate(context, params) {
    const { cursor, dryRun } = params;

    // Process one bounded batch through registered Collections or gateways.

    return {
        done: false,
        cursor: nextCursor,
        stats: { scanned: 100, updated: 12 },
    };
}
```

`context` is the active RequestContext. Access application data only through its registered Collections or gateways. `params.cursor` is `null` for the first batch and otherwise is the opaque cursor returned by the previous committed batch. `params.dryRun` forbids all mutations.

The returned plain object must contain:

- `done`: a boolean.
- `cursor`: `null` exactly when `done` is `true`; otherwise a non-empty cursor different from the input cursor.
- `stats`: a plain object containing finite numeric counters for this batch.

Treat cursors as opaque. Do not parse, alter, combine, or synthesize them. Rebuild the same scan/query operation on every cursored batch, including type, index, ordering, and bounds. Keep stat names stable so real-run batches can be accumulated.

One invocation must process only one bounded batch with comfortable headroom under every supported runtime limit. The remote caller drives subsequent batches.

Every record mutation must be idempotent: inspect current state and skip a write when the intended result is already present. Application writes and the ledger commit are not atomic, so a batch may be replayed after interruption or a ledger race. Handle expected record-level concurrency and domain failures deliberately.

A dry run must perform the same reads, selection, skip logic, and counting as a real run, but it must omit every application-data write and external mutation.

## Expand/contract deployment

Deploy migrations as a compatibility sequence:

1. Deploy application code that accepts both old and new data shapes.
2. Register and deploy the migration with that compatible code.
3. Dry-run or run the migration in each required environment, staging first.
4. Confirm the ledger reports `applied` and review accumulated statistics.
5. Remove support for the old shape only in a later deployment.

A migration must never depend on application code absent from the same deployed
build.

## Authoring checklist

When authoring a migration script, confirm every item on this punchlist has been addressed before claiming the migration is ready for deployment:

- [ ] The id is permanent, unique, date-prefixed, and explicitly registered.
- [ ] The application build tolerates both old and new data shapes.
- [ ] One invocation processes one bounded batch.
- [ ] All data access uses registered Collections or gateways.
- [ ] Scan/query options remain identical across cursored batches.
- [ ] The Collection cursor is returned unchanged and is null exactly at completion.
- [ ] Every non-terminal cursor differs from the input cursor.
- [ ] Every record mutation has a current-state idempotency check.
- [ ] Dry-run and real-run selection logic are identical.
- [ ] Dry-run execution performs no writes or external mutations.
- [ ] Stats are plain, finite numeric counters with stable meanings.
- [ ] Expected record-level concurrency and domain errors are handled deliberately.
- [ ] The batch size fits every target runtime limit with headroom.
