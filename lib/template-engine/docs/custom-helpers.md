# Custom Helpers

Kixx Templating allows you to create custom helper functions to extend the template engine's capabilities. This guide covers how to create both inline and block helpers.

## Helper Types

There are two types of helpers you can create:

- **Inline Helpers**: Transform data and return a string value
- **Block Helpers**: Control template flow and can contain other content

## Helper Function Signature

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

### This Context

Inside block helpers, the `this` context provides:

- `this.blockParams`: Array of block parameter names
- `this.renderPrimary(newContext)`: Render the primary block
- `this.renderInverse(newContext)`: Render the inverse (else) block

## Inline Helpers

Inline helpers transform data and return a string value.

### Basic Inline Helper

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

### Usage

```html
<p>Published: {{ formatDate article.publishDate format="long" }}</p>
<p>Updated: {{ formatDate article.updatedDate format="short" timezone="America/New_York" }}</p>
```

### Helper with Multiple Arguments

```javascript
function image(context, options, src, alt, width, height) {
    const { class: className = '', loading = 'lazy' } = options;
    
    if (!src) return '';
    
    return `<img src="${src}" alt="${alt || ''}" width="${width || ''}" height="${height || ''}" class="${className}" loading="${loading}">`;
}
```

### Usage

```html
{{image article.image.src article.image.alt 800 600 class="featured" loading="eager"}}
```

## Block Helpers

Block helpers control template flow and can contain other content.

### Basic Block Helper

```javascript
function unless(context, options, condition) {
    if (!condition) {
        return this.renderPrimary(context);
    }
    return this.renderInverse(context);
}
```

### Usage

```html
{{#unless user.isLoggedIn}}
    <p>Please log in to continue.</p>
{{else}}
    <p>Welcome back!</p>
{{/unless}}
```

### Block Helper with Parameters

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

### Usage

```html
{{#repeat 3 separator=", "}}
    <span>Item {{ index }}</span>
{{/repeat}}
```

### Complex Block Helper

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

### Usage

```html
{{#with user.profile}}
    <h2>{{ name }}</h2>
    <p>{{ bio }}</p>
    <p>Email: {{ email }}</p>
{{else}}
    <p>No profile information available.</p>
{{/with}}
```

## Registering Helpers

To use custom helpers, you need to register them with your template engine:

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

class TemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();

    registerHelper(name, helperFunction) {
        this.#helpers.set(name, helperFunction);
    }

    compileTemplate(name, source) {
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.#helpers, this.#partials, tree);
    }
}

// Create engine and register helpers
const engine = new TemplateEngine();

engine.registerHelper('formatDate', formatDate);
engine.registerHelper('image', image);
engine.registerHelper('unless', unless);
engine.registerHelper('repeat', repeat);
engine.registerHelper('with', with);
```

## Advanced Helper Examples

### Date Formatting Helper

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

### String Manipulation Helper

```javascript
function truncate(context, options, text) {
    const { length = 100, suffix = '...' } = options;
    
    if (!text || text.length <= length) {
        return text;
    }
    
    return text.substring(0, length) + suffix;
}
```

### Conditional Class Helper

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

### Usage

```html
<div class="{{ conditionalClass 'active' user.isActive 'admin' user.isAdmin 'verified' user.isVerified }}">
    User content
</div>
```

### Pagination Helper

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

## Error Handling

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

## Best Practices

### 1. Keep Helpers Simple

```javascript
// Good: Single responsibility
function formatCurrency(context, options, amount) {
    const { currency = 'USD' } = options;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
}

// Avoid: Multiple responsibilities
function formatCurrencyAndDate(context, options, amount, date) {
    // Too many responsibilities
}
```

### 2. Use Descriptive Names

```javascript
// Good
function formatRelativeTime(context, options, date) { }

// Avoid
function fmt(context, options, d) { }
```

### 3. Provide Sensible Defaults

```javascript
function image(context, options, src) {
    const { 
        alt = '', 
        width = '', 
        height = '', 
        class: className = '' 
    } = options;
    
    // Implementation
}
```

### 4. Validate Input

```javascript
function formatNumber(context, options, value) {
    if (typeof value !== 'number' || isNaN(value)) {
        return '';
    }
    
    const { decimals = 2 } = options;
    return value.toFixed(decimals);
}
```

### 5. Use Block Parameters Appropriately

```javascript
function each(context, options, array) {
    const [ itemName, indexName ] = this.blockParams;
    
    if (!itemName) {
        throw new Error('Block parameter required for #each helper');
    }
    
    // Implementation
}
```

## Next Steps

- **[Examples](./examples.md)** - See more helper examples in action
- **[Integration Guide](./integration.md)** - Learn advanced integration patterns
- **[API Reference](./api-reference.md)** - Complete API documentation 