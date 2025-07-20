# Getting Started

This guide will help you get up and running with Kixx Templating in your JavaScript project.

## Installation

### Using npm

```bash
npm install kixx-templating
```

## Environment Requirements

Kixx Templating requires:

- **Node.js** ≥ 16.13.2 or **Deno** ≥ 1.0.0
- **ECMAScript** ≥ ES2022 support
- **ES6 Modules** environment

## Basic Setup

### 1. Import the Library

```javascript
import { 
    tokenize, 
    buildSyntaxTree, 
    createRenderFunction, 
    helpers 
} from 'kixx-templating';
```

### 2. Create a Simple Template Engine

```javascript
class TemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();

    compileTemplate(name, source) {
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        return createRenderFunction(null, this.#helpers, this.#partials, tree);
    }

    registerHelper(name, helperFunction) {
        this.#helpers.set(name, helperFunction);
    }

    registerPartial(name, source) {
        const partial = this.compileTemplate(name, source);
        this.#partials.set(name, partial);
    }
}
```

### 3. Your First Template

```javascript
// Create template engine instance
const engine = new TemplateEngine();

// Define a simple template
const templateSource = `
<h1>{{ title }}</h1>
<p>Welcome, {{ user.name }}!</p>
{{#if user.isAdmin}}
    <div class="admin-panel">
        <p>You have admin privileges.</p>
    </div>
{{/if}}
`;

// Compile the template
const render = engine.compileTemplate('welcome.html', templateSource);

// Create context data
const context = {
    title: 'Welcome to Our Site',
    user: {
        name: 'John Doe',
        isAdmin: true
    }
};

// Render the template
const html = render(context);
console.log(html);
```

**Output:**
```html
<h1>Welcome to Our Site</h1>
<p>Welcome, John Doe!</p>
    <div class="admin-panel">
        <p>You have admin privileges.</p>
    </div>
```

**Security Note:** All expressions automatically escape HTML entities for security. If you need to render trusted HTML content, use the `noop` helper.

## Project Structure

A typical project using Kixx Templating might look like this:

```
my-project/
├── src/
│   ├── templates/
│   │   ├── layout.html
│   │   ├── home.html
│   │   └── partials/
│   │       ├── header.html
│   │       └── footer.html
│   ├── helpers/
│   │   ├── date-helpers.js
│   │   └── string-helpers.js
│   └── template-engine.js
├── package.json
└── README.md
```

## Next Steps

Now that you have the basics working, explore:

- **[Template Syntax](./syntax.md)** - Learn the full template syntax
- **[Built-in Helpers](./built-in-helpers.md)** - Use the provided helper functions
- **[Custom Helpers](./custom-helpers.md)** - Create your own helper functions
- **[Integration Guide](./integration.md)** - Advanced integration patterns
