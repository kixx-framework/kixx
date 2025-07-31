# Performance Guide

This guide covers optimization techniques and best practices for achieving high performance with Kixx Templating in production applications.

## Template Compilation Performance

### Caching Strategies

Template compilation is the most expensive operation. Always cache compiled templates:

```javascript
class OptimizedTemplateEngine {
    #cache = new Map();
    #templateHashes = new Map();
    
    compileTemplate(name, source) {
        const hash = this.hashString(source);
        const cachedHash = this.#templateHashes.get(name);
        
        // Return cached version if source hasn't changed
        if (cachedHash === hash && this.#cache.has(name)) {
            return this.#cache.get(name);
        }
        
        // Compile and cache
        const tokens = tokenize(null, name, source);
        const tree = buildSyntaxTree(null, tokens);
        const render = createRenderFunction(null, this.#helpers, this.#partials, tree);
        
        this.#cache.set(name, render);
        this.#templateHashes.set(name, hash);
        
        return render;
    }
    
    hashString(str) {
        // Use a fast hash function for change detection
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }
}
```

### LRU Cache Implementation

For memory-constrained environments, implement LRU (Least Recently Used) cache:

```javascript
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    get(key) {
        if (this.cache.has(key)) {
            // Move to end (most recently used)
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        return undefined;
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first item)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    clear() {
        this.cache.clear();
    }
}

class LRUTemplateEngine {
    constructor(maxCacheSize = 100) {
        this.cache = new LRUCache(maxCacheSize);
        this.helpers = new Map(helpers);
        this.partials = new Map();
    }
    
    compileTemplate(name, source) {
        const cacheKey = `${name}:${this.hashString(source)}`;
        
        let render = this.cache.get(cacheKey);
        if (!render) {
            const tokens = tokenize(null, name, source);
            const tree = buildSyntaxTree(null, tokens);
            render = createRenderFunction(null, this.helpers, this.partials, tree);
            this.cache.set(cacheKey, render);
        }
        
        return render;
    }
}
```

## Rendering Performance

### Context Optimization

Optimize your context objects for faster property access:

```javascript
// Good: Flattened structure for faster access
const optimizedContext = {
    userName: user.name,
    userEmail: user.email,
    userRole: user.role,
    articleTitle: article.title,
    articleContent: article.content
};

// Avoid: Deep nesting
const slowContext = {
    user: {
        profile: {
            personal: {
                name: user.name,
                email: user.email
            }
        }
    }
};
```

### Pre-compute Expensive Values

```javascript
// Pre-compute values that are used multiple times
const context = {
    user: user,
    articles: articles,
    // Pre-compute expensive operations
    articleCount: articles.length,
    publishedArticles: articles.filter(a => a.status === 'published'),
    userFullName: `${user.firstName} ${user.lastName}`,
    formattedDate: new Date().toLocaleDateString()
};
```

### Batch Rendering

For multiple templates, batch the compilation:

```javascript
class BatchRenderer {
    constructor() {
        this.engine = new TemplateEngine();
        this.compiledTemplates = new Map();
    }
    
    // Compile all templates at once
    compileTemplates(templates) {
        const promises = templates.map(async ([name, source]) => {
            const render = this.engine.compileTemplate(name, source);
            this.compiledTemplates.set(name, render);
        });
        
        return Promise.all(promises);
    }
    
    // Render multiple templates with shared context
    renderBatch(templateNames, context) {
        return templateNames.map(name => {
            const render = this.compiledTemplates.get(name);
            if (!render) {
                throw new Error(`Template not found: ${name}`);
            }
            return render(context);
        });
    }
}
```

## Memory Management

### Template Lifecycle Management

