# Transaction Scripts

To organize domain logic for this application we use the Transaction Script pattern from Fowler's *Patterns of Enterprise Application Architecture*.

A Transaction Script is a single procedure, one for each action that a user might want to do. It is expressed as a function that takes the input from the presentation, processes it with validations, makes computations, stores data in the database, and invokes any operations from other systems. It replies with more data to the presentation, perhaps doing more calculation to help organize and format the reply.

You can think of Transaction Scripts as remote procedure calls.

Transaction scripts are application-specific domain logic and live in the app/transaction-scripts/ directory.

## File and Naming Conventions

Each Transaction Script lives in its own file. Files are named after the action they perform, in kebab-case:

```
app/transaction-scripts/
├── bugs/
│   ├── create-bug-ticket.js
│   ├── get-bug-ticket.js
│   └── list-bug-tickets.js
└── users/
    ├── create-user.js
    └── get-user.js
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

Return `null` or `undefined` only from scripts where no data is needed by the caller (e.g. a delete operation). For everything else, return a plain object. For read scripts that fetch one required resource, throw `NotFoundError` when the resource is absent unless the caller explicitly handles absence as an allowed result.

## Input to Transaction Scripts

Transaction scripts get their input from the Presentation Layer through the use of Forms. Forms should be used for both FormData and JSON:API write requests. See the @application/docs/presentation-layer.md document for more information.

Even when Transaction Scripts get their data from other external sources — external APIs, remote service calls, web scraping, etc. — the Forms pattern should be used to format and validate the incoming data.

Forms own payload parsing, normalization, and field-level validation. Transaction Scripts receive already-validated Forms and enforce cross-field or state-dependent business rules. For read operations, middleware passes URL parameters and query values directly as plain arguments (no Form needed).

## Data Access

Transaction Scripts access stored data through registered Collections on the `RequestContext`. See @application/docs/data-source-layer.md for the full Collection API.

## Calling External Services

When a Transaction Script needs to call an external service — a Cloudflare binding such as the email service, R2 object store, or any other platform API — it does so through a registered gateway. Retrieve gateways via `context.getService()`:

```js
const emailGateway = context.getService('EmailGateway');
const { messageId } = await emailGateway.send(context, message);

const objectStore = context.getService('ObjectStoreGateway');
const { tempKey, contentHash } = await objectStore.streamToTemp(context, body, { contentType });
```

**Do not put business rules inside a gateway.** A gateway's sole responsibility is to hide the shape of one external resource: its binding API, key formats, error codes, and wire protocol. Business rules, cross-field validation, and conditional branching based on domain state belong in the Transaction Script.

To author and register a new gateway for an external resource, see the "External Service Gateways" section of @application/docs/data-source-layer.md.

## Error Handling

Follow @application/docs/error-handling.md for the project-wide error taxonomy, assertion rules, wrapping rules, and HTTP serialization behavior. This section only covers how those rules apply at the Transaction Script boundary.

### Expected vs. Unexpected Errors

Every error a transaction script encounters must be classified into one of two buckets:

- **Expected (operational) errors** are errors the Transaction Script logic is prepared for and describes an outcome the caller is allowed to see: a violated business rule, a missing resource, a conflicting write. In this case you should throw the operational error class from @application/src/kixx/errors/mod.js (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, etc.) which makes the most sense for the case you are handling. Each of these operational error classes carries an HTTP status and a client-safe `message`, and the router serializes it into the corresponding 4xx response.
- **Unexpected (programmer) errors** are bugs and infrastructure failures: a broken invariant, a record the code should never have produced, an unreachable binding, an unrecognized storage failure. These must reach the router as a **non-operational** error so its fallback produces a 500 and the underlying defect is logged instead of hidden. Rethrow these errors as an `AssertionError` with the original error set as the cause.

```js
import {
    AssertionError,
    ConflictError,
    NotFoundError,
} from '../../../kixx/errors/mod.js';

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

When the Transaction Script itself detects the violated business rule or missing resource, throw the operational error directly:

```js
// Throw when a business rule is violated:
throw new ConflictError('A bug ticket with this title already exists in the project');

// Throw when a required entity is absent:
throw new NotFoundError(`Bug ticket "${ id }" was not found`);
```

## Complete Example: Write Script

```js
import { AssertionError, ConflictError } from '../../../kixx/errors/mod.js';

/**
 * Creates a new bug ticket from a validated form submission.
 * @param {import('../../../kixx/context/request-context.js').default} context
 * @param {import('../../forms/create-bug-ticket-form.js').default} form
 * @returns {Promise<Object>} The created ticket document
 * @throws {ConflictError} When a ticket with the same ID already exists
 */
export async function createBugTicket(context, form) {
    const tickets = context.getCollection('BugTicket');

    let record;
    try {
        record = await tickets.create(context, {
            id: form.id,
            title: form.title,
            description: form.description,
            priority: form.priority ?? 'medium',
            screenshots: form.screenshots ?? [],
        });
    } catch (cause) {
        if (cause.name === 'DocumentAlreadyExistsError') {
            throw new ConflictError(
                'A bug ticket with this ID already exists',
                { cause, code: 'BugTicketConflictError' },
            );
        }
        throw new AssertionError('Unexpected error in createBugTicket', { cause });
    }

    return record.toDocument();
}
```
