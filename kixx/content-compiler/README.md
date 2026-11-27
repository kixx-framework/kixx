# Content Compiler

The content compiler turns a project's content into content objects and a Release manifest, and reports what is wrong with it. A command line tool, CI, the development server, and Studio all compile content with this one module, so they all agree on what a Release holds and on what refuses one.

It imports no platform module. It reads files through a small port, the content source, and uses only `crypto.subtle`, `TextEncoder`, and `TextDecoder`. The same code runs on Node.js, on Deno, and in a Cloudflare Worker.

It only compiles. It uploads nothing and publishes nothing.

Module paths here are from core's directory, which is `kixx/` in a project.

## Compiling a Project

A tool on Node.js or Deno loads three modules from the project's own `kixx/`:

| Module | What it gives |
|---|---|
| `tooling/mod.js` | `compileProjectContent()`, `listPluginContentRoots()`, `compileContent()`, `serializeContentObject()` |
| `adapters/node/tooling/lib/project-file-system.js` | `createProjectFileSystem(projectDirectory)`, which reads the manifests |
| `adapters/node/content-compiler/lib/file-system-content-source.js` | `createFileSystemContentSource(projectDirectory)`, which reads the content |

```javascript
import { compileProjectContent, serializeContentObject } from './kixx/tooling/mod.js';
import { createProjectFileSystem } from './kixx/adapters/node/tooling/lib/project-file-system.js';
import { createFileSystemContentSource } from './kixx/adapters/node/content-compiler/lib/file-system-content-source.js';

const { objects, release, report } = await compileProjectContent({
    fileSystem: createProjectFileSystem(projectDirectory),
    source: createFileSystemContentSource(projectDirectory),
});

if (release === null) {
    for (const problem of report.problems) {
        console.error(`${ problem.filepath }: ${ problem.message }`);
    }
} else {
    // release.manifest names every object by its id.
    for (const object of objects) {
        const body = serializeContentObject(object);
        // Store `body` under `object.hash`.
    }
}
```

`compileProjectContent({ fileSystem, source, coreDirectory })` reads core's manifest, every installed plugin's manifest, and `app/app.json`. From them it takes each plugin's content directories and every declared template helper name, and then it calls `compileContent()`. An invalid manifest rejects before any content is read. `coreDirectory` is where core lives, as a path from the project root. It defaults to `kixx`.

A running app has no manifests to read. Its generated registry already holds both lists, so it calls the compiler directly:

```javascript
import { compileContent } from './kixx/content-compiler/mod.js';
import { contentRoots, templateHelpers } from './node-registry.generated.js';

const compilation = await compileContent({
    source,
    pluginContentRoots: contentRoots,
    templateHelpers,
});
```

`compileContent()` takes:

| Option | Meaning |
|---|---|
| `source` | A content source, rooted at the project. Required. |
| `pluginContentRoots` | The plugins' content directories, in installation order: `[ { plugin, pagesDirectory?, templatesDirectory?, staticAssetsDirectory? } ]`, each a path from the project root. Defaults to `[]`. |
| `templateHelpers` | Every declared template helper name. Required. |

It throws an `AssertionError` for a missing or malformed option. It rejects with a `ValidationError` when a plugin content directory isn't a plain path inside the project (it is absolute, or holds an empty, `.`, or `..` segment). The error names the owner, the key, and the path, and nothing has been read by then. This is what refuses content declared by a core that lives outside the project.

`content-compiler/mod.js` also exports `createMemoryContentSource(files, { symlinks })`, a source that holds its tree in memory. Tests use it. It exports `createCompiledContent()` and `listContentDirectories()` too (see "Serving Compiled Content").

## The Content Source

The compiler reads a project through two methods. The contract is in `content-source-interface.js`.

```javascript
const source = {
    // Every file and symbolic link beneath a directory, at any depth.
    async listFiles(directory) {
        return { kind: 'directory', entries: [ { path: 'about/page.json', type: 'file' } ] };
    },

    // The file's exact bytes as an ArrayBuffer, or null when there is no such file.
    async readFile(path) {
        return bytes;
    },
};
```

