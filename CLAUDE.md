# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This project is the source for the Kixx rapid web development framework.

## About Kixx

Kixx is a rapid web development framework for humans and their AI tools. It's designed to build server-rendered, hypermedia-driven applications (HTML as the engine of application state) with minimal client side scripting. The framework emphasizes convention over configuration, developer productivity, and simplicity.

This project contains the source files which implement the Kixx framework.

- **No TypeScript**: Allows for flexibility and developer productivity
- **ES2022+ JavaScript**: with Node.js >= 16.13.2
- **Vendored Dependencies**: Some dependencies are vendored in `lib/vendor/` (luxon, marked, jsonc-parser, path-to-regexp)

## Commands

### Testing
- `npm test` - Runs ESLint and unit tests
- `npm run unit-test` - Runs only unit tests (uses `node run-tests.js`)
- `npm run lint` - Runs ESLint only

The test runner (`run-tests.js`) recursively loads all `*.test.js` files from the `test/` directory.

**Running a single test file:**

```bash
node run-tests.js test/path/to/your.test.js
```

**Controlling the stack trace size**

When running tests, you can set the size (number of lines) of stack traces to avoid filling your terminal with useless information when lots of errors are present. The default stack trace size is 4 lines.

You can set the stack trace size to unlimited with:

```bash
node run-tests.js --stack no-limit
```

Or explicitly set a limit with:

```bash
node run-tests.js --stack 6
```

### File Organization
- `lib/` - Kixx framework source code (included in kixx npm package)
- `test/` - Tests mirroring `lib/` directory structure (e.g., `lib/foo/bar.js` → `test/foo/bar.test.js`)
- `bin/` - CLI entry point (included in kixx npm package)
- `cli/` - CLI command implementations (included in kixx npm package)
- `project-template/` - Scaffolding for new projects (included in kixx npm package)
- `docs/` - Internal documentation for developers working in this project. This is *not* external documentation for using the Kixx framework for applications.
- `tools/` - Various tools for working on this project
- `tmp/` - Dump any temporary files here which should be excluded from git source control

## Code Style and Conventions

### Important Notes

- **No TypeScript**: The project intentionally avoids TypeScript for simplicity and developer happiness
- **Vendored Dependencies**: Some dependencies are vendored in `lib/vendor/` (luxon, marked, jsonc-parser, path-to-regexp)
- **ES Modules Only**: The framework uses ES6 modules exclusively (type: "module" in package.json)
- **Assertions**: Use the assertion library in `lib/assertions/` to make assertions in the code about important assumptions
- **File System Access**: Use `lib/lib/file-system.js` utilities, not direct Node.js fs calls (enables testing with mocks)

### ESLint Configuration
The project uses strict ESLint rules (`eslint.config.mjs`):
- 4-space indentation
- Use array bracket spacing
- Always use parentheses with arrow functions
- Use dangling commas on multiline array and object definitions
- Single quotes (with escape allowance)
- Semicolons are required
- Do not allow trailing spaces at the end of lines
- No console.log (must use logger)
- No var (use const/let)
- Prefer arrow functions for callbacks
- No plusplus operator (`i++`)
- Always use `===` not `==`

### Naming Conventions
- Test files: `*.test.js`
- Classes: PascalCase
- Files: kebab-case.js
- Private class fields: `#privateField`

### Error Handling
Use framework error classes from `lib/errors/`:

- `BadRequestError` - 400
- `UnauthenticatedError` - 401
- `UnauthorizedError` - 403
- `NotFoundError` - 404
- `ValidationError` - 400 with validation details
- `OperationalError` - Expected runtime errors

See `lib/errors/mod.js` and the error class definitions in `lib/errors/lib/**` for more error classes and documentation.

## Testing Guidelines

See `docs/unit-testing-guidelines.md` for comprehensive testing documentation.

**Key Points:**
- Use `kixx-test` framework with `describe()`, `before()`, `after()`, `it()` blocks
- Use `kixx-assert` for assertions (no deep equality - compare by reference or individual properties)
- Use `sinon` for spies and stubs
- Test files mirror source structure in `test/` directory
- Each logical code branch should have its own `describe()` block
- Do NOT nest `describe()` blocks
- Test errors by name (`error.name`), not `instanceof`
- Always call `sinon.restore()` in `after()` blocks when using stubs
