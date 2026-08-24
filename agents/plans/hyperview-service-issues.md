# HyperviewService — Issue Tracker

Issues found during a documentation review of `src/kixx/hyperview/` on
2026-08-24.

Everything except HV-6 is fixed; see the status note on each. HV-6 is open and
deliberately deferred. The suite is now 1031 tests, 100 of them against
`src/kixx/hyperview/`, and the linter is clean. Each fix below was checked by
reverting it and confirming the new tests fail, so they are verified by
execution rather than by reading — but only at the unit level. Nothing has run
against a real request, because HV-6 means nothing imports the service yet.

Most of what follows is one root cause: `HyperviewService` was written against
the old `HyperviewContentSnapshot` API and only partially migrated to
`ContentSnapshot` when the content-addressable store landed (`d5e5037`,
`179a67e`). The method *names* were updated; their arguments and return shapes
were not.

Ordered by severity.

---

## HV-1: Every content read omits the `context` argument

**Status:** Fixed. The request context is threaded through
`#loadGlobalTemplatePartials(context, content)`,
`#loadBaseTemplate(context, content, templateId)`,
`#getPage(context, content, url, pathname, responseProps)`, and
`#getEmail(context, content, pathname)`, and passed as the first argument to
all four `ContentSnapshot` reads. Linter clean; 931 unit tests pass. Still
unverified at runtime because of HV-6.

**Severity:** Critical — no page, partial, or email can render
**Location:** `src/kixx/hyperview/hyperview-service.js:217`, `:273`, `:399`, `:433`

```javascript
const page = await content.batchGetPageAssets(pathname);
const file = await content.getGlobalTemplatePartials();
const file = await content.getBaseTemplates();
const bundle = await content.getEmailAssets(pathname);
```

Every read method on `ContentSnapshot` takes the request context first:
`batchGetPageAssets(context, pathname)`, `getGlobalTemplatePartials(context)`,
`getBaseTemplates(context)`, `getEmailAssets(context, pathname)`. The old
`HyperviewContentSnapshot` took no context — it captured everything at
construction — so these call sites are one argument short.

**How it is triggered**

Any request that reaches `respondWithHypertext()`, and any call to
`renderEmail()`.

`batchGetPageAssets(pathname)` binds `pathname` to `context` and leaves
`pathname` undefined, so the method's own `assert(isValidPathname(pathname))`
fails before any read happens. The request dies with an `AssertionError` naming a
pathname argument the caller did supply, which will send whoever debugs it to the
wrong place. `getEmailAssets(pathname)` fails the same way.

`getGlobalTemplatePartials()` and `getBaseTemplates()` fail one layer deeper:
both pass `undefined` to `ContentSnapshot#getFile()`, which hands it to the
platform store. On Cloudflare, `ContentStore#getFile()` resolves the KV binding
*out of* the context (`#resolveKvStore(context)`), so the read throws on a
property access of `undefined` rather than reporting a missing argument.

**Implications**

The entire hypermedia presentation layer is non-functional: every page render,
every partial fetch, every page transition, and every outgoing email. There is no
partial degradation and no fallback — the failure is on the first content read of
every render.

**Recommended fix**

Thread the request context through the private loaders. They already receive the
snapshot; the context is the other half of the same request scope, so pass it
alongside rather than stashing it on the instance (an instance field would be
shared across concurrent requests):

```javascript
async #loadGlobalTemplatePartials(context, content) {
    // ...
    const file = await content.getGlobalTemplatePartials(context);
```

Same for `#loadBaseTemplate(context, content, templateId)`,
`#getPage(context, content, url, pathname, responseProps)`, and
`#getEmail(context, content, pathname)`.

---

## HV-2: `createMiniTemplate()` calls a method that does not exist

**Status:** Fixed. `createMiniTemplate()` now calls the module-private
`compileTemplate()` function.

**Severity:** Critical — every templated title, description, or subject throws
**Location:** `src/kixx/hyperview/hyperview-service.js:856`

```javascript
createMiniTemplate(templateId, templateSource) {
    const template = this.compileTemplate(templateId, templateSource, this.#customHelpers);
```

