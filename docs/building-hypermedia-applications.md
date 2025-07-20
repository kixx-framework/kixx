# Building Hypermedia-Driven Applications with Kixx

This comprehensive guide walks through the practical steps required to create a hypermedia-driven web application using the Kixx framework, based on real-world examples from the reference applications.

## Table of Contents

1. [Step 1: Application Configuration](step-1-application-configuration.md)
   - Configuration files and environment management
   - Virtual hosts and routing setup
   - Site-wide data and secrets management

2. [Step 2: Template System Setup](step-2-template-system-setup.md)
   - Base templates and partials
   - Template helpers and components
   - Data binding and best practices

3. [Step 3: Page Structure](step-3-page-structure.md)
   - Static and dynamic pages
   - Form pages and data handling
   - Page organization and naming conventions

4. [Step 4: Routing Configuration](step-4-routing-configuration.md)
   - Route definitions and patterns
   - Request handlers and middleware
   - Error handling and URL parameters

5. [Step 5: Custom Plugins](step-5-custom-plugins.md)
   - Service architecture and business logic
   - Request handlers and middleware
   - Background jobs and error handling

6. [Step 6: Application Entry Point](step-6-application-entry-point.md)
   - Server initialization and configuration
   - Service startup and graceful shutdown
   - Health checks and monitoring

7. [Step 7: Progressive Enhancement](step-7-progressive-enhancement.md)
   - Base functionality without JavaScript
   - Enhanced user experience with JavaScript
   - Accessibility and testing strategies

8. [Step 8: Data Management](step-8-data-management.md)
   - Datastore operations and querying
   - Data modeling and concurrency control
   - Performance optimization and best practices

## Project Structure Overview

A typical Kixx application follows this structure:

```
my-kixx-app/
├── kixx-config.json          # Application configuration
├── virtual-hosts.json        # Virtual host definitions
├── site-page-data.json       # Site-wide page data
├── .secrets.json            # Sensitive configuration
├── pages/                   # Page templates and data
│   ├── page.html           # Home page template
│   ├── page.json           # Home page data
│   └── about/
│       ├── page.html
│       └── page.json
├── routes/                  # Route configurations
│   └── main.json
├── templates/               # Template system
│   ├── templates/
│   │   └── base.html       # Base template
│   ├── partials/
│   │   ├── header.html
│   │   └── footer.html
│   └── helpers/
│       └── format_date.js
├── public/                  # Static assets
│   ├── css/
│   ├── js/
│   └── images/
├── plugins/                 # Custom plugins
│   └── my-plugin/
│       ├── my-plugin.js
│       ├── services/
│       ├── request-handlers/
│       └── models/
└── server.js               # Application entry point
```

## Step 1: Application Configuration

### 1.1 Create Configuration Files

**kixx-config.json** - Main application configuration:
```json
{
    "name": "MyApp",
    "procName": "myapp",
    "environments": {
        "development": {
            "logger": {
                "level": "debug",
                "mode": "console"
            },
            "server": {
                "port": 3000
            }
        },
        "production": {
            "logger": {
                "level": "info",
                "mode": "stdout"
            },
            "server": {
                "port": 3001
            }
        }
    },
    "customConfig": {
        "apiKey": "your-api-key",
        "timezone": "America/New_York"
    }
}
```

**virtual-hosts.json** - Define hostname routing:
```json
[
    {
        "name": "Main",
        "hostname": "com.myapp.www",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    }
]
```

**site-page-data.json** - Site-wide navigation and metadata:
```json
{
    "page": {
        "title": "My Application"
    },
    "nav_menu_sections": [
        {
            "label": "Main",
            "pages": [
                {
                    "label": "Home",
                    "url": "/"
                },
                {
                    "label": "About",
                    "url": "/about"
                }
            ]
        }
    ],
    "contactInfo": {
        "phone": {
            "raw": "555-123-4567",
            "formatted": "(555) 123-4567"
        }
    }
}
```

## Step 2: Template System Setup

### 2.1 Base Template

**templates/templates/base.html** - Main layout template:
```html
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body id="site-layout">
        {{> site-header.html }}
        <!-- START Main Content Container -->
        <div class="page-body">{{ body }}</div>
        <!-- END Main Content Container -->
        {{> site-footer.html }}
    </body>
</html>
```

### 2.2 Header Partial