To write a source:

- **Paths** are POSIX paths from the project root, with no leading `/` and no empty, `.`, or `..` segment. Assert that before you read anything, so no path can leave the root.
- **`listFiles()`** answers `kind: 'directory'` with the entries, `kind: 'symlink'` when the directory itself is a symbolic link, and `kind: 'missing'` when there is no such directory or the path is a file. An entry's `path` is relative to the listed directory. Its `type` is `file` or `symlink`.
- **Never follow a symbolic link.** List it, and list nothing beneath it.
- **A missing file or directory is a normal answer**, never a rejection. Any other failure rejects, and the compile rejects with it.
- **Order doesn't matter.** The compiler sorts every listing.
- **An empty directory can't be listed**, so the compiler never sees one.
- **`readFile()` returns a buffer the caller owns.**

Run a new source against the shared suite in `test/kixx/content-compiler/content-source-conformance.js`.

## What Is Compiled

The project's content is four directories at the project root:

| Directory | Holds |
|---|---|
| `pages/` | Pages. Each directory with a `page.json` is a page. |
| `templates/` | Global partials in `templates/partials/` and base templates in `templates/base/`. |
| `static-assets/` | Stylesheets, scripts, images, and other assets. CSS is bundled and JavaScript comments are stripped. |
| `public/` | Files published exactly as they are. |

A plugin adds up to three directories, named by the `content` key of its manifest: pages, templates, and static assets. A plugin has no `public/` directory.

The compiler builds seven types of object:

| Type | Pathname | Payload |
|---|---|---|
| `PageMetadata` | The page's pathname: `/` for `pages/page.json`, `/blog/first` for `pages/blog/first/page.json` | The parsed `page.json` |
| `PageTemplate` | The page's pathname, then the template's file name: `/blog/first/post.html` | The template's text |
| `PagePartials` | The page's pathname | `[ { id, source } ]`, sorted by id. `[]` when the page declares none. |
| `PageIncludes` | The page's pathname | `{ name: text }`. `{}` when the page declares none. |
| `GlobalTemplatePartials` | `/` | `[ { id, source } ]` for every file under a `templates/partials/` directory. The id is the path beneath it: `nav.html`, `admin/notice.html`. |
| `BaseTemplates` | `/` | The same, for `templates/base/` |
| `StaticAsset` | The path beneath `static-assets/` or `public/`, with no leading `/`: `stylesheets/site.css` | The bytes |

Rules worth knowing:

- **A page always gets metadata, partials, and includes objects.** It gets a template object only when its `page.json` names a `template`. A page with no template is legal.
- **A `page.json` references files** with `template`, `partials` (`[ { id, filename } ]`), and `includes` (`{ name: { filename } }`). A reference is relative to the `page.json` and can't leave the page's directory tree.
- **A template reference may include directories**, but the template is published under its file name alone, beside the page's other objects. A template may not be named `page.json` or use one of the names reserved for a page's bundles.
- **Paths are lowercase.** A file whose path holds an uppercase letter, a segment that starts with a dot, or a character outside the safe set can't be published.
- **Each Release has one global partials bundle and one base templates bundle.** Templates go in by owner, the project first, and each owner's in the order of a directory walk. A missing or empty `templates/partials/` directory yields no bundle.
- **`static-assets/` and `public/` share one namespace.** The same path in both is a collision.
- **Text is decoded as UTF-8.** Templates and `page.json` files keep a leading byte order mark. Stylesheets and scripts under `static-assets/` lose it. Files under `public/` are never decoded.

## The Result

`compileContent()` resolves plain data:

```javascript
{
    objects,   // Every object that could be built, sorted by type, then pathname
    release,   // { manifest }, or null when there is any problem
    report,    // { problems, pages, unmatchedFiles }
    graph,     // { pages, globalPartials, baseTemplates }
}
```

**`release` is `null` whenever `report.problems` is not empty.** A caller that publishes checks `release` and can't publish a refused tree by accident. `objects`, `report`, and `graph` are returned either way, so a development server can serve the pages that compiled and show the report for the rest.

