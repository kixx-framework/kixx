**Scope:** this entire guide does not apply to `lib/vendor/` or `test/fixtures/`.

Code Quality Guidelines
-----------------------

**Owners of responsibility**

Shift your focus from *how* an operation is performed to *what* object, method, or function is responsible for doing it.

- A class is useful when there is durable state, a lifecycle, caching, or an API that benefits from grouping related operations.
- A module is enough when the responsibility needs private helpers but no per-instance state.
- A plain helper function is enough when the behavior is stateless, has no hidden invariants, and can be named precisely.
- Data that carries important invariants should usually be manipulated through the module or object that owns those invariants.

**Lean into Object Oriented Programming (OOP)**

Consider the owners of responsibility for your logic, but do not blindly follow the "one class per noun" methodology.

**Smaller modules, classes, and methods are not always better**

The goal is simpler code, not smaller units. Keep code together when the pieces:

- Share information, such as knowledge of a common protocol.
- Are used together: anyone using one is likely to use the other.
- Overlap conceptually under a simple higher-level category.
- Are hard to understand without looking at each other.

**Avoid thin wrapper classes**

Do not write classes that only wrap data with getters and setters. Remove the getters, or the whole class if it serves no other purpose, and operate on a plain object (optionally with a JSDoc `@typedef`).

```javascript
// Bad
class Dog {
    #weight;

    constructor(args) {
        this.#weight = args.weight;
    }

    get weight() {
        return Number.parseFloat(this.#weight);
    }
}

// Better
function createDog(args) {
    return {
        weight: Number.parseFloat(args.weight),
    };
}
```

Code Style Guidelines
---------------------

This project uses JavaScript in the **ECMAScript 2022** standard using **ES modules** (no CommonJS, no `"use strict"`). The linter parses ES2025 only so `import ... with { type: 'json' }` works.

**The linter is authoritative.** `eslint.config.js` enforces style rules beyond this guide. If the linter reports an error, fix it.

### Imports

- Import Node.js built-ins with the `node:` prefix (`import path from 'node:path'`). Deno resolves the same specifiers.
- Import everything else by relative path. There are no runtime dependencies; third-party code is vendored under `lib/vendor/`. See `docs/packaging-and-runtimes.md`.
- Never import from outside `devkit/`. Only `test/conformance/` may read the repository's `lib/`.

### Naming Conventions

- **Files**: kebab-case (`user-service.js`, not `UserService.js`)
- **Functions**: camelCase, verb-first (`createUser`, `validateToken`)
- **Classes**: PascalCase with descriptive suffixes (`UserCreateInput`, `AuthResponse`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Boolean variables**: is/has/can prefix (`isActive`, `hasPermission`)

### Formatting

- **Let the reader breathe.** Add empty lines between logical blocks of code.
- **Arrow functions:** single-expression bodies on one line (`[1, 2].map((n) => n * 10)`); otherwise a multi-line block.

### Function Argument Objects

Destructure object arguments inside the function body, not in the parameter list, so defaults and `args ?? {}` handling stay consistent:

```javascript
function runSubProcess(args) {
    const {
        argv = [],
        cwd = process.cwd(),
    } = args ?? {};
}

// Wrong
function runSubProcess({ argv = [], cwd = process.cwd() } = {}) { ... }
```

### Unused Variables (`no-unused-vars`)

Every declared variable, import, and argument must be used. Prefix a required-but-unused positional argument with `_` (`(_event) => submitForm()`); the linter ignores any `_`-prefixed variable, argument, destructured element, or catch binding. Still, remove unused object destructuring keys, and omit an unneeded `catch` binding entirely (`catch { return null; }`).

### Private Class Members

Use ES2022 `#private` fields and methods, never `_underscore` prefixes.

### Async Code

When an async function delegates its return value to another Promise, `return await` it. Returning the Promise directly drops the current function from the error stack when it rejects.

```js
export async function getObjectListing(baseUrl) {
    const res = await fetch(`${ baseUrl }/objects`);
    return await res.json(); // not `return res.json()`
}
```

### Type Detection

Use the predicates from the vendored `lib/vendor/kixx-assert/mod.js` (relative path from the file you are editing) instead of raw `typeof`. The vendored copy is unmodified upstream code, so do not add helpers to it; write a module-local predicate when it lacks one.

```javascript
import { isUndefined, isString } from '../vendor/kixx-assert/mod.js';

if (isUndefined(value)) { ... } // not typeof value === 'undefined'
```

**Type Predicates**

- `isString(value)`: String primitive or String object
- `isNonEmptyString(value)`: non-empty String
- `isNumber(value)`: Number or BigInt, including boxed values
- `isNumberNotNaN(value)`: Number/BigInt and not NaN
- `isBoolean(value)`: Boolean primitive or Boolean object
- `isUndefined(value)`: undefined
- `isPrimitive(value)`: null, undefined, String, Number, BigInt, Boolean, or Symbol
- `isFunction(value)`: any callable function/method/class constructor
- `isObjectNotNull(value)`: object and not null
- `isPlainObject(value)`: plain object or null-prototype object
- `isDate(value)`: Date instance, valid or invalid
- `isValidDate(value)`: Date with a non-NaN timestamp
- `isRegExp(value)`: RegExp instance
- `isMap(value)`: Map or WeakMap
- `isSet(value)`: Set or WeakSet

**Comparison and Formatting**

- `isEqual(a, b)`: strict equality plus valid-Date equality and NaN === NaN; curryable
- `doesMatch(matcher, value)`: RegExp.test(), isEqual(), String.includes(), or ISO date matching; curryable
- `toFriendlyString(value)`: human-readable value formatter for diagnostics

### Inline Code Comments

Comment *why*, not *what*. When you had to reason about why code has its current shape, leave one or two focused lines near the decision so the next reader does not have to rediscover it. Good subjects:

- Why a branch exists, an order matters, or a default is safe.
- Why a value is cloned, frozen, normalized, or rewrapped.
- Why an error is caught, translated, hidden, or allowed to propagate.
- Why a simpler-looking implementation would be wrong in this runtime.
- Protocol, security, platform-limit, or compatibility decisions; state the consequence.
- State transitions and side effects of a call.
- Workarounds, with when to remove them.
- Coordinated change points (`// WARNING: also update ...`).
- Short guide comments separating phases of long logic.

```javascript
// Content-Length is measured in bytes, not JavaScript characters; using
// string length can truncate UTF-8 responses containing multi-byte characters.
const contentLength = new Blob([ body ]).size;
```
