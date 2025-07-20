# API Reference

Complete API documentation for all exported functions and classes from the Kixx Templating library.

## Exports

```javascript
import {
    tokenize,
    buildSyntaxTree,
    createRenderFunction,
    helpers,
    escapeHTMLChars
} from 'kixx-templating';
```

## Core Functions

### `tokenize(options, filename, utf8)`

Tokenizes template source code into an array of tokens.

**Parameters:**
- `options` (Object | null): Compilation options (currently unused, pass `null`)
- `filename` (string): Name of the template file for error reporting
- `utf8` (string): Template source code as UTF-8 string

**Returns:** Array of token objects

**Token Object Structure:**
```javascript
{
    filename: string,        // Template filename
    lineNumber: number,      // 1-indexed line number
    startPosition: number,   // Character position where token starts
    endPosition: number,     // Character position where token ends
    tokenString: string,     // The actual token content
    line: string            // Full line containing the token
}
```

**Example:**
```javascript
import { tokenize } from 'kixx-templating';

const source = '<h1>{{ title }}</h1>';
const tokens = tokenize(null, 'template.html', source);
console.log(tokens);
// [
//   { filename: 'template.html', lineNumber: 1, startPosition: 0, endPosition: 4, tokenString: '<h1>', line: '<h1>{{ title }}</h1>\n' },
//   { filename: 'template.html', lineNumber: 1, startPosition: 4, endPosition: 6, tokenString: '{{', line: '<h1>{{ title }}</h1>\n' },
//   { filename: 'template.html', lineNumber: 1, startPosition: 6, endPosition: 12, tokenString: ' title ', line: '<h1>{{ title }}</h1>\n' },
//   { filename: 'template.html', lineNumber: 1, startPosition: 12, endPosition: 14, tokenString: '}}', line: '<h1>{{ title }}</h1>\n' },
//   { filename: 'template.html', lineNumber: 1, startPosition: 14, endPosition: 20, tokenString: '</h1>', line: '<h1>{{ title }}</h1>\n' }
// ]
```

### `buildSyntaxTree(options, tokens)`

Builds an Abstract Syntax Tree (AST) from an array of tokens.

**Parameters:**
- `options` (Object | null): Compilation options (currently unused, pass `null`)
- `tokens` (Array): Array of tokens from `tokenize()`

**Returns:** Array of AST nodes

**AST Node Types:**

#### Content Node
```javascript
{
    type: 'CONTENT',
    str: string,           // The content string
    tokens: Array          // Original tokens
}
```

#### Path Expression Node
```javascript
{
    type: 'PATH_EXPRESSION',
    exp: Array,            // Parsed expression parts
    tokens: Array          // Original tokens
}
```

#### Helper Expression Node
```javascript
{
    type: 'HELPER_EXPRESSION',
    exp: Array,            // Parsed expression parts
    tokens: Array          // Original tokens
}
```

#### Block Open Node
```javascript
{
    type: 'BLOCK_OPEN',
    exp: Array,            // Parsed expression parts
    children: Array,       // Child AST nodes
    tokens: Array          // Original tokens
}
```

#### Block Close Node
```javascript
{
    type: 'BLOCK_CLOSE',
    exp: string,           // Block name
    tokens: Array          // Original tokens
}
```

#### Partial Node
```javascript
{
    type: 'PARTIAL',
    exp: string,           // Partial name
    tokens: Array          // Original tokens
}
```

#### Else Node
```javascript
{
    type: 'ELSE',
    tokens: Array          // Original tokens
}
```

#### Comment Node
```javascript
{
    type: 'COMMENT',
    tokens: Array          // Original tokens
}
```

**Example:**
```javascript
import { tokenize, buildSyntaxTree } from 'kixx-templating';

const source = '<h1>{{ title }}</h1>';
const tokens = tokenize(null, 'template.html', source);
const tree = buildSyntaxTree(null, tokens);
console.log(tree);
// [
//   { type: 'CONTENT', str: '<h1>', tokens: [...] },
//   { type: 'PATH_EXPRESSION', exp: [{ type: 'PATH', path: ['title'], pathString: 'title' }], tokens: [...] },
//   { type: 'CONTENT', str: '</h1>', tokens: [...] }
// ]
```