`compileTemplate()` is a module-private function, not a method. `HyperviewService`
has no `compileTemplate` member, so this is always a `TypeError`.

**How it is triggered**

Publishing any page whose `page.json` gives `page.title` or `page.description` in
the documented `{ "template": "..." }` form, or any email whose bundle gives
`subject.template`. `HyperviewPage#mergeSources()` calls the injected
`createMiniTemplate` during context assembly, so the failure happens while
building the page context, before any template runs.

**Implications**

`this.compileTemplate is not a function` surfaces from inside the `HyperviewPage`
constructor, several frames away from the real defect. The templated-metadata
feature documented in `src/app/presentation/README.md` cannot be used at all;
only plain-string titles and descriptions work.

**Recommended fix**

Call the module function:

```javascript
const template = compileTemplate(templateId, templateSource, this.#customHelpers);
```

---

## HV-3: `#getPage()` does not await the compiled template and partials

**Status:** Fixed. Both compilations are awaited together through
`Promise.all()`, preserving the concurrency.

**Severity:** Critical — page renders receive Promises where functions are required
**Location:** `src/kixx/hyperview/hyperview-service.js:412`

```javascript
const partials = this.#getPagePartials(page.partials);
const template = this.#getPageTemplate(page.template);

return new HyperviewPage({ /* ... */ template, partials, /* ... */ });
```

Both methods are `async`. `HyperviewPage` stores what it is given verbatim, so
`page.template` and `page.partials` are Promises for the life of the render.

**How it is triggered**

Any successful page render, once HV-1 and HV-2 are fixed. Each render mode fails
differently, and none of them fails clearly:

- Partial render: `page.partials.get(...)` — `TypeError`, Promise has no `get()`.
- Page-template render: `template(...)` — `TypeError`, Promise is not a function.
- Full-page render: `layerPartials()` spreads the Promise into a `Map`
  constructor — `TypeError`, Promise is not iterable.

**Implications**

Every render path throws a type error naming a Promise, which reads as a
templating bug rather than a missing `await`. Note that the two calls are started
concurrently on purpose — that is worth keeping.

**Recommended fix**

Await both, preserving the concurrency:

```javascript
const [ partials, template ] = await Promise.all([
    this.#getPagePartials(page.partials),
    this.#getPageTemplate(page.template),
]);
```

---

## HV-4: Page includes are passed to templates as a content object, not their content

**Status:** Fixed. `#getPage()` now passes `page.includes?.json ?? {}`,
matching what `#getEmail()` already did.

**Severity:** High — silently renders nothing
**Location:** `src/kixx/hyperview/hyperview-service.js:422`

```javascript
includes: page.includes || {},
```

`ContentSnapshot#batchGetPageAssets()` returns `includes` as a
`JsonContentObject` — `{ pathname, hash, size, metadata, json }` — where the
published bundle is under `.json`. The old snapshot API returned the parsed
bundle directly.

**How it is triggered**

Any page that publishes an includes bundle and references it from a template. The
publishing API validates the bundle as a flat object of name → text
(`putPageIncludes`), and templates address it as `{{ includes.intro }}`.

**Implications**

This one does not throw. `{{ includes.intro }}` resolves nothing and renders an
empty string, so the page renders successfully with its included content missing —
the failure mode most likely to reach production unnoticed. It also puts a class
instance into the page context, which is then assigned by reference (`deepMerge`
does not copy non-plain objects) and serialized in full by the `.json` debug
response.

**Recommended fix**

```javascript
includes: page.includes?.json ?? {},
```

`#getEmail()` already does this correctly (`bundle.json.includes ?? {}`), which is
what makes the page path's omission easy to miss.

---

## HV-5: `renderEmail()` does not handle an unpublished email

**Status:** Fixed. `renderEmail()` throws `NotFoundError` when `#getEmail()`
resolves null, and the JSDoc records it with `@throws`.

**Severity:** Medium — wrong error class for an ordinary condition
**Location:** `src/kixx/hyperview/hyperview-service.js:805`

```javascript
const email = await this.#getEmail(content, pathname);

const globalPartials = await this.#loadGlobalTemplatePartials(content);
const partials = layerPartials(email.partials, globalPartials);
```