```javascript
class TemplateManager {
    constructor() {
        this.templates = new Map();
        this.accessCount = new Map();
        this.lastAccess = new Map();
    }
    
    registerTemplate(name, source) {
        const render = this.compileTemplate(name, source);
        this.templates.set(name, render);
        this.accessCount.set(name, 0);
        this.lastAccess.set(name, Date.now());
    }
    
    getTemplate(name) {
        const render = this.templates.get(name);
        if (render) {
            // Update access tracking
            this.accessCount.set(name, this.accessCount.get(name) + 1);
            this.lastAccess.set(name, Date.now());
        }
        return render;
    }
    
    // Clean up unused templates
    cleanup(maxAge = 3600000) { // 1 hour default
        const now = Date.now();
        for (const [name, lastAccess] of this.lastAccess) {
            if (now - lastAccess > maxAge) {
                this.templates.delete(name);
                this.accessCount.delete(name);
                this.lastAccess.delete(name);
            }
        }
    }
    
    // Get memory usage statistics
    getStats() {
        return {
            templateCount: this.templates.size,
            totalAccess: Array.from(this.accessCount.values()).reduce((a, b) => a + b, 0),
            averageAccess: this.templates.size > 0 ? 
                Array.from(this.accessCount.values()).reduce((a, b) => a + b, 0) / this.templates.size : 0
        };
    }
}
```

### Garbage Collection Optimization

```javascript
class GCOptimizedEngine {
    constructor() {
        this.templates = new WeakMap(); // Allow GC to clean up unused templates
        this.strongReferences = new Map(); // Keep frequently used templates
    }
    
    compileTemplate(name, source) {
        const render = createRenderFunction(null, helpers, partials, tree);
        
        // Use WeakMap for templates that might not be used frequently
        this.templates.set({ name, source }, render);
        
        // Keep strong reference for frequently used templates
        if (this.isFrequentlyUsed(name)) {
            this.strongReferences.set(name, render);
        }
        
        return render;
    }
    
    isFrequentlyUsed(name) {
        // Implement your logic to determine frequently used templates
        return ['layout', 'header', 'footer'].includes(name);
    }
}
```

## Helper Performance

### Optimize Helper Functions

```javascript
// Good: Efficient helper with early returns
function optimizedFormatDate(context, options, dateString) {
    if (!dateString) return '';
    
    const { format = 'short' } = options;
    
    // Early return for common case
    if (format === 'short') {
        return new Date(dateString).toLocaleDateString();
    }
    
    // Only create date object if needed
    const date = new Date(dateString);
    
    switch (format) {
        case 'long':
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        case 'time':
            return date.toLocaleTimeString();
        default:
            return date.toLocaleDateString();
    }
}

// Avoid: Inefficient helper
function slowFormatDate(context, options, dateString) {
    const date = new Date(dateString); // Always created
    const { format = 'short', timezone, locale } = options;
    
    // Complex object creation every time
    const formatOptions = {
        short: { month: 'short', day: 'numeric', year: 'numeric' },
        long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    };
    
    return date.toLocaleDateString(locale, formatOptions[format]);
}
```

### Memoize Expensive Helpers

```javascript
function memoizedHelper(fn) {
    const cache = new Map();
    
    return function(context, options, ...args) {
        const key = JSON.stringify([options, ...args]);
        
        if (cache.has(key)) {
            return cache.get(key);
        }
        
        const result = fn.call(this, context, options, ...args);
        cache.set(key, result);
        
        return result;
    };
}

// Usage
const memoizedFormatDate = memoizedHelper(function(context, options, dateString) {
    // Expensive date formatting logic
    return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
});
```

## Network and I/O Performance

### Template Loading Optimization

```javascript
class AsyncTemplateLoader {
    constructor() {
        this.loadingPromises = new Map();
        this.templates = new Map();
    }
    
    async loadTemplate(name) {
        // Return cached template if available
        if (this.templates.has(name)) {
            return this.templates.get(name);
        }
        
        // Return existing promise if already loading
        if (this.loadingPromises.has(name)) {
            return this.loadingPromises.get(name);
        }
        
        // Start loading
        const loadPromise = this.fetchTemplate(name);
        this.loadingPromises.set(name, loadPromise);
        
        try {
            const source = await loadPromise;
            const render = this.compileTemplate(name, source);
            this.templates.set(name, render);
            this.loadingPromises.delete(name);
            return render;
        } catch (error) {
            this.loadingPromises.delete(name);
            throw error;
        }
    }
    
    async fetchTemplate(name) {
        const response = await fetch(`/templates/${name}.html`);
        return response.text();
    }
}
```

