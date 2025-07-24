# Creating Custom Plugins
A custom plugin is where all the magic happens in a Kixx web application. Most of the common functionality expected from a website comes pre-configured out of the box with Kixx, but custom plugins is where you get to role your sleeves up and build something unique.

## Plugin Structure
```
plugins/
└── my-app/                          # Named plugin directory.
    ├── plugin.js                    # Main plugin entry point (must be named "plugin.js").
    ├── services/                    # Business logic services
    │   ├── one-service.js
    │   └── two-service.js
    ├── request-handlers/            # Custom HTTP request handlers.
    │   ├── route-a-handler.js
    │   └── route-b-handler.js
    ├── middleware/                  # Inbound and outbound middleware.
    │   ├── auth-middleware.js
    │   └── cookie-middleware.js
    ├── error-handlers/              # Custom error handling
    │   └── custom-error-handler.js
    ├── jobs/                        # Background jobs
    │   └── cleanup-job.js
    ├── lib/                         # Libraries and utilities
    │   └── utils.js
    └── models/
        └── item-model.js            # Data models
```

## Plugin Structure
Plugins are installed and initialized automatically just by placing them in the `plugins/` directory as outlined above. More details and examples are provided below.

### Main Plugin File
If the main plugin file is not named "plugin.js" it must end in "plugin.js".

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

## Request Handlers

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

## Middleware

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

## Error Handlers

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