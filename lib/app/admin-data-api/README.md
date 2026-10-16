# Administrative Data API Resources

Registrations that expose Collections through `/admin-data-api/v1/`. The
HTTP contract is documented in `../usage-docs/kixx-app/admin-data-api.md`.

## Adding a resource

Register a Collection by adding a registration object to `resources/` and
listing it in `mod.js`. The registry validates and freezes every
registration at import, and `app.initialize()` checks each against its
Collection; any mismatch is a programmer error that fails boot.

```javascript
export default {
    type: 'widgets',                 // public JSON:API type: lowercase, hyphenated
    collection: 'Widget',            // registered Collection name: PascalCase
    description: 'What the records are, and what direct edits bypass.',
    attributes: {                    // the complete read projection
        name: { description: 'Widget name.', schema: { type: 'string' } },
    },
    operations: {                    // present = enabled; omit to disable
        list: {
            sorts: [
                // name is the JSON:API sort value; first is the default.
                // index optionally names one of the Collection's INDEXES.
                { name: '-createdAt', description: 'Newest first.', descending: true },
            ],
        },
        get: {},
        create: {
            attributes: [ 'name' ],  // writable on create
            required: [ 'name' ],    // subset of attributes
            // Optional: persist(context, collection, attributes) => Promise<Record>.
            // Defaults to collection.create(context, attributes).
        },
        update: { attributes: [ 'name' ] },
        delete: {},
    },
};
```

Rules the registry enforces:

- Types and Collections are unique; unknown keys anywhere are rejected.
- Attribute names are camelCase and may not be server-owned names (`id`,
  `type`, `version`, `sortKey`, `createdAt`, `updatedAt`, `meta`, `links`,
  `relationships`). Each attribute needs a description and a JSON schema
  fragment for discovery. Record schemas describe; `Record#validate()` and the
  registration enforce.
- Every attribute must exist in the Collection's Record schema, every enabled
  operation needs its Collection method, and every sort index must be declared
  in the Collection's `INDEXES`.
- Write attribute lists name declared attributes only; server-owned values
  belong in a `persist` hook (create only) or the Collection.
- `attributes` and `list.sorts` are non-empty; every sort needs a
  `description` and a boolean `descending`; operations are objects (`{}`).

Exposing a Collection is a security decision: any token granted on it can read
every declared attribute of every record.

## Verification

The e2e suite in `test-app/test/300-admin-data-api/` (from the repo root)
exercises the contract against a running target: tokens created and revoked
through the admin panel, scoped grants, every File operation, stale versions
and two concurrent writers, and byte checks after every repoint and delete.
The race in which a write lands between load and persist is covered by the
unit tests in `test/app/presentation/request-handlers/admin-data-api/`,
which also prove that no API request reaches the file object store.
