# Logging in Kixx

Kixx provides a structured logging system with two built-in implementations: a human-readable logger for development and a JSON logger for production. Both share the same API and are injected into your application at startup — you never construct them directly in application code.

---

## The Two Loggers

### DevLogger — human-readable output

Used in non-production environments. Each line is formatted as:

```
HH:mm:ss.SSS [LEVEL] name message [info]
```

WARN lines are prefixed in yellow; ERROR lines in red (ANSI escape codes). If you pass an `Error` object as the third argument, it is printed to `console.error` with its full stack trace below the log line.

Example output:

```
14:32:01.045 [INFO ] app Server listening on port 3000
14:32:01.203 [DEBUG] app:database query executed {"table":"users","rows":12}
14:32:05.811 [WARN ] app:http Slow response {"path":"/dashboard","ms":4201}
14:32:09.002 [ERROR] app Unhandled error in request handler
Error: Connection refused
    at ...
```

### ProdLogger — newline-delimited JSON

Used in `production`. Each log entry is a single JSON object on one line, designed for log aggregators (Datadog, CloudWatch, Logtail, etc.).

```json
{"time":"2026-03-18T14:32:01.045Z","level":"INFO","levelInt":20,"name":"app","message":"Server listening on port 3000"}
{"time":"2026-03-18T14:32:01.203Z","level":"DEBUG","levelInt":10,"name":"app:database","message":"query executed","info":{"table":"users","rows":12}}
{"time":"2026-03-18T14:32:09.002Z","level":"ERROR","levelInt":40,"name":"app","message":"Unhandled error in request handler","error":{"name":"Error","code":"[NO_ERROR_CODE]","message":"Connection refused","stack":"Error: Connection refused\n    at ..."}}
```

`NodeBootstrap.createLogger()` selects the right implementation automatically based on the environment string passed to the bootstrap.

---

## Accessing the Logger

The logger is available on both `ApplicationContext` and `RequestContext` as `.logger`. You never import or construct a logger directly — the bootstrap creates it and injects it.

**In a plugin:**

```javascript
function register(applicationContext) {
    const { logger } = applicationContext;
    logger.info('MyPlugin registered');
}

async function initialize(applicationContext) {
    const { logger } = applicationContext;
    logger.info('MyPlugin initializing');
    // ... async setup
    logger.info('MyPlugin ready');
}
```

**In a request handler or middleware:**

```javascript
async function myRequestHandler(requestContext, request, response) {
    const { logger } = requestContext;
    logger.info('Handling request', { path: request.url });
}
```

---

## Logging Methods

All four methods have the same signature:

```javascript
logger.debug(message, info, error)
logger.info(message, info, error)
logger.warn(message, info, error)
logger.error(message, info, error)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Short, human-readable description of the event |
| `info` | `*` | No | Structured data associated with the event — any JSON-serializable value |
| `error` | `Error` | No | Error object to include with the entry |

```javascript
// Message only
logger.info('Server started');

// Message + structured data
logger.info('Request received', { method: 'GET', path: '/users', requestId: 'abc123' });

// Message + error
logger.error('Database connection failed', null, err);

// Message + data + error
logger.error('Query failed', { table: 'users', query: 'SELECT *' }, err);
```

Entries below the current log level are silently discarded — the info and error values are not evaluated eagerly, but the method call itself still occurs. If constructing the `info` object is expensive, guard with a level check:

```javascript
if (logger.level === 'DEBUG') {
    logger.debug('Full request dump', expensiveInspect(request));
}
```

---

## Log Levels

Four levels, in ascending severity:

| Level | Integer | When to use |
|-------|---------|-------------|
| `DEBUG` | 10 | Detailed diagnostics, only useful during development |
| `INFO` | 20 | Normal operational events (startup, requests, jobs) |
| `WARN` | 30 | Something unexpected happened but the operation succeeded |
| `ERROR` | 40 | An operation failed and requires attention |

The logger only outputs entries at or above the configured level. Setting the level to `WARN` suppresses all `DEBUG` and `INFO` output.

The current level is readable and writable:

```javascript
logger.level = 'DEBUG';     // string name (case-insensitive)
logger.level = 10;          // integer value also accepted
console.log(logger.level);  // always returns the string name: 'DEBUG'
```

Level constants are available on `BaseLogger.LEVELS`:

```javascript
import { BaseLogger } from 'kixx';