**templates/partials/site-header.html** - Navigation header:
```html
<header id="site-header">
    <div class="site-width-container">
        <a href="/" id="site-header__logo">
            <img src="/images/logo.png" alt="{{ page.title }}" />
        </a>
        <nav>
            <ul class="nav-menu">
                {{#each nav_menu_sections as |menu_item|}}
                <li class="nav-menu__group">
                    <span>{{ menu_item.label }}</span>
                    <ul>
                        {{#each menu_item.pages as |page|}}
                        <li>
                            <a href="{{ page.url }}">{{ page.label }}</a>
                        </li>
                        {{/each}}
                    </ul>
                </li>
                {{/each}}
            </ul>
        </nav>
    </div>
</header>
```

### 2.3 Custom Helpers

**templates/helpers/format_date.js** - Date formatting helper:
```javascript
export default function format_date(dateString, options) {
    const date = new Date(dateString);
    const format = options.hash.format || 'default';
    
    switch (format) {
        case 'DATE_MONTH_DATE':
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
        case 'TIME_SIMPLE':
            return date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit' 
            });
        default:
            return date.toLocaleDateString();
    }
}
```

## Step 3: Page Structure

### 3.1 Home Page

**pages/page.html** - Home page template:
```html
<div class="hero-banner">
    <img src="/images/hero.jpg" alt="Welcome to {{ page.title }}">
</div>

<main class="site-width-container">
    <h1>{{ page.title }}</h1>
    
    <section>
        <h2>Welcome</h2>
        <p>This is a hypermedia-driven application built with Kixx.</p>
    </section>
    
    <section>
        <h2>Recent Items</h2>
        {{#each recentItems}}
        <div class="item-card">
            <h3>{{ title }}</h3>
            <p>{{ description }}</p>
            <a href="/items/{{ id }}">Read More</a>
        </div>
        {{/each}}
    </section>
</main>
```

**pages/page.json** - Home page data:
```json
{
    "recentItems": [
        {
            "id": "1",
            "title": "First Item",
            "description": "This is the first item"
        },
        {
            "id": "2", 
            "title": "Second Item",
            "description": "This is the second item"
        }
    ]
}
```

### 3.2 Dynamic Pages

**pages/items/:id/page.html** - Dynamic item page:
```html
<main class="site-width-container">
    <article>
        <header>
            <h1>{{ item.title }}</h1>
            <time datetime="{{ item.createdAt }}">
                {{format_date item.createdAt format="DATE_MED_WITH_WEEKDAY"}}
            </time>
        </header>
        
        <div class="item-content">
            {{ item.content }}
        </div>
        
        <footer>
            <a href="/items/{{ item.id }}/edit" class="button">Edit</a>
            <form action="/items/{{ item.id }}/delete" method="POST" style="display: inline;">
                <button type="submit" class="button button--danger">Delete</button>
            </form>
        </footer>
    </article>
</main>
```

## Step 4: Routing Configuration

### 4.1 Route Definitions

**routes/main.json** - Define application routes:
```json
[
    {
        "name": "HomePage",
        "pattern": "/{index.json}",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "HomePageHandler",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["HomePageHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "ItemPages",
        "pattern": "/items/:id{.json}",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "ItemHandler",
                "methods": ["GET", "HEAD"],
                "handlers": [
                    ["ItemPageHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    },
    {
        "name": "ItemActions",
        "pattern": "/items/:id/:action",
        "errorHandlers": [
            ["kixx.AppPageErrorHandler"]
        ],
        "targets": [
            {
                "name": "ItemActionHandler",
                "methods": ["GET", "POST"],
                "handlers": [
                    ["ItemActionHandler"],
                    ["kixx.AppPageHandler"]
                ]
            }
        ]
    }
]
```

## Step 5: Custom Plugins

### 5.1 Plugin Structure

**plugins/my-app/plugin.js** - Main plugin entry point:
```javascript
import ItemService from './services/item-service.js';
import * as ItemPageHandler from './request-handlers/item-page-handler.js';
import * as ItemActionHandler from './request-handlers/item-action-handler.js';

export function register(context) {
    // Register services
    context.registerService('ItemService', new ItemService({
        logger: context.logger.createChild('ItemService'),
        datastore: context.getService('kixx.Datastore')
    }));

    // Register request handlers
    const { registerHandler } = await import('../../request-handlers/handlers/mod.js');
    registerHandler('ItemPageHandler', ItemPageHandler.default);
    registerHandler('ItemActionHandler', ItemActionHandler.default);
}

export async function initialize(context) {
    const itemService = context.getService('ItemService');
    await itemService.initialize();
}
```

