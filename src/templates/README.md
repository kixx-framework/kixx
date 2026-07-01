# Kixx Hyperview Templating

The Kixx Hyperview plugin renders server-side HTML with the Kixx templating engine which uses Mustache-style `{{ ... }}` tags for interpolation, sections, helpers, partials, comments, and delimiter changes.

The core templating engine is deliberately small.

Kixx targets core Mustache behavior where it fits this project. The optional Mustache extensions `~lambdas`, `~dynamic-names`, and `~inheritance` are intentionally not supported. Values that happen to be functions are treated as values; they are not called.

One intentional difference from core Mustache: plain object sections iterate over the object's own enumerable property values. Core Mustache treats a plain object section as a single pushed context. Use `#with` (documented below) when you want to push an object as the active context.

## Hyperview Context

Hyperview page data comes from merged `pages/**/page.json` files, optional page-local `includes` files for additional text content, and runtime props on the response object supplied by request handlers with `response.updateProps()`. The assembled data object is passed to the page template and then to the base template.

Static page data:

```json
{
    "baseTemplate": "website.html",
    "page": {
        "title": "Album Notes",
        "description": "Notes for selected albums.",
        "locale": "en-US"
    },
    "albums": [
        {
            "title": "Follow the Leader",
            "artist": "Eric B. & Rakim",
            "releasedAt": "1988-07-26T04:00:00.000Z"
        },
        {
            "title": "Paid in Full",
            "artist": "Eric B. & Rakim",
            "releasedAt": "1987-07-07T04:00:00.000Z"
        }
    ]
}
```

Runtime props:

```javascript
export default function albumPageRequestHandler(_context, _request, response) {
    return response.updateProps({
        viewer: {
            isLoggedIn: true,
            displayName: 'Kris',
        },
        page: {
            title: 'Album Notes',
        },
    });
}
```

Page template:

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
        <li>
            <strong>{{ plusOne index }}. {{ album.title }}</strong>
            <span>by {{ album.artist }}</span>
            <time datetime='{{ formatDate album.releasedAt zone="America/New_York" format="ISO_DATE" }}'>
                {{ formatDate album.releasedAt zone="America/New_York" locale="en-US" format="DATE_MED" }}
            </time>
        </li>
    {{/each}}
    </ol>
</article>
```

Every page's assembled template context can be inspected by adding `.json` to its URL, e.g. `http://localhost:2026/admin/style-guide/aesthetic.json`. This is useful for confirming what data a page template actually receives.

## Basic Expressions

A double-mustache tag interpolates a value from the current context.

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

Double-mustache interpolation escapes HTML by default. A value of `null` or `undefined` renders as an empty string. Other non-string values are converted with `String()`, so rendering an object directly produces `[object Object]`. Prefer nested property access.

### Nested Properties

Use dot notation for nested properties.

```javascript
const context = {
    song: {
        title: 'Follow the Leader',
        writer: {
            firstName: 'Eric',
            lastName: 'Barrier',
        },
        stats: {
            trackNumber: 1,
            duration: '5:36',
        },
    },
};
```

```html
<h2>{{ song.title }}</h2>
<p>Written by {{ song.writer.firstName }} {{ song.writer.lastName }}</p>
<p>Track {{ song.stats.trackNumber }} runs {{ song.stats.duration }}.</p>
```

If any part of a path is missing, the expression resolves to `undefined` and renders as an empty string.

### Array Indexes

Use numeric bracket notation for array elements.

```javascript
const context = {
    images: [
        {
            src: 'https://www.example.com/assets/image-1.jpg',
            alt: 'Album cover front',
            tags: [ 'cover', 'front' ],
        },
        {
            src: 'https://www.example.com/assets/image-2.jpg',
            alt: 'Album cover back',
            tags: [ 'cover', 'back' ],
        },
    ],
};
```

```html
<figure>
    <img src="{{ images[0].src }}" alt="{{ images[0].alt }}">
    <figcaption>{{ images[0].tags[0] }} / {{ images[0].tags[1] }}</figcaption>
</figure>

<figure>
    <img src="{{ images[1].src }}" alt="{{ images[1].alt }}">
    <figcaption>{{ images[1].tags[0] }} / {{ images[1].tags[1] }}</figcaption>
</figure>
```

