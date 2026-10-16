# Kixx Hyperview Templating

The Hyperview plugin renders server-side HTML with the Kixx templating engine: Mustache-style `{{ ... }}` tags for interpolation, sections, helpers, partials, comments, and delimiter changes.

Kixx follows core Mustache where it fits, with these differences:

- **No optional extensions.** `~lambdas`, `~dynamic-names`, and `~inheritance` are not supported. Function values are treated as values, not called.
- **Plain object sections iterate.** `{{#obj}}` renders once per own enumerable property value. Core Mustache pushes the object as one context; use `#with` for that.

## Hyperview Context

Page data is merged from `pages/**/page.json`, optional page-local `includes` files, and runtime props set by request handlers with `response.updateProps()`. A page's template and page-local partials sit beside its leaf `page.json`; shared templates live under `templates/`. `HyperviewService#renderPage()` assembles the data and renders the page template, then the base template named by the route's `baseTemplateId` option.

```javascript
export default function albumPageRequestHandler(_context, _request, response) {
    return response.updateProps({
        viewer: { isLoggedIn: true, displayName: 'Kris' },
    });
}
```

```html
<article>
    <h1>{{ page.title }}</h1>
    {{#if viewer.isLoggedIn}}
        <p>Welcome back, {{ viewer.displayName }}.</p>
    {{else}}
        <p>Welcome.</p>
    {{/if}}
    <ol>
    {{#each albums as |album index| }}
        <li>{{ plusOne index }}. {{ album.title }} ({{ formatDate album.releasedAt format="DATE_MED" }})</li>
    {{/each}}
    </ol>
</article>
```

When `HYPERVIEW.allowJsonResponse` is on (shipped on for `development` and `local`), add `.json` to a page URL to see its assembled context, e.g. `http://localhost:2026/admin/style-guide/aesthetic.json`.

## Expressions

```html
<h1>{{ album }}</h1>                       {{!-- HTML-escaped --}}
<p>{{ song.writer.lastName }}</p>          {{!-- nested property --}}
<img src="{{ images[0].src }}">            {{!-- array index --}}
<dd>{{ headers[Content-Type] }}</dd>       {{!-- bracket notation --}}
<section>{{{ trustedHtml }}}</section>     {{!-- raw; same as {{& trustedHtml }} --}}
{{!-- Comments render nothing, and tags inside them are ignored. --}}
```

- **`null` and `undefined` render as `""`.** Other non-strings go through `String()`, so an object renders `[object Object]`.
- **A missing path segment** resolves the whole expression to `undefined`.
- **Bracket contents are literal path segments**, not JavaScript. Use `[Content-Type]`, not `["Content-Type"]`; quotes become part of the key. Use brackets for names with dashes, spaces, or other characters dot notation can't express.
- **Array indexes are for fixed slots.** Use `#each` for lists.
- **Raw output is for trusted or already-sanitized HTML only.**

## Sections

A data section opens with `{{#name}}` and closes with `{{/name}}`. It renders from the shape of the data, without a helper.

```html
<ol>
{{#tracks}}
    <li><a href="{{ albumUrl }}">{{ title }}</a></li>   {{!-- albumUrl comes from the parent --}}
{{/tracks}}
</ol>
<ul>{{#genres}}<li>{{ . }}</li>{{/genres}}</ul>       {{!-- . is the current scalar item --}}

{{#articles}}<article>{{ title }}</article>{{/articles}}
{{^articles}}<p>No articles available.</p>{{/articles}}
```

- **Arrays** render once per item, with the item pushed onto the context stack. Parent values stay reachable.
- **Maps, Sets, and plain objects** render once per value (objects in `Object.keys()` order). Keys are not exposed; use `#each` for keys.
- **Scalars** render once with the scalar pushed. `0` and `""` render.
- **Inverted sections** (`{{^name}}`) render when the value is absent, false, or empty.
- **No `{{else}}` in data sections.** Pair `{{#name}}` with `{{^name}}`, or use `#if`, `#unless`, or `#each`.

## Falsiness and Empty Values

Sections and helpers disagree on `0`, `""`, and `{}`:

| Value | `{{#x}}` section | `{{#if x}}` | `{{#unless x}}` | `{{#with x}}` |
| --- | --- | --- | --- | --- |
| `false`, `null`, `undefined` | else | else | main | else |
| `0`, `""` | main | else | main | else |
| non-empty string, non-zero number | main | main | else | main |
| `[]`, empty Map or Set | else | else | main | else |
| non-empty array, Map, or Set | main | main | else | main |
| `{}` | else | main | main | main |
| non-empty object | main | main | else | main |

"main" means the helper body renders. Note `{}`: `#if` and `#with` render their body, while sections and `#unless` treat it as empty.

## Name Resolution

Names resolve against a context stack. For a dotted path, Kixx walks up the stack to the first frame that has the first segment, then resolves the rest on that value only. If the rest breaks, the result is `undefined`.

```html
{{#with post}}
    <h1>{{ title }}</h1>
    <p>By {{ author.name }} on {{ site.name }}</p>   {{!-- site resolves from the root frame --}}
{{/with}}
```

## Delimiters

`{{=<% %>=}}` changes the delimiters from that point on in the same source. Partials are parsed separately, so a parent's change does not reach them.

## Whitespace

Kixx follows the Mustache standalone rule: a line holding only a section, inverted section, comment, partial, or set-delimiter tag (plus whitespace) is removed from the output. Interpolation tags render in place.

Helper `{{else}}` tags are **not** standalone-stripped. Keep chained tags adjacent for switch-like branching without stray whitespace:

```html
{{#ifEqual user.role "admin"}}
    <a href="/dashboard/admin">Administrator</a>
{{else}}{{#ifEqual user.role "moderator"}}
    <a href="/dashboard/moderator">Moderator</a>
{{else}}
    <a href="/dashboard">Dashboard</a>
{{/ifEqual}}{{/ifEqual}}
```

## Built-in Helpers

Helpers are Kixx extensions. Prefer data sections for simple rendering; use helpers for block params, indexes, keys, truthiness, equality, scope changes, or formatting.

| Helper | Type | Description |
| --- | --- | --- |
| `#each` | Block | Iterate arrays, objects, Maps, and Sets with block params |
| `#if` | Block | Render when truthy by helper rules |
| `#unless` | Block | Render when falsey by helper rules |
| `#ifEqual` | Block | Compare two values with loose `==` (`1` equals `"1"`) |
| `#with` | Block | Push a value onto the context stack; parents stay visible |
| `unescape` | Inline | Emit a value without HTML escaping, like `{{{ }}}` |
| `plusOne` | Inline | Add 1 to a number or numeric string; returns a string. Values `Number()` cannot parse return `""` |

- **`{{else}}`** splits any block helper into primary and inverse branches.
- **Arguments** are paths, quoted strings, integers, booleans, `null`, or `undefined`. Positional arguments pass in order; named ones (`format="DATETIME_MED"`) collect into `options`. Calls may span lines.

### each

The first block parameter is required. Separate names with whitespace, not commas. Nested blocks can still read parent context.

```html
{{#each airports as |airport code| }}
    <h2>{{ code }}: {{ airport.name }}</h2>
{{else}}
    <p>No airport data available.</p>
{{/each}}
```

| Iterable | Second block parameter |
| --- | --- |
| Array | index |
| Map | key |
| Set | not defined |
| Object | property name |

### if, unless, with

```html
{{#if profile.links}}<nav>...</nav>{{else}}<p>No links.</p>{{/if}}   {{!-- skips wrapper markup for empty lists --}}
{{#unless articles}}<p>No articles.</p>{{else}}<p>{{ articles.length }} articles</p>{{/unless}}

{{#each cities as |city| }}
    {{#with city}}{{> cards/city.html }}{{/with}}   {{!-- partial sees name, state as locals --}}
{{/each}}
```

`#with` renders `{{else}}` for falsey values and empty arrays, Maps, and Sets; `{}` renders the primary branch.

## Hyperview Helpers

| Helper | Source | Description |
| --- | --- | --- |
| `formatDate` | `helpers/format-date.js` | Format ISO strings, millisecond timestamps, Dates, or Luxon object values |
| `markup` | `helpers/markup.js` | Convert Markdown to raw HTML with the vendored `marked` parser |
| `truncate` | `helpers/truncate.js` | Shorten a string to a maximum character count |
| `assetUrl` | `helpers/asset-url.js` | Render a fingerprinted static-asset URL from the reserved `assets` map |

