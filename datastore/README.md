# Datastore

The Datastore module provides a high-level, document-oriented API for managing persistent data using a file-based backend. It supports atomic operations, optimistic concurrency control, revision tracking, and view-based querying.

## Architecture Overview

The datastore follows a layered architecture with clear separation of concerns:

```
Datastore (High-Level API)
    ↓
DatastoreEngine (Core Storage & Indexing)
    ↓
File System (Persistence)
```

**Important:** The datastore uses an **in-memory caching strategy** where all documents are loaded into application memory at startup and kept there for the entire runtime. This provides fast read/write performance but means the entire dataset must fit in available RAM.

## Core Components

### Datastore
The main high-level API that provides a simple interface for document management. Wraps the DatastoreEngine and provides concurrency control.

**Key Features:**
- Atomic get/set/update/delete operations with revision (_rev) support
- Optimistic concurrency control to prevent lost updates
- Locking queue for safe concurrent access in async environments
- Querying by key range or custom views, with pagination and sorting

### DatastoreEngine
The core storage engine that handles document persistence, indexing, and view management.

**Key Features:**
- File-backed document persistence with in-memory caching
- All documents loaded into memory at startup for fast access
- In-memory indexing for fast queries
- View registration and querying
- Key range queries with pagination and sorting

## Basic Usage

### Initialization

```javascript
import { Datastore } from './datastore/mod.js';

// Create a new datastore instance
const datastore = new Datastore({ 
    directory: '/path/to/data' 
});

// Load all documents from disk into memory
await datastore.load();
```

### Basic Operations

```javascript
// Store a document
const user = {
    name: 'John Doe',
    email: 'john@example.com',
    createdAt: new Date().toISOString()
};

const savedUser = await datastore.setItem('user:123', user);
console.log(savedUser._rev); // 0 (first revision)

// Retrieve a document
const retrievedUser = await datastore.getItem('user:123');
console.log(retrievedUser.name); // 'John Doe'

// Update a document
const updatedUser = await datastore.updateItem('user:123', (currentUser) => {
    return {
        ...currentUser,
        lastLogin: new Date().toISOString()
    };
});
console.log(updatedUser._rev); // 1 (incremented revision)

// Delete a document
await datastore.deleteItem('user:123');
```

## Document Structure

Documents in the datastore are plain JavaScript objects with an optional `_rev` property for revision tracking:

```javascript
{
    "_rev": 2,           // Revision number (auto-managed)
    "name": "John Doe",  // Your custom properties
    "email": "john@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### Revision Control

The datastore automatically manages document revisions to prevent lost updates:

```javascript
// First, get a document
const user1 = await datastore.getItem('user:123');

// Simulate another process updating the same document
await datastore.updateItem('user:123', (user) => {
    user.lastLogin = new Date().toISOString();
    return user;
});

// This will throw a ConflictError because the document has been modified
try {
    await datastore.setItem('user:123', user1); // Uses old revision
} catch (error) {
    console.log('Conflict detected:', error.message);
}

// To update safely, use the current version
const currentUser = await datastore.getItem('user:123');
currentUser.name = 'Jane Doe';
await datastore.setItem('user:123', currentUser); // Uses current revision
```

## Querying

### Key Range Queries

Query documents by key range with pagination and sorting:

```javascript
// Query all users
const result = await datastore.queryKeys({
    startKey: 'user:',
    endKey: 'user:\uffff',
    limit: 10,
    includeDocuments: true
});

console.log(`Found ${result.items.length} users`);
console.log(`Next page starts at index: ${result.exclusiveEndIndex}`);

// Query with pagination
const page2 = await datastore.queryKeys({
    startKey: 'user:',
    endKey: 'user:\uffff',
    inclusiveStartIndex: result.exclusiveEndIndex,
    limit: 10,
    includeDocuments: true
});

// Query in descending order
const recentUsers = await datastore.queryKeys({
    startKey: 'user:',
    endKey: 'user:\uffff',
    descending: true,
    limit: 5,
    includeDocuments: true
});
```

### View-Based Queries

Create custom views for complex querying patterns:

```javascript
import { DatastoreEngine } from './datastore/mod.js';