### 5.2 Custom Services

**plugins/my-app/services/item-service.js** - Business logic service:
```javascript
export default class ItemService {
    constructor({ logger, datastore }) {
        this.logger = logger;
        this.datastore = datastore;
    }

    async initialize() {
        // Initialize service
        this.logger.info('ItemService initialized');
    }

    async getItem(id) {
        return await this.datastore.getItem(`item:${id}`);
    }

    async getAllItems() {
        const result = await this.datastore.queryKeys({
            startKey: 'item:',
            endKey: 'item:\uffff',
            includeDocuments: true
        });
        return result.items.map(item => item.document);
    }

    async createItem(itemData) {
        const id = `item:${Date.now()}`;
        const item = {
            ...itemData,
            id,
            createdAt: new Date().toISOString()
        };
        return await this.datastore.setItem(id, item);
    }

    async updateItem(id, updates) {
        return await this.datastore.updateItem(`item:${id}`, (currentItem) => {
            return {
                ...currentItem,
                ...updates,
                updatedAt: new Date().toISOString()
            };
        });
    }

    async deleteItem(id) {
        return await this.datastore.deleteItem(`item:${id}`);
    }
}
```

### 5.3 Request Handlers

**plugins/my-app/request-handlers/item-page-handler.js** - Page handler:
```javascript
export default function ItemPageHandler() {
    return async function itemPageHandler(context, request, response) {
        const itemService = context.getService('ItemService');
        const { id } = request.pathnameParams;

        const item = await itemService.getItem(id);
        
        if (!item) {
            // Let the error handler deal with 404
            return response;
        }

        response.updateProps({ item });
        return response;
    };
}
```

**plugins/my-app/request-handlers/item-action-handler.js** - Action handler:
```javascript
export default function ItemActionHandler() {
    return async function itemActionHandler(context, request, response) {
        const itemService = context.getService('ItemService');
        const { id, action } = request.pathnameParams;

        switch (action) {
            case 'edit':
                if (request.method === 'GET') {
                    const item = await itemService.getItem(id);
                    response.updateProps({ item, editing: true });
                } else if (request.method === 'POST') {
                    const formData = await request.getFormData();
                    await itemService.updateItem(id, {
                        title: formData.get('title'),
                        content: formData.get('content')
                    });
                    return response.redirect(`/items/${id}`);
                }
                break;

            case 'delete':
                if (request.method === 'POST') {
                    await itemService.deleteItem(id);
                    return response.redirect('/');
                }
                break;
        }

        return response;
    };
}
```

## Step 6: Application Entry Point

**server.js** - Main application file:
```javascript
import { initialize } from './application/application.js';
import ApplicationServer from './application/application-server.js';

async function main() {
    // Initialize application context
    const context = await initialize('./kixx-config.json', 'development');
    
    // Load application server
    const server = await ApplicationServer.load(context, {
        port: context.config.getNamespace('server').port
    });
    
    // Start the server
    server.startServer();
    
    // Start job queue
    const jobQueue = context.getService('kixx.JobQueue');
    jobQueue.start();
    
    console.log(`Server running on port ${server.port}`);
}

main().catch(console.error);
```

## Step 7: Progressive Enhancement

### 7.1 Base Functionality (No JavaScript)

All forms and links work without JavaScript:
```html
<!-- Simple form submission -->
<form action="/items/new" method="POST">
    <input type="text" name="title" placeholder="Item title" required>
    <textarea name="content" placeholder="Item content"></textarea>
    <button type="submit">Create Item</button>
</form>
```

### 7.2 Enhanced with JavaScript

**public/js/app.js** - Progressive enhancement:
```javascript
// Add loading states to forms
document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', function(e) {
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = true;
            button.textContent = 'Saving...';
        }
    });
});

// Add confirmation for delete actions
document.querySelectorAll('form[action*="/delete"]').forEach(form => {
    form.addEventListener('submit', function(e) {
        if (!confirm('Are you sure you want to delete this item?')) {
            e.preventDefault();
        }
    });
});

// Add search functionality
const searchForm = document.querySelector('#search-form');
if (searchForm) {
    searchForm.addEventListener('submit', function(e) {
        const query = this.querySelector('input[name="q"]').value;
        if (!query.trim()) {
            e.preventDefault();
        }
    });
}
```

