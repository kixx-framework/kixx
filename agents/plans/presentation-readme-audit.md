# Presentation README Audit

## Scope

Reviewed `src/app/presentation/README.md` against the presentation, router,
Hyperview, context, form, static-file, and platform-server implementations and
their focused unit tests. This report records disagreements and materially
misleading omissions; it does not list every statement that agrees with the
code.

## Findings

### 1. The content-only recipe relies on a route that is not active

**Severity:** High

The recipe says that `HyperviewPageHandler()` "should already be configured for
the catch-all route" and that a content-only page needs no route work
([presentation README, lines 742-744](../../src/app/presentation/README.md#L742)).
The only Hyperview catch-all in `src/virtual-hosts.js` is commented out
([virtual-hosts.js, lines 111-131](../../src/virtual-hosts.js#L111)). Therefore a
new content-only pathname does not currently reach Hyperview; it receives the
router's not-found response.

The recipe should either instruct the developer to enable/add the catch-all or
state that content-only routing is unavailable in the current application
configuration.

### 2. Bare `HyperviewPageHandler()` cannot produce the documented full page

**Severity:** High

The same recipe specifically says `HyperviewPageHandler()` needs no options
([presentation README, line 743](../../src/app/presentation/README.md#L743)). The
rendering section correctly says that a full-page render requires
`baseTemplateId` ([presentation README, line 361](../../src/app/presentation/README.md#L361)).
The service enforces that requirement whenever neither `partial` nor
`skipBaseRender` is selected
([hyperview-service.js, lines 590-599](../../src/kixx/hyperview/hyperview-service.js#L590)).

A normal browser request to the bare handler therefore fails an assertion. The
commented catch-all shows the viable configuration:
`HyperviewPageHandler({ baseTemplateId: 'default.html' })`.

### 3. The documented page pathname field is in the wrong location

**Severity:** High

The page-context section says Hyperview creates `page.pathname`
([presentation README, line 978](../../src/app/presentation/README.md#L978)). The
implementation creates top-level `pathname` and `url_pathname`; it does not
default `page.pathname`
([hyperview-page.js, lines 133-145](../../src/kixx/hyperview/hyperview-page.js#L133)).

Any template following the guide and reading `page.pathname` receives only a
value explicitly supplied by page metadata or runtime props. The framework
default is `pathname` at the root of the context. Existing style-guide templates
currently read `page.pathname`, which makes this disagreement especially likely
to cause incorrect active-navigation state.

### 4. The default canonical URL is not canonicalized or lower-cased

**Severity:** Medium

The guide says `page.canonical_url` defaults to the "canonical lower-case
request URL" ([presentation README, line 979](../../src/app/presentation/README.md#L979)).
The implementation concatenates the request protocol, host, and raw
`url.pathname` ([hyperview-page.js, lines 147-151](../../src/kixx/hyperview/hyperview-page.js#L147)).
It omits the query and fragment as documented, but preserves pathname case,
duplicate/trailing slashes, and the `.json` representation suffix.

The canonical content pathname is separately normalized by `HyperviewService`,
but that normalized value is not used to construct `page.canonical_url`.

### 5. The primary form example returns validation failures as HTTP 200

**Severity:** High

The guide says handlers should set an error status for inline re-renders
([presentation README, line 296](../../src/app/presentation/README.md#L296)) and
later warns that `updateProps()` alone preserves the default 200
([presentation README, lines 423-430](../../src/app/presentation/README.md#L423)).
However, its main write-handler example catches `ValidationError` and only calls
`response.updateProps()`
([presentation README, lines 318-323](../../src/app/presentation/README.md#L318)).

The code behaves exactly as the later warning describes: `ServerResponse`
starts at 200 and `updateProps()` does not change status. The example should set
`response.status = err.httpStatusCode` (normally 422 for `ValidationError`) before
returning the updated props.

The same example also hardcodes its redirect pathname despite the preceding
reverse-routing section saying redirects should compile through an
`HttpTarget`.

### 6. The error-wrapping rule misclassifies `expected` errors

**Severity:** High

The presentation guide says a handler "MUST wrap the unexpected error" in an
`AssertionError` when `cause.expected` is truthy
([presentation README, line 403](../../src/app/presentation/README.md#L403)). A
truthy `expected` flag denotes an operational error, not an unexpected one.
The canonical error-handling guide says to catch expected errors only when the
layer can handle them or add context, preserve them as operational errors when
wrapping, and not wrap programmer errors
([server error handling, lines 17-35](../../src/docs/server-error-handling.md#L17),
[lines 112-120](../../src/docs/server-error-handling.md#L112)).

The likely intended rule is narrower: if an expected error arrives from a code
path whose occurrence violates the handler's invariant, wrap it in the project
`AssertionError` with `cause`; otherwise handle or propagate it as expected.
As written, the presentation guide tells developers to turn all caught
operational failures into fatal programmer errors.

### 7. The dynamic-page recipe contradicts the route ownership rules

**Severity:** Medium

The routing section says surface routes belong in `src/routes/` modules and
edits to `virtual-hosts.js` should be reserved for mounting a subtree or changing
subtree-wide configuration
([presentation README, line 21](../../src/app/presentation/README.md#L21)). The
dynamic-page recipe instead says to add the route in `virtual-hosts.js`
([presentation README, line 749](../../src/app/presentation/README.md#L749)).

The current application follows the first rule: admin-panel, admin API, and
publishing API leaf routes live in `src/routes/` and are mounted from
`src/virtual-hosts.js`. The recipe should direct developers to the owning route
module, with `virtual-hosts.js` only as the fallback for a new surface.

### 8. `RequestContext` documentation omits the public `config` property

**Severity:** Low

The guide says all three request objects are described and lists the
`RequestContext` properties, but omits `config`
([presentation README, lines 438-454](../../src/app/presentation/README.md#L438)).
`RequestContext` inherits the enumerable public `config` property from
`BaseContext` ([base-context.js, lines 42-68](../../src/kixx/context/base-context.js#L42)).

Add `config | Object | Resolved application configuration` to the table, or
avoid claiming the table is complete.

### 9. Numeric environment helpers accept strings the guide implies are invalid

**Severity:** Medium

The guide describes `getEnvInteger()` as returning an integer from a base-10
string and says present values that cannot be parsed as the expected number type
throw ([presentation README, lines 478-487](../../src/app/presentation/README.md#L478)).
The implementation uses permissive `Number.parseInt()` and
`Number.parseFloat()` without verifying full-string consumption
([base-context.js, lines 104-121](../../src/kixx/context/base-context.js#L104),
[lines 137-151](../../src/kixx/context/base-context.js#L137)).

Examples of actual behavior:

- `getEnvInteger()` returns `1` for `"1.5"` and `12` for `"12px"`.
- `getEnvFloat()` returns `1.5` for `"1.5px"`.

Either document prefix parsing explicitly or tighten the implementation to
reject trailing non-numeric text and non-integer numeric strings.

### 10. The shutdown claim is Node-specific, not cross-platform

**Severity:** Medium

The routing section says unexpected router failures trigger "the platform
server's graceful shutdown"
([presentation README, lines 184-188](../../src/app/presentation/README.md#L184)).
The Node entry point does initiate shutdown for unexpected non-HTTP errors
([node-server.js, lines 145-153](../../src/node-server.js#L145)). The Cloudflare
entry point only logs the error; there is no graceful-shutdown mechanism
([cloudflare-server.js, lines 70-79](../../src/cloudflare-server.js#L70)).

The guide should describe a platform fatal-error policy and identify graceful
process shutdown as the Node adapter's implementation of that policy.

### 11. The special `*` route is not restricted to unnamed routes

**Severity:** Low

The pattern guide says to use the app-level `*` "only for unnamed catch-all
routes" ([presentation README, line 117](../../src/app/presentation/README.md#L117)).
The route validator accepts an explicit name for any pattern, and the commented
application catch-all itself uses both `pattern: '*'` and
`name: 'hyperview-static-catch-all'`
([virtual-hosts.js, lines 111-114](../../src/virtual-hosts.js#L111)).

If "unnamed" means "does not capture a wildcard parameter," rephrase it that
way. If it means a route without a `name`, the statement disagrees with both the
implementation and the application's example configuration.

## Suggested correction order

1. Fix the inactive/bare catch-all guidance and the validation-status example.
2. Correct page-context field names and canonical URL behavior.
3. Replace the error-wrapping rule with the canonical error-handling rule.
4. Align route ownership and cross-platform failure language.
5. Resolve the lower-impact context, environment parsing, and `*` wording gaps.

## Validation notes

This was a read-only code/documentation audit. No JavaScript was changed, so the
project's JavaScript lint and unit-test requirements do not apply. The report was
corroborated with relevant focused tests where the contract is covered; no
end-to-end or development server work was performed.
