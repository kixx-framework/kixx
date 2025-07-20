# Partials

Partials are reusable template components that allow you to break down large templates into smaller, manageable pieces. They help maintain consistency across your application and reduce code duplication.

## What are Partials?

Partials are template files that can be included within other templates. They inherit the current template context and can be used to create reusable components like headers, footers, navigation menus, and content blocks.

## Basic Usage

### Including a Partial

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
        {{ content }}
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

## Context Inheritance

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

## Registering Partials

To use partials, you need to register them with your template engine:

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

class TemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();

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

// Create engine and register partials
const engine = new TemplateEngine();

// Register partials
engine.registerPartial('header.html', headerSource);
engine.registerPartial('footer.html', footerSource);
engine.registerPartial('user-card.html', userCardSource);
```

## Common Partial Patterns

### Layout Partials

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

### Component Partials

Create reusable UI components:

```html
<!-- button.html -->
<button 
    type="{{ type }}" 
    class="btn btn-{{ variant }} {{ size }}"
    {{#if disabled}}disabled{{/if}}
>
    {{ text }}
</button>

<!-- Usage -->
{{> button.html type="submit" variant="primary" size="large" text="Save Changes" }}
```

### Form Partials

Create reusable form elements:

```html
<!-- form-field.html -->
<div class="form-group">
    <label for="{{ id }}">{{ label }}</label>
    <input 
        type="{{ type }}" 
        id="{{ id }}" 
        name="{{ name }}" 
        value="{{ value }}"
        {{#if required}}required{{/if}}
        class="form-control {{#if error}}error{{/if}}"
    />
    {{#if error}}
        <span class="error-message">{{ error }}</span>
    {{/if}}
</div>

<!-- Usage -->
{{> form-field.html 
    type="email" 
    id="email" 
    name="email" 
    label="Email Address" 
    value=user.email 
    required=true 
}}
```

## Nested Partials

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

## Conditional Partials

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

## Dynamic Partial Names

You can use expressions to determine which partial to include:

```html
<!-- Include different partials based on content type -->
{{> (concat content.type "-card.html") }}

<!-- Or use a helper -->
{{> (getPartialName content.type) }}
```

## Best Practices

### 1. Use Descriptive Names

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

### 2. Keep Partials Focused

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

### 3. Use Consistent Naming Conventions

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

### 4. Organize Partials by Feature

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

### 5. Document Partial Dependencies

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

## Performance Considerations

### 1. Cache Compiled Partials

```javascript
class TemplateEngine {
    #partials = new Map();
    
    registerPartial(name, source) {
        // Only compile if not already cached
        if (!this.#partials.has(name)) {
            const tokens = tokenize(null, name, source);
            const tree = buildSyntaxTree(null, tokens);
            const partial = createRenderFunction(null, this.#helpers, this.#partials, tree);
            this.#partials.set(name, partial);
        }
    }
}
```

### 2. Avoid Deep Nesting

```html
<!-- Good: Shallow nesting -->
{{> header.html }}
<main>{{ content }}</main>
{{> footer.html }}

<!-- Avoid: Deep nesting -->
{{> layout.html }}
    {{> header.html }}
        {{> navigation.html }}
            {{> menu-item.html }}
                {{> submenu.html }}
```

## Common Use Cases

### 1. Page Layouts

```html
<!-- page.html -->
{{> layout.html }}
    <div class="page-content">
        <h1>{{ page.title }}</h1>
        {{ page.content }}
    </div>
{{/layout}}
```

### 2. Form Components

```html
<!-- form.html -->
<form method="POST" action="{{ form.action }}">
    {{#each form.fields as |field|}}
        {{> form-field.html field=field }}
    {{/each}}
    {{> form-submit.html }}
</form>
```

### 3. Content Blocks

```html
<!-- content-block.html -->
<div class="content-block {{ type }}">
    {{#if title}}
        <h2>{{ title }}</h2>
    {{/if}}
    <div class="content">
        {{ content }}
    </div>
</div>
```

## Next Steps

- **[Integration Guide](./integration.md)** - Learn how to integrate partials into your application
- **[Examples](./examples.md)** - See practical examples of partial usage
- **[API Reference](./api-reference.md)** - Complete API documentation 