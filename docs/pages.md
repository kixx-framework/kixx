# Pages

Pages are the core content units in a Kixx application. Each page maps directly to a URL path and lives in its own directory under `pages/`.

## How Pages Work

When a request arrives (and no static file matches), Kixx:

1. Maps the URL pathname to a directory under `pages/`
2. Loads `page.jsonc` for data (optional)
3. Loads `page.html` for the page template (required)
4. Loads any `.md` files for Markdown content sections (optional)
5. Renders the page template with data and Markdown content to produce the page body
6. Wraps the page body in the base template to produce the final HTML response

## URL-to-Directory Mapping

| URL Path | Page Directory |
|---|---|
| `/` | `pages/` |
| `/about/` | `pages/about/` |
| `/about/team/` | `pages/about/team/` |
| `/blog/my-post/` | `pages/blog/my-post/` |

Index files are normalized automatically — `/about/index.html` resolves to the same page as `/about/`.

## Page Directory Contents

| File | Purpose | Required |
|---|---|---|
| `page.jsonc` | Page data (title, description, custom properties) | No |
| `page.html` | Page body template | Yes |
| `*.md` | Markdown content sections | No |

- `page.json` is also accepted (JSONC supports comments; JSON does not)
- `page.xml` is accepted as an alternative to `page.html` for XML output (e.g., sitemaps)

## Creating a Minimal Page

To create a page at `/about/`:

**`pages/about/page.jsonc`**
```jsonc
{
    "title": "About",
    "description": "Learn more about us."
}
```

**`pages/about/page.html`**
```html
<main>
    <h1>About Us</h1>
    <p>Welcome to our page.</p>
</main>
```

That's all. The `baseTemplate` is configured globally in `kixx-config.jsonc` — do not add it to individual `page.jsonc` files unless you need to override the default for a specific page.

## Page Data (`page.jsonc`)

Page data is passed to both the page template and the base template during rendering. If the file is missing, an empty object is used.

### Reserved Properties

These properties have special meaning in the rendering pipeline:

| Property | Type | Description |
|---|---|---|
| `title` | string | HTML `<title>` tag content. Supports template syntax (e.g., `"{{ name }} - My Site"`). |
| `description` | string | Meta description. Supports template syntax. |
| `baseTemplate` | string | Override the global base template for this page (e.g., `"blog.html"`). |
| `templateFilename` | string | Override the page template filename (default: `page.html`). |
| `contentType` | string | Override the response `Content-Type` header. |
| `openGraph` | object | Open Graph metadata (see below). |

### Open Graph Metadata

Open Graph properties are auto-populated from page data if not explicitly set:

```jsonc
{
    "title": "Our Team",
    "description": "Meet the people behind the project.",
    "openGraph": {
        "type": "website",
        "image": {
            "url": "https://example.com/images/team.jpg"
        },
        "twitterImage": {
            "url": "https://example.com/images/team-twitter.jpg"
        }
    }
}
```

If `title` and `description` are set, Open Graph `title`, `description`, and `url` (canonical URL) are filled in automatically.

### Custom Properties

Any properties you add are available in your templates:

```jsonc
{
    "title": "Our Team",
    "description": "Meet the coaches and staff.",
    "teamMembers": [
        { "name": "Alice Johnson", "role": "Head Coach" },
        { "name": "Bob Smith", "role": "Assistant Coach" }
    ]
}
```

### Templated Metadata

The `title` and `description` fields can contain template syntax:

```jsonc
{
    "playerName": "Alex Johnson",
    "title": "{{ playerName }} - Player Profile",
    "description": "Stats and biography for {{ playerName }}."
}
```

## Page Templates (`page.html`)

The page template produces the page body — the content that gets injected into the base template. Templates use Handlebars-style syntax.

### Template Context

The template receives:

- All properties from `page.jsonc`
- A `content` object with rendered Markdown (keyed by filename without `.md`)
- System-added metadata: `canonicalURL`, `href`, `openGraph`
- All registered template helpers and partials

### Basic Template

```html
<main>
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
</main>
```

### Iterating Over Data

```html
<section>
    <h2>Our Team</h2>
    <ul>
        {{#each teamMembers}}
            <li>
                <strong>{{ name }}</strong> — {{ role }}
            </li>
        {{/each}}
    </ul>
</section>
```

### Conditional Content

```html
{{#if featuredImage}}
    <img src="{{ featuredImage.url }}" alt="{{ featuredImage.alt }}">
{{/if}}

{{#unless isPublished}}
    <p class="draft-notice">This page is a draft.</p>
{{/unless}}
```

### Including Partials

```html
<article>
    {{> article-header.html }}
    <div class="body">{{unescape content.body}}</div>
    {{> article-footer.html }}
</article>
```

For partials in subdirectories:

```html
{{> cards/team-member-card.html }}
```

### Rendering Markdown Content

Use `{{unescape ...}}` when outputting Markdown-rendered HTML to prevent double-escaping:

```html
<article>
    <div class="content">
        {{unescape content.body}}
    </div>
    {{#if content.sidebar}}
        <aside>
            {{unescape content.sidebar}}
        </aside>
    {{/if}}
</article>
```

## Markdown Content

You can add Markdown files alongside `page.html`. Each `.md` file becomes a property on the `content` object in your template, keyed by its filename without the `.md` extension.

### Example

Given this page directory:

```
pages/blog/my-post/
├── page.jsonc
├── page.html
├── body.md
└── sidebar.md
```

The template has access to:

- `content.body` — HTML rendered from `body.md`
- `content.sidebar` — HTML rendered from `sidebar.md`

### Template Syntax in Markdown

Markdown files are compiled as templates before being parsed to HTML, so you can use template syntax inside them:

**`body.md`**
```markdown
# {{ title }}

Published by **{{ author }}**.

This is the article content with **bold** and *italic* text.

{{#each highlights}}
- {{ this }}
{{/each}}
```

### Using the Content in Templates

```html
<article>
    <div class="post-body">
        {{unescape content.body}}
    </div>
    <aside class="sidebar">
        {{unescape content.sidebar}}
    </aside>
</article>
```

## Built-in Template Helpers

These helpers are available in all templates:

| Helper | Usage | Description |
|---|---|---|
| `unescape` | `{{unescape html}}` | Output raw HTML (use for rendered Markdown) |
| `formatDate` | `{{formatDate date format='DATE_FULL'}}` | Format a date value |
| `markup` | `{{markup text}}` | Escape HTML characters |
| `truncate` | `{{truncate text 100}}` | Truncate a string to N characters |
| `each` | `{{#each list}}...{{/each}}` | Iterate over arrays |
| `if` | `{{#if condition}}...{{/if}}` | Conditional rendering |
| `unless` | `{{#unless condition}}...{{/unless}}` | Inverse conditional |
| `with` | `{{#with object}}...{{/with}}` | Change context scope |

## Custom Template Helpers

Create custom helpers in `templates/helpers/`. Each file must export a `name` string and a `helper` function:

**`templates/helpers/currency.js`**
```javascript
export const name = 'currency';

export function helper(value, options) {
    const amount = Number(value);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
```

Use it in templates:

```html
<span class="price">{{currency product.price}}</span>
```

## Partials

Partials are reusable template fragments stored in `templates/partials/`. They can be nested in subdirectories:

```
templates/partials/
├── site-header.html
├── site-footer.html
└── cards/
    ├── product-card.html
    └── team-member-card.html
```

Include them with `{{> filename.html}}`:

```html
{{> site-header.html}}
<main>
    {{unescape body}}
</main>
{{> site-footer.html}}
```

Partials can include other partials.

## Base Templates

The base template wraps the page body to produce the final HTML document. It lives in `templates/base-templates/` and receives the full page data object, including the rendered `body` property.

Keep the base template minimal by delegating to partials for major sections:

**`templates/base-templates/base.html`**
```html
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body>
        {{> site-header.html }}
        <div class="site-content">{{unescape body}}</div>
        {{> site-footer.html }}
    </body>
</html>
```

Put SEO meta tags and stylesheet links in `templates/partials/html-header.html`:

**`templates/partials/html-header.html`**
```html
<meta charset="utf-8">

<title>{{ title }}</title>

{{#if description}}
    <meta name="description" content="{{ description }}">
{{/if}}

<meta name="viewport" content="width=device-width, initial-scale=1">

{{#if openGraph.type}}
<meta property="og:type" content="{{ openGraph.type }}">
{{/if}}
{{#if openGraph.title}}
<meta property="og:title" content="{{ openGraph.title }}">
{{/if}}
{{#if openGraph.description}}
<meta property="og:description" content="{{ openGraph.description }}">
{{/if}}
{{#if openGraph.url}}
<meta property="og:url" content="{{ openGraph.url }}">
{{/if}}
{{#if openGraph.image}}
<meta property="og:image" content="{{ openGraph.image.url }}">
{{/if}}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{ title }}">
{{#if description}}
<meta name="twitter:description" content="{{ description }}">
{{/if}}
{{#if openGraph.twitterImage}}
<meta name="twitter:image" content="{{ openGraph.twitterImage.url }}">
{{/if}}

{{#if canonicalURL}}
    <link rel="canonical" href="{{ canonicalURL }}" />
{{/if}}

<link rel="stylesheet" href="/css/styles.css">
```

### Multiple Base Templates

You can have multiple base templates for different layouts. Set `baseTemplate` in `page.jsonc` to override the default:

```jsonc
{
    "title": "Blog Post",
    "baseTemplate": "blog.html"
}
```

Or configure it per-route in your route definition (see [Routing](routing.md)).

## JSON API

By default, pages can also be served as JSON. When a client requests `/about.json` or sends `Accept: application/json`, the page data object is returned as JSON instead of rendering HTML.

This is useful for introspection during development:

- `http://localhost:3000/about.json` — returns page data for `pages/about/`
- `http://localhost:3000/index.json` — returns page data for `pages/` (home page)

To disable JSON responses for a route:

```javascript
handlers: [
    ['HyperviewRequestHandler', { allowJSON: false }],
],
```

## System-Injected Page Properties

The rendering pipeline automatically adds these properties to page data before rendering:

| Property | Description |
|---|---|
| `canonicalURL` | The canonical URL without query string or hash (e.g., `https://example.com/about/`) |
| `href` | The full request URL including query string |
| `openGraph.url` | Same as `canonicalURL` (if not set in page data) |
| `openGraph.type` | Defaults to `"website"` (if not set) |
| `openGraph.title` | Defaults to `title` (if not set) |
| `openGraph.description` | Defaults to `description` (if not set) |