`#getEmail()` resolves `null` when the snapshot names no bundle at that pathname —
an ordinary outcome, and the reason the null branch exists.

**How it is triggered**

Calling `renderEmail()` with a pathname whose bundle has not been published, or
which was removed by a later publication. A typo in a caller's pathname is enough.

**Implications**

`TypeError: Cannot read properties of null (reading 'partials')` propagates as an
unexpected programmer error and is reported as a 500, rather than the expected
operational error the situation is. `respondWithHypertext()` handles the
equivalent page case correctly, so the two render methods disagree about what an
absent resource means.

**Recommended fix**

Mirror the page path:

```javascript
if (!email) {
    throw new NotFoundError(`No email found for pathname "${ pathname }"`, { pathname });
}
```

Then document it with `@throws {NotFoundError}` on `renderEmail()`.

---

## HV-6: `hyperview-request-handlers.js` does not exist

**Severity:** High — the application cannot start
**Location:** `src/virtual-hosts.js:1`, `src/app/presentation/lib/html-error-page.js:1`

```javascript
import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from './kixx/hyperview/hyperview-request-handlers.js';
```

`src/kixx/hyperview/` contains only `hyperview-page.js`, `hyperview-service.js`,
and `helpers/`. The module these two files import was removed with the legacy
hyperview modules in `d5e5037` and has not been replaced.

**How it is triggered**

Booting the server, or any import of `src/virtual-hosts.js`.

**Implications**

Nothing in the application currently calls `HyperviewService`, which is precisely
why HV-1 through HV-4 have not surfaced: the code path is unreachable. Fixing the
handler module without fixing those first will produce four failures in a row.

**Recommended fix**

Reinstate the request-handler module against the current service API. It is the
adapter between the router (`context`, `request`, `response`) and
`respondWithHypertext()`, and owns the per-route options — `baseTemplateId`,
`partial`, `skipBaseRender`, `allowJsonResponse`, and the page-cache settings.
`src/virtual-hosts.js` and `src/app/presentation/README.md` between them describe
the surface the replacement has to satisfy; `git show d5e5037^` has the previous
implementation for reference, but it is written against the old content API.

---

## HV-7: No test coverage for `src/kixx/hyperview/`

**Status:** Fixed. `test/unit-tests/kixx/hyperview/` covers the service and the
three helpers with 100 tests, built on a file-local fake `ContentSnapshot` and
fake content-addressable and KV stores. Every item on the recommended-minimum
list below is covered, and each of the HV-1..HV-5, HV-8, and HV-10 fixes was
confirmed to fail the suite when reverted. `src/kixx/hyperview/hyperview-page.js`
has no test file of its own: its behavior is exercised through the service
(merge precedence, mini templates, URL-derived defaults), which is how the
application reaches it.

**Severity:** Medium — the defects above are all silent
**Location:** `test/unit-tests/` (no hyperview directory)

The legacy hyperview tests were removed in `e9a886c` and nothing replaced them.

**How it is triggered**

Not a runtime failure. It is the reason HV-1 through HV-5 are sitting in `main`
with a green test run: `node run-tests.js` reports 931 passing tests against a
service that cannot render a single page.

**Implications**

Every future change to the render modes, the cache-key derivation, or the
template-cache generations is unverifiable. The cache-key logic in particular
deserves tests: the props-in-key default (HV-note below) is a security property,
not an optimization.

**Recommended fix**

Add `test/unit-tests/kixx/hyperview/` with a fake `ContentSnapshot`, covering at
minimum:

- the three render modes and the distinct cache identity each produces;
- `includePropsInCacheKey` defaulting to true whenever the page cache is on;
- template-cache hits and evictions keyed by content hash;
- a missing page producing `NotFoundError`;
- metadata mini templates rendering against the merged context.

---

## HV-8: The base-template bundle is not validated as an Array

**Status:** Fixed. `#loadBaseTemplate()` now calls `assertArray()` on
`file.json` like the other three loaders.

**Severity:** Low — diagnostics only
**Location:** `src/kixx/hyperview/hyperview-service.js:281`

`#loadGlobalTemplatePartials()`, `#getPagePartials()`, and `#getEmail()` each
`assertArray(file.json, ...)` before iterating, naming the pathname in the
message. `#loadBaseTemplate()` iterates `file.json` with no such check.

