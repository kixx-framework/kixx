# Examples

This page contains practical examples of using Kixx Templating in real-world scenarios. Each example demonstrates different features and patterns you can use in your applications.

## Basic Examples

### Simple Variable Output

```html
<!-- template.html -->
<h1>{{ title }}</h1>
<p>Welcome, {{ user.name }}!</p>
<p>You have {{ user.unreadMessages }} unread messages.</p>
```

**Note:** All expressions automatically escape HTML entities for security. Use the `noop` helper if you need to render trusted HTML content.

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

const source = '<h1>{{ title }}</h1><p>Welcome, {{ user.name }}!</p>';
const tokens = tokenize(null, 'template.html', source);
const tree = buildSyntaxTree(null, tokens);
const render = createRenderFunction(null, helpers, new Map(), tree);

const context = {
    title: 'Dashboard',
    user: {
        name: 'John Doe',
        unreadMessages: 5
    }
};

const html = render(context);
console.log(html);
// <h1>Dashboard</h1><p>Welcome, John Doe!</p>
```

### Nested Object Access

```html
<!-- user-profile.html -->
<div class="user-profile">
    <img src="{{ user.avatar.url }}" alt="{{ user.avatar.alt }}" />
    <h2>{{ user.profile.firstName }} {{ user.profile.lastName }}</h2>
    <p>{{ user.profile.bio }}</p>
    <div class="contact">
        <p>Email: {{ user.contact.email }}</p>
        <p>Phone: {{ user.contact.phone }}</p>
    </div>
