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

- `writing-tests/SKILL.md` — Detailed guidelines on writing and using automated tests to verify your code; including the test framework, assertion library, and sinon mocking library reference
- `coding-conventions/SKILL.md` — Coding style rules and ESLint configuration
- `jsdocs/SKILL.md` — JSDoc comment and tag usage guidelines
- `inline-code-comments/SKILL.md` — When and how to write inline code comments
- `assertions/SKILL.md` — Using assertions to enforce invariants and validate inputs
- `error-handling/SKILL.md` — Error handling patterns and conventions when writing new code or refactoring existing code
