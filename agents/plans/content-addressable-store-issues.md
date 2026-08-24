# ContentAddressableStore — Issue Tracker

Issues found during a documentation review of `src/kixx/content-addressable-store/`
and `src/plugins/content-addressable-store/` on 2026-08-24.

Nothing in this document has been fixed. The review changed comments and JSDoc
only; all 899 unit tests pass and the linter is clean against the reviewed
directories, which is itself part of the finding for CAS-1 through CAS-3: none
of them is covered by a test.

Ordered by severity.

---

## CAS-1: `getEmailBundlePath()` discards its argument, collapsing every email onto one bundle

**Status:** Resolved — `getEmailBundlePath()` now nests the bundle beneath the
email pathname (`/emails/<pathname>/__email-assets`), the doc block was
corrected, and `content-layout.test.js` covers distinct pathnames, the new
path shape, and the assertion on an invalid pathname.
**Severity:** High — silent data loss
**Location:** `src/kixx/content-addressable-store/content-layout.js:227`

```javascript
export function getEmailBundlePath(pathname) {
    assert(isValidPathname(pathname), 'getEmailBundlePath() requires a valid page pathname');
    return normalizePathname(`emails/${ EMAIL_ASSETS_BUNDLE }`);
}
```

The `pathname` argument is validated and then never used. Every email resolves to
the single storage pathname `/emails/__email-assets`.

**How it is triggered**

Publishing a second email. `ContentSnapshot#putEmailAssets(context, '/welcome', bundle)`
and `putEmailAssets(context, '/password-reset', bundle)` both write to
`/emails/__email-assets`. A commit that lists both produces a manifest with two
entries at the same pathname, which `validateIndexSourceFiles()` rejects as a
duplicate — so the publish fails with a `ValidationError` naming a pathname the
publisher never supplied.

Reading is worse, because it does not fail: `getEmailAssets(context, '/welcome')`
and `getEmailAssets(context, '/password-reset')` return the same bundle. Whichever
email was published last is served for every email pathname in the site.

**Implications**

A site can publish exactly one email. With more than one, either the publish
fails with a confusing error, or — if the publisher deduplicates the manifest
before committing — the wrong email body is rendered and sent. `renderEmail()`
has no way to detect the substitution, since the bundle it receives is
structurally valid.

**Recommended fix**

Give each email its own directory, mirroring the page layout:

```javascript
export function getEmailBundlePath(pathname) {
    assert(isValidPathname(pathname), 'getEmailBundlePath() requires a valid email pathname');
    return normalizePathname(`emails/${ pathname }/${ EMAIL_ASSETS_BUNDLE }`);
}
```

