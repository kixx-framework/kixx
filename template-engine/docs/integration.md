# Integration Guide

This guide covers how to integrate Kixx Templating into different types of applications and architectures. You'll learn patterns for web servers, static site generators, build tools, and more.

## Basic Integration Pattern

All integrations follow this basic pattern:

```javascript
import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from 'kixx-templating';

class TemplateEngine {
    #helpers = new Map(helpers);
    #partials = new Map();
    #cache = new Map();

    compileTemplate(name, source) {
        // Check cache first
        if (this.#cache.has(name)) {
            return this.#cache.get(name);
        }

        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        const render = createRenderFunction(null, this.#helpers, this.#partials, tree);
        
        // Cache the compiled template
        this.#cache.set(name, render);
        return render;
    }

    registerHelper(name, helperFunction) {
        this.#helpers.set(name, helperFunction);
    }

    registerPartial(name, source) {
        const partial = this.compileTemplate(name, source);
        this.#partials.set(name, partial);
    }

    clearCache() {
        this.#cache.clear();
    }
}
```

## Static Site Generator

```javascript
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { TemplateEngine } from './template-engine.js';

class StaticSiteGenerator {
    constructor() {
        this.engine = new TemplateEngine();
        this.pages = new Map();
        this.data = {};
    }

    async loadData() {
        // Load site-wide data
        const dataPath = join(process.cwd(), 'data');
        const dataFiles = await readdir(dataPath);
        
        for (const file of dataFiles) {
            if (extname(file) === '.json') {
                const content = await readFile(join(dataPath, file), 'utf8');
                const name = file.replace('.json', '');
                this.data[name] = JSON.parse(content);
            }
        }
    }

    async loadTemplates() {
        // Load partials
        const partialsPath = join(process.cwd(), 'templates', 'partials');
        const partialFiles = await readdir(partialsPath);
        
        for (const file of partialFiles) {
            if (extname(file) === '.html') {
                const source = await readFile(join(partialsPath, file), 'utf8');
                this.engine.registerPartial(file, source);
            }
        }

        // Load pages
        const pagesPath = join(process.cwd(), 'templates', 'pages');
        const pageFiles = await readdir(pagesPath);
        
        for (const file of pageFiles) {
            if (extname(file) === '.html') {
                const source = await readFile(join(pagesPath, file), 'utf8');
                const name = file.replace('.html', '');
                this.pages.set(name, source);
            }
        }
    }

    async build() {
        await this.loadData();
        await this.loadTemplates();

        const outputPath = join(process.cwd(), 'dist');

        for (const [name, source] of this.pages) {
            const context = {
                ...this.data,
                page: { name, title: this.getPageTitle(name) }
            };

            const render = this.engine.compileTemplate(name, source);
            const html = render(context);

            const outputFile = join(outputPath, `${name}.html`);
            await writeFile(outputFile, html);
        }
    }

    getPageTitle(pageName) {
        const titles = {
            'home': 'Welcome',
            'about': 'About Us',
            'contact': 'Contact'
        };
        return titles[pageName] || 'Page';
    }
}

// Usage
const generator = new StaticSiteGenerator();
generator.build().then(() => {
    console.log('Site built successfully!');
});
```

## Content Management System

```javascript
import { TemplateEngine } from './template-engine.js';

class CMS {
    constructor() {
        this.engine = new TemplateEngine();
        this.templates = new Map();
        this.content = new Map();
    }

    registerTemplate(name, source) {
        this.templates.set(name, source);
    }

    addContent(type, content) {
        if (!this.content.has(type)) {
            this.content.set(type, []);
        }
        this.content.get(type).push(content);
    }

    renderPage(pageType, context = {}) {
        const template = this.templates.get(pageType);
        if (!template) {
            throw new Error(`Template not found: ${pageType}`);
        }

        const render = this.engine.compileTemplate(pageType, template);
        return render({
            ...context,
            content: this.content.get(pageType) || []
        });
    }

    // Dynamic template compilation
    compileTemplate(source) {
        return this.engine.compileTemplate('dynamic', source);
    }
}

// Usage
const cms = new CMS();

// Register templates
cms.registerTemplate('blog', `
    <h1>{{ title }}</h1>
    {{#each content as |post|}}
        <article>
            <h2>{{ post.title }}</h2>
            <p>{{ post.excerpt }}</p>
        </article>
    {{/each}}
`);

// Add content
cms.addContent('blog', {
    title: 'First Post',
    excerpt: 'This is the first blog post.'
});

// Render
const html = cms.renderPage('blog', { title: 'My Blog' });
```

## Performance Optimization

### Template Caching

```javascript
class CachedTemplateEngine extends TemplateEngine {
    constructor() {
        super();
        this.compiledTemplates = new Map();
        this.templateHashes = new Map();
    }

    compileTemplate(name, source) {
        const hash = this.hashString(source);
        const cachedHash = this.templateHashes.get(name);
        
        if (cachedHash === hash && this.compiledTemplates.has(name)) {
            return this.compiledTemplates.get(name);
        }
        
        const render = super.compileTemplate(name, source);
        this.compiledTemplates.set(name, render);
        this.templateHashes.set(name, hash);
        
        return render;
    }

    hashString(str) {
        // Simple hash function - use a proper one in production
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    clearCache() {
        this.compiledTemplates.clear();
        this.templateHashes.clear();
    }
}
```

### Lazy Loading

```javascript
class LazyTemplateEngine extends TemplateEngine {
    constructor() {
        super();
        this.templateSources = new Map();
        this.compiledTemplates = new Map();
    }

    registerTemplateSource(name, source) {
        this.templateSources.set(name, source);
    }

    compileTemplate(name, source) {
        // If source is provided, use it; otherwise load from registered sources
        const templateSource = source || this.templateSources.get(name);
        if (!templateSource) {
            throw new Error(`Template source not found: ${name}`);
        }

        // Check if already compiled
        if (this.compiledTemplates.has(name)) {
            return this.compiledTemplates.get(name);
        }

        const render = super.compileTemplate(name, templateSource);
        this.compiledTemplates.set(name, render);
        
        return render;
    }
}
```

## Next Steps

- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Examples](./examples.md)** - See more integration examples
- **[Performance Guide](./performance.md)** - Learn about optimization techniques 