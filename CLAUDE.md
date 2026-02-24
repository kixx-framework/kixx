# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kixx is a framework for building server-rendered, hypermedia-driven web applications in an Object Oriented way. It uses ES2022 JavaScript (no TypeScript) and supports applications written for Node.js (>=16.13.2), Deno, Cloudflare Workers, and AWS Lambda. The package entry point is `lib/mod.js`.

## Commands

```bash
# Linting
npx eslint ./                                          # Full lint check
npx eslint lib/http-router/                            # Lint a directory
npx eslint --fix lib/http-router/http-target.js    # Auto-fix a file

# Testing
node ./run-tests.js                                              # All tests
node ./run-tests.js test/http-router/                            # Directory of tests
node ./run-tests.js test/http-router/http-target.test.js # Single test file
npm test                                                         # Lint + all tests
```

## Testing Conventions
Use your writing-tests skill (defined in `.claude/skills/writing-tests/SKILL.md`) for detailed testing guidelines for this project.

- Test files live in `test/` mirroring the `lib/` and `examples/` directory structures (e.g., `lib/node-http-server/server-request.js` → `test/lib/node-http-server/server-request.test.js` and `examples/forms/todo-item.form.js` → `test/examples/forms/todo-item.form.test.js`).
- Uses `kixx-test` (describe/before/after/it blocks), `kixx-assert`, and `sinon` for mocking.
- Always call `sinon.restore()` in `after()` when using stubs or spies on existing methods.

## Coding Conventions
Use your javascript-coding-conventions skill (defined in `.claude/skills/javascript-coding-conventions/SKILL.md`) for detailed coding conventions used in this project.

- 4-space indentation, single quotes, semicolons required, strict equality (`===`/`!==`).
- `const` by default, `let` for reassignment, no `var`.
- Always use curly braces for control structures.
- Spaces inside object literals `{ key: value }`, array literals `[ 1, 2, 3 ]` (except arrays of objects), and template expressions `` `${ value }` ``.
- Arrow functions for callbacks, function declarations for named functions.
- Use `+=`/`-=` instead of `++`/`--`.
- No `console` statements (must be explicitly allowed via eslint override).

## Skills Reference
Development guidelines are documented as skills in `.claude/skills/`:

- `writing-tests/SKILL.md` — Test framework, assertion library, and sinon API reference
- `javascript-coding-conventions/SKILL.md` — Coding style rules and ESLint configuration
- `jsdocs/SKILL.md` — JSDoc comment guidelines and tag ordering
- `inline-code-comments/SKILL.md` — When and how to write inline comments
- `assertions/SKILL.md` — Using kixx-assert to enforce invariants and validate inputs
- `error-handling/SKILL.md` — Error handling patterns using kixx-server-errors
