# Step 6: Application Entry Point

## Overview

The application entry point is the main file that initializes and starts your Kixx application. It's responsible for setting up the application context, loading configuration, starting services, and launching the HTTP server.

## Application Structure

### server.js

The main application entry point file:

```javascript
import { initialize } from './application/application.js';
import ApplicationServer from './application/application-server.js';

async function main() {
    try {
        // Initialize application context
        const context = await initialize('./kixx-config.json', process.env.NODE_ENV || 'development');
        
        // Load application server
        const server = await ApplicationServer.load(context, {
            port: context.config.getNamespace('server').port
        });
        
        // Start the server
        server.startServer();
        
        // Start job queue
        const jobQueue = context.getService('kixx.JobQueue');
        jobQueue.start();
        
        console.log(`🚀 Server running on port ${server.port}`);
        console.log(`📊 Environment: ${context.environment}`);
        console.log(`🔗 URL: http://localhost:${server.port}`);
        
        // Graceful shutdown handling
        setupGracefulShutdown(server, context);
        
    } catch (error) {
        console.error('❌ Failed to start application:', error);
        process.exit(1);
    }
}

function setupGracefulShutdown(server, context) {
    const shutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
        
        try {
            // Stop accepting new requests
            server.stopServer();
            
            // Stop job queue
            const jobQueue = context.getService('kixx.JobQueue');
            jobQueue.stop();
            
            // Close datastore connections
            const datastore = context.getService('kixx.Datastore');
            await datastore.close();
            
            console.log('✅ Graceful shutdown completed');
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    };
    
    // Handle shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start the application
main().catch(console.error);
```

## Application Initialization

### Environment Detection

The application automatically detects the environment:

```javascript
// Environment priority:
// 1. NODE_ENV environment variable
// 2. Command line argument
// 3. Default to 'development'

const environment = process.env.NODE_ENV || 'development';
const context = await initialize('./kixx-config.json', environment);
```

### Configuration Loading

Configuration is loaded from multiple sources:

```javascript
// Configuration sources (in order of precedence):
// 1. kixx-config.json (main configuration)
// 2. Environment-specific overrides
// 3. Environment variables
// 4. .secrets.json (sensitive data)

const config = context.config;
const serverPort = config.getNamespace('server').port;
const logLevel = config.getNamespace('logger').level;
```

## Service Initialization

### Core Services

Kixx provides several core services that are automatically initialized:

```javascript
// Core services available after initialization:
const datastore = context.getService('kixx.Datastore');      // Document storage
const objectStore = context.getService('kixx.ObjectStore');  // File storage
const jobQueue = context.getService('kixx.JobQueue');        // Background jobs
const viewService = context.getService('kixx.ViewService');  // Template rendering
const logger = context.logger;                               // Logging
```

### Custom Services

Custom services are initialized through plugins:

```javascript
// Custom services registered by plugins:
const itemService = context.getService('ItemService');
const userService = context.getService('UserService');
const emailService = context.getService('EmailService');
```

## Server Configuration

### HTTP Server Setup

The HTTP server is configured with various options:

```javascript
const server = await ApplicationServer.load(context, {
    port: 3000,                    // Server port
    hostname: 'localhost',         // Server hostname
    maxConnections: 1000,          // Maximum concurrent connections
    timeout: 30000,               // Request timeout (30 seconds)
    keepAlive: true,              // Enable keep-alive
    keepAliveTimeout: 5000        // Keep-alive timeout
});
```

### Virtual Host Configuration

Virtual hosts are configured for different domains:

```javascript
// virtual-hosts.json defines hostname routing
[
    {
        "name": "Main",
        "hostname": "com.myapp.www",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    },
    {
        "name": "API",
        "hostname": "api.myapp.com", 
        "routes": [
            "app://api.json"
        ]
    }
]
```

## Development vs Production

### Development Mode

Development mode includes additional features:

```javascript
// Development features:
// - Hot reloading
// - Detailed error messages
// - Debug logging
// - Development middleware

if (context.environment === 'development') {
    console.log('🔧 Development mode enabled');
    console.log('📝 Debug logging enabled');
    console.log('🔄 Hot reloading enabled');
}
```

### Production Mode

Production mode optimizes for performance and security:

```javascript
// Production optimizations:
// - Minified assets
// - Caching headers
// - Security headers
// - Performance monitoring

if (context.environment === 'production') {
    console.log('🚀 Production mode enabled');
    console.log('🔒 Security headers enabled');
    console.log('⚡ Performance optimizations enabled');
}
```

## Logging Configuration

### Logger Setup

The logger is configured based on the environment:

```javascript
// Logger configuration from kixx-config.json
const loggerConfig = context.config.getNamespace('logger');

// Development logging
if (context.environment === 'development') {
    // Console logging with colors
    context.logger.info('Application started in development mode');
    context.logger.debug('Debug information available');
}

// Production logging
if (context.environment === 'production') {
    // Structured logging to stdout
    context.logger.info('Application started in production mode');
}
```

### Log Levels

Different log levels for different environments:

```javascript
// Log levels:
// - error: Critical errors
// - warn: Warning messages
// - info: General information
// - debug: Debug information (development only)

context.logger.error('Critical error occurred', { error });
context.logger.warn('Warning: deprecated feature used');
context.logger.info('User logged in', { userId: user.id });
context.logger.debug('Request processed', { duration: '150ms' });
```

## Error Handling

### Startup Errors

Handle errors during application startup:

```javascript
async function main() {
    try {
        const context = await initialize('./kixx-config.json', 'development');
        // ... rest of initialization
    } catch (error) {
        console.error('❌ Failed to start application:', error);
        
        // Log detailed error information
        if (error.code === 'ENOTFOUND') {
            console.error('Configuration file not found');
        } else if (error.code === 'EADDRINUSE') {
            console.error('Port already in use');
        } else {
            console.error('Unknown error:', error.message);
        }
        
        process.exit(1);
    }
}
```

### Runtime Errors

Handle errors during application runtime:

```javascript
// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
```

## Health Checks

### Health Check Endpoint

Add a health check endpoint for monitoring:

```javascript
// Add to routes/health.json
[
    {
        "name": "HealthCheck",
        "pattern": "/health",
        "targets": [
            {
                "name": "HealthCheckHandler",
                "methods": ["GET"],
                "handlers": [
                    ["HealthCheckHandler"]
                ]
            }
        ]
    }
]
```

### Health Check Handler

```javascript
// plugins/my-app/request-handlers/health-check-handler.js
export default function HealthCheckHandler() {
    return async function healthCheckHandler(context, request, response) {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            environment: context.environment,
            version: context.config.getNamespace('version') || '1.0.0',
            services: {}
        };
        
        // Check datastore
        try {
            const datastore = context.getService('kixx.Datastore');
            await datastore.getItem('health-check');
            health.services.datastore = 'healthy';
        } catch (error) {
            health.services.datastore = 'unhealthy';
            health.status = 'degraded';
        }
        
        // Check job queue
        try {
            const jobQueue = context.getService('kixx.JobQueue');
            health.services.jobQueue = jobQueue.isRunning() ? 'healthy' : 'unhealthy';
        } catch (error) {
            health.services.jobQueue = 'unhealthy';
            health.status = 'degraded';
        }
        
        response.setHeader('Content-Type', 'application/json');
        response.body = JSON.stringify(health);
        
        return response;
    };
}
```

## Performance Monitoring

### Request Timing

Monitor request performance:

```javascript
// Middleware for request timing
export default function TimingMiddleware() {
    return async function timingMiddleware(context, request, response) {
        const startTime = Date.now();
        
        const result = await response;
        
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

### Memory Usage

Monitor memory usage:

```javascript
// Memory monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    context.logger.info('Memory usage', {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
    });
}, 60000); // Every minute
```

## Deployment Considerations

### Environment Variables

Use environment variables for configuration:

```bash
# Production environment variables
export NODE_ENV=production
export PORT=3001
export DATABASE_URL=postgresql://user:pass@host:5432/db
export API_SECRET=your-secret-key
export LOG_LEVEL=info
```

### Process Management

Use a process manager for production:

```json
// ecosystem.config.js (PM2)
{
    "apps": [{
        "name": "my-kixx-app",
        "script": "server.js",
        "instances": "max",
        "exec_mode": "cluster",
        "env": {
            "NODE_ENV": "production",
            "PORT": 3001
        },
        "env_production": {
            "NODE_ENV": "production",
            "PORT": 3001
        }
    }]
}
```

### Docker Deployment

Docker configuration for containerized deployment:

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
```

## Testing the Application

### Manual Testing

Test the application manually:

```bash
# Start the application
npm start

# Test health endpoint
curl http://localhost:3000/health

# Test main page
curl http://localhost:3000/

# Test with different environment
NODE_ENV=production npm start
```

### Automated Testing

Set up automated testing:

```javascript
// test/server.test.js
import { initialize } from '../application/application.js';

describe('Application Server', () => {
    let context;
    
    beforeAll(async () => {
        context = await initialize('./test-config.json', 'test');
    });
    
    afterAll(async () => {
        const datastore = context.getService('kixx.Datastore');
        await datastore.close();
    });
    
    test('should start successfully', () => {
        expect(context).toBeDefined();
        expect(context.environment).toBe('test');
    });
    
    test('should have required services', () => {
        expect(context.getService('kixx.Datastore')).toBeDefined();
        expect(context.getService('kixx.JobQueue')).toBeDefined();
        expect(context.getService('kixx.ViewService')).toBeDefined();
    });
});
```

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Check what's using the port
   lsof -i :3000
   
   # Kill the process
   kill -9 <PID>
   ```

2. **Configuration file not found**
   ```bash
   # Check file exists
   ls -la kixx-config.json
   
   # Check file permissions
   chmod 644 kixx-config.json
   ```

3. **Permission denied**
   ```bash
   # Check file permissions
   ls -la server.js
   
   # Make executable
   chmod +x server.js
   ```

### Debug Mode

Enable debug mode for troubleshooting:

```javascript
// Enable debug logging
process.env.DEBUG = 'kixx:*';

// Or set in configuration
{
    "logger": {
        "level": "debug",
        "mode": "console"
    }
}
```

## Next Steps

After setting up the application entry point, proceed to:

- [Step 7: Progressive Enhancement](../step-7-progressive-enhancement.md)
- [Step 8: Data Management](../step-8-data-management.md)
- [Deployment Guide](../deployment-guide.md) 