## Step 8: Data Management

### 8.1 Using the Datastore

```javascript
// In your service
async function loadRecentItems() {
    const result = await this.datastore.queryKeys({
        startKey: 'item:',
        endKey: 'item:\uffff',
        descending: true,
        limit: 10,
        includeDocuments: true
    });
    
    return result.items.map(item => item.document);
}

// Create views for complex queries
const engine = this.datastore._db;
engine.setView('itemsByCategory', {
    map: function(document, emit) {
        if (document.category) {
            emit(document.category, {
                id: document.id,
                title: document.title,
                createdAt: document.createdAt
            });
        }
    }
});
```

### 8.2 Background Jobs

**plugins/my-app/jobs/cleanup-old-items.js**:
```javascript
export async function initialize({ logger, jobQueue, itemService }) {
    jobQueue.registerJobHandler('cleanupOldItems', async () => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago
        
        const allItems = await itemService.getAllItems();
        const oldItems = allItems.filter(item => 
            new Date(item.createdAt) < cutoffDate
        );
        
        for (const item of oldItems) {
            await itemService.deleteItem(item.id);
        }
        
        logger.info(`Cleaned up ${oldItems.length} old items`);
    });
    
    // Schedule daily cleanup
    await jobQueue.scheduleJob({
        methodName: 'cleanupOldItems',
        executionDate: new Date().setHours(2, 0, 0, 0) // 2 AM
    });
}
```

## Key Principles Demonstrated

### 1. Server-Side Rendering
All pages are rendered on the server using the template system, ensuring fast initial page loads and SEO-friendly content.

### 2. Hypermedia as State Engine
State changes occur through links and forms, following REST principles and providing a predictable application flow.

### 3. Progressive Enhancement
Applications work without JavaScript and are enhanced with client-side features for better user experience.

### 4. Template-Driven Development
HTML templates with embedded state transitions make the application structure clear and maintainable.

### 5. Monolithic Design
Single application with clear separation of concerns, reducing complexity and improving reliability.

### 6. Plugin Architecture
Modular components for extensibility, allowing developers to add functionality without modifying core code.

## Best Practices Summary

### Development Practices
1. **Keep templates simple** - Focus on content and navigation
2. **Use semantic HTML** - Proper structure for accessibility
3. **Progressive enhancement** - Base functionality works without JavaScript
4. **Server-side data handling** - Business logic belongs on the server
5. **Consistent URL structure** - RESTful URLs for resources
6. **Error handling** - Graceful degradation and user-friendly errors

### Performance Practices
1. **In-memory caching** - Leverage datastore's memory cache for fast reads
2. **Efficient queries** - Use views and proper key design for optimal performance
3. **Pagination** - Handle large datasets with proper pagination
4. **Asset optimization** - Minimize and compress static assets
5. **Caching headers** - Set appropriate cache headers for static content

### Security Practices
1. **Input validation** - Validate all user inputs on the server
2. **CSRF protection** - Use proper form tokens and validation
3. **Secure configuration** - Keep secrets in separate files
4. **Error handling** - Don't expose sensitive information in error messages
5. **Access control** - Implement proper authentication and authorization

## Next Steps

After completing this guide, consider exploring:

- **[Testing Guide](../testing-guide.md)** - Comprehensive testing strategies for Kixx applications
- **[Deployment Guide](../deployment-guide.md)** - Production deployment and monitoring
- **[Performance Tuning](../performance-tuning.md)** - Advanced performance optimization techniques
- **[API Development](../api-development.md)** - Building RESTful APIs with Kixx
- **[Advanced Patterns](../advanced-patterns.md)** - Complex application patterns and architectures

## Conclusion

This approach results in applications that are:

- **Simple to develop** - Fewer moving parts and frameworks
- **Fast to load** - Minimal JavaScript, server-rendered content
- **Reliable** - Works in any browser, graceful degradation
- **Maintainable** - Single codebase, clear structure
- **Accessible** - Semantic HTML, keyboard navigation
- **Scalable** - Efficient data management and caching

By following these steps and principles, you'll build robust, performant hypermedia-driven applications that provide excellent user experiences while maintaining simplicity and reliability.