// Create a view for active users
const activeUsersView = {
    map: function(document, emit) {
        if (document.status === 'active') {
            emit(document.email, {
                name: document.name,
                lastLogin: document.lastLogin
            });
        }
    }
};

// Register the view with the engine
const engine = datastore._db; // Access the underlying engine
engine.setView('activeUsers', activeUsersView);

// Query the view
const activeUsers = await datastore.queryView('activeUsers', {
    limit: 20,
    includeDocuments: true
});

console.log('Active users:', activeUsers.items);
```

### Complex View Examples

```javascript
// View for users by registration date
const usersByDateView = {
    map: function(document, emit) {
        const date = document.createdAt.split('T')[0]; // YYYY-MM-DD
        emit(date, {
            id: document.id,
            name: document.name,
            email: document.email
        });
    }
};

// View for user statistics
const userStatsView = {
    map: function(document, emit) {
        const month = document.createdAt.substring(0, 7); // YYYY-MM
        emit(month, 1); // Count users per month
    }
};

// Register views
engine.setView('usersByDate', usersByDateView);
engine.setView('userStats', userStatsView);

// Query users registered in January 2024
const janUsers = await datastore.queryView('usersByDate', {
    startKey: '2024-01',
    endKey: '2024-01\uffff',
    includeDocuments: true
});
```

## Configuration Options

### Datastore Options

```javascript
const datastore = new Datastore({
    directory: '/path/to/data',        // Required: Data storage directory
    db: customEngine,                  // Optional: Custom engine instance
    lockingQueue: customLockingQueue   // Optional: Custom locking queue
});
```

### Query Options

```javascript
const options = {
    startKey: 'user:',                 // Start of key range
    endKey: 'user:\uffff',            // End of key range
    key: 'user:123',                   // Specific key (overrides range)
    descending: false,                 // Sort order (default: ascending)
    inclusiveStartIndex: 0,           // Pagination start index
    limit: 10,                        // Maximum results (default: 10)
    includeDocuments: false           // Include full documents in results
};
```

## Advanced Usage

### Custom Engine Integration

```javascript
import { DatastoreEngine } from './datastore/mod.js';

// Create a custom engine with specific configuration
const engine = new DatastoreEngine({
    directory: '/custom/data/path',
    fileSystem: customFileSystem // Optional custom file system
});

// Create datastore with custom engine
const datastore = new Datastore({
    db: engine
});
```

### Batch Operations

```javascript
// Load multiple documents efficiently
const userIds = ['user:1', 'user:2', 'user:3'];
const users = [];

for (const id of userIds) {
    const user = await datastore.getItem(id);
    if (user) {
        users.push(user);
    }
}

