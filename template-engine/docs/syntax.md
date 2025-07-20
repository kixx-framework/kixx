# Template Syntax

Kixx Templating uses a clean, intuitive syntax based on mustache-style templating. This guide covers all the syntax elements you can use in your templates.

## Basic Expressions

The most fundamental syntax element is the expression, which allows you to output values from your context.

### Simple Variable Output

```html
<h1>{{ title }}</h1>
<p>Welcome, {{ user.name }}!</p>
```

### Nested Property Access

```html
<p>{{ article.author.firstName }} {{ article.author.lastName }}</p>
<p>Published: {{ article.metadata.publishDate }}</p>
```

### Array and Object Access

```html
<!-- Array access -->
<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />

<!-- Object property access -->
<span>{{ user.preferences.theme }}</span>

<!-- Mixed access -->
<p>{{ articles[0].comments[2].author.name }}</p>
```

## Comments

Comments are useful for documentation and debugging. They don't appear in the final output.

### Single Line Comments

```html
{{!-- This is a single line comment --}}
<h1>{{ title }}</h1>
```

### Multi-line Comments

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

## Helpers

Helpers are functions that can transform data or provide conditional logic. They come in two types: inline helpers and block helpers.

### Inline Helpers

Inline helpers are used for data transformation and formatting.

```html
<!-- Basic helper usage -->
<p>{{ format_date article.publishDate }}</p>

<!-- Helper with arguments -->
<p>{{ format_date article.publishDate format="long" timezone="UTC" }}</p>

<!-- Helper with multiple arguments -->
<img src="{{ image article.image width=800 height=600 quality="high" }}" />
```

### Block Helpers

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

### Helper Arguments

Helpers can accept different types of arguments:

#### Positional Arguments

```html
{{ format_date "2023-12-25" "long" "America/New_York" }}
```

#### Named Arguments (Hash)

```html
{{ format_date article.date format="long" timezone="America/New_York" locale="en-US" }}
```

#### Mixed Arguments

```html
{{ image article.image 800 600 quality="high" format="webp" }}
```

## Partials

Partials allow you to include other templates within your current template.

### Basic Partial Usage

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

### Partials with Context

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

## Advanced Syntax Features

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

### String Literals

You can use string literals in helper arguments:

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{/ifEqual}}

{{ format_date "2023-12-25" format="long" }}
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

## Best Practices

### 1. Use Descriptive Variable Names

```html
<!-- Good -->
<h1>{{ article.title }}</h1>
<p>By {{ article.author.name }}</p>

<!-- Avoid -->
<h1>{{ t }}</h1>
<p>By {{ a.n }}</p>
```

### 2. Keep Templates Readable

```html
<!-- Good: Multi-line for complex helpers -->
{{#each articles as |article, index|}}
    <article class="article-item">
        <h2>{{ article.title }}</h2>
        <p>{{ article.excerpt }}</p>
    </article>
{{/each}}

<!-- Avoid: Everything on one line -->
{{#each articles as |article, index|}}<article><h2>{{ article.title }}</h2><p>{{ article.excerpt }}</p></article>{{/each}}
```

### 3. Use Comments for Complex Logic

```html
{{!-- Only show admin panel for admin users --}}
{{#if user.isAdmin}}
    {{!-- Include admin-specific partial --}}
    {{> admin-panel.html }}
{{/if}}
```

### 4. Organize with Partials

Break large templates into smaller, reusable partials:

```html
<!-- main.html -->
<!DOCTYPE html>
<html>
    {{> head.html }}
    <body>
        {{> header.html }}
        <main>{{ content }}</main>
        {{> footer.html }}
    </body>
</html>
```

### 5. Validate Your Data

Always ensure your context object contains the expected properties before rendering:

```javascript
// In your application code
const context = {
    user: user || { name: 'Guest' },
    articles: articles || []
};

const html = render(context);
```

## Syntax Reference

| Syntax | Description | Example |
|--------|-------------|---------|
| `{{ variable }}` | Output variable | `{{ title }}` |
| `{{ object.property }}` | Nested property | `{{ user.name }}` |
| `{{ array[0] }}` | Array access | `{{ images[0] }}` |
| `{{ helper arg1 arg2 }}` | Inline helper | `{{ format_date date }}` |
| `{{ helper key=value }}` | Named arguments | `{{ image src width=800 }}` |
| `{{#helper}}...{{/helper}}` | Block helper | `{{#if condition}}...{{/if}}` |
| `{{> partial.html }}` | Partial include | `{{> header.html }}` |
| `{{!-- comment --}}` | Comment | `{{!-- This is a comment --}}` |

## Next Steps

- **[Built-in Helpers](./built-in-helpers.md)** - Learn about the provided helper functions
- **[Custom Helpers](./custom-helpers.md)** - Create your own helper functions
- **[Examples](./examples.md)** - See practical examples of template syntax 