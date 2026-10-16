Error Handling
==============

The devkit is a CLI run by a person at a terminal. Every error answers one question: **can the operator fix this by changing arguments, settings, or the outside world?**

Two Categories
--------------

### Operator errors: `UsageError`

Throw `UsageError` (`lib/usage-error.js`) for anything the operator can fix: a bad flag, a missing setting, invalid `cloudflare-config.jsonc`, a missing Cloudflare resource, an expired token.

`kixx.js` prints the message alone, wrapped at 80 columns, with no stack trace, and exits `1`. So the message is the whole user interface:

- Say what was wrong and how to fix it.
- Name the file and dotted key path the value belongs in (`app.environments.<environment>.publishingToken in .kixx/secrets.json`).
- Name the next command to run when there is one.

Subclass `UsageError` when callers need to branch on the case. `PublishingApiTokenInactiveError` does this: it is a protocol failure, but the fix is an operator action.

### Defects: everything else

Bugs, violated invariants, and unexpected remote responses propagate. `kixx.js` prints `Failed to run command:` with the full error and stack, and exits `1`. Do not catch and swallow them, and do not turn them into `UsageError`; the stack trace is what the developer needs.

Assertions
----------

Write internal assumptions down with the `assert*` helpers from `lib/vendor/kixx-assert/mod.js`, at public function entry points and between pipeline stages:

```js
assertNonEmptyString(origin, 'AdminAPIClient() requires an origin');
assert(isFunction(fetchImpl), 'AdminAPIClient() requires a fetch function');
```

Prefix the message with the function name. An `AssertionError` is a defect, never operator input validation.

### Translating assertions at the configuration boundary

When one module owns the value rules (for example `CloudflareWorkerVersion` in `lib/cloudflare/cloudflare-worker-version.js`), validate configuration by running those rules early and converting the `AssertionError` into a `UsageError` that names the config path. See `lib/cloudflare/worker-version-config.js`. Rethrow anything else unchanged. This keeps one copy of each rule while still reporting bad config as config.

Remote API Errors
-----------------

Each API client throws its own error class, carrying protocol details as properties so callers branch on data, not message text:

| Class | Module | Extra properties |
|---|---|---|
| `AdminApiError` | `lib/admin/admin-api-error.js` | `status`, `errors`, `method`, `url`, `attempts` |
| `PublishingApiError` | `lib/publishing/publishing-api-error.js` | `status`, `errors`, `method`, `url`, `attempts` |
| `CloudflareApiError` | `lib/cloudflare/cloudflare-api-error.js` | `status`, `errors`, `method`, `url`, `tokenStatus` |
| `BundleError` | `lib/bundler/bundle-error.js` | `diagnostics` |

`status` is `null` for a network failure. The Admin and Publishing modules export `create*ApiError()` factories that map a server JSON:API error `code` to a typed subclass (`ReleaseNotFoundError`, `MigrationConcurrencyError`, ...). Add a subclass and a map entry when a command needs to react to a new server code.

All these classes set `name` and `code` to the class name. Branch with `error.name === 'CloudflareApiError'` or `error.code`; reserve `instanceof` for the `UsageError` check in `kixx.js`, which must also match subclasses.

### Cloudflare authentication

`kixx.js` passes every command error through `toCloudflareAuthUsageError()` (`lib/cloudflare/cloudflare-auth-guidance.js`). A `CloudflareApiError` with a `tokenStatus` becomes a `UsageError` telling the operator whether the token is invalid or lacks a permission, and which secrets files to check. Commands do not handle auth failures themselves.

### Retries

API clients retry only when repeating the request is safe:

- Reads (`GET`) retry on 429, 5xx, and network failures.
- Writes retry on 429 only. A 5xx or network failure on a write surfaces immediately, because the write may have landed (a migration batch, a Release).

Keep this rule when adding a client or endpoint. Record the attempt count on the error.

### Partial success

When a multi-step operation fails after creating durable remote state, the error must say what already exists so the operator can finish by hand. `commands/app/publish.js` reports the created Release id when build assignment fails, so `kixx app assign-build` can complete it.

Wrapping
--------

Wrap with `cause` when a layer adds context the operator or developer needs:

```js
throw new UsageError(`${ cause.message }\nRun "kixx ${ commandName } ${ subCommandName } --help" for usage.`, { cause });
```

- Always pass `cause`.
- Say what this layer was doing; do not repeat the inner message.
- Catch narrowly (`cause.code === 'ENOENT'`), and rethrow what you do not recognize.
