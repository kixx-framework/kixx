# Step 5: Custom Plugins

## Overview

Plugins in Kixx applications provide a modular way to extend functionality, organize business logic, and create reusable components. Plugins can define services, request handlers, middleware, error handlers, and background jobs, making them the primary mechanism for building complex applications.

## Plugin Architecture

```
plugins/
└── my-app/
    ├── plugin.js                    # Main plugin entry point
    ├── services/
    │   ├── item-service.js          # Business logic services
    │   └── user-service.js
    ├── request-handlers/
    │   ├── item-page-handler.js     # Page handlers
    │   ├── item-action-handler.js   # Action handlers
    │   └── api-handler.js           # API handlers
    ├── middleware/
    │   ├── auth-middleware.js       # Authentication
    │   └── logging-middleware.js    # Request logging
    ├── error-handlers/
    │   └── custom-error-handler.js  # Custom error handling
    ├── jobs/
    │   └── cleanup-job.js           # Background jobs
    └── models/
        └── item-model.js            # Data models
```

## Plugin Structure

### Main Plugin File

**plugins/my-app/plugin.js** - The main plugin entry point:

```javascript
import ItemService from './services/item-service.js';
import UserService from './services/user-service.js';
import * as ItemPageHandler from './request-handlers/item-page-handler.js';
import * as ItemActionHandler from './request-handlers/item-action-handler.js';
import * as AuthMiddleware from './middleware/auth-middleware.js';

export function register(context) {
    // Register services
    context.registerService('ItemService', new ItemService({
        logger: context.logger.createChild('ItemService'),
        datastore: context.getService('kixx.Datastore')
    }));

    context.registerService('UserService', new UserService({
        logger: context.logger.createChild('UserService'),
        datastore: context.getService('kixx.Datastore')
    }));

    // Register request handlers
    const { registerHandler } = await import('../../request-handlers/handlers/mod.js');
    registerHandler('ItemPageHandler', ItemPageHandler.default);
    registerHandler('ItemActionHandler', ItemActionHandler.default);

    // Register middleware
    const { registerMiddleware } = await import('../../request-handlers/middleware/mod.js');
    registerMiddleware('AuthMiddleware', AuthMiddleware.default);
}

export async function initialize(context) {
    const itemService = context.getService('ItemService');
    const userService = context.getService('UserService');

    // Initialize services
    await itemService.initialize();
    await userService.initialize();

    // Set up background jobs
    const jobQueue = context.getService('kixx.JobQueue');
    await setupJobs(jobQueue, itemService);
}

async function setupJobs(jobQueue, itemService) {
    // Register job handlers
    jobQueue.registerJobHandler('cleanupOldItems', async () => {
        await itemService.cleanupOldItems();
    });

    // Schedule recurring jobs
    await jobQueue.scheduleJob({
        methodName: 'cleanupOldItems',
        executionDate: new Date().setHours(2, 0, 0, 0), // 2 AM daily
        recurring: true,
        interval: 24 * 60 * 60 * 1000 // 24 hours
    });
}
```

## Services

### Service Architecture

Services contain business logic and provide a clean interface for data operations.

### Item Service

**plugins/my-app/services/item-service.js** - Business logic for items:

```javascript
export default class ItemService {
    constructor({ logger, datastore }) {
        this.logger = logger;
        this.datastore = datastore;
    }

    async initialize() {
        this.logger.info('ItemService initialized');
        
        // Set up datastore views for efficient queries
        const engine = this.datastore._db;
        engine.setView('itemsByCategory', {
            map: function(document, emit) {
                if (document.type === 'item' && document.category) {
                    emit(document.category, {
                        id: document.id,
                        title: document.title,
                        createdAt: document.createdAt
                    });
                }
            }
        });
    }

    async getItem(id) {
        try {
            return await this.datastore.getItem(`item:${id}`);
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }

    async getAllItems(options = {}) {
        const { category, limit = 50, offset = 0, sortBy = 'createdAt', sortOrder = 'desc' } = options;
        
        let result;
        if (category) {
            // Use view for category filtering
            result = await this.datastore.queryView('itemsByCategory', {
                startKey: category,
                endKey: category + '\uffff',
                includeDocuments: true,
                limit,
                offset
            });
        } else {
            // Query all items
            result = await this.datastore.queryKeys({
                startKey: 'item:',
                endKey: 'item:\uffff',
                includeDocuments: true,
                limit,
                offset,
                descending: sortOrder === 'desc'
            });
        }

        return {
            items: result.items.map(item => item.document),
            total: result.total,
            hasMore: result.hasMore
        };
    }

    async createItem(itemData) {
        const id = `item:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const item = {
            ...itemData,
            id,
            type: 'item',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await this.datastore.setItem(id, item);
        this.logger.info('Item created', { id, title: item.title });
        
        return item;
    }

    async updateItem(id, updates) {
        return await this.datastore.updateItem(`item:${id}`, (currentItem) => {
            if (!currentItem) {
                throw new Error('Item not found');
            }

            return {
                ...currentItem,
                ...updates,
                updatedAt: new Date().toISOString()
            };
        });
    }

    async deleteItem(id) {
        await this.datastore.deleteItem(`item:${id}`);
        this.logger.info('Item deleted', { id });
    }

    async searchItems(query, options = {}) {
        const { limit = 20, offset = 0 } = options;
        
        // Simple text search implementation
        const allItems = await this.getAllItems({ limit: 1000 });
        const searchTerm = query.toLowerCase();
        
        const results = allItems.items.filter(item => 
            item.title.toLowerCase().includes(searchTerm) ||
            item.description.toLowerCase().includes(searchTerm)
        );

        return {
            items: results.slice(offset, offset + limit),
            total: results.length,
            hasMore: offset + limit < results.length
        };
    }

    async cleanupOldItems() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago
        
        const allItems = await this.getAllItems({ limit: 1000 });
        const oldItems = allItems.items.filter(item => 
            new Date(item.createdAt) < cutoffDate
        );
        
        for (const item of oldItems) {
            await this.deleteItem(item.id);
        }
        
        this.logger.info(`Cleaned up ${oldItems.length} old items`);
    }
}
```

### User Service

**plugins/my-app/services/user-service.js** - User management service:

```javascript
import crypto from 'crypto';

export default class UserService {
    constructor({ logger, datastore }) {
        this.logger = logger;
        this.datastore = datastore;
    }

    async initialize() {
        this.logger.info('UserService initialized');
    }

