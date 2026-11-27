# Content

Content is the part of a Kixx App that changes without a code deploy: pages,
templates, stylesheets, scripts, images, and other files. It compiles into a
Release, and a Release is what a build serves. Paths are relative to the app
directory.

Before content becomes a Release, the content compiler checks it. If
anything is wrong, there is no Release. Every tool that builds one uses the
same compiler, so content that passes the checks on your laptop passes them
everywhere.

The full reference is [the content compiler's
README](../../kixx/content-compiler/README.md), which is
`kixx/content-compiler/README.md` in your project.

## Where content lives

| Directory | Holds |
| --- | --- |
| `pages/` | Pages. A directory with a `page.json` is a page: `pages/about/page.json` is `/about`, and `pages/page.json` is `/`. |
| `templates/partials/` | Global partials, which any template can include. |
| `templates/base/` | Base templates, the outer HTML a page renders into. |
| `static-assets/` | Stylesheets, scripts, images, and fonts. Stylesheet `@import`s are bundled, and comments are removed from CSS and JavaScript. |
| `public/` | Files published exactly as they are, such as `robots.txt`. |

A `page.json` names the page's files, each relative to the `page.json`:

```json
{
    "template": "page.html",
    "partials": [ { "id": "teaser", "filename": "teaser.html" } ],
    "includes": { "body": { "filename": "body.md" } },
    "page": { "title": "About" }
}
```

Paths are lowercase. A file with an uppercase letter in its path, or in a
directory that starts with a dot, can't be published.

Installed plugins add content of their own: an admin plugin's pages, for
example. Plugin content compiles into the same Release as yours.

## Content in development

In the `development` environment a Node.js or Deno server renders pages and
assets straight from these directories. There is no publish step, and an
edit shows on the next request with no restart.

- **It shows what a publish would produce.** The server runs the same
  compiler and the same checks, so stylesheets are bundled and assets have
  their real content hashes.
- **A page that fails a check answers 500** with a page that lists its
  problems: the code, the message, and the file. The problems are logged
  too. Every other page keeps rendering.
- **Mount the two content handlers** in `virtual-hosts.js`:
  `StaticAssetRequestHandler` from `kixx/static-assets/` and
  `HyperviewPageHandler` from `kixx/hyperview/hyperview-page-handler.js`. A
  catch-all route with both renders any page, so a new page needs no route
  and no code deploy.

The switch is `CONTENT_STORE.workingTree`; see "Working-tree content in
development" in [Configuration](configuration.md).

## What the checks catch

The checks compile every template. They render nothing, so they need no
running app and no data.

- **A template that doesn't compile**: an unclosed block, a stray closing
  tag, or other broken syntax. Reported with the file and line.
- **A helper nothing declares**: `{{formatMoney price}}` when no manifest
  lists `formatMoney`. See [Declaring a template
  helper](#declaring-a-template-helper).
- **A partial that doesn't exist**: `{{> teaser }}` when neither the page nor
  `templates/partials/` supplies `teaser`.
- **A file a `page.json` names that doesn't exist**, and a `page.json` that
  isn't valid.
- **An empty template or asset.**
- **A broken stylesheet `@import`** or a script that doesn't parse.
- **Two things at one path.** See [Collisions](#collisions).
- **Content over a limit**: an object over 25 MiB, or more than 10,000
  objects in one Release.

One rule surprises people. A global partial or a base template can include
only global partials. If `templates/partials/card.html` includes `{{> teaser }}`
and `teaser` is a page's own partial, that is a missing partial, even when
every page supplies one. Move `teaser` to `templates/partials/`.

## What the checks don't catch

- **A mistyped helper with no arguments.** `{{formatDat}}` reads as a data
  lookup, so it compiles and renders nothing. A helper called with an
  argument, `{{formatDat page.date}}`, is caught.
- **A template that fails with real data.** That shows when the page is
  served.
- **A partial your route code picks at run time.**
- **A helper you declared but never registered.** It compiles, and fails
  when the page renders. The app warns about it when it starts.

## Reading a failed check

Each problem has a code, a message, and the file at fault. A problem in a
page's own files also names the page. Some codes add fields, such as the line.

```json
{
    "code": "unregistered-helper",
    "filepath": "pages/pricing/page.html",
    "message": "Template helper \"formatMoney\" is used in \"pages/pricing/page.html\" on line 12 but is not declared. Declare it under \"templateHelpers\" in the manifest of the app or plugin that registers it.",
    "helper": "formatMoney",
    "line": 12,
    "page": "/pricing"
}
```

Problems are also grouped by page. A page's group holds the problems in its
own files and the problems in every global partial it includes, so one broken
partial shows up under each page that uses it. Problems in base templates and
static assets belong to no page.

Fix every problem and compile again. A template reports its first syntax
error only, so fixing one can reveal the next.

Every code is listed in [the
reference](../../kixx/content-compiler/README.md#problem-codes).

## Declaring a template helper

The checks can't run your code, so they can't see which helpers it
registers. They read a list instead. Add every helper your app registers to
`app/app.json`:

```json
{
    "templateHelpers": [ "formatMoney" ]
}
```

```javascript
// app/app.js
export function initialize(context) {
    context.getService('HyperviewService').registerTemplateHelper('formatMoney', formatMoney);
}
```

A name holds letters, digits, and underscores, and doesn't start with a
digit. After changing `app/app.json`, regenerate the project's generated
files.

Kixx's own helpers (`each`, `if`, `unless`, `ifEqual`, `with`, `unescape`,
`plusOne`, `formatDate`, `markup`, `truncate`, `assetUrl`) are already
declared, and each plugin declares its own.

**The app warns at boot when the two lists differ.** It never refuses to
start. It logs one warning for helpers that are registered but not declared,
and one for helpers that are declared but not registered. Each warning lists
the names. Fix the first by adding the names to `app/app.json`. Fix the second
by registering the helper or removing the name.

## Collisions

Your content and every plugin's content share the same paths. Two owners
can't supply the same page, global partial, base template, or static asset.
When they do, the compile fails and names both files:

```json
{
    "code": "page-collision",
    "filepath": "plugins/visits/pages/visits/page.json",
    "message": "Page \"/visits\" is supplied by the app (pages/visits/page.json) and by plugin \"visits\" (plugins/visits/pages/visits/page.json)",
    "conflictingFile": "pages/visits/page.json",
    "owner": "visits",
    "conflictingOwner": "app",
    "pathname": "/visits"
}
```

The project's file always keeps the path, so `filepath` is the plugin's file
and `conflictingFile` is yours.

To resolve one, move or rename your file. A plugin's files aren't yours to
edit: they are replaced when the plugin is upgraded. If two plugins collide
with each other, one of them has to change, so report it to its author.

`static-assets/` and `public/` share paths too. `static-assets/robots.txt`
and `public/robots.txt` collide.

Sharing paths has an upside: your templates can include a plugin's global
partials, and a plugin's templates can include yours.

## Unmatched files

A file under a content directory that nothing uses is reported as
unmatched: a `README.md` in `templates/`, or a file in a page's directory
that its `page.json` doesn't name. Unmatched files are listed for your
information. They are left out of the Release, and they never fail a compile.