All are inline helpers, available in page, base, partial, and email templates and in page metadata and email subject mini templates. Templates can pass published `includes` content to them like any value. Mini templates compile without partials, so don't use `{{> partial }}` in them.

### assetUrl

```html
<link rel="stylesheet" href="{{ assetUrl assets "/stylesheets/stylesheet.css" }}">
```

Renders `/assets/<hash>/<pathname>` for a pathname in the snapshot's static assets, otherwise the pathname unchanged. `assets` is a reserved context key that Hyperview merges after page data and response props, so neither can shadow it. Output is escaped.

### formatDate

```html
{{ formatDate game.startTime zone="America/New_York" locale="en-US" format="DATETIME_MED" }}
{{!-- Wrong: the date must come before named options --}}
{{ formatDate zone="America/New_York" game.startTime }}
```

- **Inputs:** ISO string, millisecond timestamp, `Date`, or an object for Luxon's `DateTime.fromObject()` (`{ "year": 2025, "month": 10, "day": 24 }`).
- **`zone`** (IANA, default system), **`locale`** (BCP 47, default system), **`format`** (preset, default `DATETIME_SHORT`).
- `""`, `null`, and `undefined` render `""`. Invalid dates render an escaped `Invalid date ...` message.

| Preset | Example in `en-US` |
| --- | --- |
| `DATE_SHORT` | `10/14/1983` |
| `DATE_MED` | `Oct 14, 1983` |
| `DATE_MED_WITH_WEEKDAY` | `Fri, Oct 14, 1983` |
| `DATE_FULL` | `October 14, 1983` |
| `DATE_HUGE` | `Friday, October 14, 1983` |
| `TIME_SIMPLE` | `1:30 PM` |
| `TIME_WITH_SECONDS` | `1:30:23 PM` |
| `TIME_WITH_SHORT_OFFSET` | `1:30:23 PM EDT` |
| `TIME_WITH_LONG_OFFSET` | `1:30:23 PM Eastern Daylight Time` |
| `TIME_24_SIMPLE` | `13:30` |
| `TIME_24_WITH_SECONDS` | `13:30:23` |
| `TIME_24_WITH_SHORT_OFFSET` | `13:30:23 EDT` |
| `TIME_24_WITH_LONG_OFFSET` | `13:30:23 Eastern Daylight Time` |
| `DATETIME_SHORT` | `10/14/1983, 1:30 PM` |
| `DATETIME_MED` | `Oct 14, 1983, 1:30 PM` |
| `DATETIME_MED_WITH_WEEKDAY` | `Fri, Oct 14, 1983, 1:30 PM` |
| `DATETIME_FULL` | `October 14, 1983 at 1:30 PM EDT` |
| `DATETIME_HUGE` | `Friday, October 14, 1983 at 1:30 PM Eastern Daylight Time` |
| `DATETIME_SHORT_WITH_SECONDS` | `10/14/1983, 1:30:23 PM` |
| `DATETIME_MED_WITH_SECONDS` | `Oct 14, 1983, 1:30:23 PM` |
| `DATETIME_FULL_WITH_SECONDS` | `October 14, 1983 at 1:30:23 PM EDT` |
| `DATETIME_HUGE_WITH_SECONDS` | `Friday, October 14, 1983 at 1:30:23 PM Eastern Daylight Time` |
| `DATE_MONTH_DATE` | `Oct 14` |
| `UTC` | `Wed, 14 Jun 2017 07:00:00 GMT` |
| `ISO` | `2017-06-14T07:00:00.000Z` |
| `ISO_DATE` | `2017-06-14` |
| `ISO_DATE_TIME_24` | `2017-06-14 07:00` |

### markup

```html
<div class="article-body">{{ markup article.body }}</div>
```

`""` renders `""`. Non-strings are converted with `toFriendlyString()`, not parsed. **`markup` returns unescaped HTML: use it only on trusted or sanitized Markdown.**

### truncate

```html
{{ truncate article.title 17 }}                    {{!-- Follow the Leader&hellip; --}}
{{ truncate article.summary 34 " (read more)" }}   {{!-- custom suffix --}}
{{ truncate article.summary 24 "" }}               {{!-- no suffix --}}
```