Then correct the `EMAIL_ASSETS_BUNDLE` doc block (it currently says "within its
page directory", which is right for the fix and wrong for the code) and add unit
tests asserting that two distinct email pathnames produce two distinct storage
pathnames. This is a layout change, so it must land before any site publishes
email content; afterwards it needs a `FORMAT` bump or a republish.

---

## CAS-2: `HyperviewService` calls every `ContentSnapshot` read without the `context` argument

**Status:** Open
**Severity:** High — page rendering is broken on every platform
**Location:** `src/kixx/hyperview/hyperview-service.js:146, 157, 198, 210, 329, 359`

`ContentSnapshot`'s read methods take `context` as their first argument, but
`hyperview-service.js` was written against the earlier signatures and was not
updated when `context` was threaded through (commit `f25c3e4`, "New Cloudflare
ContentStore"). Four call sites are off by one argument:

| Call site | Actual signature |
| --- | --- |
| `content.getGlobalTemplatePartials()` | `(context)` |
| `content.getBaseTemplates()` | `(context)` |
| `content.batchGetPageAssets(pathname)` | `(context, pathname)` |
| `content.getEmailAssets(pathname)` | `(context, pathname)` |

(`statGlobalTemplatePartials()` and `statBaseTemplates()` are correct — those two
are synchronous index lookups and take no context.)

**How it is triggered**

Any page render. `#getPage()` calls `batchGetPageAssets(pathname)`, so inside the
snapshot `context` is bound to the pathname string and `pathname` is `undefined`.
The method's first statement is
`assert(isValidPathname(pathname), 'batchGetPageAssets() requires a valid pathname')`,
and `isValidPathname(undefined)` returns `false`. Every request throws an
`AssertionError` before any content is read. `renderEmail()` fails the same way.

The two bundle reads fail differently and later: their arguments are simply
missing, so `context` is `undefined` and gets passed to
`ContentStore#getFile(undefined, ...)`. The Node adapter ignores `context` and
happens to work; the Cloudflare adapter resolves its bindings from `context.env`
and throws a `TypeError` on property access of `undefined`.

**Implications**

The Hyperview render path cannot serve a page at all. The bundle reads are the
more dangerous half of this: they pass on Node and fail only on Cloudflare, so a
local test suite and a dev server both stay green while the deploy target breaks.

**Recommended fix**

Thread `context` into the four call sites. `#getPage()` and `#getEmail()` already
receive `content` from a caller that holds `context`, so pass `context` alongside
it rather than capturing it:

```javascript
async #getPage(context, content, url, pathname, responseProps) {
    const page = await content.batchGetPageAssets(context, pathname);
```

`#loadGlobalTemplatePartials(content)` and `#loadBaseTemplate(content, templateId)`
need the same treatment. Add a unit test that drives `respondWithHypertext()`
against a snapshot double asserting its first argument is the context object —
the existing `content-snapshot.test.js` passes `{}` for context and so cannot
catch an arity mismatch in a caller.

---

## CAS-3: `hashString()` is called with an object when props are folded into the page cache key

**Status:** Open
**Severity:** Medium — a documented option throws when used
**Location:** `src/kixx/hyperview/hyperview-service.js:566`

```javascript
propsHash = await this.#contentAddressableStore.hashString(response.props);
```

`hashString()` accepts a string only and throws `TypeError` on anything else.
`response.props` is a plain object.

**How it is triggered**

Rendering a page with `includePropsInCacheKey` enabled and no custom
`options.propsHashFunction`. The `if (isFunction(options.propsHashFunction))`
branch is the only path that produces a usable hash; its `else` branch always
throws.

**Implications**

The props-in-cache-key feature is unusable without also supplying a custom hash
function, which makes the fallback branch dead code that fails loudly rather than
a working default. The failure is a `TypeError` from inside `addressing.js`,
which the HTTP router will treat as an unexpected programmer error and surface as
a 500 — not an obvious pointer back to a caching option.

**Recommended fix**

Hash the canonicalized props instead. `addressing.js` already exports `hashSet()`
for exactly this — a digest over a canonicalizable collection, domain-separated
from plain strings — but `ContentAddressableStore` does not re-export it. Either
expose it:

```javascript
// content-addressable-store.js
async hashSet(value) {
    return await hashSet(value);
}
```

and call `this.#contentAddressableStore.hashSet(response.props)`, or hash the
canonical form explicitly at the call site. Prefer the former: canonicalization
is the addressing module's invariant, not the render path's. Add a unit test that
renders with `includePropsInCacheKey` and no `propsHashFunction`.

---

## CAS-4: `ContentSnapshot#putGlobalTemplatePartials()` and `#putBaseTemplates()` accept a `pathname` they discard

**Status:** Open
**Severity:** Low — misleading API, no incorrect behavior today
**Location:** `src/kixx/content-addressable-store/content-snapshot.js` — `putGlobalTemplatePartials()`, `putBaseTemplates()`

Both methods take a `pathname`, assert it is valid, and then call a path builder
that takes no parameters at all:

```javascript
const fullPathname = getGlobalTemplatePartialsPath(pathname);  // getGlobalTemplatePartialsPath()
const fullPathname = getBaseTemplatesPath(pathname);           // getBaseTemplatesPath()
```

**How it is triggered**

Calling either method. The argument is silently ignored, and the corresponding
`stat*`/`get*` methods correctly take no pathname at all, so the write and read
sides of the same resource disagree about whether the resource is addressable.

**Implications**

No wrong bytes are written — these are genuinely site-wide singletons, and the
builders return the right constant path. The cost is in what the signature
promises: a caller reading `putBaseTemplates(context, pathname, bundle)`
reasonably concludes that base templates can be published per-path, and the
assertion on `pathname` reinforces that. The publishing API's catalog already
works around it, passing `_pathname` and dropping it (`publishing-api/mod.js:38, 41`).

**Recommended fix**

Drop the parameter from both methods:

```javascript
async putBaseTemplates(context, bundle) {
    assertArray(bundle, 'putBaseTemplates() requires an Array bundle');
    return await this.#putFile(context, 'text', getBaseTemplatesPath(), canonicalize(bundle));
}
```

This matches `statBaseTemplates()` / `getBaseTemplates()`, which already take no
pathname. There are no live callers of the write path yet (see CAS-6), so this
costs nothing to change now and is a breaking change later.

---

## CAS-5: `putPageIncludes()` asserts a plain object but reports "Array bundle"

**Status:** Open
**Severity:** Low — misleading diagnostic
**Location:** `src/kixx/content-addressable-store/content-snapshot.js` — `putPageIncludes()`

```javascript
assert(isPlainObject(bundle), 'putPageIncludes() requires an Array bundle');
```

**How it is triggered**

Publishing page includes as anything other than a plain object — an array, for
instance, which is exactly what the message tells the caller to supply.

**Implications**

The assertion is correct (`getPageIncludes` consumers treat the bundle as a map
keyed by include name; `HyperviewService` does `email.includes` / `page.includes`
lookups), so only the message is wrong. A caller who trusts the message and
passes an array trips the same assertion again with the same misleading text.

**Recommended fix**

Change the message to `'putPageIncludes() requires a plain object bundle'`,
matching `putEmailAssets()`, which asserts the same predicate and reports it
correctly.

---

## CAS-6: The write half of `ContentSnapshot` has no live caller

**Status:** Open — informational
**Severity:** Informational
**Location:** `src/app/presentation/request-handlers/publishing-api/mod.js`

The publishing API handlers resolve `context.getService('HyperviewContent')`, and
no plugin registers a service under that name — `HyperviewContent` appears
nowhere else in `src/`. Every `put*` method on `ContentSnapshot`,
`ContentAddressableStore#commitChanges()`, `ContentStoreInterface#saveIndex()`,
and `#assignBuild()` are therefore reachable only from unit tests.

**How it is triggered**

Any request to a publishing API route. `getService()` fails on the unregistered
name.

**Implications**

Not a defect so much as an unfinished seam, but it explains why CAS-1, CAS-4, and
CAS-5 have gone unnoticed: the entire write path is exercised only by tests that
call `ContentSnapshot` directly. It also means the signature changes recommended
in CAS-4 are free right now.

**Recommended fix**

None here. Track the `HyperviewContent` service as its own piece of work; when it
lands, resolve CAS-4 and CAS-5 first so the new service is written against the
corrected signatures. Note that the service's own contract differs from
`ContentSnapshot`'s — it takes options objects (`{ bundle, etag }`) and returns
`{ hash, count }` where `commitChanges()` returns `{ rootHash, nodeCount }` — so
it is a genuine adapting layer, not a pass-through.

---

## CAS-7: `RESERVED_PAGE_FILENAMES` is exported but never enforced

**Status:** Open
**Severity:** Low — a stated invariant with nothing checking it
**Location:** `src/kixx/content-addressable-store/content-layout.js:53`

The set names the three filenames a page directory reserves for its own bundles,
and nothing in `src/` reads it.

**How it is triggered**

Publishing a page template whose filename is `page.json`,
`__page-partials-bundle`, or `__page-includes-bundle` — for example
`putPageTemplate(context, '/blog/post/page.json', source)`. The write succeeds:
`getPageTemplatePath()` validates only that the pathname is canonical, and
`isValidTemplateFilepath()` only additionally rejects the root.

**Implications**

The template overwrites the page's metadata blob at commit time — or, more
likely, collides with it in the manifest and fails the publish with a duplicate
pathname error naming an internal path. If the collision is with a bundle the
page does not publish, there is no error at all: `batchGetPageAssets()`
identifies the template by elimination, so a blob named `page.json` in the page
directory is classified as metadata and the page renders with no template,
which `#getPage()` reports as a 404.

**Recommended fix**

Enforce it where template filepaths enter the system. Add a guard to
`isValidTemplateFilepath()`, which is already the publishing API's validation
hook (`publishing-api/mod.js:100`), so a reserved filename becomes a
`BadRequestError` at the boundary rather than a publish-time surprise:

```javascript
export function isValidTemplateFilepath(value) {
    if (!isValidPathname(value) || normalizePathname(value) === '/') {
        return false;
    }
    const filename = normalizePathname(value).split('/').pop();
    return !RESERVED_PAGE_FILENAMES.has(filename);
}
```

Add unit tests covering each reserved filename.