Direct array indexes are useful for fixed slots. Use `#each` for ordinary list rendering.

### Bracket Notation

Property names with dashes, spaces, or other characters that do not work in dot notation must use bracket notation.

```javascript
const context = {
    headers: {
        Date: 'Thu, 23 Oct 2025 17:07:22 GMT',
        'Content-Type': 'text/html',
        'Content-Length': 199,
    },
};
```

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

Bracket contents are literal path segments, not JavaScript expressions. Use `[Content-Type]`, not `["Content-Type"]`; quotes would become part of the key.

### Raw Output

Triple-mustache tags and ampersand tags output trusted content without escaping.

```html
<section>{{{ trustedHtml }}}</section>
<section>{{& trustedHtml }}</section>
```

Both forms are equivalent. Use them only for trusted or already-sanitized HTML.

### Comments

Comments render no output.

```html
{{!-- A single-line comment --}}

{{!--
    A multi-line comment.
    Tags inside comments, such as {{ page.title }}, are ignored.
--}}
```

## Sections

Data sections are Mustache sections that render from the shape of data, without registering a helper. A section opens with `{{#name}}` and closes with `{{/name}}`.

### Array Sections

An array section renders once per item. Each item is pushed onto the context stack, so item properties resolve first and parent values remain available.

```javascript
const context = {
    listName: 'Tracks',
    albumUrl: '/albums/follow-the-leader',
    tracks: [
        { title: 'Follow the Leader', duration: '5:36' },
        { title: 'Microphone Fiend', duration: '5:17' },
    ],
};
```

```html
<h2>{{ listName }}</h2>
<ol>
{{#tracks}}
    <li>
        <a href="{{ albumUrl }}">{{ title }}</a>
        <span>{{ duration }}</span>
    </li>
{{/tracks}}
</ol>
```

Output:

```html
<h2>Tracks</h2>
<ol>
    <li>
        <a href="/albums/follow-the-leader">Follow the Leader</a>
        <span>5:36</span>
    </li>
    <li>
        <a href="/albums/follow-the-leader">Microphone Fiend</a>
        <span>5:17</span>
    </li>
</ol>
```

Use `{{ . }}` for the current scalar item.

```javascript
const context = {
    genres: [ 'Hip hop', 'Golden age', 'East Coast' ],
};
```

```html
<ul>
{{#genres}}
    <li>{{ . }}</li>
{{/genres}}
</ul>
```

### Map, Set, and Object Sections

Map and Set sections render once per value. Plain object sections render once per own enumerable property value in `Object.keys()` order. Keys are not exposed in data sections; use `#each` when you need keys.

```javascript
const context = {
    usersById: {
        u1: { name: 'Ada', role: 'admin' },
        u2: { name: 'Linus', role: 'reviewer' },
    },
};
```

```html
<ul>
{{#usersById}}
    <li>{{ name }}: {{ role }}</li>
{{/usersById}}
</ul>
```

Output:

```html
<ul>
    <li>Ada: admin</li>
    <li>Linus: reviewer</li>
</ul>
```

### Scalar Sections

A scalar value renders the section once, with the scalar pushed onto the stack. For data sections, `0` and `""` render once.

```javascript
const context = {
    status: 'active',
    count: 0,
    subtitle: '',
};
```

```html
{{#status}}<p>Status: {{ . }}</p>{{/status}}
{{#count}}<p>Count: {{ . }}</p>{{/count}}
{{#subtitle}}<p>Subtitle: {{ . }}</p>{{/subtitle}}
```

Output:

```html
<p>Status: active</p>
<p>Count: 0</p>
<p>Subtitle: </p>
```

### Inverted Sections

An inverted section, `{{^name}}`, renders when a value is absent, false, or empty.

```javascript
const context = {
    articles: [],
};
```

```html
{{#articles}}
    <article>{{ title }}</article>
{{/articles}}
{{^articles}}
    <p>No articles available.</p>
{{/articles}}
```

Data sections do not support `{{else}}`. Pair `{{#name}}` with `{{^name}}`, or use `#if`, `#unless`, or `#each` when an inline `{{else}}` branch is clearer.

## Falsiness and Empty Values

Data sections and helpers each decide whether a value is present. The differences for `0`, `""`, and `{}` matter.

