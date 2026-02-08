# Kixx Framework - Project Structure Documentation

The Kixx framework project is organized into several top-level directories, each serving a specific purpose in the framework's architecture.

## Top-Level Structure

```
kixx/
├── bin/                    # CLI entry point (included in npm package)
├── cli/                    # CLI command implementations (included in npm package)
├── docs/                   # Internal developer documentation (NOT in npm package)
├── lib/                    # Core framework source code (included in npm package)
├── project-template/       # Scaffolding for new projects (included in npm package)
├── test/                   # Test suite mirroring lib/ structure (NOT in npm package)
├── tools/                  # Development tools (NOT in npm package)
├── tmp/                    # Temporary files (git-ignored)
├── reference/              # Reference implementations
├── node_modules/           # Third-party dependencies
├── .git/                   # Git repository data
├── .gitignore              # Git ignore patterns
├── eslint.config.mjs       # ESLint configuration
├── package.json            # NPM package configuration
├── package-lock.json       # NPM dependency lock file
├── run-tests.js            # Test runner script
├── LICENSE                 # MIT License
└── README.md               # Project README
```

## Detailed Directory Structure

### `/bin` - CLI Entry Point
The executable entry point for the Kixx command-line interface.

```
bin/
└── kixx.js                 # Main CLI executable (#!/usr/bin/env node)
                            # Routes commands to appropriate CLI handlers
```

**Purpose**: Provides the `kixx` command that users invoke from the terminal (e.g., `npx kixx init-project`).

---

### `/cli` - CLI Command Implementations
Contains the implementation of all CLI commands available through the `kixx` executable.

```
cli/
├── app-server.js           # Production server command implementation
├── dev-server.js           # Development server with hot-reloading
├── init-project.js         # Project scaffolding command
├── run-command.js          # Custom command runner
└── docs/                   # CLI command documentation
```

---

### `/docs` - Internal Developer Documentation
Documentation for developers working on the Kixx framework itself (not for end users).

```
docs/*.md
```

**Note**: This is NOT user-facing documentation for building applications with Kixx.

---

### `/lib` - Core Framework Source Code
The heart of the Kixx framework containing all the core functionality.

```
lib/
├── mod.js                      # Main module export (framework entry point)
├── application/                # Application bootstrapping and configuration
├── assertions/                 # Assertion utilities and helpers
├── errors/                     # Error classes and handling
├── http-routes-store/          # HTTP route storage and management
├── http-server/                # HTTP server implementation
├── hyperview/                  # Server-side rendering and templating
├── kixx-templating/            # Template engine implementation
├── lib/                        # Shared utilities and helpers
├── local-file-datastore/       # File-based data storage
├── logger/                     # Logging utilities
├── middleware/                 # HTTP middleware components
├── models/                     # Base model classes
├── user/                       # User authentication and session management
└── vendor/                     # Vendored third-party dependencies
```

#### `/lib/application` - Application Core
Application lifecycle, configuration, and server management.

```
lib/application/
├── application.js              # Core Application class
├── application-server.js       # Production server implementation
├── development-server.js       # Development server with hot-reload
├── config.js                   # Configuration management
├── context.js                  # Request context management
├── paths.js                    # Application path resolution
└── plugin.js                   # Plugin system
```

#### `/lib/assertions` - Assertion Utilities
Type checking and assertion functions for runtime validation.

```
lib/assertions/
└── mod.js                      # Assertion functions (isString, assertArray, etc.)
```

**Provides**: `isString`, `isNumber`, `isFunction`, `assert`, `assertEqual`, `assertArray`, etc.

#### `/lib/errors` - Error Classes
HTTP and operational error classes with proper status codes.

```
lib/errors/
├── mod.js                              # Error exports
└── lib/
    ├── assertion-error.js              # Assertion failures
    ├── bad-request-error.js            # 400 Bad Request
    ├── conflict-error.js               # 409 Conflict
    ├── forbidden-error.js              # 403 Forbidden
    ├── method-not-allowed-error.js     # 405 Method Not Allowed
    ├── not-acceptable-error.js         # 406 Not Acceptable
    ├── not-found-error.js              # 404 Not Found
    ├── not-implemented-error.js        # 501 Not Implemented
    ├── operational-error.js            # Expected runtime errors
    ├── unauthenticated-error.js        # 401 Unauthenticated
    ├── unauthorized-error.js           # 403 Unauthorized (permission denied)
    ├── unsupported-media-type-error.js # 415 Unsupported Media Type
    ├── validation-error.js             # 400 with validation details
    └── wrapped-error.js                # Wraps underlying errors
```

#### `/lib/http-routes-store` - Route Storage
Manages HTTP route definitions and virtual host configurations.

```
lib/http-routes-store/
├── http-routes-store.js        # Route storage and retrieval
├── http-route-spec.js          # Route specification schema
├── http-target-spec.js         # Route target specification
└── virtual-host-spec.js        # Virtual host configuration schema
```

#### `/lib/http-server` - HTTP Server
Core HTTP server implementation with routing and request handling.

