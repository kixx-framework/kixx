# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kixx is a server-rendered, hypermedia-driven web application framework for Node.js (>=16.13.2). It uses ES2022 JavaScript (no TypeScript). The package entry point is `lib/mod.js` and the CLI entry point is `bin/kixx.js`.

## Commands

```bash
# Linting
npx eslint ./                                          # Full lint check
npx eslint lib/application/                            # Lint a directory
npx eslint --fix lib/application/request-context.js    # Auto-fix a file

# Testing
node ./run-tests.js                                              # All tests
node ./run-tests.js test/application/                            # Directory of tests
node ./run-tests.js test/application/application-context.test.js # Single test file
npm test                                                         # Lint + all tests
```

## Architecture

### Request Processing Pipeline

```
HTTP Request → ApplicationServer → HttpRouter → VirtualHost → HttpRoute → Middleware Chain → HttpTarget → Response
```

Errors cascade upward: target → route → router, each level having the opportunity to handle or propagate.

### Application Lifecycle

**Application** (`lib/application/application.js`) bootstraps the framework: loads config from `kixx-config.json`/`.jsonc`, loads secrets from `.secrets.json`/`.jsonc`, creates the ApplicationContext, discovers plugins in alphabetical order (app plugin loads last), and registers their middleware, request handlers, and error handlers.

**ApplicationContext** (`lib/application/application-context.js`) is the dependency injection container. Components access services and collections through `getService()` and `getCollection()`. It clones into a read-only RequestContext for individual HTTP requests.

**Config** (`lib/application/config.js`) manages environment-specific configuration with namespaces. Emits `update:config` and `update:secrets` events for runtime reconfiguration.

### Plugin System

Plugins live in `plugins/` (or `app/` for the main app plugin) and follow a convention-based structure:

```
plugin-name/
├── plugin.js          # Entry point (register + initialize)
├── collections/       # Data models
├── middleware/         # Request middleware
├── request-handlers/  # Route handlers
└── error-handlers/    # Error handlers
```

Plugins are loaded alphabetically. Each can define `register()` (sync initialization) and `initialize()` (async setup that can reference other services).

### Key Subsystems

- **HTTP Server** (`lib/http-server/`): `ApplicationServer` for production (preloaded routes), `DevelopmentServer` for hot-reloading. The `HttpRouter` manages virtual hosts and the four-phase request pipeline (route resolution → method resolution → middleware → response validation).
- **Route Configuration** (`lib/http-routes-store/`): Loads virtual host and route definitions from route files into specs (`VirtualHostSpec`, `HttpRouteSpec`, `HttpTargetSpec`).
- **Templating** (`lib/kixx-templating/`): Custom template engine with `{{ variable }}` syntax and built-in helpers (`if`, `unless`, `each`, `with`, `equals`, `unescape`, `plusOne`).
- **Errors** (`lib/errors/`): `WrappedError` (unexpected, preserves cause) and `OperationalError` (expected, recoverable) as base classes. HTTP error classes (`BadRequestError`, `NotFoundError`, etc.) set appropriate status codes and `expected: true`.
- **Assertions** (`lib/assertions/`): Type checking functions (`isString()`, `isPlainObject()`) and assertion functions (`assertEqual()`, `assertNonEmptyString()`). No deep equality — compare objects by reference or by their properties.
- **Logger** (`lib/logger/`): Configurable levels (debug, info, warn, error), supports console and JSON modes, child loggers, runtime reconfiguration.

## Testing Conventions

- Test files live in `test/` mirroring the `lib/` directory structure (e.g., `lib/application/paths.js` → `test/application/paths.test.js`).
- Uses `kixx-test` (describe/before/after/it blocks), `kixx-assert`, and `sinon` for mocking.
- Do **not** nest `describe()` blocks — create separate top-level blocks for each behavior/code branch.
- Always call `sinon.restore()` in `after()` when using stubs or spies on existing methods.
- Test errors using try/catch with `error.name` or `error.code` — not `instanceof`.
- Detailed testing guidelines are in `.claude/skills/writing-tests/SKILL.md`.

## Coding Conventions

- 4-space indentation, single quotes, semicolons required, strict equality (`===`/`!==`).
- `const` by default, `let` for reassignment, no `var`.
- Always use curly braces for control structures.
- Spaces inside object literals `{ key: value }`, array literals `[ 1, 2, 3 ]` (except arrays of objects), and template expressions `` `${ value }` ``.
- Arrow functions for callbacks, function declarations for named functions.
- Use `+=`/`-=` instead of `++`/`--`.
- No `console` statements (must be explicitly allowed via eslint override).
- Detailed conventions are in `.claude/skills/javascript-coding-conventions/SKILL.md`.

## Skills Reference

Development guidelines are documented as skills in `.claude/skills/`:

- `writing-tests/SKILL.md` — Test framework, assertion library, and sinon API reference
- `javascript-coding-conventions/SKILL.md` — Coding style rules and ESLint configuration
- `jsdocs/SKILL.md` — JSDoc comment guidelines and tag ordering
- `inline-code-comments/SKILL.md` — When and how to write inline comments
