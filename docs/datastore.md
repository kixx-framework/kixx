# The Kixx Datastore
Data management in Kixx applications is handled through the Datastore service, which provides a file-backed, document-oriented storage system with in-memory caching, optimistic concurrency control, and powerful querying capabilities. Understanding how to effectively use the datastore is crucial for building scalable hypermedia applications.

## Datastore Architecture

### Core Components

The datastore consists of several key components:

```javascript
const datastore = context.getService('kixx.Datastore');
```

Components:

- Document storage (JSON files)
- In-memory cache (all documents loaded at startup)
- Views (for complex queries)
- Indexing (for fast lookups)
- Concurrency control (optimistic locking)

### In-Memory Caching

The datastore loads all documents into memory at startup for fast access:

This provides:

- Fast read access
- No disk I/O for reads
- Immediate consistency
- Requires entire dataset to fit in RAM

Memory usage considerations:

- Monitor memory usage
- Consider data archiving for large datasets
- Use views for efficient queries

## Basic Operations

### Creating Documents

```javascript
// Create a new document
const item = await datastore.setItem('item:123', {
    title: 'Sample Item',
    description: 'This is a sample item',
    price: 29.99,
    category: 'electronics',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
});

// Generate unique IDs
const id = `item:${ randomUUID() }`;
const item = await datastore.setItem(id, itemData);
```

### Reading Documents

```javascript
// Get a single document
const item = await datastore.getItem('item:123');

// Check if document exists
try {
    const item = await datastore.getItem('item:123');
    // Document exists
} catch (error) {
    if (error.name === 'NotFoundError') {
        // Document doesn't exist
    }
}

// Get multiple documents
const result = await datastore.queryKeys({
    startKey: 'item:',
    endKey: 'item:\uffff',
    includeDocuments: true,
    limit: 10
});
```

### Updating Documents

```javascript
// Update with optimistic concurrency control
const updatedItem = await datastore.updateItem('item:123', (currentItem) => {
    if (!currentItem) {
        throw new Error('Item not found');
    }
    
    return {
        ...currentItem,
        title: 'Updated Title',
        updatedAt: new Date().toISOString()
    };
});

// Update with conflict handling
try {
    const updatedItem = await datastore.updateItem('item:123', (currentItem) => {
        return { ...currentItem, price: 39.99 };
    });
} catch (error) {
    if (error.name === 'ConflictError') {
        // Handle concurrent modification
        // Retry or show error to user
    }
}
```

### Deleting Documents

```javascript
// Delete a document
await datastore.deleteItem('item:123');

// Soft delete (mark as deleted)
await datastore.updateItem('item:123', (currentItem) => {
    return {
        ...currentItem,
        deletedAt: new Date().toISOString(),
        deleted: true
    };
});
```

## Querying Data

### Key-Based Queries

```javascript
// Query by key prefix
const result = await datastore.queryKeys({
    startKey: 'item:',
    endKey: 'item:\uffff',
    includeDocuments: true,
    limit: 50,
    offset: 0
});

// Query specific range
const result = await datastore.queryKeys({
    startKey: 'item:2024-01-01',
    endKey: 'item:2024-01-31',
    includeDocuments: true
});

// Query with pagination
const result = await datastore.queryKeys({
    startKey: 'item:',
    endKey: 'item:\uffff',
    includeDocuments: true,
    limit: 20,
    offset: 40, // Skip first 40 items
    descending: true // Most recent first
});
```

### Views for Complex Queries

```javascript
// Create a view for category-based queries
const engine = datastore._db;
engine.setView('itemsByCategory', {
    map: function(document, emit) {
        if (document.type === 'item' && document.category) {
            emit(document.category, {
                id: document.id,
                title: document.title,
                price: document.price,
                createdAt: document.createdAt
            });
        }
    }
});

// Query using the view
const result = await datastore.queryView('itemsByCategory', {
    startKey: 'electronics',
    endKey: 'electronics\uffff',
    includeDocuments: true,
    limit: 20
});
```

### Advanced Views

```javascript
// Multi-field view
engine.setView('itemsByPriceRange', {
    map: function(document, emit) {
        if (document.type === 'item' && document.price) {
            const priceRange = Math.floor(document.price / 10) * 10;
            emit(`${priceRange}-${priceRange + 9}`, {
                id: document.id,
                title: document.title,
                price: document.price,
                category: document.category
            });
        }
    }
});

// Date-based view
engine.setView('itemsByDate', {
    map: function(document, emit) {
        if (document.type === 'item' && document.createdAt) {
            const date = new Date(document.createdAt);
            const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
            emit(dateKey, {
                id: document.id,
                title: document.title,
                createdAt: document.createdAt
            });
        }
    }
});
```

## Data Modeling

### Document Structure

Design your documents for efficient querying:

```javascript
// Good document structure
const item = {
    id: 'item:123',
    type: 'item',           // Document type for filtering
    title: 'Sample Item',
    description: 'Description here',
    price: 29.99,
    category: 'electronics',
    tags: ['gadget', 'tech'],
    metadata: {
        sku: 'SKU123',
        weight: 0.5,
        dimensions: { width: 10, height: 5, depth: 2 }
    },
    status: 'active',       // For soft deletes
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z'
};

// User document
const user = {
    id: 'user:456',
    type: 'user',
    email: 'user@example.com',
    name: 'John Doe',
    role: 'customer',
    preferences: {
        newsletter: true,
        theme: 'dark'
    },
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z'
};
```

### Key Naming Conventions

Use consistent key naming for efficient querying:

```javascript
// Key naming patterns
const keys = {
    // Simple items
    item: 'item:123',
    
    // User items
    userItem: 'user:456:item:123',
    
    // Date-based items
    dateItem: 'item:2024-01-15:123',
    
    // Category-based items
    categoryItem: 'item:electronics:123',
    
    // Composite keys
    composite: 'order:2024-01-15:456:item:123'
};

// Query patterns
const queries = {
    // All items
    allItems: { startKey: 'item:', endKey: 'item:\uffff' },
    
    // User's items
    userItems: { startKey: 'user:456:item:', endKey: 'user:456:item:\uffff' },
    
    // Items by date
    dateItems: { startKey: 'item:2024-01-15:', endKey: 'item:2024-01-15:\uffff' },
    
    // Items by category
    categoryItems: { startKey: 'item:electronics:', endKey: 'item:electronics:\uffff' }
};
```

## Concurrency Control

### Optimistic Locking

The datastore uses optimistic concurrency control:

```javascript
// Concurrent updates
async function updateItemPrice(id, newPrice) {
    try {
        const updatedItem = await datastore.updateItem(id, (currentItem) => {
            return {
                ...currentItem,
                price: newPrice,
                updatedAt: new Date().toISOString()
            };
        });
        return updatedItem;
    } catch (error) {
        if (error.name === 'ConflictError') {
            // Another process modified the document
            // Retry or handle conflict
            throw new Error('Item was modified by another user. Please try again.');
        }
        throw error;
    }
}

// Retry logic
async function updateWithRetry(id, newPrice, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await updateItemPrice(id, newPrice);
        } catch (error) {
            if (error.message.includes('modified by another user') && attempt < maxRetries) {
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                continue;
            }
            throw error;
        }
    }
}
```

### Conflict Resolution

Handle conflicts gracefully:

```javascript
// Conflict resolution strategies
class ConflictResolver {
    static async resolveUpdate(id, updateFunction, strategy = 'retry') {
        switch (strategy) {
            case 'retry':
                return this.retryStrategy(id, updateFunction);
            case 'merge':
                return this.mergeStrategy(id, updateFunction);
            case 'last-wins':
                return this.lastWinsStrategy(id, updateFunction);
            default:
                throw new Error('Unknown conflict resolution strategy');
        }
    }
    
    static async retryStrategy(id, updateFunction, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await datastore.updateItem(id, updateFunction);
            } catch (error) {
                if (error.name === 'ConflictError' && attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                    continue;
                }
                throw error;
            }
        }
    }
    
    static async mergeStrategy(id, updateFunction) {
        // Implement merge logic for complex conflicts
        // This would compare changes and merge them intelligently
    }
    
    static async lastWinsStrategy(id, updateFunction) {
        // Force update, overwriting any concurrent changes
        const currentItem = await datastore.getItem(id);
        const updatedItem = updateFunction(currentItem);
        return await datastore.setItem(id, updatedItem);
    }
}
```

## Performance Optimization

### Efficient Queries

Optimize your queries for performance:

```javascript
// Efficient querying patterns
class QueryOptimizer {
    // Use views for complex queries
    static async getItemsByCategory(category, options = {}) {
        return await datastore.queryView('itemsByCategory', {
            startKey: category,
            endKey: category + '\uffff',
            includeDocuments: true,
            limit: options.limit || 50,
            offset: options.offset || 0
        });
    }
    
    // Use pagination for large datasets
    static async getItemsPaginated(page = 1, pageSize = 20) {
        const offset = (page - 1) * pageSize;
        return await datastore.queryKeys({
            startKey: 'item:',
            endKey: 'item:\uffff',
            includeDocuments: true,
            limit: pageSize,
            offset: offset
        });
    }
    
    // Use specific key ranges
    static async getRecentItems(days = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const startKey = `item:${cutoffDate.toISOString().split('T')[0]}`;
        
        return await datastore.queryKeys({
            startKey: startKey,
            endKey: 'item:\uffff',
            includeDocuments: true,
            limit: 100,
            descending: true
        });
    }
}
```

### Memory Management

Monitor and manage memory usage:

```javascript
// Memory monitoring
class MemoryMonitor {
    static getMemoryUsage() {
        const usage = process.memoryUsage();
        return {
            rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
            external: `${Math.round(usage.external / 1024 / 1024)}MB`
        };
    }
    
    static logMemoryUsage(logger) {
        const usage = this.getMemoryUsage();
        logger.info('Memory usage', usage);
    }
    
    // Monitor datastore size
    static async getDatastoreStats(datastore) {
        const result = await datastore.queryKeys({
            startKey: '',
            endKey: '\uffff',
            includeDocuments: false
        });
        
        return {
            totalDocuments: result.total,
            estimatedSize: `${Math.round(result.total * 1024 / 1024)}MB` // Rough estimate
        };
    }
}
```

## Data Migration

### Schema Evolution

Handle schema changes gracefully:

```javascript
// Schema migration utility
class SchemaMigrator {
    static async migrateDocuments(datastore, migrationFunction) {
        const result = await datastore.queryKeys({
            startKey: '',
            endKey: '\uffff',
            includeDocuments: true
        });
        
        let migrated = 0;
        let errors = 0;
        
        for (const item of result.items) {
            try {
                const migratedDocument = migrationFunction(item.document);
                await datastore.setItem(item.key, migratedDocument);
                migrated++;
            } catch (error) {
                console.error(`Migration failed for ${item.key}:`, error);
                errors++;
            }
        }
        
        return { migrated, errors, total: result.total };
    }
    
    // Example migration: Add new field
    static async addNewField(datastore, fieldName, defaultValue) {
        return await this.migrateDocuments(datastore, (document) => {
            if (!(fieldName in document)) {
                return { ...document, [fieldName]: defaultValue };
            }
            return document;
        });
    }
    
    // Example migration: Rename field
    static async renameField(datastore, oldField, newField) {
        return await this.migrateDocuments(datastore, (document) => {
            if (oldField in document && !(newField in document)) {
                const { [oldField]: value, ...rest } = document;
                return { ...rest, [newField]: value };
            }
            return document;
        });
    }
}
```

## Backup and Recovery

### Data Backup

Implement backup strategies:

```javascript
// Backup utility
class DataBackup {
    static async createBackup(datastore, backupPath) {
        const result = await datastore.queryKeys({
            startKey: '',
            endKey: '\uffff',
            includeDocuments: true
        });
        
        const backup = {
            timestamp: new Date().toISOString(),
            version: '1.0',
            documents: result.items.map(item => ({
                key: item.key,
                document: item.document
            }))
        };
        
        // Write backup to file
        const fs = await import('fs/promises');
        await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
        
        return {
            path: backupPath,
            documentCount: result.total,
            size: `${Math.round(JSON.stringify(backup).length / 1024)}KB`
        };
    }
    
    static async restoreBackup(datastore, backupPath) {
        const fs = await import('fs/promises');
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        
        let restored = 0;
        let errors = 0;
        
        for (const item of backupData.documents) {
            try {
                await datastore.setItem(item.key, item.document);
                restored++;
            } catch (error) {
                console.error(`Restore failed for ${item.key}:`, error);
                errors++;
            }
        }
        
        return { restored, errors, total: backupData.documents.length };
    }
}
```

## Best Practices

### 1. Key Design

Design keys for efficient querying:

```javascript
// Good key design
const goodKeys = {
    // Hierarchical
    userOrder: 'user:123:order:456',
    
    // Date-based
    dateItem: 'item:2024-01-15:789',
    
    // Category-based
    categoryItem: 'item:electronics:101',
    
    // Composite
    composite: 'order:2024-01-15:456:item:789'
};

// Avoid
const badKeys = {
    // Random IDs (hard to query)
    random: 'item:abc123def456',
    
    // No structure
    unstructured: 'item123'
};
```

### 2. Document Design

Design documents for your use cases:

```javascript
// Good document design
const goodDocument = {
    id: 'item:123',
    type: 'item',           // For filtering
    title: 'Sample Item',
    category: 'electronics',
    status: 'active',       // For soft deletes
    metadata: {             // Group related fields
        sku: 'SKU123',
        weight: 0.5
    },
    timestamps: {           // Group timestamps
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z'
    }
};
```

### 3. Query Optimization

Optimize queries for performance:

```javascript
// Use views for complex queries
engine.setView('itemsByCategory', {
    map: function(document, emit) {
        if (document.type === 'item' && document.category) {
            emit(document.category, document);
        }
    }
});

// Use pagination for large datasets
const result = await datastore.queryKeys({
    startKey: 'item:',
    endKey: 'item:\uffff',
    includeDocuments: true,
    limit: 20,  // Reasonable page size
    offset: 0
});
```

### 4. Error Handling

Handle errors gracefully:

```javascript
// Robust error handling
async function safeGetItem(id) {
    try {
        return await datastore.getItem(id);
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return null;
        }
        throw error;
    }
}

async function safeUpdateItem(id, updateFunction) {
    try {
        return await datastore.updateItem(id, updateFunction);
    } catch (error) {
        if (error.name === 'ConflictError') {
            // Handle concurrent modification
            throw new Error('Item was modified by another user');
        }
        throw error;
    }
}
```