**How it is triggered**

A base-template bundle published as an object rather than an array — reachable
only by writing through `ContentSnapshot#putBaseTemplates()` directly, since the
publishing API validates the shape.

**Implications**

`file.json is not iterable`, with no pathname, instead of the message the other
three loaders would give.

**Recommended fix**

Add the matching `assertArray()` call for symmetry.

---

## HV-9: Documented JSON-response behavior does not match the implementation

**Status:** Fixed in the documents, as recommended — the `.json`-suffix-only
rule stands. `src/app/presentation/README.md` no longer claims `Accept`-header
negotiation, and `AGENTS.md` no longer claims includes are excluded (with HV-4
fixed, the context carries the parsed includes bundle and the debug response
serializes it).

**Severity:** Low — documentation drift
**Location:** `AGENTS.md`, `src/app/presentation/README.md:290`

Two mismatches against `respondWithHypertext()`:

1. `AGENTS.md` says the `.json` URL returns the template context object
   "excluding includes content". The service returns `page.context` whole, and the
   context carries `includes` (as a content object today — see HV-4).
2. `src/app/presentation/README.md` says a request counts as a JSON request when
   the pathname ends in `.json` **or** the `Accept` header includes
   `application/json`. The service only implements the `.json` suffix.

**How it is triggered**

Following either document. The `Accept`-header form silently renders HTML.

**Implications**

Nothing breaks, but a page whose includes are large makes the debug response much
heavier than documented, and content negotiation appears broken rather than
absent.

**Recommended fix**

Decide which side is authoritative. The `.json`-suffix-only rule is the safer one
— it is explicit, it cannot be triggered by a browser's `Accept` header, and
`respondWithHypertext()` already explains why gating the suffix matters — so
prefer correcting the two documents. If includes really should be excluded,
exclude them at the response, not from the context, since templates need them.

---

## HV-10: Helper edge cases render diagnostic text into the page

**Status:** Fixed. `markup` returns `''` for any falsy value, and `truncate`
returns the string unchanged when `length` is not a number.

**Severity:** Low
**Location:** `src/kixx/hyperview/helpers/markup.js:30`, `src/kixx/hyperview/helpers/truncate.js:28`

Two rough edges in the helper contracts:

1. `markup` returns `''` for an empty string but falls through to
   `toFriendlyString()` for `null` and `undefined`, rendering the literal text
   `null` or `undefined` into the page. `formatDate` and `truncate` both treat all
   three the same way and return `''`.
2. `truncate` called without a `length` compares `str.length <= undefined`, which
   is false, then slices with `slice(0, undefined)` — returning the whole string
   with `&hellip;` appended to it.

**How it is triggered**

`{{ markup page.body }}` where the field is absent from the page data, which is
ordinary for an optional field. `{{ truncate summary }}` with the argument
forgotten.

**Implications**

Visible garbage in rendered output rather than an omission or an error. Neither is
severe, but the inconsistency between the three helpers is the kind of thing a
template author will hit and then work around with `{{#if}}` wrappers.

**Recommended fix**

Give `markup` the same empty guard the other two helpers use (`if (!markdown)
return ''`), and have `truncate` return the string unchanged when `length` is not
a number.

---

## HV-11: `createMiniTemplate()` documents a render error it does not produce

**Status:** Fixed in the JSDoc. Found while writing the HV-7 tests.

**Severity:** Low — documentation only
**Location:** `src/kixx/hyperview/hyperview-service.js:846`

The JSDoc said a `{{> name }}` in a title, description, or subject "is a render
error rather than an expansion". It is not. The empty partial lookup means the
tag resolves nothing, and `compilePartial()` in the templating engine follows the
Mustache spec: a missing partial renders as an empty string.

**How it is triggered**

Publishing a metadata field containing a partial tag. It renders as if the tag
were not there.

**Implications**

The constraint the empty lookup enforces is real, but it is silent, not loud. An
author following the JSDoc would expect to be told; instead the field renders
short. Only the documentation was wrong, so only the documentation changed — the
silent behavior is the engine's spec-conformant one and is now covered by a test
that asserts it.