| Value | `{{#x}}` section | `{{#if x}}` | `{{#unless x}}` | `{{#with x}}` |
| --- | --- | --- | --- | --- |
| `false` | else | else | main | else |
| `null` | else | else | main | else |
| `undefined` | else | else | main | else |
| `0` | main | else | main | else |
| `""` | main | else | main | else |
| non-empty string | main | main | else | main |
| non-zero number | main | main | else | main |
| `[]` | else | else | main | else |
| non-empty array | main | main | else | main |
| empty Map or Set | else | else | main | else |
| non-empty Map or Set | main | main | else | main |
| `{}` | else | main | main | main |
| non-empty object | main | main | else | main |

For `#unless`, "main" means the helper body renders. Empty plain objects are a notable case: `#if {}` and `#with {}` render their main block, while data sections and `#unless` treat `{}` as empty.

## Name Resolution

Kixx resolves names against a context stack. For a dotted path, it walks up the stack to find the first frame with the first segment, then resolves the rest of the path directly on that value. If the rest of the chain breaks, the result is `undefined`.

```javascript
const context = {
    site: {
        name: 'kixx.dev',
    },
    post: {
        title: 'Hello Templates',
        author: {
            name: 'Kris',
        },
    },
};
```

```html
{{#with post}}
<article>
    <h1>{{ title }}</h1>
    <p>By {{ author.name }} on {{ site.name }}</p>
</article>
{{/with}}
```

Output:

```html
<article>
    <h1>Hello Templates</h1>
    <p>By Kris on kixx.dev</p>
</article>
```

Use `#with` here because a plain object data section would iterate the object's property values instead of pushing the object itself.

## Delimiters

A set-delimiter tag changes the active delimiters from that point forward in the same template source.

```html
{{=<% %>=}}
<h1><% page.title %></h1>
<p><% page.description %></p>
```

Delimiter changes are scoped to the source being parsed. Partials are parsed independently, so a parent's delimiter change does not affect a partial.

## Whitespace

Kixx follows the Mustache standalone tag rule. When a section, inverted section, comment, partial, or set-delimiter tag is the only non-whitespace content on its line, that whole line is removed from the output.

```html
<ul>
{{#items}}
    <li>{{ . }}</li>
{{/items}}
</ul>
```

The `{{#items}}` and `{{/items}}` lines do not leave blank lines behind.

Interpolation tags render in place and preserve surrounding whitespace. Helper `{{else}}` tags are not standalone-stripped; place them deliberately when exact output matters.

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

Helpers are Kixx extensions. Prefer data sections for simple Mustache rendering. Use helpers when you need block parameters, indexes, keys, truthiness helpers, equality, scope changes, or custom formatting.

| Helper | Type | Description |
| --- | --- | --- |
| `#each` | Block | Iterate arrays, objects, Maps, and Sets with block params |
| `#if` | Block | Render when a value is truthy by Kixx helper rules |
| `#unless` | Block | Render when a value is falsey by Kixx helper rules |
| `#ifEqual` | Block | Compare two values with loose `==` equality |
| `#with` | Block | Push a value onto the context stack |
| `unescape` | Inline | Emit a value without HTML escaping |
| `plusOne` | Inline | Add 1 to a number or numeric string |

`{{else}}` splits any block helper into primary and inverse branches.

Helper calls can span multiple lines. Positional arguments are passed in order; named arguments such as `format="DATETIME_MED"` are collected into the helper's `options` object. Arguments can be paths, quoted strings, integers, booleans, `null`, or `undefined`.

```html
<time datetime='{{ formatDate event.startsAt zone="America/New_York" format="ISO" }}'>
    {{ formatDate event.startsAt
        zone="America/New_York"
        locale="en-US"
        format="DATETIME_FULL"
    }}
</time>
```

### each Helper

`#each` iterates arrays, Maps, Sets, and plain objects with explicit block parameters. The first block parameter is required. Block parameter names are separated by whitespace, not commas.

```javascript
const context = {
    weatherStations: [ 'WXL34', 'WXN59', 'WNG671' ],
};
```