logger.level = BaseLogger.LEVELS.WARN; // 30
```

---

## Configuring the Logger

Logger options live in the `logger` namespace of `kixx-config.jsonc`:

```jsonc
{
    "logger": {
        "name": "my-app",   // optional — falls back to config.name
        "level": "DEBUG"    // optional — falls back to DEBUG
    }
}
```

The `name` field appears in every log entry to identify the source application. When omitted, the top-level `name` from the config file is used.

---

## Child Loggers

`createChild(name)` creates a new logger that:

- Scopes its name as `parent:child` (colon-separated)
- Inherits the parent's current level
- Automatically tracks level changes from the parent

Use child loggers to add a subsystem label to log output without passing a logger instance through every function call.

```javascript
// In a plugin's initialize()
const dbLogger = applicationContext.logger.createChild('database');

dbLogger.info('Connected', { host: 'localhost', port: 5432 });
// → app:database Connected {"host":"localhost","port":5432}

// Changing the root level propagates to all children
applicationContext.logger.level = 'WARN';
dbLogger.debug('This is now suppressed');
```

Naming convention: use short lowercase identifiers that reflect the subsystem — `http`, `database`, `cache`, `auth`, `jobs`.

```javascript
const logger = applicationContext.logger;

const httpLogger  = logger.createChild('http');
const cacheLogger = logger.createChild('cache');

// Child loggers can also have children
const queryLogger = cacheLogger.createChild('query');
// name: app:cache:query
```

---

## Custom Loggers

If neither `DevLogger` nor `ProdLogger` suits your needs (e.g. you want to send entries to a logging service), extend `BaseLogger` and implement `printMessage()`:

```javascript
import { BaseLogger } from 'kixx';

export default class DatadogLogger extends BaseLogger {
    printMessage(level, message, info, error) {
        const entry = {
            level: BaseLogger.LEVELS[level] ?? level,
            message,
            service: this.name,
            // ...
        };
        this.printWriter(JSON.stringify(entry) + '\n');
    }
}
```

`printWriter` is the function injected at construction time that does the actual I/O. Pass it in when constructing your logger — on Node.js this is typically `process.stdout.write.bind(process.stdout)`, but on other runtimes it can be any `(string) => void` function:

```javascript
const logger = new DatadogLogger({
    name: 'my-app',
    level: 'INFO',
    printWriter: process.stdout.write.bind(process.stdout),
});
```

To use your custom logger with `NodeBootstrap`, override `createLogger()`:

```javascript
import { NodeBootstrap } from 'kixx';
import process from 'node:process';
import DatadogLogger from './datadog-logger.js';

class MyBootstrap extends NodeBootstrap {
    createLogger(config) {
        const loggerConfig = config.getNamespace('logger');
        return new DatadogLogger({
            name: loggerConfig.name || config.name,
            level: loggerConfig.level || 'INFO',
            printWriter: process.stdout.write.bind(process.stdout),
        });
    }
}
```

The `printWriter` injection is what keeps the logger classes themselves platform-agnostic. The concrete loggers have no knowledge of `process` or any other runtime global — only the composition root (`NodeBootstrap`) knows which writer to provide.

---

## Architecture Note

`DevLogger` and `ProdLogger` live in the **Core** layer (see [ports-and-adapters.md](./ports-and-adapters.md)). They are platform-agnostic: they format entries but delegate all I/O to the injected `printWriter` function. The only platform-specific code is in `NodeBootstrap.createLogger()`, where `process.stdout.write` is bound and passed in. A future `CloudflareBootstrap` would pass a different writer — no changes to the logger classes would be required.
