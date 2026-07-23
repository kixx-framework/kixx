# Transaction Scripts

To organize domain logic for this application we use the Transaction Script pattern from Fowler's *Patterns of Enterprise Application Architecture*.

A Transaction Script is a single procedure, one for each action that a user might want to do. It is expressed as a function that takes the input from the presentation, processes it with validations, makes computations, stores data in the database, and invokes any operations from other systems. It replies with more data to the presentation, perhaps doing more calculation to help organize and format the reply.

You can think of Transaction Scripts as remote procedure calls.

Transaction scripts are application-specific domain logic and live in the app/transaction-scripts/ directory.

## File and Naming Conventions

Each Transaction Script lives in its own file. Files are named after the action they perform, in kebab-case:

```
app/transaction-scripts/
├── admin-users/
│   ├── authenticate-admin-session.js
│   ├── create-admin-user.js
│   └── verify-amdin-credentials.js
└── publishing-api-tokens/
    ├── authenticate-publishing-token.js
    ├── create-publishing-api-token.js
    └── list-publishing-api-tokens.js
```

Each file exports one named async function whose name matches the file in camelCase:

```js
export async function createBugTicket(context, form) { ... }
export async function getBugTicket(context, id) { ... }
export async function listBugTickets(context, params) { ... }
```

Group Transaction Scripts into subdirectories by domain concept when there are multiple actions for the same entity.

## Function Signatures

Transaction Scripts are plain async functions. They are not middleware — they do not receive the HTTP request or response objects.

**Write scripts** receive a `RequestContext` and a validated Form:

```js
async function createBugTicket(context, form)
```

**Read scripts** receive a `RequestContext` and individual query values extracted by the calling middleware:

```js
async function getBugTicket(context, id)
async function listBugTickets(context, { limit, cursor })
```

Keeping Transaction Scripts decoupled from HTTP objects makes them independently testable and reusable from non-HTTP entry points (CLI commands, scheduled jobs, etc.).

## Return Values

A Transaction Script returns a plain JavaScript object. The calling middleware decides how to use the returned data — typically by merging it into the response props so the template can render it:

```js
// Write script returns the created document:
return record.toDocument();

// Read script returns one document:
return record.toDocument();

// List script returns a paginated result:
return { items: records.map((r) => r.toDocument()), cursor };
```

For transaction scripts that fetch a single resource, like fetching a product by ID, return the document or `null` and document it explicitly in the JSDoc (`@returns {Promise<Object|null>}`) so every caller is obligated to handle it. A pure read reports the *fact* that a resource is absent; deciding how to represent that to the user (a 404, an empty state, a default) is presentation policy and belongs to the caller, not the domain script

Otherwise, return `null` or `undefined` only from scripts where the caller needs no data back (e.g. a delete operation).

Do throw instead of returning `null` in two cases:

- **Mutations whose precondition is that the target exists** — revoke, update, delete-strict — where absence means the requested action cannot be performed. Throw `NotFoundError` if that is an operational error or an `AssertionError` if it is an unexpected code path.
- **Reads where absence carries a specific domain meaning** — for example, a missing or orphaned session is an authentication failure, so `authenticateAdminSession` throws `UnauthenticatedError` rather than leaking whether the id ever existed.

For everything else, return a plain object.

## Input to Transaction Scripts

Transaction scripts get their input from the Presentation Layer through the use of Forms. Forms should be used for both FormData and JSON:API write requests. See the @application/docs/presentation-layer.md document for more information.

Even when Transaction Scripts get their data from other external sources — external APIs, remote service calls, web scraping, etc. — the Forms pattern should be used to format and validate the incoming data.

Forms own payload parsing, normalization, and field-level validation. Transaction Scripts receive already-validated Forms and enforce cross-field or state-dependent business rules. For read operations, middleware passes URL parameters and query values directly as plain arguments (no Form needed).

## Data Access

Transaction Scripts access stored data through registered Collections on the `RequestContext`. See @application/docs/data-source-layer.md for the full Collection API.

## Calling External Services

When a Transaction Script needs to call an external service — a Cloudflare binding such as the email service, R2 object store, or any other platform API — it does so through a registered gateway. Retrieve gateways via `context.getService()`:

```js
const objectStore = context.getService('ObjectStore');
const { tempKey, contentHash } = await objectStore.streamToTemp(context, body, { contentType });

const mailer = context.getService('Mailer');
const { messageId } = await mailer.send(context, 'password-reset', {
    to: user.email_address,
    data: { user, resetUrl },
});
```

**Do not put business rules inside a gateway.** A gateway's sole responsibility is to hide the shape of one external resource: its binding API, key formats, error codes, and wire protocol. Business rules, cross-field validation, and conditional branching based on domain state belong in the Transaction Script.

## Error Handling

Error

### Expected vs. Unexpected Errors

Every error a transaction script encounters must be classified into one of two buckets:

- **Expected errors** - also known as "operational errors" - are errors the Transaction Script logic is prepared for and will handle internally.
- **Unexpected errors** - also known as "programmer errors" - are errors which come from code paths the Transaction Script logic assumes should be unreachable, or should not be present in a healthy system.

A Transaction Script should never attempt to handle unexpected errors, other than by logging and rethrowing. Generally speaking, an unexpected error should crash the system. A Transaction Script may decide to wrap an unexpected error and rethrow it as an AssertionError if it can provide more useful context for debugging. A TransactionScript MUST wrap the unexpected error and rethrow it as an AssertionError if the cause.expected flag is truthy.

A Transaction Script can act with discretion when expected operational errors occur. Depending on the context:

- **Wrap the cause and rethrow with a new error.name or error.code** - when the caught error does not have a name or code which is meaningful to the caller, or to standardize the error signature from the Transaction Script.
- **Wrap the cause and rethrow as an AssertionError** - when the operational error is coming from a code path the Transaction Script is not accounting for.
- **Pass the error through or rethrow without wrapping** - when the error is documented by the Transaction Script so callers know to expect it.

Use error properties like `error.name`, `error.code`, and `error.expected` instead of `instanceof` to drive logical code branches:

```js
import {
    AssertionError,
    ConflictError,
    NotFoundError,
} from '../../../kixx/errors/mod.js';

// Update a record we expect to exist:

try {
    record = await tickets.update(context, record);
} catch (cause) {
    if (cause.name === 'DocumentNotFoundError') {
        throw new NotFoundError(
            `Bug ticket "${ record.id }" was not found`,
            { cause, code: 'BugTicketNotFound' },
        );
    }
    if (cause.name === 'VersionConflictError') {
        throw new ConflictError(
            'This ticket was modified by someone else. Reload and try again.',
            { cause, code: 'BugTicketConcurrencyError' },
        );
    }
    throw new AssertionError('Unexpected error while updating bug ticket', { cause });
}
```