```html
<ol>
{{#each weatherStations as |stationCode index| }}
    <li>
        <span>{{ plusOne index }}.</span>
        <a href="https://www.weather.gov/nwr/sites?site={{ stationCode }}">
            {{ stationCode }}
        </a>
    </li>
{{else}}
    <li>No weather stations configured.</li>
{{/each}}
</ol>
```

The optional second block parameter depends on the iterable type.

| Iterable | Second block parameter |
| --- | --- |
| Array | index |
| Map | key |
| Set | not defined |
| Object | property name |

Map example:

```javascript
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

const context = { airports };
```

```html
<section>
{{#each airports as |airport code| }}
    <article>
        <h2>{{ code }}: {{ airport.name }}</h2>
        <p>Yearly passengers: {{ airport.yearlyPassengersMillions }} million</p>
    </article>
{{else}}
    <p>No airport data available.</p>
{{/each}}
</section>
```

Set example:

```javascript
const context = {
    tags: new Set([ 'airports', 'traffic', 'passengers' ]),
};
```

```html
<p>
{{#each tags as |tag| }}
    <span>{{ tag }}</span>
{{else}}
    <span>No tags</span>
{{/each}}
</p>
```

Object example:

```javascript
const context = {
    headers: {
        Date: 'Thu, 23 Oct 2025 17:07:22 GMT',
        'Content-Type': 'text/html',
        'Content-Length': 199,
    },
};
```

```html
<dl>
{{#each headers as |value key| }}
    <dt>{{ key }}</dt>
    <dd>{{ value }}</dd>
{{else}}
    <dt>Headers</dt>
    <dd>No headers available.</dd>
{{/each}}
</dl>
```

Nested `#each` blocks can still read parent context.

```javascript
const context = {
    gallery: {
        title: 'Album Art',
        images: [
            {
                src: '/assets/follow-the-leader/front.jpg',
                alt: 'Front cover',
                tags: [ 'front', 'cover' ],
            },
            {
                src: '/assets/follow-the-leader/back.jpg',
                alt: 'Back cover',
                tags: [ 'back', 'cover' ],
            },
        ],
    },
};
```

```html
<section>
    <h2>{{ gallery.title }}</h2>

    {{#each gallery.images as |image imageIndex| }}
    <figure>
        <img src="{{ image.src }}" alt="{{ image.alt }}">
        <figcaption>
            <span>Image {{ plusOne imageIndex }}</span>
            {{#each image.tags as |tag| }}
                <span>{{ gallery.title }}: {{ tag }}</span>
            {{/each}}
        </figcaption>
    </figure>
    {{else}}
    <p>No gallery images.</p>
    {{/each}}
</section>
```

### if Helper

`#if` renders the primary branch when the value is truthy by helper rules.

```javascript
const context = {
    user: {
        isLoggedIn: true,
        name: 'Jane Doe',
        role: 'admin',
    },
};
```

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}.</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

Use `#if` to avoid rendering wrapper markup for empty arrays, empty Maps, and empty
Sets.

```html
{{#if profile.links}}
<nav aria-label="Profile links">
    <ul>
    {{#each profile.links as |link| }}
        <li><a href="{{ link.href }}">{{ link.label }}</a></li>
    {{/each}}
    </ul>
</nav>
{{else}}
<p>No profile links available.</p>
{{/if}}
```

### unless Helper

`#unless` renders the primary branch when the value is falsey by helper rules.

```javascript
const context = {
    articles: [],
};
```

```html
{{#unless articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/unless}}
```

It is often clearer to use `#unless` for empty states before rendering a list.

```html
{{#unless profile.links}}
<p>No profile links available.</p>
{{else}}
<ul>
    {{#each profile.links as |link| }}
    <li>
        <a href="{{ link.href }}">{{ link.label }}</a>
    </li>
    {{/each}}
</ul>
{{/unless}}
```

### ifEqual Helper

`#ifEqual` compares two values with loose `==` equality, so `1` and `"1"` are equal.

```javascript
const context = {
    user: {
        role: 'moderator',
    },
};
```

```html
{{#ifEqual user.role "admin"}}
    <a href="/dashboard/admin">Administrator</a>
{{else}}{{#ifEqual user.role "moderator"}}
    <a href="/dashboard/moderator">Moderator</a>
{{else}}
    <a href="/dashboard">Dashboard</a>
{{/ifEqual}}{{/ifEqual}}
```