**An object** is `{ type, pathname, payload, hash, size, sourceFiles }`. `hash` is the object's id. `sourceFiles` are paths from the project root. `payload` is a string, an `ArrayBuffer`, or a structure. `serializeContentObject(object)` returns what a content store receives: the payload itself when it is text or bytes, and its canonical JSON when it is a structure. The object's `hash` and `size` are those of that value. Objects carry no media type.

**`release.manifest`** names each object by `{ objectId, size }`:

```javascript
{
    staticAssets: { '/stylesheets/site.css': { objectId, size } },
    pages: {
        '/blog/first': {
            metadata: { objectId, size },
            partials: { objectId, size },
            includes: { objectId, size },
            templates: { 'post.html': { objectId, size } },
        },
    },
    globalTemplatePartials: { objectId, size },
    baseTemplates: { objectId, size },
}
```

Before it returns a Release, the compiler checks the manifest and every structured object with the validators a content store applies. So a compile with no problems is a Release a store accepts.

**`report.problems`** lists every problem once, in a fixed order for one tree. A problem is `{ code, message, filepath }` plus the fields of its code (see "Problem Codes"). `filepath` is a path from the project root. A problem in a page's own files also carries `page`, the page's pathname.

**`report.pages`** groups problems by page: `[ { pathname, problems } ]`, sorted by pathname, with only the pages that have a problem. Each page lists the problems in its own files, then the problems of every global partial it reaches. The problems are the same objects as in `report.problems`. Problems in base templates, in global partials no page reaches, and in static assets, and collisions and limits, are in `report.problems` only.

**`report.unmatchedFiles`** lists files under a content directory that no convention matched, as sorted paths from the project root: a `README.md` in `templates/`, or a file in a page directory that no `page.json` references. It is information. An unmatched file never refuses a Release.

## Serving Compiled Content

A server can answer a request straight from a compilation, with no publish. The development server does this with the working tree, so development shows what a publish would produce.

`createCompiledContent(compilation)` turns what `compileContent()` resolved into supplied content, which a `ContentAddressableStore` serves in place of the build's Release:

```javascript
import { compileContent, createCompiledContent } from './kixx/content-compiler/mod.js';

const compilation = await compileContent({ source, pluginContentRoots, templateHelpers });
const content = await createCompiledContent(compilation);

// For one request:
contentAddressableStore.supplyContent(context, content);

// Or for every request:
contentAddressableStore.setContentSupplier(async (context) => content);
```

It is built from `objects`, never from `release`, so it works for a tree with problems. The objects are indexed by the functions that index a published Release, and every object keeps the compiler's hash. It resolves:

| Field | Meaning |
|---|---|
| `index`, `objects` | What the store reads: the index of every object, and a reader that returns an object's bytes by hash as text, an `ArrayBuffer`, or a new stream. |
| `getPageProblems(pathname)` | The problems that block a page: those `report.pages` lists for its pathname. Empty when none. |
| `getBaseTemplateProblems(id)` | The problems that block a base template: those in its own file and in the file of each global partial it reaches. Empty when none. |
| `report` | The compilation's report, unchanged. |
| `problems` | Every problem to log: `report.problems`, plus any added for a tree that can't be indexed. |

The problems are the report's own objects. A problem that belongs to no page and no base template blocks nothing: a global partial nothing reaches, a static asset, a collision, or a limit. A static asset the compiler couldn't build is absent.

**A tree that can't be indexed serves nothing.** When the objects can't form an index, for example a file `static-assets/a` beside `public/a/b`, the result has an empty index. `getPageProblems()` then returns every problem for every pathname, with an `invalid-release` problem for each thing the index refused unless the compiler already reported it.

**How a failing page is reported.** Hyperview asks both lookups before it reads a page. When either answers a problem, `HyperviewService#renderPage()` throws an expected `OperationalError` with code `ContentProblems` and HTTP status 500, in every environment. The problems are on `error.problems`, the page's first, and the page's pathname is on `error.pathname`. The base template is asked about only for a full-page render: a partial render, a render without the base template, and the `.json` response read none. Every other page keeps rendering.