    async createUser(userData) {
        const id = `user:${Date.now()}`;
        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPassword = this.hashPassword(userData.password, salt);
        
        const user = {
            ...userData,
            id,
            type: 'user',
            passwordHash: hashedPassword,
            salt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        delete user.password; // Don't store plain text password
        
        await this.datastore.setItem(id, user);
        this.logger.info('User created', { id, email: user.email });
        
        return user;
    }

    async authenticateUser(email, password) {
        const users = await this.datastore.queryKeys({
            startKey: 'user:',
            endKey: 'user:\uffff',
            includeDocuments: true
        });

        const user = users.items.find(item => item.document.email === email);
        if (!user) {
            return null;
        }

        const hashedPassword = this.hashPassword(password, user.document.salt);
        if (hashedPassword !== user.document.passwordHash) {
            return null;
        }

        return user.document;
    }

    hashPassword(password, salt) {
        return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    }

    async getUser(id) {
        try {
            return await this.datastore.getItem(`user:${id}`);
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }

    async updateUser(id, updates) {
        return await this.datastore.updateItem(`user:${id}`, (currentUser) => {
            if (!currentUser) {
                throw new Error('User not found');
            }

            return {
                ...currentUser,
                ...updates,
                updatedAt: new Date().toISOString()
            };
        });
    }
}
```

## Request Handlers

### Page Handlers

**plugins/my-app/request-handlers/item-page-handler.js** - Handle item page requests:

```javascript
export default function ItemPageHandler() {
    return async function itemPageHandler(context, request, response) {
        const itemService = context.getService('ItemService');
        const { id } = request.pathnameParams;

        try {
            const item = await itemService.getItem(id);
            
            if (!item) {
                response.statusCode = 404;
                return response;
            }

            // Get related items
            const relatedItems = await itemService.getAllItems({
                category: item.category,
                limit: 4
            });

            response.updateProps({ 
                item,
                relatedItems: relatedItems.items.filter(related => related.id !== item.id)
            });
            
            return response;
        } catch (error) {
            context.logger.error('Error in item page handler', { error, id });
            throw error;
        }
    };
}
```

### Action Handlers

**plugins/my-app/request-handlers/item-action-handler.js** - Handle item actions:

```javascript
export default function ItemActionHandler() {
    return async function itemActionHandler(context, request, response) {
        const itemService = context.getService('ItemService');
        const { id, action } = request.pathnameParams;

        try {
            switch (action) {
                case 'edit':
                    if (request.method === 'GET') {
                        const item = await itemService.getItem(id);
                        if (!item) {
                            response.statusCode = 404;
                            return response;
                        }
                        response.updateProps({ item, editing: true });
                    } else if (request.method === 'POST') {
                        const formData = await request.getFormData();
                        const updates = {
                            title: formData.get('title'),
                            description: formData.get('description'),
                            category: formData.get('category'),
                            price: parseFloat(formData.get('price'))
                        };
                        
                        await itemService.updateItem(id, updates);
                        return response.redirect(`/items/${id}`);
                    }
                    break;

                case 'delete':
                    if (request.method === 'POST') {
                        await itemService.deleteItem(id);
                        return response.redirect('/items');
                    }
                    break;

                default:
                    response.statusCode = 404;
                    return response;
            }

            return response;
        } catch (error) {
            context.logger.error('Error in item action handler', { error, id, action });
            throw error;
        }
    };
}
```

### API Handlers

**plugins/my-app/request-handlers/api-handler.js** - Handle API requests:

```javascript
export default function APIHandler() {
    return async function apiHandler(context, request, response) {
        const itemService = context.getService('ItemService');
        
        try {
            switch (request.method) {
                case 'GET':
                    const { category, limit, offset, q } = request.queryParams;
                    
                    if (q) {
                        // Search
                        const results = await itemService.searchItems(q, { limit, offset });
                        response.setHeader('Content-Type', 'application/json');
                        response.body = JSON.stringify(results);
                    } else {
                        // List items
                        const items = await itemService.getAllItems({ category, limit, offset });
                        response.setHeader('Content-Type', 'application/json');
                        response.body = JSON.stringify(items);
                    }
                    break;

                case 'POST':
                    const body = await request.getJSON();
                    const newItem = await itemService.createItem(body);
                    response.statusCode = 201;
                    response.setHeader('Content-Type', 'application/json');
                    response.body = JSON.stringify(newItem);
                    break;

                default:
                    response.statusCode = 405;
                    response.setHeader('Content-Type', 'application/json');
                    response.body = JSON.stringify({ error: 'Method not allowed' });
            }

            return response;
        } catch (error) {
            context.logger.error('Error in API handler', { error });
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            response.body = JSON.stringify({ error: 'Internal server error' });
            return response;
        }
    };
}
```

## Middleware

### Authentication Middleware

**plugins/my-app/middleware/auth-middleware.js** - Authentication middleware:

```javascript
export default function AuthMiddleware() {
    return async function authMiddleware(context, request, response) {
        const userService = context.getService('UserService');
        
        // Check for session token
        const sessionToken = request.cookies.get('session');
        if (sessionToken) {
            try {
                const user = await userService.getUserBySession(sessionToken);
                if (user) {
                    request.user = user;
                }
            } catch (error) {
                context.logger.warn('Invalid session token', { error });
            }
        }

        // Check for API key
        const apiKey = request.headers.get('X-API-Key');
        if (apiKey) {
            try {
                const user = await userService.getUserByApiKey(apiKey);
                if (user) {
                    request.user = user;
                }
            } catch (error) {
                context.logger.warn('Invalid API key', { error });
            }
        }

        return response;
    };
}
```

### Logging Middleware

**plugins/my-app/middleware/logging-middleware.js** - Request logging:

```javascript
export default function LoggingMiddleware() {
    return async function loggingMiddleware(context, request, response) {
        const startTime = Date.now();
        
        // Log request
        context.logger.info('Request started', {
            method: request.method,
            url: request.url,
            userAgent: request.headers.get('User-Agent'),
            ip: request.ip
        });

        // Continue processing
        const result = await response;

        // Log response
        const duration = Date.now() - startTime;
        context.logger.info('Request completed', {
            method: request.method,
            url: request.url,
            statusCode: result.statusCode,
            duration: `${duration}ms`
        });

        return result;
    };
}
```

## Error Handlers

### Custom Error Handler

**plugins/my-app/error-handlers/custom-error-handler.js** - Custom error handling:

```javascript
export default function CustomErrorHandler() {
    return async function customErrorHandler(context, request, response, error) {
        context.logger.error('Error in request handler', { 
            error: error.message, 
            stack: error.stack,
            url: request.url,
            method: request.method
        });

        // Handle specific error types
        if (error.name === 'ValidationError') {
            response.statusCode = 400;
            response.updateProps({ 
                error: 'Validation failed',
                validationErrors: error.details 
            });
            return response;
        }

        if (error.name === 'NotFoundError') {
            response.statusCode = 404;
            response.updateProps({ 
                error: 'Resource not found',
                message: 'The requested resource could not be found.'
            });
            return response;
        }

        if (error.name === 'UnauthorizedError') {
            response.statusCode = 401;
            response.updateProps({ 
                error: 'Unauthorized',
                message: 'You must be logged in to access this resource.'
            });
            return response;
        }

        // Default error handling
        response.statusCode = 500;
        response.updateProps({ 
            error: 'Internal server error',
            message: 'An unexpected error occurred. Please try again later.'
        });

        return response;
    };
}
```

## Background Jobs

### Cleanup Job

**plugins/my-app/jobs/cleanup-job.js** - Background cleanup job:

```javascript
export async function initialize({ logger, jobQueue, itemService }) {
    // Register job handler
    jobQueue.registerJobHandler('cleanupOldItems', async () => {
        logger.info('Starting cleanup job');
        
        try {
            await itemService.cleanupOldItems();
            logger.info('Cleanup job completed successfully');
        } catch (error) {
            logger.error('Cleanup job failed', { error });
            throw error; // Retry the job
        }
    });

    // Schedule daily cleanup at 2 AM
    await jobQueue.scheduleJob({
        methodName: 'cleanupOldItems',
        executionDate: new Date().setHours(2, 0, 0, 0),
        recurring: true,
        interval: 24 * 60 * 60 * 1000 // 24 hours
    });

    logger.info('Cleanup job scheduled');
}
```

## Plugin Registration

### In Application Configuration

Register your plugin in the application configuration:

```json
{
    "plugins": [
        "plugins/my-app/plugin.js"
    ]
}
```

### Plugin Loading Order

Plugins are loaded in the order specified:

```json
{
    "plugins": [
        "plugins/core/plugin.js",      // Loaded first
        "plugins/auth/plugin.js",      // Loaded second
        "plugins/my-app/plugin.js"     // Loaded last
    ]
}
```

## Plugin Best Practices

### 1. Service Organization

Organize services by domain:

```javascript
// Good: Domain-specific services
context.registerService('UserService', new UserService(...));
context.registerService('ProductService', new ProductService(...));
context.registerService('OrderService', new OrderService(...));

// Avoid: Generic services
context.registerService('DataService', new DataService(...));
```

### 2. Error Handling

Always handle errors gracefully:

```javascript
try {
    const result = await service.operation();
    return result;
} catch (error) {
    this.logger.error('Operation failed', { error });
    throw new CustomError('Operation failed', { cause: error });
}
```

### 3. Logging

Use structured logging:

```javascript
this.logger.info('User created', { 
    userId: user.id, 
    email: user.email,
    source: 'registration'
});
```

### 4. Configuration

Make services configurable:

```javascript
export default class ConfigurableService {
    constructor({ logger, datastore, config }) {
        this.logger = logger;
        this.datastore = datastore;
        this.config = config.getNamespace('myService');
    }
}
```

### 5. Testing

Make services testable:

```javascript
// Inject dependencies
export default class TestableService {
    constructor({ logger, datastore, externalAPI }) {
        this.logger = logger;
        this.datastore = datastore;
        this.externalAPI = externalAPI;
    }
}
```

## Plugin Testing

### Unit Testing

Test individual services:

```javascript
// test/services/item-service.test.js
import ItemService from '../../plugins/my-app/services/item-service.js';

describe('ItemService', () => {
    let service;
    let mockDatastore;
    let mockLogger;

    beforeEach(() => {
        mockDatastore = {
            getItem: jest.fn(),
            setItem: jest.fn(),
            updateItem: jest.fn(),
            deleteItem: jest.fn()
        };
        mockLogger = {
            info: jest.fn(),
            error: jest.fn()
        };
        service = new ItemService({ logger: mockLogger, datastore: mockDatastore });
    });

    test('should create item', async () => {
        const itemData = { title: 'Test Item', description: 'Test Description' };
        mockDatastore.setItem.mockResolvedValue();

        const result = await service.createItem(itemData);

        expect(result.title).toBe(itemData.title);
        expect(result.id).toMatch(/^item:/);
        expect(mockDatastore.setItem).toHaveBeenCalled();
    });
});
```

## Next Steps

After creating custom plugins, proceed to:

- [Step 6: Application Entry Point](../step-6-application-entry-point.md)
- [Step 7: Progressive Enhancement](../step-7-progressive-enhancement.md)
- [Step 8: Data Management](../step-8-data-management.md) 