Keep the nested `{{else}}{{#ifEqual ...}}` tags adjacent when you want switch-like branching without extra whitespace.

### with Helper

`#with` pushes a value onto the context stack. Parent context remains visible.

```javascript
const context = {
    site: {
        name: 'kixx.dev',
    },
    user: {
        profile: {
            name: 'Jane Doe',
            bio: 'Software developer',
            email: 'jane@example.com',
        },
    },
};
```

```html
{{#with user.profile}}
<section>
    <h2>{{ name }}</h2>
    <p>{{ bio }}</p>
    <p>Email: <a href="mailto:{{ email }}">{{ email }}</a></p>
    <p>Published on {{ site.name }}</p>
</section>
{{else}}
<p>No profile information available.</p>
{{/with}}
```

`#with` renders the `{{else}}` branch for falsey values, empty arrays, empty Maps, and empty Sets. An empty plain object renders the primary branch.

`#with` is useful before rendering a partial that expects the nested object's fields to be local names.

```html
{{#each cities as |city| }}
    {{#with city}}
        {{> cards/city.html }}
    {{/with}}
{{else}}
    <p>No cities available.</p>
{{/each}}
```

Partial `application/templates/partials/cards/city.html`:

```html
<article>
    <h2>{{ name }}, {{ state }}</h2>
    <p>Theme: {{ page.theme }}</p>
</article>
```

### unescape Helper

`unescape` emits a value without HTML escaping. It is equivalent to triple-mustache and ampersand tags, but reads as an explicit helper call.

```html
<main>
    {{ unescape body }}
</main>
```

Use it only for trusted or already-sanitized HTML.

### plusOne Helper

`plusOne` adds 1 to a number or numeric string and returns a string. Non-numeric values return an empty string.

```javascript
const context = {
    tracks: [
        { title: 'Follow the Leader' },
        { title: 'Microphone Fiend' },
    ],
};
```

```html
<ol>
{{#each tracks as |track index| }}
    <li value="{{ plusOne index }}">
        {{ plusOne index }}. {{ track.title }}
    </li>
{{/each}}
</ol>
```

## Hyperview Helpers

Hyperview registers these helpers in addition to the core Kixx helpers:

| Helper | Type | Source | Description |
| --- | --- | --- | --- |
| `formatDate` | Inline | `helpers/format-date.js` | Format ISO strings, millisecond timestamps, JavaScript Dates, or Luxon object values |
| `markup` | Inline | `helpers/markup.js` | Convert Markdown text to raw HTML with the vendored `marked` parser |
| `truncate` | Inline | `helpers/truncate.js` | Shorten a string to a maximum character count |

These helpers are available in Hyperview page templates, base templates, partials, page metadata mini templates, and templated `includes`. Metadata mini templates and templated `includes` compile without partials, so avoid `{{> partial }}` inside those fields.

### formatDate Helper

`formatDate` formats date-like values with Luxon.

Syntax:

```html
{{ formatDate dateValue zone="America/New_York" locale="en-US" format="DATETIME_MED" }}
```

Accepted date values:

| Input | Example |
| --- | --- |
| ISO string | `"2025-10-24T23:00:00.000Z"` |
| Millisecond timestamp | `1761346800000` |
| JavaScript `Date` | `new Date("2025-10-24T23:00:00.000Z")` |
| Object for `DateTime.fromObject()` | `{ "year": 2025, "month": 10, "day": 24, "hour": 19 }` |

Named options:

| Option | Default | Description |
| --- | --- | --- |
| `zone` | System default | IANA time zone, such as `America/New_York` |
| `locale` | System locale | BCP 47 locale, such as `en-US` |
| `format` | `DATETIME_SHORT` | Preset name listed below |

The date positional argument must come before named options.

```html
{{!-- Correct --}}
{{ formatDate game.startTime zone="America/New_York" format="DATETIME_MED" }}

{{!-- Incorrect: positional arguments cannot follow named options --}}
{{ formatDate zone="America/New_York" game.startTime format="DATETIME_MED" }}
```

Verbose example:

```javascript
const context = {
    game: {
        homeTeam: 'New York Rangers',
        awayTeam: 'Toronto Maple Leafs',
        startTime: '2025-10-24T23:00:00.000Z',
        publishedAtMillis: 1761346800000,
        createdAtObject: {
            year: 2025,
            month: 10,
            day: 24,
            hour: 19,
            minute: 0,
        },
    },
};
```

```html
<article>
    <h1>{{ game.awayTeam }} at {{ game.homeTeam }}</h1>

    <p>
        Local start:
        <time datetime='{{ formatDate game.startTime zone="America/New_York" format="ISO" }}'>
            {{ formatDate game.startTime
                zone="America/New_York"
                locale="en-US"
                format="DATETIME_MED"
            }}
        </time>
    </p>

    <p>
        Calendar date:
        {{ formatDate game.startTime
            zone="America/New_York"
            locale="en-US"
            format="DATE_HUGE"
        }}
    </p>

    <p>
        Machine date:
        {{ formatDate game.startTime format="ISO_DATE" }}
    </p>

    <p>
        From milliseconds:
        {{ formatDate game.publishedAtMillis
            zone="America/New_York"
            locale="en-US"
            format="TIME_SIMPLE"
        }}
    </p>

    <p>
        From object:
        {{ formatDate game.createdAtObject
            zone="America/New_York"
            locale="en-US"
            format="DATETIME_FULL"
        }}
    </p>
</article>
```

Example output:

```html
<article>
    <h1>Toronto Maple Leafs at New York Rangers</h1>

    <p>
        Local start:
        <time datetime="2025-10-24T19:00:00.000-04:00">
            Oct 24, 2025, 7:00 PM
        </time>
    </p>

    <p>
        Calendar date:
        Friday, October 24, 2025
    </p>

    <p>
        Machine date:
        2025-10-24
    </p>

    <p>
        From milliseconds:
        7:00 PM
    </p>

    <p>
        From object:
        October 24, 2025 at 7:00 PM EDT
    </p>
</article>
```

Empty string, `null`, and `undefined` render as empty strings. Invalid date values render an escaped `Invalid date ...` message.

Format presets:

| Name | Example in `en-US` |
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

### markup Helper

`markup` converts a Markdown string to raw HTML with the vendored `marked` parser.

```javascript
const context = {
    article: {
        title: 'Release Notes',
        body: [
            '# Release Notes',
            '',
            'This release includes:',
            '',
            '- **Server-rendered** page templates',
            '- Markdown includes',
            '- Shared partials',
            '',
            '[Read more](/docs)',
        ].join('\n'),
    },
};
```

```html
<article>
    <h1>{{ article.title }}</h1>
    <div class="article-body">
        {{ markup article.body }}
    </div>
</article>
```

Output:

```html
<article>
    <h1>Release Notes</h1>
    <div class="article-body">
        <h1>Release Notes</h1>
<p>This release includes:</p>
<ul>
<li><strong>Server-rendered</strong> page templates</li>
<li>Markdown includes</li>
<li>Shared partials</li>
</ul>
<p><a href="/docs">Read more</a></p>

    </div>
</article>
```

An empty string renders as an empty string. Non-string values are converted with `toFriendlyString()` instead of being parsed as Markdown.

Warning: `markup` returns raw HTML, and helper return values are not escaped by Kixx. Only use `markup` with trusted Markdown or content that has already been sanitized.

### truncate Helper

`truncate` shortens a string to a maximum character count.

Syntax:

```html
{{ truncate stringValue length }}
{{ truncate stringValue length "... custom suffix ..." }}
{{ truncate stringValue length "" }}
```

Parameters:

| Parameter | Position | Default | Description |
| --- | --- | --- | --- |
| `stringValue` | 1st positional | none | String to truncate |
| `length` | 2nd positional | none | Maximum number of original characters to keep |
| `ellipsis` | 3rd positional | `&hellip;` | Suffix appended only when the string is truncated |

Verbose example:

```javascript
const context = {
    article: {
        title: 'Follow the Leader expanded liner notes',
        summary: 'A detailed guide to the album, its sequencing, and its production history.',
        shortTitle: 'Paid in Full',
        nullSubtitle: null,
    },
};
```