### `createRenderFunction(options, helpers, partials, tokens)`

Creates a render function from an AST.

**Parameters:**
- `options` (Object | null): Compilation options (currently unused, pass `null`)
- `helpers` (Map): Map of helper functions
- `partials` (Map): Map of compiled partial functions
- `tokens` (Array): AST nodes from `buildSyntaxTree()`

**Returns:** Function that renders the template

**Render Function Signature:**
```javascript
function render(context) {
    // Returns rendered string
}
```

**Example:**
```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

const source = '<h1>{{ title }}</h1>';
const tokens = tokenize(null, 'template.html', source);
const tree = buildSyntaxTree(null, tokens);
const render = createRenderFunction(null, helpers, new Map(), tree);

const html = render({ title: 'Hello World' });
console.log(html); // '<h1>Hello World</h1>'
```

## Built-in Helpers

### `helpers`

A Map containing all built-in helper functions.

**Available Helpers:**
- `each`: Block helper for iteration
- `if`: Block helper for conditional rendering
- `ifEqual`: Block helper for equality comparison
- `ifEmpty`: Block helper for empty checks
- `noop`: Inline helper that returns empty string

**Example:**
```javascript
import { helpers } from 'kixx-templating';

// Access built-in helpers
const eachHelper = helpers.get('each');
const ifHelper = helpers.get('if');

// Check if helper exists
if (helpers.has('each')) {
    console.log('each helper is available');
}
```

## Utility Functions

### `escapeHTMLChars(str)`

Escapes HTML special characters in a string.

**Parameters:**
- `str` (string): String to escape

**Returns:** Escaped string

**Escaped Characters:**
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#x27;`

**Example:**
```javascript
import { escapeHTMLChars } from 'kixx-templating';

const escaped = escapeHTMLChars('<script>alert("xss")</script>');
console.log(escaped);
// '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
```

## Error Handling

### `LineSyntaxError`

Custom error class for template syntax errors.

**Properties:**
- `message` (string): Error message
- `filename` (string): Template filename
- `lineNumber` (number): Line number where error occurred
- `cause` (Error): Original error that caused this error

**Example:**
```javascript
import { tokenize, buildSyntaxTree } from 'kixx-templating';

try {
    const source = '<h1>{{ title }</h1>'; // Missing closing brace
    const tokens = tokenize(null, 'template.html', source);
    const tree = buildSyntaxTree(null, tokens);
} catch (error) {
    console.error(`Error in ${error.filename} on line ${error.lineNumber}: ${error.message}`);
}
```

## Helper Function API

### Helper Function Signature

All helper functions follow this signature:

```javascript
function helperName(context, options, ...positionals) {
    // Helper implementation
    return output;
}
```

**Parameters:**
- `context` (Object): Current template context
- `options` (Object): Named arguments (hash)
- `...positionals` (Array): Positional arguments

**This Context (for block helpers):**
- `this.blockParams` (Array): Block parameter names
- `this.renderPrimary(newContext)` (Function): Render primary block
- `this.renderInverse(newContext)` (Function): Render inverse block

### Built-in Helper Details

#### `each` Helper

```javascript
function each_helper(context, options, iterableObject) {
    // Iterates over arrays, objects, Maps, and Sets
    // Returns rendered string
}
```

**Block Parameters:** `[itemName, indexName]`

**Example:**
```html
{{#each items as |item, index|}}
    <div>{{ index }}: {{ item.name }}</div>
{{/each}}
```

#### `if` Helper

```javascript
function if_helper(context, options, value) {
    // Renders block if value is truthy
    // Returns rendered string
}
```

**Example:**
```html
{{#if user.isLoggedIn}}
    <p>Welcome, {{ user.name }}!</p>
{{else}}
    <p>Please log in.</p>
{{/if}}
```

#### `ifEqual` Helper

