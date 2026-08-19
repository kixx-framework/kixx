# Hyperview and Content Store Consistency Issues

Date: 2026-08-19

## Scope

This report covers two deferred issues in the integration between
`src/kixx/hyperview/hyperview-service.js` and
`src/plugins/cloudflare-content-addressable-store/lib/content-addressable-store.js`:

1. An indexed resource whose blob is missing can be mistaken for a resource
   that was never published.
2. A build reassignment during rendering can combine resources from different
   build versions, and Hyperview's mutable partial caches can extend that race
   beyond the storage reads themselves.

The report does not cover the other Hyperview integration issues identified in
the preceding review.

## Issue 1: An Indexed Resource With a Missing Blob Is Treated as Absent

### Relevant behavior

`ContentAddressableStore.#getPath()` performs two separate lookups:

1. It reads the pathname's index entry with `statPath()`.
2. It reads the content bytes named by that entry's hash with `getBlob()`.

If the index entry does not exist, returning `null` correctly means that the
resource is not part of the current build. However, if the index entry exists
and `getBlob()` returns no bytes, `#getPath()` also returns `null`.

This collapses two materially different states into the same result:

| State | Meaning | Current result |
| --- | --- | --- |
| No index entry | The resource was not published in this build | `null` |
| Index entry exists, blob is unavailable | The committed build cannot supply content it claims to contain | `null` |

The bulk page-loading path does not make this distinction. `getPage()` asserts
that every blob named by its collected index entries was returned. The
single-resource path used for global partials, base templates, and page
templates is therefore less strict than the page-loading path.

### How the issue is triggered

The immediate trigger is:

1. The current build index contains an entry for a global-partials bundle,
   base-templates bundle, or page template.
2. The corresponding blob lookup returns `null`.

That state can arise from several conditions:

- A committed index references a blob that was never successfully persisted.
- A blob was removed or became unavailable after the index was committed.
- The index and KV namespace bindings point at incompatible data sets.
- Cloudflare KV replication has not yet made a newly uploaded blob visible in
  the location serving the request, even though the build pointer is visible.
- A negative or stale KV cache entry temporarily hides an otherwise valid blob.

The global-partials path is the most dangerous concrete sequence:

1. `HyperviewService.loadGlobalPartials()` sees either a changed bundle etag or
   has template caching disabled.
2. `getTemplatePartials()` finds the index entry.
3. The underlying blob lookup returns `null`.
4. `ContentAddressableStore.#getPath()` returns `null`.
5. Hyperview interprets `null` as "this application defines no global
   partials," clears the live global-partials map, and continues.

For base templates, the same ambiguity eventually tends to produce a generic
"base template does not exist" assertion. For page templates,
`HyperviewService.getPageTemplate()` adds a more specific assertion. Neither
diagnostic identifies the actual condition: the resource is indexed but its
blob cannot be read.

### Implications when triggered

#### Incomplete or incorrect rendered output

Missing global partials may not cause rendering to fail. The templating engine
intentionally renders a missing partial as an empty string. A page can therefore
return structurally incomplete HTML while still passing Hyperview's non-empty
output assertion.

Because Hyperview clears its shared live partial map, the failure can affect
other templates in the same process or isolate, not only the request that
encountered the missing blob.

#### Incorrect error classification and weak diagnostics

An unpublished optional bundle and an indexed-but-unavailable blob require
different operational responses. Treating both as absence hides storage
corruption, binding mistakes, or propagation failures and makes the resulting
template error appear to be an authoring problem.

#### Bad output may enter the rendered-page cache

If the resulting hypertext remains non-empty and rendered-page caching is
enabled, the incomplete output can be written to the page cache and continue to
be served after the underlying blob becomes available.

#### Availability tradeoff on eventually consistent storage

An indexed missing blob is logically an integrity failure, but Cloudflare KV is
eventually consistent. Immediately crashing on the first missing read may turn
a short propagation delay into a fatal application error. The implementation
needs to decide explicitly whether publication guarantees blob visibility
before index assignment. The current `null` behavior avoids that decision by
silently producing the wrong semantic result.

### Recommended fix

Change `ContentAddressableStore.#getPath()` so `null` is returned only when the
index entry is absent. Once an index entry has been found, a missing blob must
be surfaced as a distinct failure carrying at least the logical pathname and
content hash.

The exact error policy should follow the publication guarantee:

- If assigning a build promises that every referenced blob is already
  readable, throw an `AssertionError`. The index/blob disagreement is then a
  violated internal invariant, consistent with `getPage()`'s current behavior.
- If temporary KV propagation gaps are expected, perform a small bounded retry
  appropriate for the platform, then throw an `OperationalError` with the
  original failure or missing-read condition as its cause. Do not translate the
  condition to `null` after retries are exhausted.

The preferred long-term publication rule is: do not make a build pointer
visible until every blob in the closure is durably readable under the same
consistency assumptions used by renderers. A read-side retry can reduce
transient failures, but it should not substitute for that ordering guarantee.

### Recommended mitigation until fixed

- Disable rendered-page caching where a missing partial could otherwise be
  retained after storage recovers.
- Monitor for indexed blob misses separately from ordinary not-found results.
- Avoid deleting immutable content-addressed blobs while any build closure can
  still reference them.
- Keep the index store and blob KV bindings versioned and deployed together so
  they cannot accidentally address different data sets.

### Recommended validation

Add content-store unit tests for each single-resource getter:

1. No index entry returns `null`.
2. An index entry plus readable blob returns a `ContentObject`.
3. An index entry plus missing blob throws the selected integrity or operational
   error and includes the pathname and hash in diagnostic properties.

Add a Hyperview integration test showing that an indexed-but-missing global
partials bundle cannot clear the live partial map and produce cacheable output.

## Issue 2: Rendering Can Combine Different Build Versions

### Relevant behavior

The Cloudflare content store resolves an index from
`context.runtime.build.id` and caches that index by build ID. Publishing can
reassign the same build ID to a different root closure. `assignBuild()` then
invalidates the in-memory index and the local edge-cache entry.

Hyperview does not obtain an immutable build snapshot for a render. Instead,
one response is assembled through several independently timed calls, including:

- `getPage()`
- `statTemplatePartials()` and `getTemplatePartials()`
- `statBaseTemplates()` and `getBaseTemplates()`
- `statPageTemplate()` and `getPageTemplate()`

`ContentAddressableStore.getPage()` itself performs multiple `statPath()` calls,
a `listStats()` call, and later blob reads. Each index operation resolves the
current cached index rather than accepting an index snapshot pinned at the
start of the page read.

Hyperview also refreshes global and page partials by clearing and repopulating
shared `Map` instances. Compiled templates retain live lookup delegates over
those maps, so a template returned to one request can observe a refresh
performed by another request before the first request invokes the template.

### How the issue is triggered

The storage-level race requires a build ID to be repointed while a render using
that same ID is in flight. A representative sequence is:

1. Render A resolves page metadata or a leaf-page stat from build root V1.
2. A publishing request assigns the same build ID to root V2.
3. `assignBuild()` invalidates the serving isolate's cached index.
4. Render A's next storage call resolves the V2 index.
5. Render A completes with some resources from V1 and others from V2.

The mix can happen inside `getPage()` itself. For example, the leaf metadata
existence check may use V1 while parent stats or the leaf directory listing use
V2. It can also happen later between page loading and template or partial
loading.

The in-memory partial race can then occur even after storage methods return:

1. Render A loads or reuses a page template compiled against live partial maps.
2. Render B observes a new partial etag and clears/repopulates one of those maps.
3. Render A invokes its already-returned template.
4. The template uses Render B's partial definitions rather than the definitions
   associated with Render A's page and cache identity.

This is most likely during an active publish or rollback of the current build.
Ordinary concurrent renders against an unchanged immutable index do not trigger
the version mismatch.

### Implications when triggered

#### Internally inconsistent pages

A response can combine old metadata with a new template, a new page with old
partials, or other combinations that never existed in any committed closure.
This defeats the principal benefit of a content-addressed build: a response is
no longer derived from one immutable content graph.

Symptoms may include missing context values, incompatible partial arguments,
broken layouts, incorrect navigation, or template evaluation failures.

#### Mixed output can be cached beyond the race window

Rendered-page cache identity is calculated through separate page and template
stats. A partial map can change after that identity is calculated but before
the template is invoked. The mixed output may therefore be stored under an etag
identity that describes older resources.

Even where the calculated etag happens to cover the exact mixed set of index
entries read, that set does not represent a real committed build. The KV page
cache can preserve this impossible state for its full expiration period.

#### Publication and rollback are not request-atomic

