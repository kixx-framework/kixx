# Kixx Templating Documentation
Kixx Templating is a lightweight, dependency-free template engine designed for modern JavaScript applications. It provides a clean, intuitive syntax for creating dynamic templates while maintaining excellent performance and reliability.

### Key Features

- **Zero Dependencies**: Pure JavaScript implementation
- **Modern JavaScript**: ES2022+ compatible
- **Simple Syntax**: Intuitive mustache-style templating
- **Robust Error Handling**: Clear error messages with line numbers
- **Flexible Integration**: Easy to integrate into any JavaScript project
- **Extensible**: Custom helpers and partials support

## Quick Start

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

// Simple template compilation
const source = '<h1>{{ title }}</h1>';
const tokens = tokenize(null, 'template.html', source);
const tree = buildSyntaxTree(null, tokens);
const render = createRenderFunction(null, helpers, new Map(), tree);

// Render with context
const html = render({ title: 'Hello World' });
// Result: <h1>Hello World</h1>
```

## Security & HTML Escaping

Kixx Templating automatically escapes HTML entities in expressions for security:

```html
<!-- Safe: User input is automatically escaped -->
<p>{{ userInput }}</p>
<!-- If userInput contains "<script>alert('xss')</script>" -->
<!-- Output: <p>&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;</p> -->

<!-- For trusted HTML content, use the noop helper -->
<p>{{noop trustedHtmlContent }}</p>
```

**⚠️ Security Warning:** Only use `noop` with content you trust. Never use it with untrusted user input.

## Documentation Sections

### [Getting Started](./getting-started.md)
Learn how to install and set up Kixx Templating in your project.

### [Template Syntax](./syntax.md)
Master the template syntax including expressions, helpers, and comments.

### [Built-in Helpers](./built-in-helpers.md)
Explore the built-in helper functions for common templating tasks.

### [Custom Helpers](./custom-helpers.md)
Learn how to create your own helper functions to extend the template engine.

### [Partials](./partials.md)
Understand how to use partials for reusable template components.

### [Integration Guide](./integration.md)
Learn how to integrate Kixx Templating into your application architecture.

### [API Reference](./api-reference.md)
Complete API documentation for all exported functions and classes.

### [Examples](./examples.md)
Practical examples and common use cases.