### Streaming Templates

For large templates, consider streaming:

```javascript
class StreamingTemplateEngine {
    constructor() {
        this.engine = new TemplateEngine();
    }
    
    async *renderStream(templateName, context) {
        const template = await this.engine.loadTemplate(templateName);
        const render = this.engine.compileTemplate(templateName, template);
        
        // Split template into chunks and render progressively
        const chunks = this.splitTemplate(template);
        
        for (const chunk of chunks) {
            const renderedChunk = this.renderChunk(chunk, context);
            yield renderedChunk;
        }
    }
    
    splitTemplate(template) {
        // Split template into manageable chunks
        return template.split(/({{.*?}})/);
    }
    
    renderChunk(chunk, context) {
        if (chunk.startsWith('{{') && chunk.endsWith('}}')) {
            // This is a template expression
            return this.evaluateExpression(chunk, context);
        }
        return chunk;
    }
}
```

## Monitoring and Profiling

### Performance Monitoring

```javascript
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            compilationTime: [],
            renderTime: [],
            cacheHits: 0,
            cacheMisses: 0
        };
    }
    
    measureCompilation(name, source) {
        const start = performance.now();
        const result = this.engine.compileTemplate(name, source);
        const end = performance.now();
        
        this.metrics.compilationTime.push({
            name,
            duration: end - start,
            sourceLength: source.length
        });
        
        return result;
    }
    
    measureRender(templateName, context) {
        const start = performance.now();
        const result = this.engine.render(templateName, context);
        const end = performance.now();
        
        this.metrics.renderTime.push({
            templateName,
            duration: end - start,
            contextSize: JSON.stringify(context).length
        });
        
        return result;
    }
    
    getStats() {
        const avgCompilation = this.metrics.compilationTime.reduce((a, b) => a + b.duration, 0) / this.metrics.compilationTime.length;
        const avgRender = this.metrics.renderTime.reduce((a, b) => a + b.duration, 0) / this.metrics.renderTime.length;
        
        return {
            averageCompilationTime: avgCompilation,
            averageRenderTime: avgRender,
            cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
            totalCompilations: this.metrics.compilationTime.length,
            totalRenders: this.metrics.renderTime.length
        };
    }
}
```

### Memory Profiling

```javascript
class MemoryProfiler {
    constructor() {
        this.snapshots = [];
    }
    
    takeSnapshot(label) {
        if (typeof performance !== 'undefined' && performance.memory) {
            this.snapshots.push({
                label,
                timestamp: Date.now(),
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            });
        }
    }
    
    getMemoryStats() {
        if (this.snapshots.length < 2) return null;
        
        const latest = this.snapshots[this.snapshots.length - 1];
        const previous = this.snapshots[this.snapshots.length - 2];
        
        return {
            currentUsed: latest.used,
            currentTotal: latest.total,
            memoryIncrease: latest.used - previous.used,
            timeSinceLastSnapshot: latest.timestamp - previous.timestamp
        };
    }
}
```

## Best Practices Summary

### 1. Always Cache Templates
```javascript
// Use caching in production
const engine = new CachedTemplateEngine();
```

### 2. Optimize Context Objects
```javascript
// Flatten nested objects for faster access
const context = {
    userName: user.name,
    userEmail: user.email
};
```

### 3. Pre-compile Templates
```javascript
// Compile templates at startup, not at request time
await engine.preloadTemplates(['layout', 'header', 'footer']);
```

### 4. Monitor Performance
```javascript
// Track key metrics
const stats = monitor.getStats();
console.log(`Average render time: ${stats.averageRenderTime}ms`);
```

### 5. Use Appropriate Cache Strategies
```javascript
// LRU cache for memory-constrained environments
const engine = new LRUTemplateEngine(50); // Max 50 templates
```

### 6. Optimize Helper Functions
```javascript
// Use early returns and avoid unnecessary object creation
function optimizedHelper(context, options, value) {
    if (!value) return '';
    // ... rest of logic
}
```

## Next Steps

- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Integration Guide](./integration.md)** - Learn integration patterns
- **[Examples](./examples.md)** - See performance optimizations in action 