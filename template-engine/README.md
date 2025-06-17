Kixx Templating
===============
A simple and robust text template engine for JavaScript environments.

Created by [Kris Walker](https://www.kriswalker.me) 2023 - 2025.

## Principles
- __No dependencies:__ A template engine is a low level primitive component which systems depend on and should NOT complicate matters by having dependencies itself.
- __Minimal:__ The scope of supported capabilities is kept intentionally small.

Installation
------------
```bash
npm install kixx-logger
```

Environment Support
-------------------

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__ or __Deno >= 1.0.0__. You could use it in a browser, but there are no plans to offer CommonJS or AMD modules. It targets at least [ES2022](https://node.green/#ES2022) and uses the optional chaining operator `?.`.

If you're curious: Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

__Note:__ There is no TypeScript here. It would be waste of time for a library as small as this.

Syntax
------
Resolve paths with [expressions](#expressions).
```html
<h1>{{ article.title }}</h1>
```
Mustaches can be broken over multiple lines. (`image` is a [helper](#helpers) function)
```html
{{image
    article.img.srcset.0
    article.img.srcset[1]
    article.img.srcset[2]
    article.img.srcset[100w]
    }}
```
The template source may include curly braces as long as they are not mustaches:
```html
<div data-json='{"foo":"bar"}'>
</div>
```
```css
@media screen and (min-width: 1080px) {
    .site-width-container {
        max-width: calc(var(--site-width) - var(--layout-right-left-margin) * 2);
        margin-left: auto;
        margin-right: auto;
    }
}
```
```js
(function () {
    console.log('Hello world!');
}());
````
### Comments
Comments can include mustaches "{{ }}" and can break over multiple lines.
```
{{!-- You can use curly braces in your markup, so long
    as it is not a mustache ("{{" or "}}") --}}
```

Expressions
-----------
JavaScript values can be dereferenced using expressions.
```js
const context = { article: {title: "War and Peace"}};
```
```html
<h1>{{ article.title }}</h1>
```
Reference errors will result in an empty string -- not an error. (The `article.date` object is not defined in this example.)
```html
<p>{{ article.date.localized }}</p>
```
Brackets can be used to dereference a value the same way they would in JavaScript.
```html
{{!-- Typically we would use the #each block helper to
    iterate over a list, but we can access indexes with brackets too --}}

<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />

{{!-- Quotes are not used for string keys --}}

<span>{{ applicationStates[playback-starting] }}</span>
```

Helpers
-------
Helpers come in two flavors: inline and block.

Inline helper:
```html
{{!-- Custom date formatter --}}
<time>{{date_to_locale_datetime "2025-06-15T10:40:31.041Z" zone="America/New_York" }}</time>
```
Block heleprs start with `#`:
```html
<ul>
    {{#each books as |book|}}
    <li>
        <span>{{ book.title }}</span>
        <span>{{ book.author }}</span>
    </li>
    {{/each}}
</ul>
```
You can pass literals to helpers too.
```html
<p>{{format_date "1970-01-01T00:00:00" }}</p>

{{#each books as |book,index|}}
<tr>
    <td>{{sum index 1 }}</td>
    <td>{{ book.title }}</td>
    <td>{{ book.author }}</td>
</tr>
{{/each}}
```

Provided helpers
----------------

### #each helper
Renders the primary block if the given value is an Array, Map, Set, or object with own keys. If the iterable object is empty then the inverse block (else block) will be rendered instead. The first block parameter is required to name each item in the block scope. The second block parameter is optional. For Arrays it will be the array index, for Sets it will be ignored, and for Maps and Objects it will be the key.

Notice that the primary render block has access to the upper context scope as well.
```html
{{#each article.comments as |comment|}}
<p>Comment on {{ comment.date }} for {{ article.title }}</p>
{{ else }}
<p>No comments yet.</p>
{{/each}}
```
### #if helper
Renders the primary block if the given value is truthy.
```html
{{!-- Here we use an #if helper to conditionally incude an
    HTML class inside the #each loop --}}

{{#each calendar as |day|}}
<div class="calendar-day{{#if day.isToday}} is-today{{/if}}">
    <span>{{ day.localeDateTime }}</span>
</div>
{{/each}}
```
### #ifEqual helper
Renders the primary block if the given values are equal using `==` comparison.
```html
{{#ifEqual user.entitlement "admin" }}
<span>Admin User</span>
{{ else }}{{#ifEqual user.entitlement "publisher" }}
<span>Publisher User</span>
{{ else }}
<span>Read-only User</span>
{{/ifEqual}}{{/ifEqual}}
```

### #ifEmpty helper
Renders the primary block if the given value is falsy, an Array with length zero, Map or Set with size zero, or any other object with without own keys.
```html
{{#ifEmpty books}}
<p>We do not have any books</p>
{{else}}
<p>We have {{books.length}} {{#ifEqual books.length 1}}book{{else}}books{{/ifEqual}}</p>
{{/ifEmpty}}
```

Custom Helpers
--------------
Custom inline and block helpers can be defined as functions with a pre-defined call pattern.

### Helper API
The helper function will be passed:

- `context` - The current context object.
- `options` - The hash arguments passed into the helper, if any.
- `...positionals` - The rest of the parameters represent the positional arguments passed into the helper, if any.

Inside the helper, the `this` context will be overwritten to have:

- `this.blockParams` Any block parameters passed into the helper.
- `this.renderPrimary` Render the primary block of a block helper, passing it a sub-context object. This returns an empty string for non-block helpers.
- `this.renderInverse` Render the inverse block ('else' block) of a block helper, passing it a sub-context object. This returns an empty string for non-block helpers.

### Example Helpers

An implementation of a simple helper called `format_date` used to format ISO date strings.
```html
<time datetime="{{format_date article.pubdate format="DATE_ISO"}}">
{{format_date article.pubdate}}
</time>
```
```js
function format_date(context, options, ...positionals) {
    const { format } = options;
    const [ isoDateString ] = positionals;

    if (format === 'DATE_ISO') {
        return isoDateString.split('T')[0];
    }
    if (format === 'TIME_ISO') {
        return isoDateString.split('T')[1];
    }
    return new Date(isoDateString).toLocaleString();
}
```

Here is the implementation for an `#each` helper for Arrays. Calling `this.renderPrimary()` will render the primary block while calling `this.renderInverse()` will render the inverse block (the 'else' block).
```js

export default function each_helper(context, options, list) {
    if (!Array.isArray(list)) {
        return this.renderInverse(context);
    }

    const [ itemName, indexName ] = this.blockParams;

    if (list.length === 0) {
        return this.renderInverse(context);
    }

    return list.reduce((str, item, index) => {
        const subContext = {};
        subContext[itemName] = item;
        if (indexName) {
            subContext[indexName] = index;
        }

        return str + this.renderPrimary(Object.assign({}, context, subContext));
    }, '');
}
```

Integration
-----------
Kixx Templating makes no assumptions about template caching or where your template source files are. To integrate into your project you'll need to build your own template engine wrapper.

```js
import {
    helpers,
    tokenize,
    buildSyntaxTree,
    compileTemplate
} from 'kixx-templating';

export default class TemplateEngine {

    #helpers = null;
    #partials = new Map();

    constructor() {
        // Make a copy of the provided helpers to avoid
        // mutating the shared helpers Map.
        this.#helpers = new Map(helpers);
    }

    registerHelper(name, helperFunction) {
        this.#helpers.set(name, helperFunction);
    }

    registerPartial(name, source) {
        const partial = this.compileTemplate(name, source);
        this.#partials.set(name, partial);
    }

    compileTemplate(name, source) {
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.#helpers, this.#partials, tree);
    }
}
```

Copyright and License
---------------------
Copyright: (c) 2023 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
