# Application Framework

The Application module provides all core components of a Kixx application. It serves as the central hub that brings together configuration, routing, services, and the HTTP server into a cohesive web application.

## Architecture Overview

The application framework follows a layered architecture with clear separation of concerns:

```
Application (Main Entry Point)
    ↓
ApplicationServer (HTTP Server + Routing)
    ↓
Context (Service Registry)
    ↓
Core Services (Datastore, ObjectStore, JobQueue, ViewService)
    ↓
Plugin System (Middleware, Handlers, Error Handlers)
```

## Core Components

### Application Initialization (`application.js`)
The main entry point for initializing a Kixx application.

**Key Features:**
- **Configuration Loading**: Loads environment-specific config from JSON files
- **Logger Setup**: Creates and configures application logging
- **Plugin System**: Dynamically loads and initializes plugin modules
- **Service Wiring**: Connects all core services together

**Usage:**
```javascript
import { initialize } from './application/application.js';

const context = await initialize('./kixx-config.json', 'development');
```

### Application Server (`application-server.js`)
Extends the base HTTP server with application-specific features.

**Key Features:**
- **HTTP Server**: Extends base HTTP server with application features
- **Dynamic Routing**: Loads virtual hosts and routes on each request (hot-reloading)
- **Plugin Integration**: Automatically loads middleware, handlers, and error handlers
- **Request/Response Handling**: Creates framework-specific request/response objects

**Usage:**
```javascript
import ApplicationServer from './application/application-server.js';

const server = await ApplicationServer.load(context, { port: 3000 });
server.startServer();
```

### Application Context (`context.js`)
Central registry for all application services and resources.

**Key Features:**
- **Service Registry**: Central registry for all application services
- **Core Services**: Manages Datastore, ObjectStore, JobQueue, and ViewService
- **Service Access**: Provides consistent interface for accessing services
- **Lifecycle Management**: Handles service initialization and cleanup

**Usage:**
```javascript
const datastore = context.getService('kixx.Datastore');
const jobQueue = context.getService('kixx.JobQueue');
const viewService = context.getService('kixx.AppViewService');
```

### Path Management (`paths.js`)
Defines and manages application directory structure and resource paths.

**Key Features:**
- **Directory Structure**: Defines standard application directory layout
- **Plugin Discovery**: Automatically discovers and loads plugin modules
- **Resource Paths**: Provides paths to all application resources

**Usage:**
```javascript
import Paths from './application/paths.js';

const paths = new Paths('/path/to/app');
const plugins = await paths.getPlugins();
```

### Configuration Management (`config.js`)
Handles application configuration with environment support and secret management.

**Key Features:**
- **Environment Support**: Loads environment-specific configurations
- **Secret Management**: Handles sensitive configuration data
- **Namespace Access**: Provides organized access to configuration sections
- **Change Notifications**: Emits events when configuration changes

**Usage:**
```javascript
import Config from './application/config.js';

const config = await Config.loadConfigs('./kixx-config.json', 'production');
const serverConfig = config.getNamespace('server');
const dbSecrets = config.getSecrets('database');
```

### Route Configuration (`routes-config.js`)
Loads and manages virtual host and route configurations.

**Key Features:**
- **Virtual Host Loading**: Loads and validates virtual host configurations
- **Route Resolution**: Resolves route URNs (app:// and kixx://)
- **Middleware Assignment**: Assigns middleware and handlers to routes
- **Configuration Validation**: Validates route and virtual host specifications

**Usage:**
```javascript
import RoutesConfig from './application/routes-config.js';

const routesConfig = new RoutesConfig(paths);
const virtualHosts = await routesConfig.loadVirtualHosts(middleware, handlers, errorHandlers);
```

## Plugin Development

### Plugin Entry Point (`plugins/my-plugin/my-plugin.js`)
```javascript
export function register(context) {
    // Register services, middleware, etc.
    console.log('My plugin registered');
}

export async function initialize(context) {
    // Initialize plugin resources
    console.log('My plugin initialized');
}
```

## Application Startup

### Main Server File (`server.js`)
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

## Built-in Services

### Datastore
Key-value store for simple data persistence:
```javascript
const datastore = context.getService('kixx.Datastore');
await datastore.set('users', userData);
const users = await datastore.get('users');
```

### JobQueue
Background job processing:
```javascript
const jobQueue = context.getService('kixx.JobQueue');
jobQueue.registerJobHandler('sendEmail', async (params) => {
    await emailService.send(params.to, params.subject, params.body);
});

await jobQueue.scheduleJob({
    methodName: 'sendEmail',
    params: { to: 'user@example.com', subject: 'Hello', body: 'Welcome!' }
});
```

### ViewService
Template rendering and page management:
```javascript
const viewService = context.getService('kixx.AppViewService');
const html = await viewService.renderPage('/about', pageData);
```

## Best Practices

### 1. **Configuration Management**
- Use environment-specific configurations
- Keep secrets separate from main config
- Use namespaces for organized configuration

### 2. **Plugin Development**
- Keep plugins focused and modular
- Use consistent naming conventions
- Handle errors gracefully in plugins

### 3. **Route Organization**
- Group related routes together
- Use nested routes for shared middleware
- Provide appropriate error handlers

### 4. **Service Usage**
- Access services through context
- Handle service errors appropriately
- Clean up resources when needed

### 5. **Template Design**
- Use base templates for consistency
- Create reusable partials
- Separate data from presentation