Different requests seeing V1 or V2 during a rollout is usually acceptable.
One request seeing both is not. The current contract provides eventual rollout
across isolates but does not guarantee snapshot consistency within a request.

#### Hard-to-reproduce failures

The race depends on timing among rendering, index invalidation, and partial-map
refreshes. Failures will cluster around deploys and rollbacks and may disappear
on retry, making them difficult to diagnose without logging the root closure or
snapshot identifier used by each read.

### Recommended fix

#### 1. Pin an immutable content snapshot for the whole render

Resolve the build ID to an immutable root/index once at the start of the
Hyperview operation. Every page, stat, template, partial, and include read for
that response must use the same snapshot.

This can be expressed as an opaque store-owned snapshot handle, for example:

```text
snapshot = contentStore.openSnapshot(context)
page = contentStore.getPage(context, snapshot, pathname)
partials = contentStore.getTemplatePartials(context, snapshot)
template = contentStore.getPageTemplate(context, snapshot, filepath)
```

The exact API can differ, but the invariant must be explicit: a snapshot always
names one immutable root closure, and build reassignment cannot alter it.
Passing only a mutable build ID is insufficient.

`getPage()` should also use one resolved index object for all of its internal
stats and listings rather than resolving the build pointer repeatedly.

#### 2. Make compiled partial dependencies version-immutable

Do not clear and repopulate a partial map that can still be observed by an
in-flight renderer. Cache immutable compiled partial maps by content etag (or by
snapshot/root plus etag), and let each compiled page/base template close over
the exact maps used when it was compiled.

The page-template cache key should include all compilation dependencies:

```text
page-template etag
+ page-partials etag
+ global-partials etag
```

When any dependency changes, compile or retrieve another version. Old maps and
templates may remain in a bounded LRU until in-flight requests release their
references; they must not be mutated into a new version.

This gives up the optimization where a cached template observes partial
updates without recompilation, but it restores deterministic rendering. Cache
reuse can still be high because content-addressed etags allow identical bundles
to share compiled functions safely.

#### 3. Bind rendered-page cache writes to the pinned snapshot

Construct the rendered-page cache identity from the same snapshot and resource
versions used to render the output. Before writing, no separate "latest"
`stat*()` call should be allowed to replace one of those versions.

Including the immutable root hash in the identity is a simple strong boundary,
even if finer-grained dependency etags remain for reuse across compatible
builds.

### Recommended mitigation until fixed

- Publish new content under a new immutable build ID rather than repointing the
  build ID currently serving requests. Switch traffic to the new build only at
  the outer deployment boundary.
- Disable rendered-page caching during publish/rollback windows so a mixed
  response cannot outlive the request that produced it.
- Avoid performing publishing mutations through the same isolate that is
  actively rendering the reassigned build ID. This narrows the immediate
  in-memory invalidation race but is not a distributed correctness guarantee.
- Log the build ID, resolved root hash, and resource etags used by a render so a
  mixed-snapshot response can be identified after the fact.

These mitigations reduce exposure but do not eliminate the mutable partial-map
race. Immutable versioned cache entries are still required for full correctness.

### Recommended validation

Add deterministic concurrency tests using deferred promises rather than timing:

1. Start `getPage()` against index V1, pause after its first index-dependent
   read, assign V2, resume, and verify the result contains resources only from
   V1.
2. Start a complete Hyperview render against V1, assign V2 between page and
   template loading, and verify the response and cache key remain wholly V1.
3. Return a V1 compiled template, refresh global and page partial caches to V2
   before invoking it, and verify the V1 render still uses V1 partials.
4. Run concurrent V1 and V2 renders and verify each can complete correctly
   without mutating the other's compiled dependency maps.
5. Verify a page-cache entry is written only under the immutable root and etags
   that produced its body.

## Recommended implementation order

1. Introduce and test a request-stable content snapshot or immutable index
   handle.
2. Make `getPage()` and all single-resource reads consume that snapshot.
3. Replace mutable live partial maps with immutable etag-versioned entries.
4. Bind rendered-page cache identity and writes to the pinned snapshot.
5. Distinguish absent index entries from indexed missing blobs, with the chosen
   retry and error-classification policy documented in the store contract.

The snapshot and immutable-cache changes should be designed together. Fixing
only the storage reads would still allow another request to mutate a partial map
after a snapshot-consistent template load.
