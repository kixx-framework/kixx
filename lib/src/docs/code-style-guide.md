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

Creating small classes, methods, and functions is NOT your goal when writing or refactoring code; making the code simpler is your goal. There are times when you should bring code together to make it simpler when breaking it apart would make it more complex:

- Code that shares information; for example, both pieces of code might depend on information about a common protocol.
- They are used together: anyone using one of the pieces of code is likely to use the other as well.
- They overlap conceptually, in that there is a simple higher-level category that includes both of the pieces of code.
- It is hard to understand one of the pieces of code without looking at the other.

**Avoid thin wrapper classes**

Avoid writing classes which are just wrappers over data, with getters and setters.

This is bad:

```javascript
class Dog {

    #color;
    #weight;
    #breeds;

    constructor(args) {
        this.#color = args.color;
        this.#weight = args.weight;
        this.#breeds = args.breeds;
    }

    get color() { return this.#color; }

    get weight() {
        return Number.parseFloat(this.#weight);
    }

    get breeds() {
        return this.#breeds.join(', ');
    }
}
```

Don't write useless getters and setters like that. When you see it, either remove them, or remove the whole class if it serves no other purpose. Just operate on the plain JavaScript object, and maybe include a JSDoc @typedef type definition for it.

This is better:

```javascript
class Dog {

    constructor(args) {
        this.color = args.color;
        this.weight = Number.parseFloat(args.weight);
        this.breeds = args.breeds.join(', ');
    }
}
```

Or use a type definition:

```javascript
/**
 * @typedef
 * @property {string} color - The common color of the dog
 * @property {number} weight - The weight of the dog expressed as a float
 * @property {string} breeds - The common breeds of the dog expressed as a comma separated list
 */

/**
 * @returns {Dog}
 */
function createDog(args) {
    return {
        color: args.color,
        weight: Number.parseFloat(args.weight),
        breeds: args.breeds.join(', '),
    };
}
```

Code Style Guidelines
---------------------

This project uses JavaScript in the **ECMAScript 2022** standard using **ES modules** (no CommonJS, no `"use strict"`).

**The Linter is Authoritative**

The ESLint config in `eslint.config.js` enforces the code style rules beyond what this guide explicitly includes. If the linter reports an error, fix it, even if it isn't covered by this document.

### Naming Conventions

- **Files**: kebab-case (`user-service.js`, not `UserService.js`)
- **Functions**: camelCase, verb-first (`createUser`, `validateToken`)
- **Classes**: PascalCase with descriptive suffixes (`UserCreateInput`, `AuthResponse`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Boolean variables**: is/has/can prefix (`isActive`, `hasPermission`)


### Use whitespace to organize code

Let the reader of the code breathe. Add empty lines between logical blocks of code.

### Arrow Functions

Single-expression bodies go on one line:

```javascript
[1, 2, 3].map((n) => n * 10);
```

Multi-statement or complex bodies use a block on multiple lines:

```javascript
const isConst = variable.defs.some((def) => {
    return def.type === 'Variable' &&
        def.parent &&
        def.parent.kind === 'const';
});
```

### Function Argument Objects

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

### Unused Variables (`no-unused-vars`)

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

### Private Class Members

Use ES2022 `#` private fields and methods instead of underscore prefixes:

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

### Async Code

Rule: When an async function or method delegates its return value to another Promise-returning operation, await that operation before returning. Do not return the delegated Promise directly.

Awaiting the Promise causes a rejection to pass through the current function, preserving that function as an async frame in the error stack. Accordingly, Promise-forwarding wrappers should generally be declared `async` and use `return await`.

This is correct:

```js
export async function getObjectListing(baseUrl) {
    const res = await fetch(`${ baseUrl }/objects`);
    return await res.json();
}
```

This is incorrect because `getObjectListing()` may be omitted from the error stack if the delegated Promise rejects:

```js
export async function getObjectListing(baseUrl) {
    const res = await fetch(`${ baseUrl }/objects`);
    return res.json();
}
```

### Type Detection

In server-side or tooling code, use the Kixx assertion helpers instead of raw `typeof`. Import assertion helpers from `kixx/assertions/mod.js` using the correct relative path from the file you are editing.

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

Use inline comments to explain intent, constraints, context, and decisions that the code cannot express clearly by itself. Be opportunistic: when you had to reason about why code belongs in its current shape, leave a short comment so the next reader does not have to rediscover that reasoning.

Focus on why the code exists and why it does what it does, especially when it seems counterintuitive or requires domain knowledge:

Good inline comments often capture:

- why this logic branch exists
- why this order matters
- why this default is safe or required
- why a value is cloned, frozen, normalized, or rewrapped
- why an error is caught, translated, hidden, or allowed to propagate
- why a simpler-looking implementation would be wrong in this runtime

Prefer one or two focused lines near the decision. A useful comment does not need to justify the whole function.

**Use Guide Comments to Break Up Complex Logic**

Use short guide comments to separate phases in longer logic when the section boundaries help readers scan intent.

```javascript
async function processPayment(order, paymentMethod) {
    // Validate payment details and customer eligibility.
    await validatePaymentMethod(paymentMethod);
    await checkCustomerCredit(order.customerId);

    // Calculate final amounts including taxes and fees.
    const taxAmount = calculateTax(order);
    const finalAmount = order.total + taxAmount + calculateFee(paymentMethod, order.total);

    // Process payment and update order status.
    const transaction = await chargePayment(paymentMethod, finalAmount);
    await updateOrderStatus(order.id, 'paid', transaction.id);

    return transaction;
}
```

**Document State Transitions and Side Effects**

```javascript
// After this call, the connection state changes to 'authenticating'
// and subsequent messages are queued until auth completes.
await connection.startAuthentication(credentials);
```

**Use Teacher Comments for Domain Knowledge**

```javascript
// JWT exp claim uses NumericDate format in seconds since epoch.
// JavaScript Date.now() returns milliseconds, so divide by 1000.
const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24);
```

**Document Workarounds and Hacks**

```javascript
// Workaround: some legacy clients send timestamps as strings; remove this
// once all clients upgrade to v2.
const timestamp = typeof data.timestamp === 'string'
    ? parseInt(data.timestamp, 10)
    : data.timestamp;
```

**Explain Performance or Memory Considerations**

```javascript
// Pre-allocate the buffer to avoid repeated reallocations during
// high-frequency writes.
const buffer = Buffer.allocUnsafe(expectedSize);

// Process in chunks to avoid blocking the event loop.
for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await processChunk(chunk);

    // Yield control back to the event loop between chunks.
    await setImmediate();
}
```

**Explain Protocol, Security, and Compatibility Decisions**

Use inline comments for decisions that encode HTTP rules, browser behavior, platform limits, security posture, or compatibility with external clients. These comments should explain the consequence, not just restate the operation.

```javascript
// Content-Length is measured in bytes, not JavaScript characters; using
// string length can truncate UTF-8 responses containing multi-byte characters.
const contentLength = new Blob([ body ]).size;
```

**Flag Coordinated Change Points**

```javascript
const EVENT_TYPES = {
    USER_LOGIN: 'user:login',
    USER_LOGOUT: 'user:logout',
    // WARNING: When adding event types here, also update:
    // - src/analytics/event-handlers.js
    // - test/fixtures/events.json
};
```
