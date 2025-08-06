# The Kixx Datastore
Data management in Kixx applications is handled through the Datastore service, which provides a file-backed, document-oriented storage system with in-memory caching, optimistic concurrency control, and powerful querying capabilities.

## API Reference

### Data Types

```javascript
/**
 * Document structure with automatic revision management
 * @typedef {Object} Document
 * @property {number} _rev - Revision number for optimistic concurrency control
 * @property {*} [*] - Any additional document properties
 */

/**
 * Query result with pagination support
 * @typedef {Object} QueryResult
 * @property {number|null} exclusiveEndIndex - Index for next page, or null if no more results
 * @property {Array<Object>} items - Array of query result items
 * @property {string|number} items[].key - Document key
 * @property {Document} [items[].document] - Full document object (when includeDocuments is true)
 * @property {*} [items[].value] - Emitted value (only for view queries)
 */

/**
 * Update function signature
 * @typedef {Function} UpdateFunction
 * @param {Document|null} currentDocument - Current document or null if doesn't exist
 * @returns {Document|Promise<Document>} Updated document
 */
```

### Method Signatures

```javascript
// Core CRUD operations
async getItem(key: string|number): Promise<Document|null>
async setItem(key: string|number, document: Object, options?: { checkConsistency?: boolean }): Promise<Document>
async updateItem(key: string|number, updateFunction: UpdateFunction, options?: { checkConsistency?: boolean }): Promise<Document>
async deleteItem(key: string|number): Promise<string|number>

// Query operations
async queryKeys(options: Object): Promise<QueryResult>
async queryView(viewId: string, options: Object): Promise<QueryResult>

// Lifecycle
async load(): Promise<Datastore>
```

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

// The _rev property is automatically managed by the datastore
console.log(item._rev); // 0 (first revision)

// Generate unique IDs
const id = `item:${ randomUUID() }`;
const item = await datastore.setItem(id, itemData);
```

### Reading Documents

```javascript
// Get a single document
const item = await datastore.getItem('item:123');
// Returns Document|null (deep cloned document or null if not found)

// Check if document exists
if (item) {
    // Document exists
    console.log(item._rev); // Current revision number
} else {
    // Document doesn't exist
}

// Get multiple documents
const result = await datastore.queryKeys({
    startKey: 'item:',
    endKey: 'item:\uffff',
    includeDocuments: true,
    limit: 10
});
// Returns QueryResult with items array and pagination info
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
// Returns Document with updated _rev property

// Update with conflict handling
try {
    const updatedItem = await datastore.updateItem('item:123', (currentItem) => {
        return { ...currentItem, price: 39.99 };
    });
} catch (error) {
    if (error.code === 'CONFLICT_ERROR') {
        // Handle concurrent modification
        // Retry or show error to user
    }
}

// Update with consistency check disabled
const updatedItem = await datastore.updateItem('item:123', (currentItem) => {
    return { ...currentItem, price: 39.99 };
}, { checkConsistency: false });
```

### Deleting Documents

```javascript
// Delete a document
const deletedKey = await datastore.deleteItem('item:123');
// Returns Promise<string|number> - the deleted key

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
    inclusiveStartIndex: 0
});
// Returns QueryResult object:
// {
//   exclusiveEndIndex: number|null, // Index for next page, or null if no more results
//   items: [
//     {
//       key: 'item:123',
//       document: { /* full document object */ } // Only when includeDocuments is true
//     },
//     // ... more items
//   ]
// }

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
    inclusiveStartIndex: 40, // Skip first 40 items
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
// Returns QueryResult with items array containing key, value, and optional document
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
        if (error.code === 'CONFLICT_ERROR') {
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