// Update multiple documents
for (const user of users) {
    await datastore.updateItem(user.id, (currentUser) => {
        return {
            ...currentUser,
            lastSync: new Date().toISOString()
        };
    });
}
```

### Error Handling

```javascript
try {
    await datastore.setItem('user:123', userData);
} catch (error) {
    if (error.code === 'CONFLICT') {
        // Handle revision conflict
        console.log('Document was modified by another process');
    } else if (error.code === 'ASSERTION') {
        // Handle validation errors
        console.log('Invalid document format');
    } else {
        // Handle other errors
        console.error('Unexpected error:', error);
    }
}
```

## File Storage Format

Documents are stored as JSON files in the specified directory:

```
/data/
├── user%3A123.json
├── user%3A456.json
├── post%3A789.json
└── settings.json
```

### Document File Format

```json
{
    "_rev": 2,
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "lastLogin": "2024-01-15T10:30:00.000Z"
}
```

## Performance Considerations

### Memory Usage
- **All documents are loaded into memory at startup** and kept there for the entire runtime
- The entire dataset must fit in available RAM
- Large datasets may consume significant memory and affect application performance
- Consider using views for filtering large datasets
- Memory usage scales linearly with the number and size of documents

### File I/O
- Documents are written to disk on each update for persistence
- Reads are served from memory cache (no disk I/O for reads)
- Consider batching updates for better performance
- File system performance affects write performance but not read performance

### Concurrency
- Uses locking queue for safe concurrent access
- Multiple processes can safely access the same datastore
- Optimistic concurrency control prevents lost updates

## Best Practices

### Memory Management
1. **Monitor memory usage**: Track RAM consumption as your dataset grows
2. **Size your dataset appropriately**: Ensure your total data fits comfortably in available RAM
3. **Consider data archiving**: Move old/inactive data to separate storage if needed
4. **Use memory-efficient document structures**: Avoid storing large binary data in documents

### Document Design
1. **Use meaningful keys**: `user:123`, `post:456`, `settings:global`
2. **Keep documents focused**: Don't store everything in one document
3. **Use consistent naming**: Follow a consistent key naming convention
4. **Include metadata**: Add `createdAt`, `updatedAt`, `version` fields

### Query Optimization
1. **Use views for complex queries**: Create views for common query patterns
2. **Limit result sets**: Always use `limit` to prevent memory issues
3. **Use key ranges**: Leverage key-based queries for better performance
4. **Memory-first design**: All queries are served from memory, making them very fast

### Error Handling
1. **Handle conflicts gracefully**: Implement retry logic for concurrent updates
2. **Validate documents**: Ensure documents meet your schema requirements
3. **Log errors appropriately**: Include context in error logs
4. **Use transactions carefully**: Consider the impact of failed operations

## Use Cases and Limitations

### Ideal Use Cases
- **Small to medium datasets** that fit comfortably in RAM
- **High-read applications** where fast access is critical
- **Development and testing** environments
- **Configuration storage** and application state
- **Caching layers** for frequently accessed data

### Limitations
- **Memory constraints**: Total dataset must fit in available RAM
- **No partial loading**: All documents are loaded at startup
- **Restart required**: Changes to disk files require application restart
- **Not suitable for large datasets**: Consider alternative storage for datasets > several GB

## Real-World Examples

### User Management System

```javascript
// User service using datastore
class UserService {
    constructor(datastore) {
        this.datastore = datastore;
    }

    async createUser(userData) {
        const userId = `user:${Date.now()}`;
        const user = {
            ...userData,
            id: userId,
            createdAt: new Date().toISOString(),
            status: 'active'
        };

        return await this.datastore.setItem(userId, user);
    }

    async getUser(userId) {
        return await this.datastore.getItem(userId);
    }

    async updateUser(userId, updates) {
        return await this.datastore.updateItem(userId, (currentUser) => {
            return {
                ...currentUser,
                ...updates,
                updatedAt: new Date().toISOString()
            };
        });
    }

    async deleteUser(userId) {
        return await this.datastore.deleteItem(userId);
    }

    async getActiveUsers(limit = 20) {
        return await this.datastore.queryView('activeUsers', {
            limit,
            includeDocuments: true
        });
    }
}
```

### Blog Post System

```javascript
// Blog service with tagging
class BlogService {
    constructor(datastore) {
        this.datastore = datastore;
        this.setupViews();
    }

    setupViews() {
        const engine = this.datastore._db;
        
        // View for posts by tag
        engine.setView('postsByTag', {
            map: function(document, emit) {
                if (document.tags) {
                    document.tags.forEach(tag => {
                        emit(tag, {
                            id: document.id,
                            title: document.title,
                            author: document.author
                        });
                    });
                }
            }
        });

        // View for posts by author
        engine.setView('postsByAuthor', {
            map: function(document, emit) {
                emit(document.author, {
                    id: document.id,
                    title: document.title,
                    publishedAt: document.publishedAt
                });
            }
        });
    }

    async createPost(postData) {
        const postId = `post:${Date.now()}`;
        const post = {
            ...postData,
            id: postId,
            createdAt: new Date().toISOString(),
            publishedAt: postData.published ? new Date().toISOString() : null
        };

        return await this.datastore.setItem(postId, post);
    }

    async getPostsByTag(tag, limit = 10) {
        return await this.datastore.queryView('postsByTag', {
            key: tag,
            limit,
            includeDocuments: true
        });
    }

    async getPostsByAuthor(author, limit = 10) {
        return await this.datastore.queryView('postsByAuthor', {
            key: author,
            limit,
            includeDocuments: true
        });
    }
}
```