Arguments: the string, the number of original characters to keep, and an optional suffix (default `&hellip;`) appended only when truncated. A string no longer than `length` is unchanged. Falsey values return `""`; non-strings go through `toFriendlyString()`. **Output is not escaped: don't pass untrusted input unless it is already escaped.**

## HTML Escaping

`{{ value }}` escapes `&`, `<`, `>`, and `"`. It does not escape `'`, `` ` ``, or `=`.

**Helper return values are never escaped**, even in double mustaches. A custom helper that emits untrusted content must escape it:

```javascript
import { escapeHTMLChars } from '../../../kixx/vendor/templating/mod.js';

export default function strongText(_context, _options, userInput) {
    return `<strong>${ escapeHTMLChars(userInput) }</strong>`;
}
```

`escapeHTMLChars()` turns `null` and `undefined` into `""` and passes other non-strings through `String()` first.

## Partials

`{{> name }}` includes a partial. Templates live in three places:

- **Shared partials:** `templates/partials/`. `{{> website/styles.css }}` resolves `templates/partials/website/styles.css`.
- **Base templates:** `templates/base/`.
- **Page templates:** beside the page's `page.json`, named by its `template` directive.

A partial used by one page sits as a flat sibling of that page's `page.json` and is registered with `partials`:

```json
{
    "template": "page.html",
    "partials": [ { "id": "album-card.html", "filename": "album-card.html" } ]
}
```

- **No `partials/` directory inside a page directory.** Child directories are child page pathnames. Move a partial shared by several pages to `templates/partials/`.
- **Page-local partials win** over shared partials with the same id.
- **A partial inherits the context stack.** Inside `{{#each albums as |album index| }}{{> cards/album.html }}{{/each}}`, the partial sees `album`, `index`, and root values like `page`.
- **Names are literal and case-sensitive.** No dynamic names. Published paths must be lowercase, so `{{> Website/Styles.css }}` is a missing partial.
- **A missing partial renders `""`.**
- **A standalone partial tag** indents every line of the partial's output to match.
- **Partials are parsed independently**, so a parent's delimiter change doesn't apply.

## Custom Helpers

Put application helpers under `app/presentation/template-helpers/` (none ship yet). Import them in `app/app.js` and register them during startup, before rendering begins:

```javascript
import formatMoney from './presentation/template-helpers/format-money.js';

export function register(context) {
    const hyperview = context.getService('HyperviewService');
    hyperview.registerTemplateHelper('formatMoney', formatMoney);
}
```

- **Scope.** Registered helpers work wherever Hyperview compiles templates: pages, base templates, partials, page metadata, and email bodies and subjects.
- **Same name replaces** the existing helper, including core and Hyperview helpers.
- **No implicit context.** Capture config in a factory called from `app.js` (`createFormatMoney(context.config.env.DEFAULT_CURRENCY)`); pass request values as template data and arguments.
- **`registerTemplateHelper()`** requires a non-empty name and a function, and returns the `HyperviewService` for chaining.

Signature: `function helperName(context, options, ...positionals)`. `context` is the current frame value, `options` holds named arguments, and positionals are resolved before the call.

```javascript
import { escapeHTMLChars } from '../../../kixx/vendor/templating/mod.js';

// Inline helper
export default function initials(_context, _options, firstName, lastName) {
    const first = String(firstName || '').trim().charAt(0);
    const last = String(lastName || '').trim().charAt(0);
    return escapeHTMLChars(`${ first }${ last }`.toUpperCase());
}

// Block helper: `this` has blockParams (names from `as |...|`),
// renderPrimary(newContext), and renderInverse(newContext) for {{else}}.
export default function repeat(_context, _options, count) {
    let output = '';
    for (let index = 0; index < count; index += 1) {
        output += this.renderPrimary({ index });
    }
    return output;
}
```

## Errors

Malformed templates throw `LineSyntaxError` with the filename, line number, and start position when available. Causes:

- Unclosed mustaches, comments, brackets, string literals, or block params.
- A block opened but never closed, a close tag with no open block, or a close tag whose name doesn't match.
- A named helper argument with no value after `=`.
- A helper throwing while rendering a tag.