```html
<article>
    <h2>{{ truncate article.title 17 }}</h2>

    <p>
        {{ truncate article.summary 34 " (read more)" }}
    </p>

    <p>
        {{ truncate article.summary 24 "" }}
    </p>

    <h3>{{ truncate article.shortTitle 20 }}</h3>

    {{#if article.nullSubtitle}}
        <p>{{ truncate article.nullSubtitle 20 }}</p>
    {{else}}
        <p>No subtitle.</p>
    {{/if}}
</article>
```

Output:

```html
<article>
    <h2>Follow the Leader&hellip;</h2>

    <p>
        A detailed guide to the album, its (read more)
    </p>

    <p>
        A detailed guide to the
    </p>

    <h3>Paid in Full</h3>

    <p>No subtitle.</p>
</article>
```

If the string is shorter than or equal to `length`, it is returned unchanged. Falsey values return an empty string. Non-string values are converted with `toFriendlyString()`.

Warning: `truncate` returns raw helper output. Do not use it directly on untrusted user input unless that value has already been escaped or sanitized.

## HTML Escaping

Escaped interpolation with `{{ value }}` escapes `&`, `<`, `>`, and `"`.

```javascript
const context = {
    comments: [
        'A normal comment.',
        '<script src="https://example.com/attack.js"></script>',
    ],
};
```

```html
{{#comments}}
<div class="comment">{{ . }}</div>
{{/comments}}
```

Output:

```html
<div class="comment">A normal comment.</div>
<div class="comment">&lt;script src=&quot;https://example.com/attack.js&quot;&gt;&lt;/script&gt;</div>
```

Characters outside that set, including `'`, `` ` ``, and `=`, are not escaped by the default policy.

Use raw output only for trusted content:

```html
<div>{{{ trustedHtml }}}</div>
<div>{{& trustedHtml }}</div>
<div>{{ unescape trustedHtml }}</div>
```

Helper return values are not escaped automatically, even when called with double mustaches. Custom helpers that emit untrusted content must escape it explicitly.

```javascript
import { escapeHTMLChars } from '../templating/mod.js';

export default function strongText(_context, _options, userInput) {
    return `<strong>${ escapeHTMLChars(userInput) }</strong>`;
}
```

The `escapeHTMLChars()` utility converts `null` and `undefined` to an empty string and coerces other non-string values with `String()` before escaping.

## Partials

Partials are reusable templates registered separately from the template that includes them. Include one with `{{> name }}`.

In Hyperview, shared partials live under `application/templates/partials/`. A tag like `{{> website/styles.css }}` resolves to:

```text
application/templates/partials/website/styles.css
```

Base templates live under `application/templates/base-templates/`. Page templates live under the matching `application/pages/` directory.

Base template:

```html
<!doctype html>
<html lang="{{ page.locale }}">
<head>
    {{> website/meta.html }}
    <style>
        {{> website/styles.css }}
    </style>
</head>
<body>
    <header>
        {{> website/navigation.html }}
    </header>

    <main id="main-content">
        {{ unescape body }}
    </main>

    <footer>
        <p>&copy; {{ site.copyrightYear }} {{ site.name }}</p>
    </footer>
