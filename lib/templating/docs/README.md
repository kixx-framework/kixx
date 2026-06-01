# Kixx Templating

A simple and robust markup and text templating system for JavaScript environments.

## Basic Expressions

Kixx templating uses mustache style syntax with double curly braces `{{ ... }}` for template expressions.

### Simple Variable Output

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
```html
<h1>Follow the Leader</h1>
<p>by Eric B. &amp; Rakim</p>
```

Notice that the "&" was converted to `&amp;`. HTML escaping is automatic. See [HTML Escaping](#html-escaping) for more details.

### Nested Property Access

Use dot notation for nested objects:

```html
<p>{{ song.writer.firstName }} {{ song.writer.lastName }}</p>
<p>Released: {{ song.released }}</p>
```

### Array Access

Use bracket notation for array indexes:

```html
<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />
<p>{{ articles[0].comments[2].author.name }}</p>
```

### Bracket Notation for Special Characters

Properties with special characters like dashes need bracket notation:

```javascript
const context = {
    headers: {
        "Content-Type": "text/html",
        "Content-Length": 199,
    },
};
```

```html
<dd>{{ headers[Content-Type] }}</dd>
```

⚠️ You do *not* need quotes inside the brackets like JavaScript. Use `[Content-Type]` not `["Content-Type"]`.

### Comments

```html
{{!-- This is a single line comment --}}

{{!--
    This is a multi-line
    comment..
--}}

{{!-- Comments can contain {{ mustaches }} --}}
{{!-- and they won't be processed. --}}
```

## Built-in Helpers

| Helper | Type | Description |
|--------|------|-------------|
| `#each` | Block | Iterate over arrays, objects, Maps, and Sets |
| `#if` | Block | Conditional rendering based on truthiness |
| `#unless` | Block | Inverse of if - renders when falsy |
| `#ifEqual` | Block | Equality comparison using `==` |
| `#with` | Block | Change the context scope |
| `unescape` | Inline | Prevent automatic HTML escaping |
| `plusOne` | Inline | Add 1 to a number (useful for array indexes) |

### each Helper

Iterate over arrays, Maps, Sets, or plain objects:

```html
<ul>
    {{#each images as |image| }}
    <li>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </li>
    {{/each}}
</ul>
```

⚠️ Remember to include the closing `{{/each}}` tag.

The second block parameter references different things based on the iterable type:

| Iterable | Second parameter |
|----------|------------------|
| Array | index |
| Map | key |
| Set | (none) |
| Object | property name |

```html
{{#each weatherStations as |stationCode, index| }}
<li>
    <span>{{plusOne index }}.</span>
    <a href="/stations/{{ stationCode }}">{{ stationCode }}</a>
</li>
{{/each}}
```

Use `else` to handle empty lists:

```html
{{#each images as |image| }}
    <div><img src="{{ image.src }}" /></div>
{{else}}
    <p>No images to display</p>
{{/each}}
```

### if Helper

Conditional rendering based on truthiness:

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

**Truthy values:** non-empty strings, non-zero numbers, `true`, non-empty arrays/objects/Maps/Sets

**Falsy values:** `false`, `0`, `""`, `null`, `undefined`, empty arrays `[]`, empty objects `{}`, empty Maps/Sets

### unless Helper

Renders when the value is falsy (inverse of `#if`):

```html
{{#unless articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/unless}}
```

### ifEqual Helper

Compares two values using `==` equality:

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

Chain for switch-like behavior:

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

Changes the context scope for a block. Useful for reducing repetition when accessing nested properties:

```javascript
const context = {
    site: { name: 'My Blog' },
    user: {
        profile: {
            name: 'Jane Doe',
            bio: 'Software developer',
            email: 'jane@example.com'
        }
    }
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

For plain objects, the properties are merged into the current context, so parent context properties like `site.name` remain accessible.

The else block renders when the value is:
- Falsy (`null`, `undefined`, `false`, `0`, `""`)
- An empty array `[]`
- An empty Map or Set

### plusOne Helper

Adds 1 to a number. Useful for displaying 1-based indexes:

```html
{{#each images as |image, index| }}
<div>
    <span>{{plusOne index }}.</span>
    <img src="{{ image.src }}" alt="{{ image.alt }}" />
</div>
{{/each}}
```

### Multi-line Helpers

All helpers can span multiple lines:

```html
<p>Game start: {{formatDate game.startTime
    zone="America/New_York"
    locale="en-US"
    format="DATETIME_MED"
}}</p>
```

## HTML Escaping

Kixx automatically escapes HTML to prevent injection attacks.

```html
{{#each post.comments as |comment|}}
<div>{{ comment }}</div>
{{/each}}
```

If a comment contains `<script src="http://evil.com/hack.js" />`, the output will be safely escaped:

```html
<div>&lt;script src&#x3D;&quot;http://evil.com/hack.js&quot; /&gt;</div>
```

### Using unescape

For trusted HTML content (like markdown converted to HTML), use the `unescape` helper:

```html
<div>{{unescape markdownContent }}</div>
```

⚠️ **Security Warning:** Only use `unescape` with content you trust. Never use it with untrusted user input.

### Escaping in Custom Helpers

Helper output is NOT automatically escaped. Use `escapeHTMLChars()` in your helpers:

```javascript
import { escapeHTMLChars } from 'kixx-templating';

function myHelper(context, options, userInput) {
    return escapeHTMLChars(userInput);
}
```

## Partials

Partials are reusable template fragments. Include them with `{{> partial-name }}`:

```html
<!DOCTYPE html>
<html>
<head>{{> head.html }}</head>
<body>
    {{> header.html }}
    <main>{{unescape content }}</main>
    {{> footer.html }}
</body>
</html>
```

Partials inherit the current context:

```html
{{#each game.players as |player| }}
    {{> cards/game-player.html }}
{{/each}}
```

Inside `cards/game-player.html`, you can access both `player` and `game`:

```html
<tr>
    <td>{{ game.formattedName }}</td>
    <td>{{ player.name }}</td>
    <td>{{ player.goals }}</td>
</tr>
```

## Custom Helpers

### Helper Signature

```javascript
function helperName(context, options, ...positionals) {
    return output;
}
```

| Parameter | Description |
|-----------|-------------|
| `context` | The current template context object |
| `options` | Named arguments passed to the helper |
| `...positionals` | Positional arguments |

### Inline Helper Example

```javascript
function formatDate(context, options, dateString) {
    const { format = 'short' } = options;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { dateStyle: format });
}
```

Usage:

```html
<p>Published: {{ formatDate article.date format="long" }}</p>
```

### Block Helper Example

Block helpers use `this` context for rendering:

| Property/Method | Description |
|-----------------|-------------|
| `this.blockParams` | Array of block parameter names |
| `this.renderPrimary(newContext)` | Render the primary block |
| `this.renderInverse(newContext)` | Render the else block |

```javascript
function repeat(context, options, count) {
    let output = '';
    for (let i = 0; i < count; i++) {
        output += this.renderPrimary({ ...context, index: i });
    }
    return output;
}
```

Usage:

```html
{{#repeat 3}}
    <span>Item {{ index }}</span>
{{/repeat}}
```

## API Reference

### Exports

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
    escapeHTMLChars
} from 'kixx-templating';
```

### tokenize(options, filename, utf8)

Tokenizes template source into an array of tokens.

- `options` - Pass `null` (reserved for future use)
- `filename` - Template name for error reporting
- `utf8` - Template source string

### buildSyntaxTree(options, tokens)

Builds an AST from tokens.

- `options` - Pass `null`
- `tokens` - Array from `tokenize()`

### createRenderFunction(options, helpers, partials, tree)

Creates a render function from an AST.

- `options` - Pass `null`
- `helpers` - Map of helper functions
- `partials` - Map of compiled partial functions
- `tree` - AST from `buildSyntaxTree()`

Returns a function: `(context) => string`

### helpers

Map containing all built-in helper functions.

### escapeHTMLChars(str)

Escapes HTML special characters: `& < > " ' \` =`

## Putting it All Together
Using the primitives provided by kixx templating you can trivially create a template engine similar to this example. From there, it's not difficult to imagine how you could add more sophistication, like template caching, to your template engine.

```javascript
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
