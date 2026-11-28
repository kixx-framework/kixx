Error Handling
==============

The devkit is a CLI run by a person at a terminal, by a script, or by an agent. Every error answers one question: **can the operator fix this by changing arguments, settings, or the outside world?** The answer picks the exit code. The exit-code table and the `--json` error envelope are in `commands/README.md`.

Two Categories
--------------

### Operator errors: `UsageError`

Throw `UsageError` (`lib/usage-error.js`) for anything the operator can fix: a bad flag, a missing setting, invalid `cloudflare-config.jsonc`, a missing Cloudflare resource, an expired token.

The runner (`lib/run-cli.js`) prints the message alone on stderr, wrapped at 80 columns, with no stack trace, and exits `2`. Under `--json` the message goes into the envelope instead. So the message is the whole user interface:

- Say what was wrong and how to fix it.
- Name the file and dotted key path the value belongs in (`app.environments.<environment>.publishingToken in .kixx/secrets.json`).
- Name the next command to run when there is one.

Subclass `UsageError` when callers need to branch on the case. `UnsupportedServerError` does this: it is a protocol failure, but the fix is an operator action (upgrade the deployment or target another one). A subclass's `code` is its class name, and it is what `--json` reports as `error.code`.

A subclass that needs its own exit code declares `static code` equal to a name in the exit-code table (`lib/exit-codes.js`). Define such a class beside the code that throws it:

| Class | Module | `code` | Exit |
|---|---|---|---|
| `ProjectNotFoundError` | `lib/project/find-project.js` | `ProjectNotFound` | 3 |
| `UnsupportedProjectVersionError` | `lib/project/project-version.js` | `UnsupportedProjectVersion` | 3 |
| `CommandNotAvailableError` | `lib/placeholder-command.js` | `CommandNotAvailable` | 4 |

`UnsupportedProjectVersionError` covers every case where this `kixx-dev` can't work with the project's copy of Kixx: an unsupported version, a `kixx/plugin.json` that can't be read, and a tooling module or export that is missing.

### Errors from the project's own Kixx code

An error named `ValidationError` or `OperationalError` also exits `2` with its message alone. These are thrown by the Kixx code a project vendors, which a `requiresTooling` command runs (see `docs/architecture.md`), and describe a problem the developer can fix: an invalid manifest under `kixx-dev generate`, for example. A manifest `ValidationError` lists every problem in its message, so the message alone is enough in text mode. The runner matches them by `name`: the class comes from the project's copy of Kixx, so `instanceof` against a devkit class is always false. A `ValidationError`'s `errors` array is reported under `--json` as `error.problems`.

### Defects: everything else

Bugs, violated invariants, and unexpected remote responses propagate. The runner prints `Failed to run command:` with the full error and stack on stderr, and exits `1`. Under `--json` the envelope's `error.code` is `UnexpectedError`, and the stack still goes to stderr. Do not catch and swallow them, and do not turn them into `UsageError`; the stack trace is what the developer needs.

A command never picks an exit code. It throws, and `describeError()` in `lib/exit-codes.js` maps the error to a row of the table.

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

All these classes set `name` and `code` to the class name. Branch with `error.name === 'CloudflareApiError'` or `error.code`; reserve `instanceof` for the `UsageError` check in `lib/exit-codes.js`, which must also match subclasses.

### Cloudflare authentication

`toCloudflareAuthUsageError()` (`lib/cloudflare/cloudflare-auth-guidance.js`) turns a `CloudflareApiError` with a `tokenStatus` into a `UsageError` telling the operator whether the token is invalid or lacks a permission, and which secrets files to check. The runner does not call it: no registered command talks to Cloudflare in this version. A command that does passes its errors through it.

### Retries

API clients retry only when repeating the request is safe:

- Reads (`GET`) retry on 429, 5xx, and network failures.
- Writes that are not idempotent retry on 429 only. A 5xx or network failure surfaces immediately, because the write may have landed (an Admin API migration batch).
- Idempotent Publishing API writes (object `PUT`, Release `POST`) retry like reads: repeating them stores the same bytes or returns the same Release.
- Publishing API build assignment never retries. Reconcile with `getBuild()` instead.

Keep this rule when adding a client or endpoint. Record the attempt count on the error.

The Publishing API client (`lib/publishing/publishing-api-client.js`) picks the delay from the response:

- A `Retry-After` header (seconds or HTTP-date) is honored, capped at 30 s, plus up to 1 s of jitter.
- A `503` without one backs off exponentially from 1 s, because the server is overloaded.
- Other retries back off exponentially from 100 ms, with jitter.

Any `503` also sets the client's sticky `serverOverloaded` flag, which `publishContent()` reads to upload one object at a time.

### Partial success

When a multi-step operation fails after creating durable remote state, the error must say what already exists so the operator can finish by hand. `lib/publishing/publish-release.js` throws `ReleaseAssignmentError` with the created Release id when build assignment fails, so the operator can assign it.

Wrapping
--------

Wrap with `cause` when a layer adds context the operator or developer needs:

```js
throw new UsageError(`${ cause.message }\nRun "kixx-dev ${ name } --help" for usage.`, { cause });
```

- Always pass `cause`.
- Say what this layer was doing; do not repeat the inner message.
- Catch narrowly (`cause.code === 'ENOENT'`), and rethrow what you do not recognize.