</body>
</html>
```

Page template:

```html
<article>
    <header>
        <h1>{{ page.title }}</h1>
        <p>{{ page.description }}</p>
    </header>

    {{#if albums}}
    <ol class="album-list">
        {{#each albums as |album index| }}
            {{> cards/album.html }}
        {{/each}}
    </ol>
    {{else}}
    <p>No albums available.</p>
    {{/if}}
</article>
```

Partial `application/templates/partials/cards/album.html`:

```html
<li>
    <article>
        <h2>
            <a href="{{ album.href }}">
                {{ plusOne index }}. {{ album.title }}
            </a>
        </h2>

        <p>Artist: {{ album.artist }}</p>

        {{#if album.releasedAt}}
        <p>
            Released
            <time datetime='{{ formatDate album.releasedAt zone="America/New_York" format="ISO_DATE" }}'>
                {{ formatDate album.releasedAt
                    zone="America/New_York"
                    locale="en-US"
                    format="DATE_MED"
                }}
            </time>
        </p>
        {{/if}}

        {{#if album.summary}}
        <p>{{ truncate album.summary 140 }}</p>
        {{/if}}
    </article>
</li>
```

The partial inherits the current context stack. In the example above, `album` and `index` come from the surrounding `#each` helper, while root values like `page` and `site` remain reachable.

Additional partial rules:

- Missing partials render as an empty string.
- Partial names are literal. Dynamic partial names are not supported.
- A standalone partial tag propagates its indentation to every line of the partial output.
- Partials are parsed independently, so delimiter changes in a parent do not affect partial syntax.

## Custom Helpers

Core helper signature:

```javascript
function helperName(context, options, ...positionals) {
    return output;
}
```

| Parameter | Description |
| --- | --- |
| `context` | Current frame value |
| `options` | Named arguments, such as `format="long"` as `options.format` |
| `...positionals` | Positional arguments, resolved against the context before the helper runs |

Inline helper:

```javascript
import { escapeHTMLChars } from '../templating/mod.js';

export default function initials(_context, _options, firstName, lastName) {
    const first = String(firstName || '').trim().charAt(0);
    const last = String(lastName || '').trim().charAt(0);
    return escapeHTMLChars(`${ first }${ last }`.toUpperCase());
}
```

Template:

```html
<span class="avatar">{{ initials user.firstName user.lastName }}</span>
```

Block helpers render their body through methods on `this`.

| Property or method | Description |
| --- | --- |
| `this.blockParams` | Names declared with `as |...|` |
| `this.renderPrimary(newContext)` | Render the primary branch |
| `this.renderInverse(newContext)` | Render the `{{else}}` branch |

Block helper:

```javascript
export default function repeat(_context, _options, count) {
    let output = '';

    for (let index = 0; index < count; index += 1) {
        output += this.renderPrimary({ index });
    }

    return output;
}
```

Template:

```html
{{#repeat 3}}
    <span>Item {{ plusOne index }}</span>
{{else}}
    <span>No items.</span>
{{/repeat}}
```

## API Reference

The templating module exports the core compiler functions and built-in helpers.

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
    escapeHTMLChars,
} from './kixx/templating/mod.js';
```

Compile a template with a custom helper and a partial:

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
    escapeHTMLChars,
} from './kixx/templating/mod.js';

function shout(_context, _options, value) {
    return escapeHTMLChars(String(value || '').toUpperCase());
}

const allHelpers = new Map(helpers);
allHelpers.set('shout', shout);

const partials = new Map();

{
    const tokens = tokenize(null, 'partials/track-row.html', `
<li>
    <strong>{{ shout title }}</strong>
    <span>{{ duration }}</span>
</li>
`);
    const tree = buildSyntaxTree(null, tokens);
    const partial = createRenderFunction(null, allHelpers, partials, tree);
    partials.set('track-row.html', partial);
}

const tokens = tokenize(null, 'album.html', `
<article>
    <h1>{{ album.title }}</h1>
    <ol>
    {{#each album.tracks as |track| }}
        {{#with track}}
            {{> track-row.html }}
        {{/with}}
    {{else}}
        <li>No tracks available.</li>
    {{/each}}
    </ol>
</article>
`);

const tree = buildSyntaxTree(null, tokens);
const render = createRenderFunction(null, allHelpers, partials, tree);

const html = render({
    album: {
        title: 'Follow the Leader',
        tracks: [
            { title: 'Follow the Leader', duration: '5:36' },
            { title: 'Microphone Fiend', duration: '5:17' },
        ],
    },
});
```

API notes:

- `tokenize(options, filename, utf8)` accepts `null` options, a filename for error
  messages, and the source string.
- `buildSyntaxTree(options, tokens)` accepts `null` options and the tokens returned by
  `tokenize()`.
- `createRenderFunction(options, helpers, partials, tree)` accepts `null` options or
  `{ escape }` to override the escaped-interpolation policy.
- `helpers` is a `Map` of built-ins. Copy it with `new Map(helpers)` before adding
  custom helpers.
- Partials are resolved at render time from the `partials` map.

## Errors

Malformed templates throw `LineSyntaxError` during tokenization, syntax-tree building,
or helper execution. The error includes the template filename, line number, and start
position when available.

Common causes:

- Unclosed mustaches, comments, brackets, string literals, or block params.
- A block opened but never closed.
- A close tag with no matching open block.
- A close tag whose name does not match the open block.
- A key/value helper argument without a value after `=`.
- A helper throwing while rendering a tag.
