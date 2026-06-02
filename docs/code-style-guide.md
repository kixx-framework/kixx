# Code Style Guide

**What this guide provides:** The canonical JavaScript style conventions for this project — language standard, runtime boundaries, formatting rules, linting constraints, and project-specific patterns like destructuring, type detection, and private class members. Following this guide keeps code consistent with the linter and with the rest of the codebase.

**Linter is authoritative:** The ESLint config in `eslint.config.js` enforces many rules beyond what this guide explicitly lists. After every edit, run:

```shell
node run-linter.js [filepath ...]
```

If the linter reports an error, fix it — even if it isn't covered by this document.

**What this guide does NOT cover:** Detailed JSDoc conventions. For the full documentation and inline-comment guidance, see `docs/code-documentation-guide.md`.

---

## Language Standard

This project uses JavaScript in the **ECMAScript 2022** standard using **ES modules** (no CommonJS, no `"use strict"`).

## Runtimes

### Node.js

Always use the `node:` prefix for built-in modules:

```javascript
import path from 'node:path';
import fsp from 'node:fs/promises';
import process from 'node:process';
```

Never use the `process` global. Import it explicitly.

---

## Arrow Functions

Single-expression bodies go on one line:

```javascript
[1, 2, 3].map(n => n * 10);
```

Multi-statement or complex bodies use a block on multiple lines:

```javascript
const isConst = variable.defs.some((def) => {
    return def.type === 'Variable' &&
        def.parent &&
        def.parent.kind === 'const';
});
```

---

## One Statement Per Line (`max-statements-per-line`)

Never put two statements on the same line. The most common mistake is a block-body arrow function on one line:

```javascript
// Wrong
const fn = () => { doSomething(); };

// Right
const fn = () => doSomething();

// Right (multi-statement block must be multiline)
const fn = () => {
    doSomething();
    doSomethingElse();
};
```

---

## Function Argument Objects

Destructure object arguments inside the function body, not in the parameter list. This keeps defaults and `args ?? {}` handling consistent:

```javascript
// Correct
function runSubProcess(args) {
    const {
        argv = [],
        cwd = process.cwd(),
        stderr = process.stderr,
    } = args ?? {};
}

// Wrong
function runSubProcess({ argv = [], cwd = process.cwd() } = {}) { ... }
```

---

## Trailing Commas (`comma-dangle`)

Multiline arrays, objects, function parameters, imports, and exports require a trailing comma after the last item. Single-line constructs must not have one:

```javascript
// Correct
const config = {
    host: 'localhost',
    port: 3000,
};

const result = someFunction(
    firstArgument,
    secondArgument,
);
```

---

## Unused Variables (`no-unused-vars`)

Every declared variable, import, and function argument must be used. If a positional argument is required by a callback signature but not needed, prefix it with `_`:

```javascript
button.addEventListener('click', (_event) => {
    submitForm();
});
```

The `_` prefix works for variables, function arguments, and destructured array elements. It does **not** work for caught error bindings or unused object destructuring keys. Remove unused object keys entirely.

For `catch` blocks where the error object is not needed, omit the binding entirely:

```javascript
try {
    parse(input);
} catch {
    return null;
}
```

---

## Private Class Members

Use ES2022 `#` private fields and methods. Never use underscore prefixes:

```javascript
// Correct
class Foo {
    #privateField;
    #privateMethod() { ... }
}

// Wrong
class Foo {
    _privateField;
    _privateMethod() { ... }
}
```

---

## `no-undef` and Web Platform Globals

Node.js exposes Web platform APIs (`URL`, `Response`, `ReadableStream`, `structuredClone`, etc.) as globals. If a file uses one of these and the linter reports `no-undef`, add the global to the `languageOptions.globals` block in `eslint.config.js`. Do not qualify it with `globalThis`:

```javascript
// eslint.config.js
languageOptions: {
    globals: {
        URL: 'readonly',
        structuredClone: 'readonly',
    },
},
```

---

## Additional Lint Rules Enforced by `eslint.config.js`

Always trust the linter output. If it reports an error, fix it even if it is not explicitly documented here. Key rules to be aware of:

- `indent`: 4 spaces, `SwitchCase: 1`
- `semi`: always required
- `eol-last`: files must end with a newline
- `no-trailing-spaces`: no trailing whitespace
- `no-var`: use `const`/`let`
- `prefer-const`: use `const` when the variable is never reassigned
- `eqeqeq`: always use `===`
- `no-console`: console calls are errors (suppress with `eslint-disable-line` if intentional)
- `func-style`: use function declarations or arrow functions (no `const fn = function() {}`)
- `no-else-return`: remove `else` after a `return`
- `no-nested-ternary`: flatten nested ternaries
- `no-plusplus`: use `+= 1` instead of `++`
- `prefer-arrow-callback`: use arrow functions for callbacks, not named `function` expressions

---

## Type Detection

Use project assertion helpers instead of raw `typeof`. In Worker source code, import from `src/kixx/assertions/mod.js` using the correct relative path from the file you are editing. In Node-side test or tooling code, import the helpers from the `kixx-assert` module by its bare module name when the test/tooling file is not importing the Worker assertion module.

```javascript
import { isUndefined, isString } from '../../kixx/assertions/mod.js';

// Correct
if (isUndefined(value)) { ... }
if (isString(value)) { ... }

// Wrong
if (typeof value === 'undefined') { ... }
if (typeof value === 'string') { ... }
```

Choose the relative import path from the file you are editing. Do not add a new helper unless the existing assertion module lacks the needed predicate.

### Type Predicates

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

### Comparison and Formatting

- `isEqual(a, b)`: strict equality plus valid-Date equality and NaN === NaN; curryable
- `doesMatch(matcher, value)`: RegExp.test(), isEqual(), String.includes(), or ISO date matching; curryable
- `toFriendlyString(value)`: human-readable value formatter for diagnostics

---

## Inline Code Comments

This section summarizes inline comment style. For the complete guidance, see `docs/code-documentation-guide.md`.

Inline comments explain the *why* — intent, constraints, and context that the code itself cannot express.

Add comments when the code seems counterintuitive or requires domain knowledge:

```javascript
// Increment DB counter BEFORE processing to ensure we don't
// get stuck on the same database if we hit the time limit
currentDb = (currentDb + 1) % totalDatabases;
```

Do **not** add trivial comments:

```javascript
// Bad
user.name = 'John'; // Set the user name to John

// Good
user.name = sanitizeInput(rawName); // Remove potential XSS vectors
```

Use guide comments to break up complex logic:

```javascript
async function processPayment(order, paymentMethod) {
    // Validate payment details and customer eligibility
    await validatePaymentMethod(paymentMethod);
    await checkCustomerCredit(order.customerId);

    // Calculate final amounts including taxes and fees
    const taxAmount = calculateTax(order);
    const finalAmount = order.total + taxAmount + calculateFee(paymentMethod, order.total);

    // Process payment and update order status
    const transaction = await chargePayment(paymentMethod, finalAmount);
    await updateOrderStatus(order.id, 'paid', transaction.id);

    return transaction;
}
```

Document state transitions and side effects:

```javascript
// After this call, the connection state changes to 'authenticating'
// and subsequent messages will be queued until auth completes
await connection.startAuthentication(credentials);
```

Use "teacher comments" for domain knowledge:

```javascript
// JWT exp claim uses NumericDate format (seconds since epoch)
// JavaScript Date.now() returns milliseconds, so we divide by 1000
const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24); // 24 hours
```

Document workarounds and hacks:

```javascript
// Workaround: Some legacy clients send timestamps as strings
// TODO: Remove this once all clients upgrade to v2.0+
const timestamp = typeof data.timestamp === 'string'
    ? parseInt(data.timestamp, 10)
    : data.timestamp;
```

Explain performance or memory considerations:

```javascript
// Pre-allocate buffer to avoid multiple reallocations
// during high-frequency writes (saves ~40% memory churn)
const buffer = Buffer.allocUnsafe(expectedSize);

// Process in chunks to avoid blocking the event loop
for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await processChunk(chunk);

    // Yield control back to event loop between chunks
    await setImmediate();
}
```

Flag coordinated change points for future readers:

```javascript
const EVENT_TYPES = {
    USER_LOGIN: 'user:login',
    USER_LOGOUT: 'user:logout',
    // WARNING: When adding event types here, also update:
    // - src/analytics/event-handlers.js
    // - tests/fixtures/events.json
};
```