```javascript
function ifequal_helper(context, options, value1, value2) {
    // Renders block if values are equal using ==
    // Returns rendered string
}
```

**Example:**
```html
{{#ifEqual user.role "admin"}}
    <span>Administrator</span>
{{else}}
    <span>User</span>
{{/ifEqual}}
```

#### `ifEmpty` Helper

```javascript
function ifempty_helper(context, options, value) {
    // Renders block if value is empty
    // Returns rendered string
}
```

**Example:**
```html
{{#ifEmpty articles}}
    <p>No articles found.</p>
{{else}}
    <p>Found {{ articles.length }} articles.</p>
{{/ifEmpty}}
```

#### `noop` Helper

```javascript
function noop_helper(context, options, ...positionals) {
    // Returns the first positional argument without HTML escaping
    return positionals[0] || '';
}
```

**Example:**
```html
<!-- Prevent HTML entity escaping -->
<p>{{noop trustedHtmlContent }}</p>

<!-- Debug: check if variable exists -->
{{noop someVariable }}
```

**Security Note:** Only use `noop` with trusted content to avoid XSS attacks.

## Template Compilation Pipeline

The complete template compilation process:

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

function compileTemplate(source, filename = 'template.html') {
    // Step 1: Tokenize
    const tokens = tokenize(null, filename, source);
    
    // Step 2: Build AST
    const tree = buildSyntaxTree(null, tokens);
    
    // Step 3: Create render function
    const render = createRenderFunction(null, helpers, new Map(), tree);
    
    return render;
}

// Usage
const template = '<h1>{{ title }}</h1>';
const render = compileTemplate(template);
const html = render({ title: 'Hello' });
```

## Performance Considerations

### Template Caching

For better performance, cache compiled templates:

```javascript
class CachedTemplateEngine {
    #cache = new Map();
    
    compileTemplate(name, source) {
        if (this.#cache.has(name)) {
            return this.#cache.get(name);
        }
        
        const render = createRenderFunction(null, helpers, partials, tree);
        this.#cache.set(name, render);
        return render;
    }
}
```

### Memory Management

Large applications should implement cache eviction:

```javascript
class LRUTemplateEngine {
    #cache = new Map();
    #maxSize = 100;
    
    compileTemplate(name, source) {
        if (this.#cache.has(name)) {
            // Move to end (most recently used)
            const render = this.#cache.get(name);
            this.#cache.delete(name);
            this.#cache.set(name, render);
            return render;
        }
        
        const render = createRenderFunction(null, helpers, partials, tree);
        
        // Evict oldest if cache is full
        if (this.#cache.size >= this.#maxSize) {
            const firstKey = this.#cache.keys().next().value;
            this.#cache.delete(firstKey);
        }
        
        this.#cache.set(name, render);
        return render;
    }
}
```

## Type Definitions (TypeScript)

```typescript
interface Token {
    filename: string;
    lineNumber: number;
    startPosition: number;
    endPosition: number;
    tokenString: string;
    line: string;
}

interface ASTNode {
    type: string;
    tokens: Token[];
    [key: string]: any;
}

interface HelperContext {
    blockParams: string[];
    renderPrimary: (context: object) => string;
    renderInverse: (context: object) => string;
}

type HelperFunction = (
    context: object,
    options: object,
    ...positionals: any[]
) => string;

interface TemplateEngine {
    compileTemplate(name: string, source: string): (context: object) => string;
    registerHelper(name: string, helper: HelperFunction): void;
    registerPartial(name: string, source: string): void;
}
```

## Browser Compatibility

Kixx Templating is designed for modern JavaScript environments:

- **ES2022+** features required
- **ES6 Modules** support required
- **Node.js** ≥ 16.13.2
- **Deno** ≥ 1.0.0
- **Modern browsers** with ES2022 support

## Next Steps

- **[Examples](./examples.md)** - See the API in action
- **[Integration Guide](./integration.md)** - Learn integration patterns
- **[Performance Guide](./performance.md)** - Optimization techniques 