# Templating with Kixx

A comprehensive developer guide for building server-side rendered web applications using Kixx's templating system.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Template Engine Fundamentals](#template-engine-fundamentals)
4. [View Service Integration](#view-service-integration)
5. [Template Structure](#template-structure)
6. [Template Syntax](#template-syntax)
7. [Built-in Helpers](#built-in-helpers)
8. [Custom Helpers](#custom-helpers)
9. [Partials](#partials)
10. [Data Flow](#data-flow)
11. [Page Templates](#page-templates)
12. [Best Practices](#best-practices)
13. [Advanced Patterns](#advanced-patterns)
14. [Troubleshooting](#troubleshooting)

## Overview

Kixx provides a robust server-side templating system designed for building hypermedia-driven web applications. The templating system consists of:

- **Template Engine**: A lightweight, dependency-free template engine with mustache-style syntax
- **View Service**: High-level integration layer for loading, merging, and rendering templates
- **Page Template Engine**: Dynamic template loading and compilation system
- **Helper System**: Extensible helper functions for data transformation and formatting

### Key Features

- **Server-side rendering** with progressive enhancement
- **Mustache-style syntax** for clean, readable templates
- **Automatic HTML escaping** for security
- **Dynamic template loading** from file system
- **Extensible helper system** with custom helpers
- **Partial support** for reusable components
- **Data merging** from multiple sources
- **Error handling** with graceful fallbacks

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

## Template Engine Fundamentals

The Kixx template engine is built on three core primitives:

### 1. Tokenization

```javascript
import { tokenize } from 'kixx-templating';

const source = '<h1>{{ title }}</h1>';
const tokens = tokenize(null, 'template.html', source);
```

### 2. Syntax Tree Building

```javascript
import { buildSyntaxTree } from 'kixx-templating';

const tree = buildSyntaxTree(null, tokens);
```

### 3. Render Function Creation

```javascript
import { createRenderFunction, helpers } from 'kixx-templating';

const render = createRenderFunction(null, helpers, partials, tree);
const html = render(context);
```

### Basic Usage

```javascript
import { 
    tokenize, 
    buildSyntaxTree, 
    createRenderFunction, 
    helpers 
} from 'kixx-templating';

class SimpleTemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();

    compile(source) {
        const tokens = tokenize(null, 'template.html', source);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.#helpers, this.#partials, tree);
    }
}

// Usage
const engine = new SimpleTemplateEngine();
const template = '<h1>{{ title }}</h1><p>{{ content }}</p>';
const render = engine.compile(template);
const html = render({ title: 'Hello', content: 'World' });
```

## View Service Integration

The View Service provides a high-level API for template management in Kixx applications.

### View Service Setup

```javascript
import ViewService from './view-service/view-service.js';

const viewService = new ViewService({
    logger: logger,
    pageDirectory: './pages',
    sitePageDataFilepath: './site-page-data.json',
    templatesDirectory: './templates/templates',
    partialsDirectory: './templates/partials',
    helpersDirectory: './templates/helpers'
});
```

### Core Methods

#### 1. Loading Page Data

```javascript
// Load and merge page data
const pageData = await viewService.getPageData('/about', {
    custom: 'value',
    dynamic: 'data'
});
```

#### 2. Rendering Page Markup

```javascript
// Render page HTML
const html = await viewService.getPageMarkup('/about', pageData);
```

#### 3. Error Page Rendering

```javascript
// Render error pages with fallback
const errorHtml = await viewService.renderMarkupForError(error);
```

### Data Merging

The View Service merges data from multiple sources:

```javascript
// Merging order (later sources override earlier ones)
const finalData = {
    ...sitePageData,        // site-page-data.json
    ...pageData,           // pages/*/page.json
    ...dynamicProps        // From request handlers
};
```

## Template Structure

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

Kixx uses mustache-style syntax with some enhancements.

### Basic Expressions

```html
<!-- Simple variable output -->
<h1>{{ title }}</h1>

<!-- Nested property access -->
<p>By {{ article.author.name }}</p>

<!-- Array access -->
<img src="{{ images[0].src }}" alt="{{ images[0].alt }}" />
```

### Comments

```html
{{!-- This is a comment that won't appear in output --}}

{{!-- 
    Multi-line comments
    can span multiple lines
--}}
```

### Conditional Rendering

```html
{{#if user.isLoggedIn}}
    <p>Welcome back, {{ user.name }}!</p>
    <a href="/logout">Logout</a>
{{else}}
    <p>Please <a href="/login">log in</a>.</p>
{{/if}}

{{#if articles}}
    <p>Found {{ articles.length }} articles.</p>
{{else}}
    <p>No articles available.</p>
{{/if}}
```

### Iteration

```html
{{#each articles as |article, index|}}
    <article class="article-{{ index }}">
        <h2>{{ article.title }}</h2>
        <p>{{ article.excerpt }}</p>
        {{#if article.tags}}
            <div class="tags">
                {{#each article.tags as |tag|}}
                    <span class="tag">{{ tag }}</span>
                {{/each}}
            </div>
        {{/if}}
    </article>
{{else}}
    <p>No articles found.</p>
{{/each}}
```

### Partials

```html
{{!-- Include a partial --}}
{{> header.html }}

{{!-- Partials inherit the current context --}}
{{#each users as |user|}}
    {{> user-card.html }}
{{/each}}
```

## Built-in Helpers

Kixx provides essential built-in helpers:

### #if Helper

```html
{{#if condition}}
    <!-- Content when condition is truthy -->
{{else}}
    <!-- Content when condition is falsy -->
{{/if}}
```

**Truthy values**: Non-empty strings, non-zero numbers, `true`, non-empty arrays/objects
**Falsy values**: `false`, `0`, `""`, `null`, `undefined`, empty arrays/objects

### #each Helper

```html
{{#each items as |item, index|}}
    <div class="item-{{ index }}">{{ item.name }}</div>
{{else}}
    <p>No items found.</p>
{{/each}}
```

Supports arrays, objects, Maps, and Sets.

### #ifEqual Helper

```html
{{#ifEqual user.role "admin"}}
    <span class="admin-badge">Administrator</span>
{{else}}
    <span class="user-badge">User</span>
{{/ifEqual}}
```

### #ifEmpty Helper

```html
{{#ifEmpty articles}}
    <p>No articles available.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/ifEmpty}}
```

### noop Helper

```html
<!-- Prevent HTML entity escaping for trusted content -->
<div>{{noop trustedHtmlContent }}</div>

<!-- Render HTML from helpers without double-escaping -->
<div>{{noop renderMarkdown article.content }}</div>
```

**⚠️ Security Warning**: Only use `noop` with trusted content to prevent XSS attacks.

## Custom Helpers

Custom helpers extend template functionality for application-specific needs.

### Helper Structure

```javascript
// templates/helpers/format_date.js
export const name = 'format_date';

export function helper(context, options, date) {
    // Helper implementation
    const format = options.hash.format || 'default';
    
    if (!date) return '';
    
    const dt = new Date(date);
    
    switch (format) {
        case 'YEAR':
            return dt.getFullYear().toString();
        case 'DATE_MONTH_DATE':
            return dt.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
        default:
            return dt.toLocaleDateString();
    }
}
```

### Helper Parameters

- `context`: The template context object
- `options`: Helper options including `options.hash` for named arguments
- `...args`: Positional arguments passed to the helper

### Example: Event Duration Helper

```javascript
// templates/helpers/event_duration.js
import DateTime from '../../vendor/luxon/datetime.js';

export const name = 'event_duration';

export function helper(context, options, start, end) {
    const startDateTime = DateTime.fromISO(start);
    const endDateTime = DateTime.fromISO(end);
    const diff = endDateTime.diff(startDateTime, ['hours', 'minutes']);
    const { hours, minutes } = diff;

    let hoursText = '';
    if (hours === 1) {
        hoursText = '1hr';
    } else if (hours > 1) {
        hoursText = `${hours}hrs`;
    }

    let minutesText = '';
    if (minutes > 0) {
        minutesText = `${minutes}min`;
    }

    if (hoursText && minutesText) {
        return `${hoursText} ${minutesText}`;
    }

    return hoursText || minutesText;
}
```

### Usage in Templates

```html
{{!-- Using the event duration helper --}}
<div class="event-duration">
    Duration: {{ event_duration event.startTime event.endTime }}
</div>
```

### Built-in Date Helper

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

## Partials

Partials are reusable template components that help maintain consistency and reduce duplication.

### Creating Partials

```html
<!-- templates/partials/html-header.html -->
<meta charset="utf-8">
<title>{{ page.title }}</title>

{{#if page.description}}
    <meta name="description" content="{{ page.description }}">
{{/if}}

<meta name="viewport" content="width=device-width, initial-scale=1">

{{#if page.openGraph}}
    {{#if page.openGraph.type}}
        <meta property="og:type" content="{{ page.openGraph.type }}">
    {{/if}}
    {{#if page.openGraph.title}}
        <meta property="og:title" content="{{ page.openGraph.title }}">
    {{/if}}
    {{#if page.openGraph.image}}
        <meta property="og:image" content="{{ page.openGraph.image.url }}">
    {{/if}}
{{/if}}

<link rel="stylesheet" href="/css/main.css">
```

### Using Partials

```html
<!-- In base template -->
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body>
        {{> site-header.html }}
        <main>{{noop body }}</main>
        {{> site-footer.html }}
    </body>
</html>
```

### Component Partials

Create reusable UI components:

```html
<!-- templates/partials/components/button.html -->
<button 
    type="{{ type }}" 
    class="btn btn-{{ variant }} {{ size }}"
    {{#if disabled}}disabled{{/if}}
    {{#if data}}data-{{ data.name }}="{{ data.value }}"{{/if}}
>
    {{#if icon}}<span class="icon">{{ icon }}</span>{{/if}}
    <span class="button__label">{{ label }}</span>
</button>

<!-- Usage -->
{{> components/button.html 
    type="submit" 
    variant="primary" 
    size="large" 
    label="Save Changes" 
    icon="save"
}}
```

### Conditional Partials

```html
{{!-- Include different partials based on context --}}
{{#if user.isAdmin}}
    {{> admin-panel.html }}
{{else}}
    {{> user-panel.html }}
{{/if}}

{{#if showSidebar}}
    {{> sidebar.html }}
{{/if}}
```

## Data Flow

Understanding data flow is crucial for effective templating.

### Data Sources

1. **Site-wide data** (`site-page-data.json`)
2. **Page-specific data** (`pages/*/page.json`)
3. **Dynamic data** (from request handlers)
4. **Configuration data** (`kixx-config.json`)

### Data Merging Example

```javascript
// site-page-data.json
{
    "site": {
        "name": "My Application",
        "description": "A great application"
    },
    "contactInfo": {
        "phone": {
            "raw": "555-123-4567",
            "formatted": "(555) 123-4567"
        }
    },
    "nav_menu_sections": [
        {
            "label": "Main",
            "pages": [
                { "url": "/", "label": "Home" },
                { "url": "/about", "label": "About" }
            ]
        }
    ]
}

// pages/about/page.json
{
    "page": {
        "title": "About Us",
        "description": "Learn more about our company"
    },
    "team": [
        { "name": "John Doe", "role": "CEO" },
        { "name": "Jane Smith", "role": "CTO" }
    ]
}

// Dynamic data from handler
{
    "currentUser": { "name": "Alice", "role": "admin" },
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### Final Merged Data

```javascript
{
    // From site-page-data.json
    "site": { "name": "My Application", "description": "A great application" },
    "contactInfo": { "phone": { "raw": "555-123-4567", "formatted": "(555) 123-4567" } },
    "nav_menu_sections": [...],
    
    // From pages/about/page.json
    "page": { "title": "About Us", "description": "Learn more about our company" },
    "team": [...],
    
    // From dynamic data
    "currentUser": { "name": "Alice", "role": "admin" },
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### Accessing Data in Templates

```html
<!-- Site-wide data -->
<title>{{ page.title }} - {{ site.name }}</title>

<!-- Contact information -->
<a href="tel:{{ contactInfo.phone.raw }}">
    {{ contactInfo.phone.formatted }}
</a>

<!-- Navigation -->
<nav>
    {{#each nav_menu_sections as |section|}}
        <div class="nav-section">
            <h3>{{ section.label }}</h3>
            <ul>
                {{#each section.pages as |page|}}
                    <li><a href="{{ page.url }}">{{ page.label }}</a></li>
                {{/each}}
            </ul>
        </div>
    {{/each}}
</nav>

<!-- Dynamic data -->
{{#if currentUser}}
    <p>Welcome, {{ currentUser.name }}!</p>
{{/if}}
```

## Page Templates

Page templates are the core content templates for each page in your application.

### Page Template Structure

```
pages/
├── page.html              # Home page
├── page.json              # Home page data
├── about/
│   ├── page.html          # About page template
│   └── page.json          # About page data
├── blog/
│   ├── page.html          # Blog listing template
│   ├── page.json          # Blog listing data
│   └── post/
│       ├── page.html      # Individual post template
│       └── page.json      # Post data
└── contact/
    ├── page.html          # Contact page template
    └── page.json          # Contact page data
```

### Home Page Template

```html
<!-- pages/page.html -->
<div class="hero-banner inverted-background">
    <img src="{{ page.heroImage.url }}" 
         alt="{{ page.heroImage.alt }}"
         style="object-position: {{ page.heroImage.position }};">
</div>

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

    {{#if page.featuredContent}}
        <section class="featured-content">
            <h2>Featured</h2>
            {{#each page.featuredContent as |item|}}
                {{> content-card.html item=item }}
            {{/each}}
        </section>
    {{/if}}
</article>
```

### Blog Post Template

```html
<!-- pages/blog/post/page.html -->
<article class="site-width-container">
    <header class="post-header">
        <h1>{{ page.title }}</h1>
        <div class="post-meta">
            <time datetime="{{ page.publishDate }}">
                {{ format_date page.publishDate format="DATE_MED_WITH_WEEKDAY" }}
            </time>
            {{#if page.author}}
                <span class="author">by {{ page.author.name }}</span>
            {{/if}}
        </div>
    </header>

    <div class="post-content">
        {{noop page.content }}
    </div>

    {{#if page.tags}}
        <footer class="post-footer">
            <div class="tags">
                {{#each page.tags as |tag|}}
                    <a href="/blog/tag/{{ tag.slug }}" class="tag">{{ tag.name }}</a>
                {{/each}}
            </div>
        </footer>
    {{/if}}
</article>
```

### Form Page Template

```html
<!-- pages/contact/page.html -->
<article class="site-width-container">
    <header>
        <h1>{{ page.title }}</h1>
        {{#if page.description}}
            <p class="description">{{ page.description }}</p>
        {{/if}}
    </header>

    <form method="POST" action="/contact" class="contact-form">
        {{#each page.formFields as |field|}}
            {{> form-field.html field=field }}
        {{/each}}
        
        <div class="form-actions">
            {{> components/button.html 
                type="submit" 
                variant="primary" 
                label="Send Message" 
            }}
        </div>
    </form>

    {{#if page.contactInfo}}
        <aside class="contact-info">
            <h3>Contact Information</h3>
            {{> contact-info.html info=page.contactInfo }}
        </aside>
    {{/if}}
</article>
```

## Best Practices

### 1. Template Organization

```
templates/
├── templates/
│   └── base.html              # Main layout template
├── partials/
│   ├── layout/
│   │   ├── html-header.html   # Head section
│   │   ├── site-header.html   # Navigation
│   │   └── site-footer.html   # Footer
│   ├── components/
│   │   ├── button.html        # Reusable components
│   │   ├── card.html
│   │   └── form-field.html
│   └── content/
│       ├── article-card.html  # Content-specific partials
│       └── event-schedule.html
└── helpers/
    ├── format_date.js         # Custom helpers
    └── format_currency.js
```

### 2. Semantic HTML

```html
<!-- Good: Semantic structure -->
<main class="site-width-container">
    <article>
        <header>
            <h1>{{ page.title }}</h1>
            <time datetime="{{ page.date }}">{{ format_date page.date }}</time>
        </header>
        <section>
            {{noop page.content }}
        </section>
    </article>
</main>

<!-- Avoid: Generic divs -->
<div class="main">
    <div class="article">
        <div class="header">
            <div class="title">{{ page.title }}</div>
        </div>
    </div>
</div>
```

### 3. Progressive Enhancement

```html
<!-- Base functionality works without JavaScript -->
<form action="/search" method="GET">
    <input type="text" name="q" placeholder="Search..." required>
    <button type="submit">Search</button>
</form>

<!-- Enhanced with JavaScript -->
<script>
document.querySelector('form').addEventListener('submit', function(e) {
    // Add loading state, validation, etc.
});
</script>
```

### 4. Security

```html
<!-- Safe: Automatic HTML escaping -->
<p>{{ userInput }}</p>

<!-- Safe: Using noop for trusted content -->
<p>{{noop trustedHtmlContent }}</p>

<!-- Unsafe: Using noop with untrusted content -->
<p>{{noop userComment }}</p> <!-- DON'T DO THIS -->
```

### 5. Performance

```html
<!-- Use conditional rendering to avoid unnecessary work -->
{{#if showExpensiveComponent}}
    {{> expensive-component.html data=expensiveData }}
{{/if}}

<!-- Cache compiled templates in production -->
<!-- The PageTemplateEngine handles this automatically -->
```

### 6. Error Handling

```html
<!-- Include error states in templates -->
{{#if error}}
    <div class="error-message">
        <h3>Error</h3>
        <p>{{ error.message }}</p>
        {{#if error.details}}
            <details>
                <summary>Technical Details</summary>
                <pre>{{ error.details }}</pre>
            </details>
        {{/if}}
    </div>
{{/if}}

<!-- Provide fallbacks for missing data -->
<h1>{{ page.title || 'Untitled Page' }}</h1>
<p>{{ page.description || 'No description available.' }}</p>
```

## Advanced Patterns

### 1. Template Inheritance

```html
<!-- base.html -->
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
        {{#if page.extraHead}}
            {{noop page.extraHead }}
        {{/if}}
    </head>
    <body class="{{ page.bodyClass }}">
        {{> site-header.html }}
        <main class="main-content">
            {{noop body }}
        </main>
        {{> site-footer.html }}
        {{#if page.extraScripts}}
            {{noop page.extraScripts }}
        {{/if}}
    </body>
</html>
```

### 2. Dynamic Partials

```html
<!-- Include different partials based on content type -->
{{#if content.type}}
    {{> (concat content.type "-card.html") }}
{{/if}}

<!-- Or use a helper -->
{{> (getPartialName content.type) }}
```

### 3. Complex Data Structures

```html
<!-- Handle nested data structures -->
{{#if user}}
    {{#if user.profile}}
        {{#if user.profile.preferences}}
            {{#if user.profile.preferences.theme}}
                <div class="theme-{{ user.profile.preferences.theme }}">
                    {{ user.profile.preferences.theme }} theme
                </div>
            {{/if}}
        {{/if}}
    {{/if}}
{{/if}}

<!-- Or use helper functions -->
{{#if (getNestedValue user "profile.preferences.theme")}}
    <div class="theme-{{ (getNestedValue user "profile.preferences.theme") }}">
        {{ (getNestedValue user "profile.preferences.theme") }} theme
    </div>
{{/if}}
```

### 4. Conditional Styling

```html
<!-- Dynamic CSS classes -->
<div class="card {{#if isActive}}card--active{{/if}} {{#if isFeatured}}card--featured{{/if}}">

<!-- Or use a helper -->
<div class="card {{ getCardClasses card }}">

<!-- Helper implementation -->
function getCardClasses(card) {
    const classes = ['card'];
    if (card.isActive) classes.push('card--active');
    if (card.isFeatured) classes.push('card--featured');
    return classes.join(' ');
}
```

### 5. Pagination

```html
<!-- pagination.html partial -->
{{#if pagination}}
    <nav class="pagination">
        {{#if pagination.prevPage}}
            <a href="?page={{ pagination.prevPage }}" class="pagination__prev">Previous</a>
        {{/if}}
        
        <span class="pagination__info">
            Page {{ pagination.currentPage }} of {{ pagination.totalPages }}
        </span>
        
        {{#if pagination.nextPage}}
            <a href="?page={{ pagination.nextPage }}" class="pagination__next">Next</a>
        {{/if}}
    </nav>
{{/if}}
```

## Troubleshooting

### Common Issues

#### 1. Template Not Found

```javascript
// Check file paths and permissions
const template = await viewService.getPageMarkup('/about', pageData);
if (!template) {
    console.log('Template not found for /about');
}
```

#### 2. Missing Data

```html
<!-- Use conditional rendering to handle missing data -->
{{#if page.title}}
    <h1>{{ page.title }}</h1>
{{else}}
    <h1>Untitled Page</h1>
{{/if}}
```

#### 3. Helper Errors

```javascript
// Check helper function signature
export function helper(context, options, ...args) {
    // Helper implementation
}
```

#### 4. HTML Escaping Issues

```html
<!-- Use noop for trusted HTML content -->
<div>{{noop trustedHtmlContent }}</div>

<!-- Use helpers for dynamic HTML -->
<div>{{ renderMarkdown article.content }}</div>
```

### Debug Techniques

#### 1. Template Debugging

```html
<!-- Debug all context data -->
{{ debug }}

<!-- Debug specific object -->
{{ debug user }}

<!-- Debug with label -->
{{ debug "User data:" user }}
```

#### 2. Helper Debugging

```javascript
export function helper(context, options, ...args) {
    console.log('Helper called with:', { context, options, args });
    // Helper implementation
}
```

#### 3. Data Validation

```javascript
// Validate data before rendering
const pageData = await viewService.getPageData('/about', props);
console.log('Page data:', JSON.stringify(pageData, null, 2));
```

### Performance Optimization

#### 1. Template Caching

The PageTemplateEngine automatically caches compiled templates:

```javascript
// Templates are compiled once and cached
const template1 = await engine.getTemplate('base.html');
const template2 = await engine.getTemplate('base.html'); // Uses cached version
```

#### 2. Partial Optimization

```javascript
// Partials are loaded once and cached
await engine.loadPartials(); // Loads all partials
// Subsequent calls use cached partials
```

#### 3. Helper Optimization

```javascript
// Helpers are loaded once and cached
await engine.loadHelpers(); // Loads all helpers
// Subsequent calls use cached helpers
```

## Conclusion

The Kixx templating system provides a powerful, flexible foundation for building server-side rendered web applications. By understanding the architecture, syntax, and best practices outlined in this guide, you can create maintainable, performant, and secure templates that scale with your application needs.

Key takeaways:

1. **Use the layered architecture** - Template Engine → Page Template Engine → View Service
2. **Follow the template structure** - Base templates, page templates, partials, and helpers
3. **Leverage data merging** - Site-wide, page-specific, and dynamic data
4. **Implement progressive enhancement** - Base functionality without JavaScript
5. **Prioritize security** - Automatic HTML escaping and careful use of `noop`
6. **Organize for maintainability** - Clear structure, semantic HTML, and reusable components

For more advanced topics, explore the [Template Engine Documentation](../template-engine/docs/) and [Reference Applications](../reference-applications/) for practical examples. 