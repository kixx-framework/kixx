# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kixx is a framework for building server-rendered, hypermedia-driven web applications in an Object Oriented way. It uses ES2022 JavaScript (no TypeScript) and supports applications written for Node.js (>=24), Deno, Cloudflare Workers, and AWS Lambda. The package entry point is `lib/mod.js`.

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

## Skills Reference
Development guidelines are documented as skills in `.claude/skills/`:

- `testing/SKILL.md` — Kixx Test Framework, Kixx Assertion Library, and Sinon reference for writing automated tests in this project
- `coding-conventions/SKILL.md` — Coding style rules and ESLint configuration
- `code-documentation/SKILL.md` — JSDoc block comments and inline code comments: when, how, and what to document
- `runtime-assertions/SKILL.md` — Using the kixx-assert library to enforce invariants and validate inputs in production code
- `error-handling/SKILL.md` — Error handling patterns and conventions when writing new code or refactoring existing code