- **In development**, `HyperviewPageHandler` answers 500 with an HTML page that lists each problem's code, message, and file, with `Cache-Control: no-store`. The page uses nothing from the project, and every value is escaped.
- **In every other environment** the handler rethrows the error, so the caller decides what a visitor or an editor sees. With no error handler, the router answers its standard response for an expected 500.

A render from supplied content never reads or writes the rendered-page cache, whatever `HYPERVIEW.usePageCache` or the call says. Compiled templates are still cached by hash.

`listContentDirectories(pluginContentRoots)` returns every directory a compile reads, as paths from the project root: `pages`, `templates`, `static-assets`, and `public`, then each plugin's directories. A caller that checks the content for changes checks exactly these.

Both functions are platform-neutral, like the rest of the compiler.

## Stylesheets

Every `.css` file under a `static-assets/` directory is published as an entry point. Local, unconditioned `@import` rules are inlined recursively in cascade order, and each imported file is also published as its own asset. Changing an imported file changes the entry point's hash. Comments are removed. Stylesheets under `public/` are published as they are.

- **Targets.** An import may be root-relative (`/stylesheets/lib/reset.css`) or relative to the importing file. Its target must stay inside the same `static-assets/` directory, use a lowercase pathname, end in `.css`, and have no query string or fragment.
- **Kept imports.** An external import (a URL scheme, or `//`) is kept as it is. An import with a media, `supports()`, or `layer` condition is kept too. A kept local import is rewritten root-relative, and its target must exist. Every kept import must come before bundled content.
- **Cycles** are a problem, reported with the import chain.
- **`@charset`.** The entry point keeps a leading UTF-8 `@charset`. Inlined files lose theirs. Any other encoding is a problem.
- **`url()`.** A relative `url()` is rewritten root-relative, keeping its query string and fragment. A relative bare string in `image-set()` must use `url()`.

A stylesheet problem is reported once, however many entry points reach the file.

## JavaScript

Every `.js` file under a `static-assets/` directory is parsed as an ES module with the vendored acorn (`vendor/acorn/`), and its comments are removed. A hashbang line is kept. Text that only looks like a comment, inside a string, template literal, or regular expression, is kept.

A file that doesn't parse is an `invalid-javascript` problem, with its line and column. Modules are not bundled: each file is published on its own. Scripts under `public/` are published as they are.

## Plugin Content

A plugin's pages, global partials, base templates, and static assets merge into the same namespaces as the project's. Nothing separates them in a Release. So a plugin's template may include a global partial the project supplies, and a project's template may include a plugin's.

Two owners can't supply the same thing. The project comes first, then the plugins in installation order. The first owner keeps the path, and each later one is a collision problem that names both:

| Code | Two owners supply the same |
|---|---|
| `page-collision` | Page pathname |
| `partial-collision` | Global partial id |
| `base-template-collision` | Base template id |
| `static-asset-collision` | Static asset path. Also reported for the project's own `static-assets/` and `public/`. |

In a problem, the owner is `app` for the project and the plugin's name otherwise. Core's own content, if it ever has any, is owned by `kixx`.

A stylesheet's `@import` resolves only inside its own owner's `static-assets/` directory.

## The Checks

The compiler compiles every template and resolves every partial reference. It renders nothing, so the checks need no request, no data, and no application code.

**Every template must compile:** each page's template and page partials, each global partial, each base template, and the `page.title.template` and `page.description.template` strings in a `page.json`. A template is compiled against the declared helper names. A helper called with arguments that no manifest declares is an `unregistered-helper`. Any other failure is a `template-syntax-error`. The engine stops at a template's first error, so one template reports one compile problem at a time.

**Every referenced partial must exist.** A reference is `{{> name }}`, and the name is literal. It resolves in one of two scopes:

- In a page's template or one of its page partials: against that page's partials first, then the global partials. That is how a page renders. A page partial with the same id as a global partial shadows it for that page.
- In a global partial or a base template: against the global partials only. A reference there to a partial that only pages supply is `missing-partial`, even when every page supplies it. So a problem never depends on which pages exist.

A partial may include itself, directly or through others. That is not a problem.

**A template can't be empty.** A zero-length page partial, global partial, or base template is `empty-template`. A zero-length page template is `empty-page-template`.

**A page's `template` must name a file that exists.** Otherwise it is `missing-referenced-file`.

### What the Checks Can't See

- **A helper used with no arguments.** `{{formatDat}}` reads as a data lookup, so a mistyped helper name with no arguments compiles, and renders nothing.
- **A block with an undeclared name and no arguments.** `{{#nope}}…{{/nope}}` reads as a plain section, and compiles.
- **Whether a declared helper is registered.** The checks read the names the manifests declare. A helper that is declared but never registered compiles here and fails when the page renders. Hyperview logs a warning at boot when the declared and registered names differ.
- **A partial chosen at run time.** Code that passes a partial id when it renders a page isn't checked.
- **Data.** A template that compiles can still fail with real data. That shows only when the page is served.
- **Partials inside the title and description templates.** They render with no partials, so their references aren't checked.

## The Dependency Graph

`graph` says which files each page, global partial, and base template is made from. It is plain data and survives `JSON.stringify`. It is built even when there are problems, from whatever could be read. It has three lists:

| List | Each record |
|---|---|
| `pages`, sorted by pathname | `{ pathname, owner, metadataFiles, templateFile, partialFiles, includeFiles, globalPartials }` |
| `globalPartials`, sorted by id | `{ id, owner, file, partials }` |
| `baseTemplates`, sorted by id | `{ id, owner, file, globalPartials }` |

- A page's `metadataFiles` holds its own `page.json`, then each ancestor page's that exists, nearest first. A page inherits its ancestors' metadata when it renders.
- A page's `globalPartials` holds the id of every global partial its template and page partials reach, through other global partials too.
- A global partial's `partials` holds the global partials it references directly.
- A base template's `globalPartials` holds every global partial it reaches.

The compiler has no function that queries the graph. To find the pages a changed file can affect, read the lists:

1. The file is in a page's `metadataFiles`, or is its `templateFile`, or is in its `partialFiles` or `includeFiles`: that page.
2. The file is a global partial's `file`: every page whose `globalPartials` holds that partial's id.

Two kinds of file have no link to pages:

- **Base templates.** The code that renders a page chooses its base template, so the compiler can't know which pages use one. Treat a change to a base template, or to a global partial a base template reaches, as affecting every page.
- **Static assets.** Which assets a page uses can't be known without rendering it. A bundled stylesheet's `sourceFiles` lists the files it was built from.

The graph holds file paths. They are for developers and tools.

## Limits

A Release over one of the content store's limits is refused before anything is uploaded:

| Limit | Value | Problem |
|---|---|---|
| Object size | 25 MiB (`MAX_OBJECT_BYTES`) | `object-too-large`, once per object |
| Objects in a Release | 10,000 (`MAX_MANIFEST_ENTRIES`) | `too-many-objects` |

Both constants are defined in `content-addressable-store/content-limits.js`. The Publishing API enforces the same two.

## Problem Codes

Every problem has `code`, `message`, and `filepath`. A problem in a page's own files also has `page`. The table lists what each code adds.