```
lib/http-server/
├── http-server.js              # Main HTTP server
├── http-router.js              # Request routing logic
├── http-route.js               # Individual route representation
├── http-target.js              # Route target (controller/handler)
├── http-server-request.js      # Enhanced request object
├── http-server-response.js     # Enhanced response object
└── virtual-host.js             # Virtual host handling
```

#### `/lib/hyperview` - Server-Side Rendering
The Hyperview system for server-rendered HTML applications.

```
lib/hyperview/
├── mod.js                          # Hyperview module exports
├── hyperview-service.js            # Main Hyperview service
├── page-store.js                   # Page definition storage
├── template-store.js               # Template caching and management
├── template-engine.js              # Template compilation and rendering
├── static-file-server-store.js     # Static file serving
├── request-handler.js              # HTTP request handling for pages
├── error-handler.js                # Error page rendering
└── helpers/                        # Template helper functions
    ├── format-date.js              # Date formatting helper
    ├── markup.js                   # HTML markup helpers
    └── truncate.js                 # Text truncation helper
```

**Purpose**: Provides the server-side rendering engine for hypermedia-driven applications.

#### `/lib/kixx-templating` - Template Engine
Custom template engine for rendering HTML with server-side data.

```
lib/kixx-templating/
├── mod.js                          # Template engine exports
└── lib/
    ├── tokenize.js                 # Template tokenization
    ├── build-syntax-tree.js        # AST construction
    ├── create-render-function.js   # Compile templates to functions
    ├── event-emitter.js            # Event system for templates
    ├── line-syntax-error.js        # Template syntax error reporting
    ├── utils.js                    # Template utilities
    └── helpers/                    # Built-in template helpers
        ├── mod.js                  # Helper exports
        ├── each.js                 # Loop helper
        ├── if.js                   # Conditional helper
        ├── if-equal.js             # Equality conditional
        ├── unless.js               # Inverse conditional
        ├── with.js                 # Context switching
        ├── plus-one.js             # Increment helper
        └── unescape.js             # HTML unescape helper
```

**Purpose**: Provides a lightweight, custom templating language for HTML generation.

#### `/lib/lib` - Shared Utilities
Common utilities used throughout the framework.

```
lib/lib/
├── constants.js                # Framework constants (ALPHA, OMEGA)
├── deep-freeze.js              # Deep object freezing
├── deep-merge.js               # Deep object merging
├── file-system.js              # File system abstraction layer
├── file-watcher.js             # File watching for hot-reload
├── http-utils.js               # HTTP utility functions
└── urn-pattern-to-regexp.js    # URN pattern to RegExp conversion
```

**Note**: The nested `lib/lib/` structure isolates general utilities from framework-specific code.

#### `/lib/local-file-datastore` - File-Based Storage
A simple, file-based key-value datastore for rapid development.

```
lib/local-file-datastore/
├── local-file-datastore.js     # Main datastore implementation
├── binary-search.js            # Binary search for sorted data
├── file-system.js              # File system operations
└── locking-queue.js            # Queue for file locking
```

**Purpose**: Provides a lightweight datastore that doesn't require external databases.

#### `/lib/logger` - Logging System
Simple logging utilities for framework and application logging.

```
lib/logger/
└── mod.js                      # Logger implementation
```

#### `/lib/vendor` - Vendored Dependencies
Third-party libraries included directly in the framework.

```
lib/vendor/
├── mod.js                      # Vendor module exports
├── jsonc-parser/               # JSON with comments parser
├── luxon/                      # DateTime library
├── marked/                     # Markdown parser
├── minimatch/                  # Glob pattern matching
└── path-to-regexp/             # Path pattern to RegExp
```

**Why vendored?**: Ensures version stability and reduces external dependencies.

---

### `/project-template` - Project Scaffolding
Template files used when creating new Kixx projects with `kixx init-project`.

```
project-template/
├── README.md                   # New project README template
├── kixx-config.jsonc           # Application configuration template
├── virtual-hosts.jsonc         # Virtual hosts configuration
├── app/                        # Application code templates
├── routes/                     # Route definitions
├── pages/                      # Page definitions
└── templates/                  # HTML templates
```

**Purpose**: Provides a working starting point for new Kixx applications.

---

### `/test` - Test Suite
Comprehensive test suite mirroring the structure of `/lib`.

```
test/
├── application/                    # Tests for lib/application/
├── http-server/                    # Tests for lib/http-server/
├── hyperview/                      # Tests for lib/hyperview/
├── lib/                            # Tests for lib/lib/
└── local-file-datastore/           # Tests for lib/local-file-datastore/
```

**Convention**: Test files are named `<module-name>.test.js` and mirror the structure of `/lib`.

---

### `/tools` - Development Tools
Utilities for working on the framework itself.

```
tools/
└── format-js-file.js           # JavaScript file formatting utility
```

---

### `/tmp` - Temporary Files
Directory for temporary files during development (git-ignored).

```
tmp/
└── (temporary files)
```

**Note**: This directory is excluded from git source control.

---

### `/reference` - Reference Implementations
Reference implementations of external libraries for comparison.

```
reference/
```