</div>
```

```javascript
const context = {
    user: {
        avatar: {
            url: '/images/avatar.jpg',
            alt: 'User avatar'
        },
        profile: {
            firstName: 'John',
            lastName: 'Doe',
            bio: 'Software developer and coffee enthusiast.'
        },
        contact: {
            email: 'john@example.com',
            phone: '+1-555-0123'
        }
    }
};
```

## Conditional Rendering

### User Status Display

```html
<!-- user-status.html -->
<div class="user-status">
    {{#if user.isOnline}}
        <span class="status online">🟢 Online</span>
    {{else}}
        <span class="status offline">🔴 Offline</span>
    {{/if}}
    
    {{#if user.lastSeen}}
        <span class="last-seen">Last seen: {{ formatDate user.lastSeen }}</span>
    {{/if}}
</div>
```

### Role-Based Content

```html
<!-- admin-panel.html -->
<div class="admin-panel">
    {{#ifEqual user.role "admin"}}
        <h3>Administrator Controls</h3>
        <div class="admin-actions">
            <button>Manage Users</button>
            <button>System Settings</button>
            <button>View Logs</button>
        </div>
    {{else}}{{#ifEqual user.role "moderator"}}
        <h3>Moderator Controls</h3>
        <div class="moderator-actions">
            <button>Moderate Comments</button>
            <button>Review Content</button>
        </div>
    {{else}}
        <p>You don't have administrative privileges.</p>
    {{/ifEqual}}{{/ifEqual}}
</div>
```

## Iteration Examples

### Article List

```html
<!-- article-list.html -->
<div class="article-list">
    {{#ifEmpty articles}}
        <p class="no-articles">No articles found.</p>
    {{else}}
        {{#each articles as |article, index|}}
            <article class="article-item article-{{ index }}">
                <h2><a href="{{ article.url }}">{{ article.title }}</a></h2>
                <p class="meta">
                    By {{ article.author }} on {{ formatDate article.publishDate }}
                </p>
                <p class="excerpt">{{ article.excerpt }}</p>
                {{#if article.tags}}
                    <div class="tags">
                        {{#each article.tags as |tag|}}
                            <span class="tag">{{ tag }}</span>
                        {{/each}}
                    </div>
                {{/if}}
            </article>
        {{/each}}
    {{/ifEmpty}}
</div>
```

### Navigation Menu

```html
<!-- navigation.html -->
<nav class="main-nav">
    <ul>
        {{#each navigation as |item|}}
            <li class="nav-item {{#ifEqual item.url currentPage}}active{{/ifEqual}}">
                <a href="{{ item.url }}">{{ item.text }}</a>
                {{#if item.children}}
                    <ul class="submenu">
                        {{#each item.children as |child|}}
                            <li><a href="{{ child.url }}">{{ child.text }}</a></li>
                        {{/each}}
                    </ul>
                {{/if}}
            </li>
        {{/each}}
    </ul>
</nav>
```

## Form Examples

### Dynamic Form Fields

```html
<!-- dynamic-form.html -->
<form method="POST" action="{{ form.action }}">
    {{#each form.fields as |field|}}
        <div class="form-group">
            <label for="{{ field.id }}">{{ field.label }}</label>
            
            {{#ifEqual field.type "text"}}
                <input 
                    type="text" 
                    id="{{ field.id }}" 
                    name="{{ field.name }}" 
                    value="{{ field.value }}"
                    {{#if field.required}}required{{/if}}
                    class="form-control {{#if field.error}}error{{/if}}"
                />
            {{else}}{{#ifEqual field.type "textarea"}}
                <textarea 
                    id="{{ field.id }}" 
                    name="{{ field.name }}"
                    {{#if field.required}}required{{/if}}
                    class="form-control {{#if field.error}}error{{/if}}"
                >{{ field.value }}</textarea>
            {{else}}{{#ifEqual field.type "select"}}
                <select 
                    id="{{ field.id }}" 
                    name="{{ field.name }}"
                    {{#if field.required}}required{{/if}}
                    class="form-control {{#if field.error}}error{{/if}}"
                >
                    {{#each field.options as |option|}}
                        <option 
                            value="{{ option.value }}"
                            {{#ifEqual option.value field.value}}selected{{/ifEqual}}
                        >
                            {{ option.text }}
                        </option>
                    {{/each}}
                </select>
            {{/ifEqual}}{{/ifEqual}}{{/ifEqual}}
            
            {{#if field.error}}
                <span class="error-message">{{ field.error }}</span>
            {{/if}}
        </div>
    {{/each}}
    
    <button type="submit">{{ form.submitText }}</button>
</form>
```

```javascript
const formContext = {
    form: {
        action: '/submit',
        submitText: 'Save Changes',
        fields: [
            {
                type: 'text',
                id: 'name',
                name: 'name',
                label: 'Full Name',
                value: 'John Doe',
                required: true
            },
            {
                type: 'textarea',
                id: 'bio',
                name: 'bio',
                label: 'Biography',
                value: 'Software developer...'
            },
            {
                type: 'select',
                id: 'country',
                name: 'country',
                label: 'Country',
                value: 'US',
                options: [
                    { value: 'US', text: 'United States' },
                    { value: 'CA', text: 'Canada' },
                    { value: 'UK', text: 'United Kingdom' }
                ]
            }
        ]
    }
};
```

## Layout Examples

### Master Layout with Partials

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

```html
<!-- head.html -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{ page.title }} - {{ site.name }}</title>
<meta name="description" content="{{ page.description }}">
<link rel="stylesheet" href="{{ site.cssUrl }}">
```

```html
<!-- header.html -->
<header class="site-header">
    <div class="container">
        <a href="/" class="logo">{{ site.name }}</a>
        {{> navigation.html }}
        {{> user-menu.html }}
    </div>
</header>
```

## E-commerce Examples

### Product Grid

```html
<!-- product-grid.html -->
<div class="product-grid">
    {{#each products as |product|}}
        <div class="product-card">
            <img src="{{ product.image }}" alt="{{ product.name }}" />
            <h3>{{ product.name }}</h3>
            <p class="price">{{ formatCurrency product.price }}</p>
            
            {{#if product.discount}}
                <span class="discount">-{{ product.discount }}%</span>
            {{/if}}
            
            {{#if product.inStock}}
                <button class="add-to-cart" data-product-id="{{ product.id }}">
                    Add to Cart
                </button>
            {{else}}
                <span class="out-of-stock">Out of Stock</span>
            {{/if}}
        </div>
    {{/each}}
</div>
```

### Shopping Cart

```html
<!-- shopping-cart.html -->
<div class="shopping-cart">
    {{#ifEmpty cart.items}}
        <p>Your cart is empty.</p>
        <a href="/products" class="btn">Continue Shopping</a>
    {{else}}
        <h2>Shopping Cart ({{ cart.itemCount }} items)</h2>
        
        {{#each cart.items as |item|}}
            <div class="cart-item">
                <img src="{{ item.image }}" alt="{{ item.name }}" />
                <div class="item-details">
                    <h3>{{ item.name }}</h3>
                    <p class="price">{{ formatCurrency item.price }}</p>
                    <div class="quantity">
                        <button class="qty-btn" data-action="decrease" data-id="{{ item.id }}">-</button>
                        <span>{{ item.quantity }}</span>
                        <button class="qty-btn" data-action="increase" data-id="{{ item.id }}">+</button>
                    </div>
                </div>
                <button class="remove-item" data-id="{{ item.id }}">Remove</button>
            </div>
        {{/each}}
        
        <div class="cart-summary">
            <p>Subtotal: {{ formatCurrency cart.subtotal }}</p>
            {{#if cart.tax}}
                <p>Tax: {{ formatCurrency cart.tax }}</p>
            {{/if}}
            <p class="total">Total: {{ formatCurrency cart.total }}</p>
            <button class="checkout-btn">Proceed to Checkout</button>
        </div>
    {{/ifEmpty}}
</div>
```

## Blog Examples

### Blog Post

```html
<!-- blog-post.html -->
<article class="blog-post">
    <header class="post-header">
        <h1>{{ post.title }}</h1>
        <div class="post-meta">
            <span class="author">By {{ post.author.name }}</span>
            <span class="date">{{ formatDate post.publishDate format="long" }}</span>
            {{#if post.readTime}}
                <span class="read-time">{{ post.readTime }} min read</span>
            {{/if}}
        </div>
        {{#if post.tags}}
            <div class="tags">
                {{#each post.tags as |tag|}}
                    <a href="/tag/{{ tag.slug }}" class="tag">{{ tag.name }}</a>
                {{/each}}
            </div>
        {{/if}}
    </header>
    
    <div class="post-content">
        {{ post.content }}
    </div>
    
    {{#if post.comments}}
        <section class="comments">
            <h3>Comments ({{ post.comments.length }})</h3>
            {{#each post.comments as |comment|}}
                <div class="comment">
                    <div class="comment-meta">
                        <strong>{{ comment.author }}</strong>
                        <span>{{ formatDate comment.date }}</span>
                    </div>
                    <p>{{ comment.content }}</p>
                </div>
            {{/each}}
        </section>
    {{/if}}
</article>
```

## Dashboard Examples

### Analytics Dashboard

```html
<!-- analytics-dashboard.html -->
<div class="analytics-dashboard">
    <h1>Analytics Dashboard</h1>
    
    <div class="stats-grid">
        {{#each stats as |stat|}}
            <div class="stat-card">
                <h3>{{ stat.label }}</h3>
                <div class="stat-value">{{ stat.value }}</div>
                {{#if stat.change}}
                    <div class="stat-change {{#if stat.change.positive}}positive{{else}}negative{{/if}}">
                        {{ stat.change.value }}%
                    </div>
                {{/if}}
            </div>
        {{/each}}
    </div>
    
    <div class="charts-section">
        {{#each charts as |chart|}}
            <div class="chart-container">
                <h3>{{ chart.title }}</h3>
                <div class="chart" data-chart-type="{{ chart.type }}" data-chart-data="{{ chart.data }}">
                    <!-- Chart will be rendered by JavaScript -->
                </div>
            </div>
        {{/each}}
    </div>
    
    <div class="recent-activity">
        <h3>Recent Activity</h3>
        {{#each recentActivity as |activity|}}
            <div class="activity-item">
                <span class="activity-icon">{{ activity.icon }}</span>
                <div class="activity-content">
                    <p>{{ activity.description }}</p>
                    <span class="activity-time">{{ formatRelativeTime activity.timestamp }}</span>
                </div>
            </div>
        {{/each}}
    </div>
</div>
```

## Email Template Examples

### Welcome Email

```html
<!-- welcome-email.html -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .email-container { max-width: 600px; margin: 0 auto; }
        .header { background: #007bff; color: white; padding: 20px; }
        .content { padding: 20px; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>Welcome to {{ site.name }}!</h1>
        </div>
        
        <div class="content">
            <h2>Hello {{ user.firstName }},</h2>
            <p>Thank you for joining {{ site.name }}. We're excited to have you on board!</p>
            
            {{#if user.verificationRequired}}
                <p>To get started, please verify your email address:</p>
                <a href="{{ verificationUrl }}" class="btn">Verify Email</a>
            {{else}}
                <p>Your account is ready to use. Here are some things you can do:</p>
                <ul>
                    {{#each onboardingSteps as |step|}}
                        <li>{{ step.description }}</li>
                    {{/each}}
                </ul>
            {{/if}}
        </div>
        
        <div class="footer">
            <p>&copy; {{ currentYear }} {{ site.name }}. All rights reserved.</p>
            <p>
                <a href="{{ unsubscribeUrl }}">Unsubscribe</a> |
                <a href="{{ preferencesUrl }}">Email Preferences</a>
            </p>
        </div>
    </div>
</body>
</html>
```

## HTML Escaping Examples

### Safe Content Rendering

```html
<!-- Safe: User input is automatically escaped -->
<div class="user-comment">
    {{ userComment }}
</div>

<!-- If userComment contains "<script>alert('xss')</script>" -->
<!-- Output: <div class="user-comment">&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;</div> -->
```

### Trusted HTML Content

```html
<!-- Safe: Using noop for trusted HTML content -->
<div class="admin-message">
    {{noop adminMessage }}
</div>

<!-- If adminMessage contains "<strong>Important:</strong> System maintenance" -->
<!-- Output: <div class="admin-message"><strong>Important:</strong> System maintenance</div> -->
```

### Helper Output (No Escaping)

```html
<!-- Helper output is not automatically escaped -->
<div class="content">
    {{ renderMarkdown article.content }}
</div>

<!-- If renderMarkdown returns "<h2>Title</h2><p>Content</p>" -->
<!-- Output: <div class="content"><h2>Title</h2><p>Content</p></div> -->
```

## Custom Helper Examples

```javascript
function formatDate(context, options, dateString) {
    const { format = 'short', timezone = 'UTC', locale = 'en-US' } = options;
    
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
        relative: () => {
            const now = new Date();
            const diff = now - date;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            
            if (days === 0) return 'Today';
            if (days === 1) return 'Yesterday';
            if (days < 7) return `${days} days ago`;
            return date.toLocaleDateString(locale);
        }
    };
    
    if (format === 'relative') {
        return formats.relative();
    }
    
    const options = formats[format] || formats.short;
    return date.toLocaleDateString(locale, options);
}
```

### Currency Formatting Helper

```javascript
function formatCurrency(context, options, amount) {
    const { 
        currency = 'USD', 
        locale = 'en-US',
        minimumFractionDigits = 2,
        maximumFractionDigits = 2
    } = options;
    
    if (typeof amount !== 'number' || isNaN(amount)) {
        return '';
    }
    
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: minimumFractionDigits,
        maximumFractionDigits: maximumFractionDigits
    }).format(amount);
}
```

### Image Helper

```javascript
function image(context, options, src, alt) {
    const { 
        width = '', 
        height = '', 
        class: className = '',
        loading = 'lazy',
        sizes = ''
    } = options;
    
    if (!src) return '';
    
    const attributes = [
        `src="${src}"`,
        alt ? `alt="${alt}"` : '',
        width ? `width="${width}"` : '',
        height ? `height="${height}"` : '',
        className ? `class="${className}"` : '',
        `loading="${loading}"`,
        sizes ? `sizes="${sizes}"` : ''
    ].filter(Boolean).join(' ');
    
    return `<img ${attributes}>`;
}
```

## Complete Application Example

### Simple Blog Engine

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

class BlogEngine {
    constructor() {
        this.engine = new TemplateEngine();
        this.posts = [];
        this.loadPosts();
        this.setupHelpers();
        this.loadTemplates();
    }
    
    loadPosts() {
        // Load blog posts from JSON file
        const postsData = readFileSync('data/posts.json', 'utf8');
        this.posts = JSON.parse(postsData);
    }
    
    setupHelpers() {
        this.engine.registerHelper('formatDate', (context, options, date) => {
            return new Date(date).toLocaleDateString();
        });
        
        this.engine.registerHelper('truncate', (context, options, text) => {
            const { length = 100, suffix = '...' } = options;
            if (text.length <= length) return text;
            return text.substring(0, length) + suffix;
        });
    }
    
    loadTemplates() {
        const templates = ['layout', 'post-list', 'post-detail', 'header', 'footer'];
        
        for (const template of templates) {
            const source = readFileSync(`templates/${template}.html`, 'utf8');
            this.engine.registerTemplate(template, source);
        }
    }
    
    generateSite() {
        // Generate index page
        const indexContext = {
            title: 'My Blog',
            posts: this.posts.map(post => ({
                ...post,
                excerpt: post.content.substring(0, 200) + '...'
            }))
        };
        
        const indexHtml = this.engine.render('post-list', indexContext);
        writeFileSync('dist/index.html', indexHtml);
        
        // Generate individual post pages
        for (const post of this.posts) {
            const postContext = {
                title: post.title,
                post: post
            };
            
            const postHtml = this.engine.render('post-detail', postContext);
            const filename = `dist/posts/${post.slug}.html`;
            writeFileSync(filename, postHtml);
        }
    }
}

// Usage
const blog = new BlogEngine();
blog.generateSite();
```

## Next Steps

- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Integration Guide](./integration.md)** - Learn integration patterns
- **[Custom Helpers](./custom-helpers.md)** - Create your own helper functions 