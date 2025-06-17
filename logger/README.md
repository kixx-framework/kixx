Kixx Logger
===========
A logger for HTTP application servers built with JavaScript (Node.js, Deno, etc).

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2025.

## Principles
- __No dependencies:__ A logger is a low level primitive component which systems depend on and should NOT complicate matters by having dependencies itself.
- __Provide rich and indexable information:__ Logs should be output in structured data formats which can be leveraged by other tools for analysis.

Features
--------

- Multilevel logging (DEBUG, INFO, WARN, ERROR)
- Named child loggers with inheritance
- Dynamic log level and mode configuration
- Multiple output modes (console, stdout)
- Structured logging with support for additional info and error objects

Installation
------------
```bash
npm install kixx-logger
```

Environment Support
-------------------

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__ or __Deno >= 1.0.0__. You could use it in a browser, but there are no plans to offer CommonJS or AMD modules. It targets at least [ES2022](https://node.green/#ES2022) and uses the optional chaining operator `?.`.

If you're curious: Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

__Note:__ There is no TypeScript here. It would be waste of time for a library as small as this.

Usage
-----

```javascript
import Logger from 'kixx-logger';

// Create a logger with a name
const logger = new Logger({ name: 'my-app' });

// Log messages at different levels
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');
```

### Additional Information and Errors

You can include additional information and error objects with your log messages:

```javascript
// Log with additional info
logger.info('User action', { userId: 123, action: 'login' });

// Log with error
try {
    // ... some code that might throw
} catch (error) {
    logger.error('Operation failed', null, error);
}

// Log with both info and error
logger.error('Failed to process user', { userId: 123 }, error);
```

### Log Levels

The logger supports four levels of logging:

| Level Name | Level Integer | Description |
|------------|---------------|-------------|
| DEBUG      | 10            | Detailed debugging information |
| INFO       | 20            | General operational information |
| WARN       | 30            | Warning messages for potentially harmful situations |
| ERROR      | 40            | Error events that might still allow the application to continue running |

### Configuration Options

When creating a logger, you can specify the following options:

```javascript
const logger = new Logger({
    name: 'my-app',      // Required: A string identifier for the logger
    level: 'INFO',       // Optional: Logging level (default: 'INFO')
    mode: 'stdout'       // Optional: Output mode (default: 'stdout')
});
```

### Child Loggers

Create child loggers that inherit settings from their parent:

```javascript
const parent = new Logger({ name: 'parent' });
const child = parent.createChild('child');

// Child logger inherits parent's level and mode
child.info('Message from child logger'); // Output: "parent:child - Message from child logger"
```

### Output Modes

The logger supports two output modes:

1. `stdout` (default): Structured output suitable for production environments
   - ISO timestamp
   - Log level
   - Process ID
   - Logger name
   - Message
   - Additional info (JSON)
   - Error details (JSON)

2. `console`: Human-readable output suitable for development
   - Human-readable timestamp
   - Log level
   - Logger name
   - Message
   - Additional info
   - Error details

## API Reference

### Constructor

```javascript
new Logger(options)
```

#### Options

- `name` (string, required): Logger identifier
- `level` (string|number, optional): Logging level
- `mode` (string, optional): Output mode ('stdout' or 'console')

### Properties

#### level

Get or set the logging level:

```javascript
// Get current level
const currentLevel = logger.level;

// Set level using string
logger.level = 'DEBUG';

// Set level using integer
logger.level = 10; // DEBUG level
```

#### mode

Get or set the output mode:

```javascript
// Get current mode
const currentMode = logger.mode;

// Set mode
logger.mode = 'console';
```

### Methods

#### createChild(name)

Creates a child logger that inherits settings from the parent.

```javascript
const child = logger.createChild('child-name');
```

#### debug(message, info, error)
#### info(message, info, error)
#### warn(message, info, error)
#### error(message, info, error)

Log messages at different levels with optional additional information and error objects.

```javascript
logger.debug('Debug message', { context: 'value' });
logger.info('Info message', { userId: 123 });
logger.warn('Warning message', null, error);
logger.error('Error message', { context: 'value' }, error);
```

Copyright and License
---------------------
Copyright: (c) 2017 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.

