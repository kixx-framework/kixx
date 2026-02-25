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

## JavaScript Coding Conventions

**ES2022, ES6 Modules. Enforced by ESLint.**

**Formatting**

| Rule | Requirement |
|------|-------------|
| Indentation | 4 spaces (no tabs) |
| Quotes | Single quotes; double to avoid escapes; backticks for templates |
| Semicolons | Always required |
| Trailing commas | Required in multiline arrays/objects; forbidden in function params/imports/exports |
| Max statements per line | 1 |
| File ending | Newline at EOF |

**Spacing:**

- Object braces: `{ key: value }` (always spaces inside)
- Array brackets: `[ 1, 2, 3 ]` (spaces, except arrays of objects: `[{ a: 1 }]`)
- Template literals: `` `Hello ${ name }` `` (spaces inside `${}`)
- No spaces inside parentheses: `fn(a, b)` not `fn( a, b )`
- Space before blocks: `if (x) {` not `if (x){`
- Spaces around infix operators: `a + b` not `a+b`
- Semicolons in `for`: `for (let i = 0; i < 10; i += 1)`
- No trailing whitespace

**Operators on continued lines:**

```js
const result = longValue
    + anotherValue;   // ✓ operator at start
```

**Variables**

- `const` by default; `let` only when reassignment is needed; never `var`
- No multiple assignments: `const a = b = 5` is forbidden
- No variable shadowing
- Underscores in identifiers are allowed (`_private`, `__internal`)
- `undefined` keyword may be used

**Functions**

- Prefer **function declarations** over `const fn = function () {}`
- Named functions: no space before parens — `function foo()`
- Anonymous/async functions: space before parens — `function (a)`, `async (a) =>`
- Arrow functions always require parens around parameters: `(x) => x * 2`
- Arrow function spacing: `(x) => x * 2` (single expression)
- Multiline Array functions should always use curly braces for the body.
- Use **arrow functions for callbacks** (avoids `this` binding issues)
- No functions created inside loops
- Use rest parameters (`...args`) instead of `arguments`
- No `return await` (redundant in async functions)
- No assignment in return statements
- No `else` after a return (`no-else-return`): use early returns
- No useless `return;` at end of functions
- Consistent return values not required

**Conditionals & Control Flow**

- **Always use curly braces**, even for single-line blocks
- One true brace style: `} else {` on same line
- `else if` instead of `else { if }` (no lonely `if` in `else`)
- **Strict equality only**: `===` and `!==`; never `==` or `!=`
- No nested ternaries

**Loops**

- `i += 1` / `i -= 1` — no `++` / `--` operators
- `for...in` must guard with `hasOwnProperty`
- No unmodified loop conditions
- No loops that always exit on the first iteration

**Classes**

- Class names must be **PascalCase**
- Getter before setter for accessor pairs
- Blank lines between multi-line class members (single-line members may be grouped)

**Objects**

- Use **shorthand** properties and methods: `{ name }`, `{ getName() {} }`
- No unnecessary computed keys: `{ foo: 1 }` not `{ ['foo']: 1 }`
- Quoting properties for readability is allowed


**Async / Promises**

- Use `Error` instances with `Promise.reject()`, not a plain string
- `async` functions without `await` are allowed (for promisification)

**Type Coercion & Numbers**

- Explicit conversion: `String(x)`, `Number(x)`, `Boolean(x)` — not `'' + x`, `+x`, `!!x`
- No floating decimals: `0.5` not `.5`; `1.0` not `1.`
- `parseInt(str, 10)` — always supply the radix

**Code Quality**

- No `console` statements (must be explicitly allowed with `// eslint-disble-next-line no-console`)
- No template literal syntax inside regular strings: use backticks
- Parentheses around mixed operators to clarify precedence (warning)
- TODO/FIXME comments are warned (tracked as technical debt)

## Coding conventions and guidelines for designing and creating good code
Most of the future changes to this framework will require adding new capabilities by extending the codebase. Your most important role is to facilitate those future extensions even when you cannot plan for them.

Complexity makes it very difficult to extend the codebase. But there are two forms of complexity: (1) Inherent complexity (2) Accidental Complexity.

Handling the inherent complexity in the codebase makes the framework valuable because the inherent complexity solves valuable problems for people. The code becomes valuable by encapsulating and hiding inherent complexity so that it is handled and does not pollute the problem domain.

Accidental complexity is introduced into your code because non-optimal design decisions were made when writing code. Accidental complexity is bad because it makes the code hard to extend and does not add value.

In a great code design, modules are as independent of one another as possible, with as few dependencies as possible between them. When a module is independent it encapsulates the good inherent complexity and avoids leaking it out to become bad accidental complexity.

So, your primary objective when adding or changing code in this project is to create a great design which makes the framework extendable by encapsulating inherent complexity in modules and reducing the dependencies between modules as much as possible.

At the highest level a module is a JavaScript file, then a class, and then a method. All of these structures can encapsulate inherent complexity while avoiding accidental complexity by reducing dependencies with each other.

Encapsulating inherent complexity in a module is also known as "information hiding". The information hidden within a module usually consists of details about how to implement some mechanism.

Information hiding reduces accidental complexity in two ways:

1. The interface reflects a simpler, more abstract view of the module’s functionality and hides the details.
2. If a piece of information is hidden, there are no dependencies on that information outside the module which makes it easier to extend the codebase.

General-purpose classes and methods are almost always better than special-purpose ones. General purpose classes and methods usually have simpler interfaces and hide more complexity than specialized modules.

One way to separate specialized code is to push it downwards. An example of this is device drivers. An operating system typically must support many different device types of devices. Each of these device types has its own specialized command set. In order to prevent specialized device characteristics from leaking into the main operating system code, operating systems define an interface with general-purpose operations that any secondary storage device must implement

Another way to separate specialized code is to push it upwards. The top-level classes of an application, which provide specific features, will necessarily be specialized for those features. That specialization should be contained in those classes.

It might appear that the best way to achieve the objective of good design is to divide the system into a large number of small components: the smaller the components, the simpler each individual component is likely to be. 

However, the act of subdividing creates additional complexity:

- Some complexity comes just from the high number of components.
- Subdivision usually results in more interfaces, and every new interface adds complexity.
- Subdivision can result in additional code to manage the components.
- Subdivided components will be farther apart making it harder to map dependencies.
- Separation makes it harder for you to understand the components at the same time which makes it difficult to map the dependencies between them.
- Subdivision can result in duplication: code that was present in a single instance before subdivision may need to be present in each of the subdivided components.

Bringing pieces of code together is most beneficial if they are closely related. If the pieces are unrelated, they are probably better off apart. Here are a few indications that two pieces of code are related:

- They share information; for example, both pieces of code might depend on information about the HTTP protocol.
- They are used together: anyone using one of the pieces of code is likely to use the other as well.
- They overlap conceptually, in that there is a simple higher-level category that includes both of the pieces of code.
- It is hard to understand one of the pieces of code without looking at the other.

## Skills Reference
Development guidelines are documented as skills in `.claude/skills/`:

- `writing-tests/SKILL.md` — Detailed guidelines on writing and using automated tests to verify your code; including the test framework, assertion library, and sinon mocking library reference
- `javascript-coding-conventions/SKILL.md` — Coding style rules and ESLint configuration
- `jsdocs/SKILL.md` — JSDoc comment and tag usage guidelines
- `inline-code-comments/SKILL.md` — When and how to write inline code comments
- `assertions/SKILL.md` — Using kixx-assert to enforce invariants and validate inputs
- `error-handling/SKILL.md` — Error handling patterns using kixx-server-errors
