# Built-in Helpers

Kixx Templating comes with a set of essential helper functions that cover common templating needs. These helpers are designed to be simple, reliable, and cover the most common use cases.

## Available Helpers

| Helper | Type | Description |
|--------|------|-------------|
| `#each` | Block | Iterate over arrays, objects, Maps, and Sets |
| `#if` | Block | Conditional rendering based on truthiness |
| `#ifEqual` | Block | Equality comparison using `==` |
| `#ifEmpty` | Block | Check if a value is empty |
| `noop` | Inline | No-operation helper to prevent automatic HTML entities encoding |

## #each Helper

The `#each` helper allows you to iterate over iterable objects and render content for each item.

### Basic Usage

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
        <p>{{ article.excerpt }}</p>
    </article>
{{/each}}
```

### With Index

```html
{{#each articles as |article, index|}}
    <article class="article-{{ index }}">
        <span class="number">{{ index }}</span>
        <h2>{{ article.title }}</h2>
    </article>
{{/each}}
```

### With Else Block

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
    </article>
{{else}}
    <p>No articles found.</p>
{{/each}}
```

### Supported Data Types

#### Arrays

```html
{{#each ['apple', 'banana', 'cherry'] as |fruit, index|}}
    <li>{{ index }}: {{ fruit }}</li>
{{/each}}
```

#### Objects

```html
{{#each user.preferences as |value, key|}}
    <div>{{ key }}: {{ value }}</div>
{{/each}}
```

#### Maps

```html
{{#each userSettings as |value, key|}}
    <div>{{ key }}: {{ value }}</div>
{{/each}}
```

#### Sets

```html
{{#each tags as |tag|}}
    <span class="tag">{{ tag }}</span>
{{/each}}
```

### Context Inheritance

The `#each` block has access to the parent context:

```html
{{#each articles as |article|}}
    <article>
        <h2>{{ article.title }}</h2>
        <p>By {{ article.author }} for {{ site.name }}</p>
    </article>
{{/each}}
```

## #if Helper

The `#if` helper provides conditional rendering based on the truthiness of a value.

### Basic Usage

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}
```

### Truthiness Rules

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

### Examples

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

## #ifEqual Helper

The `#ifEqual` helper compares two values using `==` equality and renders content conditionally.

### Basic Usage

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

### Multiple Comparisons

```html
{{#ifEqual user.role "admin"}}
    <span>Administrator</span>
{{else}}{{#ifEqual user.role "moderator"}}
    <span>Moderator</span>
{{else}}
    <span>User</span>
{{/ifEqual}}{{/ifEqual}}
```

### Examples

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

## #ifEmpty Helper

The `#ifEmpty` helper checks if a value is empty and renders content accordingly.

### Basic Usage

```html
{{#ifEmpty articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/ifEmpty}}
```

### Empty Value Rules

The `#ifEmpty` helper considers these values as **empty**:
- `false`
- `0`
- `""` (empty string)
- `null`
- `undefined`
- Empty arrays `[]`
- Empty objects `{}`
- Empty Maps and Sets

### Examples

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

## noop Helper

The `noop` helper is a no-operation helper that prevents automatic HTML entity escaping. It's useful when you want to render HTML content without escaping.

### Usage

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

## Helper Combinations

You can combine helpers to create complex conditional logic:

### Nested Conditionals

```html
{{#if user}}
    {{#if user.isAdmin}}
        <div class="admin-panel">
            <h3>Admin Controls</h3>
            {{#each adminActions as |action|}}
                <button>{{ action.name }}</button>
            {{/each}}
        </div>
    {{else}}
        <div class="user-panel">
            <h3>User Controls</h3>
        </div>
    {{/if}}
{{else}}
    <p>Please log in.</p>
{{/if}}
```

### Complex Iteration

```html
{{#if articles}}
    {{#each articles as |article, index|}}
        <article class="article-{{ index }}">
            <h2>{{ article.title }}</h2>
            
            {{#if article.tags}}
                <div class="tags">
                    {{#each article.tags as |tag|}}
                        <span class="tag">{{ tag }}</span>
                    {{/each}}
                </div>
            {{/if}}
            
            {{#ifEqual article.status "published"}}
                <span class="published">Published</span>
            {{else}}
                <span class="draft">Draft</span>
            {{/ifEqual}}
        </article>
    {{/each}}
{{else}}
    <p>No articles found.</p>
{{/if}}
```

## Best Practices

### 1. Use Descriptive Block Parameters

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

### 2. Combine Helpers for Complex Logic

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

### 3. Use Else Blocks for Better UX

```html
{{#if articles}}
    {{#each articles as |article|}}
        <article>{{ article.title }}</article>
    {{/each}}
{{else}}
    <p>No articles available. <a href="/create">Create one</a>?</p>
{{/if}}
```

### 4. Validate Data Before Rendering

```javascript
// In your application code
const context = {
    articles: articles || [],
    user: user || null
};
```

## Next Steps

- **[Custom Helpers](./custom-helpers.md)** - Learn how to create your own helper functions
- **[Examples](./examples.md)** - See practical examples of helper usage
- **[API Reference](./api-reference.md)** - Complete API documentation 