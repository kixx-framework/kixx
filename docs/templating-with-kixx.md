# Templating with Kixx
A comprehensive developer guide for building server-side rendered web applications using the Kixx templating system.

- [Architecture](#architecture)
- [Template File Structure](#template-file-structure)
- [Template Syntax](#template-syntax)
- [HTML Entity Escaping](#html-entity-escaping)
- [Error Handling](#error-handling)
- [Built-in Helpers](#built-in-helpers)
- [Partials](#partials)
- [Custom Helpers](#custom-helpers)

## Architecture
The Kixx templating system follows a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
├─────────────────────────────────────────────────────────────┤
│                    View Service                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Page Data     │  │  Page Template  │  │ Base Template│ │
│  │   Loading       │  │   Engine        │  │   Engine     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Template Engine                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │    Tokenize     │  │ Build Syntax    │  │ Create Render│ │
│  │                 │  │ Tree            │  │ Function     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **Template Engine** (`template-engine/`): Core templating primitives
2. **View Service** (`view-service/`): High-level template management
3. **Page Template Engine**: Dynamic template loading and compilation
4. **Helpers**: Built-in and custom helper functions
5. **Partials**: Reusable template components

## Template File Structure
Kixx applications follow a structured template organization:

```
your-app/
├── templates/
│   ├── templates/
│   │   └── base.html          # Base layout template
│   ├── partials/
│   │   ├── html-header.html   # Head section
│   │   ├── site-header.html   # Navigation header
│   │   ├── site-footer.html   # Footer
│   │   └── components/        # Reusable components
│   └── helpers/
│       ├── format_date.js     # Custom helpers
│       └── format_currency.js
├── pages/
│   ├── page.json              # Site-wide page data
│   ├── page.html              # Home page template
│   ├── about/
│   │   ├── page.json          # Page-specific data
│   │   └── page.html          # Page template
│   └── contact/
│       ├── page.json
│       └── page.html
└── site-page-data.json        # Global site data
```

### Base Template

The base template defines the overall HTML structure:

```html
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body id="site-layout">
        {{> site-header.html }}
        <!-- START Main Content Container -->
        <div class="page-body">{{noop body }}</div>
        <!-- END Main Content Container -->
        {{> site-footer.html }}
    </body>
</html>
```

**Note**: The `{{noop body }}` helper prevents HTML escaping for the main content, since it contains rendered HTML from page templates.

### Page Templates

Page templates contain the main content for each page:

```html
<!-- pages/about/page.html -->
<article class="site-width-container">
    <header>
        <h1>{{ page.title }}</h1>
        {{#if page.subtitle}}
            <p class="subtitle">{{ page.subtitle }}</p>
        {{/if}}
    </header>
    
    <div class="content">
        {{ page.content }}
    </div>
    
    {{#if page.relatedPages}}
        <aside class="related-pages">
            <h3>Related Pages</h3>
            <ul>
                {{#each page.relatedPages as |relatedPage|}}
                    <li><a href="{{ relatedPage.url }}">{{ relatedPage.title }}</a></li>
                {{/each}}
            </ul>
        </aside>
    {{/if}}
</article>
```

## Template Syntax
Kixx Templating uses a clean, intuitive syntax based on mustache-style templating.

### Basic Expressions
The most fundamental syntax element is the expression, which allows you to output values from your context.

#### Simple Variable Output
```html
<h1>{{ title }}</h1>
<p>Welcome, {{ user.name }}!</p>
```

#### Nested Property Access
```html
<p>{{ article.author.firstName }} {{ article.author.lastName }}</p>
<p>Published: {{ article.metadata.publishDate }}</p>
```
#### Array and Object Access

```html
<!-- Array access -->
<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />

<!-- Object property access -->
<span>{{ user.preferences.theme }}</span>

<!-- Mixed access -->
<p>{{ articles[0].comments[2].author.name }}</p>
```

### Comments

Comments are useful for documentation and debugging. They don't appear in the final output.

#### Single Line Comments

```html
{{!-- This is a single line comment --}}
<h1>{{ title }}</h1>
```

#### Multi-line Comments

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

### Multi-line Expressions

Expressions can span multiple lines for better readability:

```html
{{image
    article.featuredImage.src
    article.featuredImage.alt
    width=800
    height=600
    class="featured-image"
    }}
```

### Bracket Notation

Use bracket notation for property names with special characters:

```html
<!-- Access properties with spaces or special characters -->
<p>{{ article["Published Date"] }}</p>
<p>{{ user["email-verified"] }}</p>
```

## HTML Entity Escaping

Kixx Templating automatically escapes HTML entities for security, but the behavior differs between expressions and helpers:

### Expression Escaping

When you use simple expressions (variable output), HTML entities are automatically escaped:

```html
<!-- This will escape HTML entities -->
<p>{{ userInput }}</p>

<!-- If userInput contains "<script>alert('xss')</script>" -->
<!-- Output: <p>&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;</p> -->
```

### Helper Escaping

Helper functions return their output **without** automatic HTML escaping:

```html
<!-- Helper output is NOT automatically escaped -->
<p>{{ formatHtml userInput }}</p>

<!-- If formatHtml returns "<strong>Bold text</strong>" -->
<!-- Output: <p><strong>Bold text</strong></p> -->
```

### Using noop Helper to Prevent Escaping

The `noop` helper can be used to prevent automatic HTML entity escaping for expressions:

```html
<!-- This will NOT escape HTML entities -->
<p>{{noop userInput }}</p>

<!-- If userInput contains "<script>alert('xss')</script>" -->
<!-- Output: <p><script>alert('xss')</script></p> -->
```

**⚠️ Security Warning:** Only use `noop` when you trust the content and want to render HTML. Never use it with untrusted user input.

### Safe HTML Rendering

For trusted HTML content, you can use helpers or `noop`:

```html
<!-- Safe: Using a helper for trusted HTML -->
<p>{{ renderMarkdown article.content }}</p>

<!-- Safe: Using noop for trusted HTML -->
<p>{{noop trustedHtmlContent }}</p>

<!-- Unsafe: Using noop with untrusted content -->
<p>{{noop userComment }}</p> <!-- DON'T DO THIS -->
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

## Built-in Helpers
Kixx comes with a set of essential helper functions that cover common templating needs.

| Helper | Type | Description |
|--------|------|-------------|
| `#each` | Block | Iterate over arrays, objects, Maps, and Sets |
| `#if` | Block | Conditional rendering based on truthiness |
| `#ifEqual` | Block | Equality comparison using `==` |
| `#ifEmpty` | Block | Check if a value is empty |
| `format_date` | Inline | Format JavaScript dates and date strings |
| `noop` | Inline | No-operation helper to prevent automatic HTML entities encoding |

### #each Helper

The `#each` helper allows you to iterate over iterable objects and render content for each item.

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
        <p>{{ article.excerpt }}</p>
    </article>
{{/each}}
```

**With Index**

```html
{{#each articles as |article, index|}}
    <article class="article-{{ index }}">
        <span class="number">{{ index }}</span>
        <h2>{{ article.title }}</h2>
    </article>
{{/each}}
```

**With Else Block**

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
    </article>
{{else}}
    <p>No articles found.</p>
{{/each}}
```

#### Supported Data Types

**Arrays**

```html
{{#each ['apple', 'banana', 'cherry'] as |fruit, index|}}
    <li>{{ index }}: {{ fruit }}</li>
{{/each}}
```

**Objects**

```html
{{#each user.preferences as |value, key|}}
    <div>{{ key }}: {{ value }}</div>
{{/each}}
```

**Maps**

```html
{{#each userSettings as |value, key|}}
    <div>{{ key }}: {{ value }}</div>
{{/each}}
```

**Sets**

```html
{{#each tags as |tag|}}
    <span class="tag">{{ tag }}</span>
{{/each}}
```

#### Context Inheritance

The `#each` block has access to the parent context:

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
        <p>By {{ article.author }} for {{ site.name }}</p>
    </article>
{{/each}}
```

### #if Helper
The `#if` helper provides conditional rendering based on the truthiness of a value.

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

#### Truthiness Rules
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

```html
<!-- String check -->
{{#if user.name}}
    <p>Hello, {{ user.name }}!</p>
{{/if}}

<!-- Array check -->
{{#if articles}}
    <p>Found {{ articles.length }} articles.</p>
{{else}}
    <p>No articles available.</p>
{{/if}}

<!-- Object check -->
{{#if user.preferences}}
    <p>User has preferences set.</p>
{{/if}}

<!-- Number check -->
{{#if article.viewCount}}
    <p>Viewed {{ article.viewCount }} times.</p>
{{/if}}
```

### #ifEqual Helper
The `#ifEqual` helper compares two values using `==` equality and renders content conditionally.

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

#### Multiple Comparisons
```html
{{#ifEqual user.role "admin"}}
    <span>Administrator</span>
{{else}}{{#ifEqual user.role "moderator"}}
    <span>Moderator</span>
{{else}}
    <span>User</span>
{{/ifEqual}}{{/ifEqual}}
```

#### Examples

```html
<!-- String comparison -->
{{#ifEqual article.status "published"}}
    <span class="published">Published</span>
{{/ifEqual}}

<!-- Number comparison -->
{{#ifEqual article.viewCount 0}}
    <span class="unviewed">Not viewed yet</span>
{{/ifEqual}}

<!-- Boolean comparison -->
{{#ifEqual user.isVerified true}}
    <span class="verified">✓ Verified</span>
{{/ifEqual}}
```

### #ifEmpty Helper

The `#ifEmpty` helper checks if a value is empty and renders content accordingly.

#### Basic Usage

```html
{{#ifEmpty articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/ifEmpty}}
```

#### Empty Value Rules
The `#ifEmpty` helper considers these values as **empty**:

- `false`
- `0`
- `""` (empty string)
- `null`
- `undefined`
- Empty arrays `[]`
- Empty objects `{}`
- Empty Maps and Sets

#### Examples
```html
<!-- Array check -->
{{#ifEmpty user.posts}}
    <p>No posts yet.</p>
{{else}}
    <p>{{ user.posts.length }} posts</p>
{{/ifEmpty}}

<!-- String check -->
{{#ifEmpty user.bio}}
    <p>No bio provided.</p>
{{else}}
    <p>{{ user.bio }}</p>
{{/ifEmpty}}

<!-- Object check -->
{{#ifEmpty user.preferences}}
    <p>No preferences set.</p>
{{else}}
    <p>Preferences configured</p>
{{/ifEmpty}}
```

### noop Helper
The `noop` helper is a no-operation helper that prevents automatic HTML entity escaping. It's useful when you want to render HTML content without escaping.

```html
<!-- Prevent HTML entity escaping for trusted content -->
<p>{{noop trustedHtmlContent }}</p>

<!-- Render HTML from a helper without double-escaping -->
<div>{{noop renderMarkdown article.content }}</div>

<!-- Debug: check if variable exists (returns empty string) -->
{{noop user.name }}
```

### Security Considerations

**⚠️ Important:** Only use `noop` with content you trust. Never use it with untrusted user input as it can lead to XSS attacks.

```html
<!-- Safe: Trusted content -->
<p>{{noop adminMessage }}</p>

<!-- Unsafe: Untrusted user input -->
<p>{{noop userComment }}</p> <!-- DON'T DO THIS -->
```

### format_date Helper

Kixx includes a built-in `format_date` helper:

```html
{{!-- Basic usage --}}
<p>Published: {{ format_date article.publishDate }}</p>

{{!-- With format options --}}
<p>Year: {{ format_date article.publishDate format="YEAR" }}</p>
<p>Short date: {{ format_date article.publishDate format="DATE_MONTH_DATE" }}</p>
<p>ISO format: {{ format_date article.publishDate format="ISO" }}</p>

{{!-- With timezone and locale --}}
<p>{{ format_date article.publishDate format="DATETIME_FULL" zone="America/New_York" locale="en-US" }}</p>
```

### Best Practices

#### 1. Use Descriptive Block Parameters

```html
<!-- Good -->
{{#each articles as |article, index|}}
    <article>{{ article.title }}</article>
{{/each}}

<!-- Avoid -->
{{#each articles as |a, i|}}
    <article>{{ a.title }}</article>
{{/each}}
```

#### 2. Combine Helpers for Complex Logic

```html
{{#if user}}
    {{#ifEqual user.role "admin"}}
        {{#each adminFeatures as |feature|}}
            <div>{{ feature.name }}</div>
        {{/each}}
    {{else}}
        {{#each userFeatures as |feature|}}
            <div>{{ feature.name }}</div>
        {{/each}}
    {{/ifEqual}}
{{/if}}
```

#### 3. Use Else Blocks for Better UX

```html
{{#if articles}}
    {{#each articles as |article|}}
        <article>{{ article.title }}</article>
    {{/each}}
{{else}}
    <p>No articles available. <a href="/create">Create one</a>?</p>
{{/if}}
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