| Code | Reported when | Other fields |
|---|---|---|
| `symlink-source-root` | A content directory is itself a symbolic link | |
| `symlink-source-file` | A symbolic link lies beneath a content directory | |
| `invalid-pathname` | A file's path can't be published (see "What Is Compiled"), a `page.json` reference is absolute or malformed, or a page template can't be published under its file name | `referencedFile`, for a reference |
| `malformed-json` | A `page.json` isn't valid JSON | |
| `invalid-manifest` | A `page.json` isn't an object, or its `template`, `partials`, or `includes` is malformed | |
| `missing-referenced-file` | A `page.json` references a file that doesn't exist, or a directory | `referencedFile` |
| `symlink-referenced-file` | A `page.json` reference is, or lies beneath, a symbolic link | `referencedFile`, `symlink` |
| `reserved-template-filename` | A page template uses a file name the page directory reserves | `referencedFile` |
| `empty-page-template` | A page template is zero-length | `referencedFile` |
| `empty-template` | A page partial, global partial, or base template is zero-length | |
| `template-syntax-error` | A template doesn't compile | `line`, when the engine reports one; `field`, for a title or description template |
| `unregistered-helper` | A template calls a helper, with arguments, that no manifest declares | `helper`, `line`; `field`, for a title or description template |
| `missing-partial` | A template references a partial that doesn't exist in its scope | `partial`, `line` |
| `page-collision` | Two owners supply the same page | `pathname`, `conflictingFile`, `owner`, `conflictingOwner` |
| `partial-collision` | Two owners supply the same global partial | `id`, `conflictingFile`, `owner`, `conflictingOwner` |
| `base-template-collision` | Two owners supply the same base template | `id`, `conflictingFile`, `owner`, `conflictingOwner` |
| `static-asset-collision` | Two files would be published at the same static asset path | `pathname`, `conflictingFile`, `owner`, `conflictingOwner` |
| `empty-static-asset` | A file under `static-assets/` or `public/` is zero-length, or a stylesheet bundles to nothing | |
| `invalid-javascript` | A script under `static-assets/` doesn't parse | `line`, `column` |
| `css-import-invalid` | An `@import` is malformed, or its target isn't a pathname it may name | `line`, `column` |
| `css-import-missing` | An `@import` names a stylesheet that doesn't exist | `line`, `column` |
| `css-import-misplaced` | An `@import` follows other rules, or a kept import follows bundled content | `line`, `column`; `entry` and `importChain`, when found while bundling |
| `css-import-cycle` | Stylesheets import each other in a loop | `line`, `column`, `entry`, `importChain` |
| `css-charset-unsupported` | A stylesheet declares an encoding other than UTF-8 | `line`, `column` |
| `css-url-invalid` | A relative bare string is used in `image-set()` | `line`, `column` |
| `object-too-large` | An object is over the size limit | `type`, `pathname`, `size`, `limit` |
| `too-many-objects` | The content compiles to more objects than a Release may hold | `count`, `limit` |
| `invalid-release` | The compiled manifest or a structured object fails the content store's own validation | `source` |

For `template-syntax-error` and `unregistered-helper` in a title or description template, `filepath` is the `page.json` and `field` is `page.title.template` or `page.description.template`. For `too-many-objects`, and for an `invalid-release` in the manifest itself, `filepath` is an empty string: no one file is at fault.

`invalid-release` is a backstop. It runs only on a tree with no other problem, so seeing it means the compiler let through something a content store refuses.

## Versions

The compiler builds objects for content contract version 2, with addressing format 4. An object's id depends only on its content, so the same content compiles to the same ids on every runtime and in every version of the compiler. `test/kixx/content-compiler/content-compiler-goldens.js` pins the ids for one fixed project.

## Files

| File | What it holds |
|---|---|
| `mod.js` | The entry: `compileContent`, `serializeContentObject`, `createCompiledContent`, `listContentDirectories`, `createMemoryContentSource` |
| `compile-content.js` | The entry function, the limits, and the Release's self-validation |
| `scan-content-sources.js` | Reads every content directory and builds the objects |
| `check-templates.js` | The template checks and the dependency graph |
| `create-release-manifest.js` | Builds the manifest from the objects |
| `compiled-content.js` | Turns a compilation into content a store can serve |
| `bundle-stylesheet.js`, `parse-stylesheet.js` | Stylesheet bundling |
| `strip-asset-comments.js` | JavaScript comment stripping |
| `content-source-interface.js` | The content source contract |
| `memory-content-source.js` | The in-memory source |
| `posix-path.js` | `basename`, `dirname`, and `extname` for POSIX paths |
