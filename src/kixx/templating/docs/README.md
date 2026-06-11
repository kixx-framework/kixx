# Kixx Templating

A simple and robust markup and text templating system for JavaScript environments.

Kixx uses Mustache-style `{{ ... }}` syntax. It supports the core Mustache feature set
plus a small library of Kixx helper extensions for the logic that Mustache deliberately
leaves out (iteration with indexes, conditionals, equality checks, scope changes, and
custom formatting).

## Mustache Compatibility

Kixx implements core Mustache templates plus Kixx helper extensions. The optional
Mustache spec extensions `~lambdas`, `~dynamic-names`, and `~inheritance` are
intentionally unsupported. Use inline helpers for computed interpolation and block
helpers for the section behavior that lambdas would otherwise provide.

Two intentional differences from core Mustache are worth knowing up front:

- **Object sections iterate.** A plain object section iterates over its own enumerable
  property values. Core Mustache treats a plain object section as a single pushed
  context. (Arrays, Maps, and Sets also iterate.)
- **Data values are never called.** A value that happens to be a function is treated like
  any other value; the renderer does not invoke it or re-parse a returned string as a
  template.

For the exact rules on which values count as empty or falsey, see
[Falsiness and Empty Values](#falsiness-and-empty-values).

## Basic Expressions

A double-mustache tag interpolates a value from the context object.

```javascript
const context = {
    album: 'Follow the Leader',
    artist: 'Eric B. & Rakim',
};
```

```html
<h1>{{ album }}</h1>
<p>by {{ artist }}</p>
```

Output:

```text
<h1>Follow the Leader</h1>
<p>by Eric B. &amp; Rakim</p>
```

The `&` became `&amp;` because escaped interpolation is automatic. See
[HTML Escaping](#html-escaping) for the full policy.

A tag whose value is `null` or `undefined` renders as an empty string.

### Nested Property Access

Use dot notation to reach nested properties:

```javascript
const context = {
    song: {
        writer: { firstName: 'Eric', lastName: 'Barrier' },
        released: 1988,
    },
};
```

```html
<p>{{ song.writer.firstName }} {{ song.writer.lastName }}</p>
<p>Released: {{ song.released }}</p>
```

If any link in the chain is missing, the whole expression resolves to `undefined` and
renders as an empty string.

### Array Indexes

Use bracket notation with a numeric segment for array elements:

```html
<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />
<p>{{ articles[0].comments[2].author.name }}</p>
```

### Bracket Notation for Special Characters

Property names containing characters that are not valid in dot notation (dashes, spaces,
and so on) must use bracket notation:

```javascript
const context = {
    headers: {
        'Content-Type': 'text/html',
        'Content-Length': 199,
    },
};
```

```html
<dd>{{ headers[Content-Type] }}</dd>
```

Bracket contents are **literal path segments, not JavaScript expressions**. Write
`[Content-Type]`, not `["Content-Type"]` — the quotes would become part of the key. A
numeric segment such as `[0]` is an array index.

### Raw, Unescaped Output

Triple-mustache and ampersand tags emit their value without HTML escaping:

```html
<article>{{{ htmlBody }}}</article>
<article>{{& htmlBody }}</article>
```

Both forms are equivalent. Only use them for content you trust — never for untrusted
user input. See [HTML Escaping](#html-escaping) for the safe alternatives.

### Comments

Single-line and multi-line comments produce no output:

```html
{{! A short Mustache comment }}

{{!-- A single-line comment --}}

{{!--
    A multi-line
    comment.
--}}
```

Comments may contain mustaches; their contents are never parsed:

```html
{{!-- {{ this }} is ignored --}}
```

## Sections

Mustache sections render based on the shape of the data, without registering any helper.
A section opens with `{{#name}}` and closes with `{{/name}}`. How it renders depends on
the value of `name`.

### Array Sections

An array section renders its block once per item. Each item is pushed onto the context
stack, so `{{.}}` resolves to the current item, the item's own properties resolve first,
and parent context remains visible.

```javascript
const context = {
    listName: 'Tracks',
    tracks: [
        { title: 'Follow the Leader' },
        { title: 'Microphone Fiend' },
    ],
};
```

```html
<h2>{{ listName }}</h2>
<ul>
{{#tracks}}
    <li>{{ title }} — {{ listName }}</li>
{{/tracks}}
</ul>
```

Output:

```text
<h2>Tracks</h2>
<ul>
    <li>Follow the Leader — Tracks</li>
    <li>Microphone Fiend — Tracks</li>
</ul>
```

`{{ listName }}` still resolves inside the block because name resolution walks up the
context stack (see [Name Resolution](#name-resolution)).

### Map, Set, and Object Sections

Map and Set sections render once per value. Plain object sections render once per own
enumerable property value, in `Object.keys()` order. Keys and property names are **not**
exposed inside data sections — use the [`each`](#each-helper) helper when you need them.

```javascript
const context = {
    usersById: {
        u1: { name: 'Ada' },
        u2: { name: 'Linus' },
    },
};
```

```html
<ul>
{{#usersById}}
    <li>{{ name }}</li>
{{/usersById}}
</ul>
```

Output:

```text
<ul>
    <li>Ada</li>
    <li>Linus</li>
</ul>
```

### Scalar Sections

A scalar (non-collection) value renders the block exactly once, with the value pushed
onto the stack so `{{.}}` outputs it. Only `false`, `null`, and `undefined` suppress a
scalar section; importantly, `0` and `""` render once.

```html
{{#status}}Status: {{.}}{{/status}}
{{#count}}Count: {{.}}{{/count}}
```

With `{ status: 'active', count: 0 }` this outputs `Status: active` and `Count: 0`.

### Inverted Sections

An inverted section, `{{^name}}`, renders when its value is empty or falsey: `false`,
`null`, `undefined`, an empty array, an empty Map, an empty Set, or an empty plain
object. It is the complement of a regular data section.

```html
{{#articles}}
    <article>{{ title }}</article>
{{/articles}}
{{^articles}}
    <p>No articles available.</p>
{{/articles}}
```

Data sections do not support `{{else}}`. Pair `{{#name}}` with `{{^name}}` instead, or
reach for the [`if`](#if-helper) / [`each`](#each-helper) helpers when you need an inline
else branch, indexes, or block params.

## Falsiness and Empty Values

Data sections and the conditional helpers each decide independently whether a value is
"present." The rules mostly agree, but they differ for `0`, `""`, and empty plain
objects, so this table is the authoritative reference. "main" means the primary block
renders; "else" means the inverse branch renders (`{{^name}}` for a data section,
`{{else}}` for a helper).

| Value                  | `{{#x}}` section   | `{{#if x}}` | `{{#unless x}}` | `{{#with x}}` |
|------------------------|--------------------|-------------|-----------------|---------------|
| `false`                | else               | else        | main            | else          |
| `null`                 | else               | else        | main            | else          |
| `undefined`            | else               | else        | main            | else          |
| `0`                    | main (scalar)      | else        | main            | else          |
| `""` (empty string)    | main (scalar)      | else        | main            | else          |
| non-empty string       | main (scalar)      | main        | else            | main          |
| non-zero number        | main (scalar)      | main        | else            | main          |
| `[]` empty array       | else               | else        | main            | else          |
| non-empty array        | main (iterates)    | main        | else            | main          |
| empty Map / Set        | else               | else        | main            | else          |
| non-empty Map / Set    | main (iterates)    | main        | else            | main          |
| `{}` empty object      | else               | **main**    | main            | **main**      |
| non-empty object       | main (iterates)    | main        | else            | main          |

Note the two surprises on the empty-object row: `#if {}` and `#with {}` treat an empty
object as a present value (main block), while data sections and `#unless` treat it as
empty. For `#unless`, "main" is its body, which renders precisely when the value is
falsey.

## Name Resolution

Name resolution follows Mustache semantics over a context stack. For a dotted path, the
engine walks **up** the stack to find the first frame whose value has the *first*
segment, then resolves the remaining segments directly on that value. A broken chain
returns `undefined`; it does not restart the search higher up the stack.

```javascript
const context = {
    site: 'Blog',
    post: { title: 'Hello' },
};
```

```html
{{#with post}}{{ title }} on {{ site }}{{/with}}
```

Inside the block, `title` resolves on the pushed `post` value and `site` is found by
walking up to the root frame. Output: `Hello on Blog`.

(This uses [`#with`](#with-helper) rather than a `{{#post}}` data section on purpose: a
plain-object data section *iterates its property values* instead of pushing the object
itself — see [Sections](#sections).)

## Delimiters

A set-delimiter tag changes the active delimiters from that point forward in the source:

```html
{{=<% %>=}}
<h1><% title %></h1>
```

Delimiter changes are scoped to the template source in which they appear. Partials are
parsed independently, so a parent's delimiter change does not affect a partial.

## Whitespace Control

Kixx follows the Mustache standalone-tag rule: when a section, inverted section, comment,
partial, or set-delimiter tag is the only non-whitespace content on its line, that entire
line — including its trailing newline and leading indentation — is removed from the
output.

```html
<ul>
{{#items}}
    <li>{{ . }}</li>
{{/items}}
</ul>
```

Because the `{{#items}}` and `{{/items}}` lines are standalone, they leave no blank lines
behind; only the `<li>` lines remain.

Two things are **not** standalone-stripped, by design:

- **Interpolation tags** (`{{ x }}`, `{{{ x }}}`). They render in place, so surrounding
  whitespace is preserved.
- **Helper `{{else}}` tags.** Whitespace around `{{else}}` is kept, so place it
  deliberately when exact output matters. Put the `{{else}}` immediately against
  surrounding tags (`...{{/each}}{{else}}{{#each...`) to avoid emitting stray newlines.

## Built-in Helpers

Helpers are Kixx extensions. Prefer plain data sections for ordinary iteration and
conditionals; reach for helpers when you need block params, indexes, keys, equality
checks, scope changes, formatting, or other custom behavior.

| Helper       | Type   | Description                                       |
|--------------|--------|---------------------------------------------------|
| `#each`      | Block  | Iterate arrays, objects, Maps, and Sets           |
| `#if`        | Block  | Conditional rendering based on truthiness         |
| `#unless`    | Block  | Render when a value is falsey                      |
| `#ifEqual`   | Block  | Loose (`==`) equality comparison                  |
| `#with`      | Block  | Change the context scope                          |
| `unescape`   | Inline | Emit a value without HTML escaping                |
| `plusOne`    | Inline | Add 1 to a number (useful for array indexes)      |

`{{else}}` splits any block helper into a primary branch and an inverse branch.

### each Helper

`each` iterates arrays, Maps, Sets, or plain objects, with explicit block parameters.

```html
<ul>
{{#each images as |image| }}
    <li><img src="{{ image.src }}" alt="{{ image.alt }}" /></li>
{{/each}}
</ul>
```

The first block parameter is **required**. Block parameter names are separated by
whitespace — do not use commas. Always include the closing `{{/each}}` tag.

The optional second block parameter depends on the iterable type:

| Iterable | Second parameter |
|----------|------------------|
| Array    | index            |
| Map      | key              |
| Set      | (none)           |
| Object   | property name    |

```html
{{#each weatherStations as |stationCode index| }}
<li>
    <span>{{ plusOne index }}.</span>
    <a href="/stations/{{ stationCode }}">{{ stationCode }}</a>
</li>
{{/each}}
```

For Maps and plain objects the second parameter is the key or property name:

```html
{{#each usersById as |user id| }}
    <a href="/users/{{ id }}">{{ user.name }}</a>
{{/each}}
```

Use `{{else}}` for the empty case. The inverse branch renders for an empty array, empty
Map, empty Set, empty plain object, `null`, `undefined`, or any non-object value:

```html
{{#each images as |image| }}
    <div><img src="{{ image.src }}" /></div>
{{else}}
    <p>No images to display.</p>
{{/each}}
```

### if Helper

Renders the primary block when the value is truthy (see
[Falsiness and Empty Values](#falsiness-and-empty-values)):

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

Truthy: non-empty strings, non-zero numbers, `true`, plain objects (including empty
objects), and non-empty arrays, Maps, and Sets. Falsey: `false`, `0`, `""`, `null`,
`undefined`, and empty arrays, Maps, and Sets.

### unless Helper

The mirror of `if`: renders its primary block when the value is falsey.

```html
{{#unless articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/unless}}
```

`#unless` renders the primary block for `false`, `0`, `""`, `null`, `undefined`, and
empty arrays, Maps, Sets, and plain objects. Note that an empty plain object is falsey
here even though it is truthy for `#if`.

### ifEqual Helper

Compares two values with loose (`==`) equality, so `1` and `"1"` are considered equal:

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

Chain `ifEqual` for switch-like branching. Keep the `{{else}}` and nested open tags
adjacent so the [whitespace rules](#whitespace-control) do not introduce stray newlines:

```html
{{#ifEqual user.role "admin"}}
    <a href="/dashboard/admin">Administrator</a>
{{else}}{{#ifEqual user.role "moderator"}}
    <a href="/dashboard/mod">Moderator</a>
{{else}}
    <a href="/dashboard">Dashboard</a>
{{/ifEqual}}{{/ifEqual}}
```

### with Helper

Pushes a value onto the context stack to shorten repeated nested access:

```javascript
const context = {
    site: { name: 'My Blog' },
    user: {
        profile: { name: 'Jane Doe', bio: 'Software developer', email: 'jane@example.com' },
    },
};
```

```html
{{#with user.profile}}
    <h2>{{ name }}</h2>
    <p>{{ bio }}</p>
    <p>Email: {{ email }}</p>
    <p>On {{ site.name }}</p>
{{else}}
    <p>No profile information available.</p>
{{/with}}
```

Inside the block, the profile's properties resolve first, and parent values like
`site.name` remain reachable. The `{{else}}` branch renders when the value is falsey, an
empty array, or an empty Map or Set. An empty plain object is treated as a usable context
and renders the primary block.

### unescape Helper

Emits a value without HTML escaping. It is equivalent to `{{{ value }}}` / `{{& value }}`
but reads as a helper call. Only use it for trusted content.

```html
<div>{{ unescape markdownContent }}</div>
```

### plusOne Helper

Adds 1 to a number and returns the result as a string — handy for 1-based display of
0-based array indexes. Numeric strings are accepted; non-numeric values return an empty
string.

```html
{{#each images as |image index| }}
<div>
    <span>{{ plusOne index }}.</span>
    <img src="{{ image.src }}" alt="{{ image.alt }}" />
</div>
{{/each}}
```

### Multi-line Helper Calls

Any helper call may span multiple lines, which keeps long argument lists readable:

```html
<p>Game start: {{formatDate game.startTime
    zone="America/New_York"
    locale="en-US"
    format="DATETIME_MED"
}}</p>
```

Helper arguments can be paths, quoted string literals, integer literals, the boolean
literals `true` / `false`, `null`, or `undefined`. Positional arguments are passed in
order; named arguments such as `format="long"` are collected into the helper's `options`
object.

## HTML Escaping

Escaped interpolation (`{{ value }}`) escapes the core Mustache set: `&`, `<`, `>`, and
`"`.

```html
{{#comments}}
<div>{{ . }}</div>
{{/comments}}
```

A comment of `<script src="http://evil.com/hack.js" />` renders safely as:

```text
<div>&lt;script src=&quot;http://evil.com/hack.js&quot; /&gt;</div>
```

Characters outside that set — including `'`, `` ` ``, and `=` — are **not** escaped by
the default policy. If you need something stricter, pass a custom `escape` function to
`createRenderFunction()`:

```javascript
const render = createRenderFunction(
    { escape: (value) => String(value).replace(/'/g, '&#39;') },
    helpers,
    partials,
    tree,
);
```

### Raw, Trusted HTML

For pre-sanitized HTML (for example, Markdown already converted to HTML), use any of the
three unescaped forms:

```html
<div>{{{ markdownContent }}}</div>
<div>{{& markdownContent }}</div>
<div>{{ unescape markdownContent }}</div>
```

Never pass untrusted user input through raw output.

### Escaping in Custom Helpers

Helper return values are **not** escaped automatically, even when the helper is called
with double mustaches. If a helper emits untrusted content, escape it yourself:

```javascript
import { escapeHTMLChars } from 'kixx-templating';

function shout(context, options, userInput) {
    return escapeHTMLChars(userInput) + '!';
}
```

Helpers should always return a string. A `null` or `undefined` return is not coerced to
an empty string for you.

## Partials

Partials are reusable, separately-registered template fragments. Include one with
`{{> name }}`:

```html
<!DOCTYPE html>
<html>
<head>{{> head.html }}</head>
<body>
    {{> header.html }}
    <main>{{{ content }}}</main>
    {{> footer.html }}
</body>
</html>
```

A partial inherits the current context, including the surrounding stack:

```html
{{#players}}
    {{> cards/game-player.html }}
{{/players}}
```

Inside `cards/game-player.html`, both the current player's fields and the parent context
are reachable:

```html
<tr>
    <td>{{ game.formattedName }}</td>
    <td>{{ name }}</td>
    <td>{{ goals }}</td>
</tr>
```

Additional notes:

- A partial name that is not registered renders as an empty string.
- Partial names are literal. The dynamic-name extension (`{{>*name}}`) is not supported.
- A standalone partial tag propagates its indentation to every line of the partial's
  output:

  ```html
  <ul>
    {{> row }}
  </ul>
  ```

  Each rendered line of `row` receives the two-space indent that preceded the tag.

## Custom Helpers

### Helper Signature

```javascript
function helperName(context, options, ...positionals) {
    return output;
}
```

| Parameter        | Description                                              |
|------------------|---------------------------------------------------------|
| `context`        | The current frame value (the value `this` block is in)  |
| `options`        | Object of named arguments (`format="long"` → `options.format`) |
| `...positionals` | Positional arguments, already resolved against context  |

Positional path arguments are looked up before the helper runs; a missing path resolves
to `undefined`.

### Inline Helper Example

```javascript
function formatDate(context, options, dateString) {
    const { format = 'short' } = options;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { dateStyle: format });
}
```

```html
<p>Published: {{ formatDate article.date format="long" }}</p>
```

### Block Helper Example

A block helper renders its body through methods on `this`:

| Property / Method                | Description                                  |
|----------------------------------|----------------------------------------------|
| `this.blockParams`               | Array of the `as |...|` parameter names      |
| `this.renderPrimary(newContext)` | Render the primary block                     |
| `this.renderInverse(newContext)` | Render the `{{else}}` block                  |

```javascript
function repeat(context, options, count) {
    let output = '';
    for (let i = 0; i < count; i += 1) {
        output += this.renderPrimary({ index: i });
    }
    return output;
}
```

```html
{{#repeat 3}}
    <span>Item {{ index }}</span>
{{/repeat}}
```

The object passed to `renderPrimary()` is pushed onto the context stack, so parent
context stays visible without copying it. Calling `renderPrimary()` with no argument
re-renders against the current frame unchanged.

Block helpers can read the names declared with `as |...|`:

```javascript
function entries(context, options, value) {
    const [ valueName, keyName ] = this.blockParams;
    let output = '';

    for (const key of Object.keys(value)) {
        output += this.renderPrimary({
            [keyName]: key,
            [valueName]: value[key],
        });
    }

    return output;
}
```

```html
{{#entries settings as |value key| }}
    <dt>{{ key }}</dt>
    <dd>{{ value }}</dd>
{{/entries}}
```

## Errors

Malformed templates throw a `LineSyntaxError` during tokenization or syntax-tree
construction, with the offending `filename`, `lineNumber`, and `startPosition` attached
for diagnostics. Errors are raised for:

- An unclosed mustache (`{{ ...` with no `}}`) or unclosed comment.
- A block that is opened but never closed.
- A close tag with no matching open block, or whose name does not match the open block
  (`{{#if x}}...{{/each}}`).
- Unclosed string literals, brackets, or block params inside an expression.
- A key/value argument with no value after `=`.

A helper that throws is wrapped in a `LineSyntaxError` whose `cause` is the original
error, so failures point back to the tag that triggered them.

## API Reference

### Exports

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
    escapeHTMLChars,
} from 'kixx-templating';
```

### tokenize(options, filename, utf8)

Tokenizes template source into an array of tokens. Handles dynamic delimiter changes and
records standalone-whitespace metadata.

- `options` — pass `null` (reserved for future use)
- `filename` — template name, used in error messages
- `utf8` — the template source string

### buildSyntaxTree(options, tokens)

Builds an AST from tokens.

- `options` — pass `null`
- `tokens` — the array returned by `tokenize()`

### createRenderFunction(options, helpers, partials, tree)

Compiles an AST into a render function.

- `options` — pass `null`, or `{ escape }` to override the escaped-interpolation policy
- `helpers` — `Map` of helper functions
- `partials` — `Map` of compiled partial render functions
- `tree` — the AST returned by `buildSyntaxTree()`

Returns a render function with the signature `(context) => string`. Partials are resolved
at render time, so a template may reference partials registered after it was compiled.

### helpers

A `Map` of all built-in helper functions. Copy it (`new Map(helpers)`) before adding your
own so the built-ins stay intact.

### escapeHTMLChars(str)

Escapes the Mustache HTML set (`&`, `<`, `>`, `"`). `null` and `undefined` become the
empty string; other non-strings are coerced with `String()`.

## Putting it All Together

These primitives are enough to build a small template engine with application-specific
behavior such as helper registration, partial registration, and caching.

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
} from 'kixx-templating';

class TemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();

    registerHelper(name, fn) {
        this.#helpers.set(name, fn);
    }

    registerPartial(name, source) {
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        const partial = createRenderFunction(null, this.#helpers, this.#partials, tree);
        this.#partials.set(name, partial);
    }

    compileTemplate(name, source) {
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.#helpers, this.#partials, tree);
    }
}
```

```javascript
const engine = new TemplateEngine();

engine.registerPartial('track-row', '<li>{{ title }} — {{ duration }}</li>');

const render = engine.compileTemplate('track-list', `
<h1>{{ album }}</h1>
<ol>
{{#tracks}}
    {{> track-row }}
{{/tracks}}
</ol>
`);

render({
    album: 'Follow the Leader',
    tracks: [
        { title: 'Follow the Leader', duration: '5:36' },
        { title: 'Microphone Fiend', duration: '5:17' },
    ],
});
```
