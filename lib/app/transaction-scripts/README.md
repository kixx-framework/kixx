# Transaction Scripts

Domain logic uses Fowler's Transaction Script pattern: one async function per user action. It takes input from the presentation layer, validates it, applies business rules, reads and writes Collections, calls external services, and returns data for the caller to render. Scripts live in `app/transaction-scripts/`.

## When Not to Write One

A script must add something: cross-field validation, business rules, orchestration across Collections or services, or a decision about what an error means to the application. A script that only calls one service method and returns its result is an extra hop.

Presentation code may call a framework service directly via `context.getService(name)` when the service owns the complete operation and no business policy applies. Example: `objects.js` in `app/presentation/request-handlers/publishing-api/` calls `ContentAddressableStore` directly, while `releases.js` and `builds.js` go through `app/transaction-scripts/publishing/` because they coordinate it with the `Release` and `Activation` Collections.

This exception is narrow. Anything that touches a Collection, enforces a business rule, or must classify errors belongs in a script.

## Files and Signatures

One script per file, named for the action in kebab-case, grouped by domain concept. Each file exports one async function named in camelCase to match. Helpers shared within a group go in `lib.js` (e.g. `files/lib.js`).

```
app/transaction-scripts/
└── publishing-api-tokens/
    ├── create-publishing-api-token.js   → createPublishingApiToken(context, form, grantingUserId)
    ├── list-publishing-api-tokens.js    → listPublishingApiTokens(context, params)
    └── revoke-publishing-api-token.js   → revokePublishingApiToken(context, tokenId)
```

The first argument is always the `RequestContext`. Scripts never receive HTTP request or response objects, so they stay testable and callable from jobs and CLI tools.

- **Writes** take a validated Form (see Forms in `app/presentation/README.md`), plus any route values like an id. Use Forms for FormData, JSON:API, and data from external sources alike. Forms own parsing, normalization, and field-level validation. Scripts enforce cross-field and state-dependent rules.
- **Reads** take plain values (ids, `{ limit, cursor }`) extracted by the caller.
- **Internal callers** (other handlers, jobs) may pass a plain `args` object, e.g. `createRelease(context, { manifest, createdBy })`.

## Return Values

Return plain objects:

```js
return record.toObject();
return { items: result.items.map((record) => record.toObject()), cursor: result.cursor };
```

- A single-resource read returns the object or `null`, documented as `@returns {Promise<Object|null>}`. Deciding what absence means to the user (404, empty state, default) is the caller's job.
- Return nothing only when the caller needs no data (e.g. delete).
- Throw instead of returning `null` when:
  - A mutation requires the target to exist (revoke, update, strict delete): throw `NotFoundError`, or `AssertionError` if absence is an unexpected code path.
  - Absence has domain meaning: e.g. `authenticateAdminSession` throws `UnauthenticatedError` for a missing session rather than revealing whether the id existed.

## Data and External Services

Get Collections with `context.getCollection(name)` (API: `app/collections/README.md`). Get gateways and framework services with `context.getService(name)`:

```js
const store = context.getService('ContentAddressableStore');
const release = await store.createRelease(context, manifest);

const mailer = context.getService('Mailer');
const { messageId } = await mailer.send(context, '/password-reset', {
    to: user.email_address,
    data: { user, resetUrl },
});
```

**Do not put business rules inside a gateway.** A gateway only hides the shape of one external resource: its binding API, key formats, error codes, and wire protocol. Business rules, validation, and branching on domain state belong in the script.

## Error Handling

Classify every caught error:

- **Expected (operational)**: the script is prepared to handle it.
- **Unexpected (programmer)**: from a path the script assumes is unreachable or impossible in a healthy system.

Never handle unexpected errors beyond logging and rethrowing; they should crash the system. You may wrap one in an `AssertionError` to add debugging context. You **must** wrap it in an `AssertionError` if `cause.expected` is truthy.

For expected errors, choose one:

- **Wrap with a new `name` or `code`** when the original is not meaningful to the caller, or to standardize the script's error signature.
- **Wrap as `AssertionError`** when it comes from a path the script does not account for.
- **Rethrow unchanged** when the script documents it with `@throws`.

Branch on `error.name`, `error.code`, and `error.expected`, never `instanceof`:

```js
import { AssertionError, ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';

try {
    record = await tickets.update(context, record);
} catch (cause) {
    if (cause.name === 'DocumentNotFoundError') {
        throw new NotFoundError(`Bug ticket "${ record.id }" was not found`, { cause, code: 'BugTicketNotFound' });
    }
    if (cause.name === 'VersionConflictError') {
        throw new ConflictError('This ticket was modified by someone else. Reload and try again.', {
            cause,
            code: 'BugTicketConcurrencyError',
        });
    }
    throw new AssertionError('Unexpected error while updating bug ticket', { cause });
}
```
