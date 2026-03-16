---
name: coding-conventions
description: "ESLint-enforced formatting and style rules for this project's JavaScript. Key project-specific conventions to get right: 4-space indentation; single quotes; spaces inside array brackets ([ 1, 2, 3 ]) and template literals (`${ value }`); trailing commas in multiline objects/arrays but NOT in function params or imports; arrow function params always need parens; use i += 1 not i++; operators go at the start of continued lines, not the end. Apply when writing or refactoring any JavaScript code."
---

This document summarizes the JavaScript coding styles and conventions, many of which are defined in ./eslint-config.mjs and enforced by ESLint.

## Summary of Key Conventions

### Critical Rules (Errors)
1. **4-space indentation** with spaces
2. **Single quotes** for strings
3. **Semicolons required**
4. **Strict equality** (`===`, `!==`)
5. **No `var`** - use `const`/`let`
6. **Prefer `const`** over `let`
7. **Always use curly braces** for control structures
8. **Spaces in object/template literals** `{ key: value }`, `` `${ value }` ``
9. **Spaces in arrays** `[ 1, 2, 3 ]` (except objects)
10. **No console statements** (must be explicitly allowed)
11. **Arrow functions** for callbacks
12. **No `++`/`--`** operators

### Warnings (Non-blocking)
1. **Avoid await in loops** (consider parallelization)
2. **Avoid bitwise operators** (usually mistakes)
3. **Avoid mixed operators** (use parentheses)
4. **TODO/FIXME comments** (track technical debt)

### Allowed Flexibility
1. **Consistent returns not required** (can return or not)
2. **Underscores allowed** in identifiers
3. **Quote object properties** for readability
4. **`async` without `await`** (for promisification)
5. **`undefined` keyword** can be used

- **ECMAScript Version**: ES2022
- **Module System**: ES6 Modules (`import`/`export`)

## Indentation and Spacing

**4 spaces for indentation** (not tabs)
```javascript
// ✓ GOOD
function example() {
    const value = 10;
    if (condition) {
        doSomething();
    }
}

// ✗ BAD - 2 spaces
function example() {
  const value = 10;
}
```

**Switch cases indented one level**
```javascript
// ✓ GOOD
switch (value) {
    case 1:
        doSomething();
        break;
    case 2:
        doSomethingElse();
        break;
}
```

**Array brackets have spaces, except for objects inside arrays**
```javascript
// ✓ GOOD
const arr = [ 1, 2, 3 ];
const mixed = [{ a: 1 }, { b: 2 }];  // No space before closing bracket

// ✗ BAD
const arr = [1, 2, 3];  // Missing spaces
const mixed = [ { a: 1 } ];  // Extra space before closing bracket
```

**Object curly braces always have spaces**
```javascript
// ✓ GOOD
const obj = { a: 1, b: 2 };
import { something } from 'module';

// ✗ BAD
const obj = {a: 1, b: 2};
import {something} from 'module';
```

**Space before blocks**
```javascript
// ✓ GOOD
if (condition) {
    doSomething();
}

// ✗ BAD
if (condition){
    doSomething();
}
```

**Space in template literals**
```javascript
// ✓ GOOD
const message = `Hello ${ name }`;

// ✗ BAD
const message = `Hello ${name}`;
```

**No spaces in parentheses**
```javascript
// ✓ GOOD
function example(a, b) {
    return (a + b);
}

// ✗ BAD
function example( a, b ) {
    return ( a + b );
}
```

**Spaces around infix operators**
```javascript
// ✓ GOOD
const sum = a + b;
const result = x * y;

// ✗ BAD
const sum = a+b;
const result = x*y;
```

## Semicolons

**Always use semicolons**
```javascript
// ✓ GOOD
const x = 10;
doSomething();

// ✗ BAD
const x = 10
doSomething()
```

**Semicolon spacing**
```javascript
// ✓ GOOD
for (let i = 0; i < 10; i += 1) {
    doSomething();
}

// ✗ BAD
for (let i = 0 ; i < 10 ; i += 1) {
    doSomething();
}
```

## Quotes

**Use single quotes** (except when avoiding escapes or using template literals)
```javascript
// ✓ GOOD
const message = 'Hello world';
const withApostrophe = "It's working";  // Avoiding escape
const template = `Hello ${ name }`;  // Template literal OK

// ✗ BAD
const message = "Hello world";
const withApostrophe = 'It\'s working';  // Should use double quotes
```

## Commas

**Trailing commas in multiline arrays and objects**
```javascript
// ✓ GOOD
const arr = [
    1,
    2,
    3,
];

const obj = {
    a: 1,
    b: 2,
};

// ✗ BAD
const arr = [
    1,
    2,
    3  // Missing trailing comma
];
```

**No trailing commas in function calls, imports, or exports**
```javascript
// ✓ GOOD
function example(a, b, c) { }
import { a, b, c } from 'module';
export { a, b, c };

// ✗ BAD
function example(a, b, c,) { }  // No trailing comma
import { a, b, c, } from 'module';
```

**Comma spacing**
```javascript
// ✓ GOOD
const arr = [ 1, 2, 3 ];
function example(a, b) { }

// ✗ BAD
const arr = [ 1,2,3 ];
function example(a,b) { }
```

## Line Breaks

**End files with a newline**

**Operators at the beginning of continued lines**
```javascript
// ✓ GOOD
const result = longValue
    + anotherValue
    + yetAnotherValue;

// ✗ BAD
const result = longValue +
    anotherValue +
    yetAnotherValue;
```

**No trailing whitespace**

**Line breaks between class members** (except after single-line members)
```javascript
// ✓ GOOD
class Example {
    shortMethod() { return 1; }
    anotherShort() { return 2; }

    longerMethod() {
        // Implementation
        return result;
    }

    anotherLonger() {
        // Implementation
    }
}
```

## Variables and Constants

**Use `const` by default, `let` when reassignment is needed**
```javascript
// ✓ GOOD
const name = 'John';
let counter = 0;
counter += 1;

// ✗ BAD
let name = 'John';  // Should be const
var counter = 0;  // Never use var
```

**No multiple assignments in one statement**
```javascript
// ✓ GOOD
const a = 5;
const b = 10;

// ✗ BAD
const a = b = 5;
```

**No variable shadowing**
```javascript
// ✗ BAD
const name = 'John';
function example() {
    const name = 'Jane';  // Shadows outer name
}
```

**Functions and classes can be used before definition**
```javascript
// ✓ GOOD
doSomething();  // OK for functions

function doSomething() {
    // Implementation
}

// ✗ BAD for variables
console.log(x);  // Not allowed
const x = 10;
```

## Functions

**Prefer function declarations, allow arrow functions**
```javascript
// ✓ GOOD
function example() {
    return 42;
}

const callback = () => {
    return 42;
};

// ✗ BAD
const example = function () {  // Should be declaration
    return 42;
};
```

**Function spacing**
```javascript
// ✓ GOOD - Named functions: no space before parens
function example(a, b) {
    return a + b;
}

// ✓ GOOD - Anonymous functions: space before parens
const fn = function (a, b) {
    return a + b;
};

// ✓ GOOD - Async arrows: space before parens
const asyncFn = async (a, b) => {
    return a + b;
};

// ✗ BAD
function example (a, b) {  // Extra space
    return a + b;
}
```

**Always use parentheses around arrow function parameters**
```javascript
// ✓ GOOD
const double = (x) => x * 2;
const add = (a, b) => a + b;

// ✗ BAD
const double = x => x * 2;  // Missing parens
```

**Arrow function spacing**
```javascript
// ✓ GOOD
const fn = (x) => x * 2;
const multiline = (x) =>
    x * 2;

// ✗ BAD
const fn = (x)=>x * 2;  // Missing spaces
const multiline = (x) => x * 2;  // Implicit return should be on same line
```

**Prefer arrow callbacks to prevent `this` errors**
```javascript
// ✓ GOOD
items.map((item) => item.value);
items.forEach((item) => {
    console.log(item);
});

// Named functions are allowed when intentional
items.forEach(function processItem(item) {
    console.log(item);
});

// ✗ BAD - Risks wrong `this` binding
items.map(function (item) {
    return this.process(item);
});
```

**No functions in loops**
```javascript
// ✗ BAD
for (let i = 0; i < 10; i += 1) {
    setTimeout(function () {
        console.log(i);
    }, 100);
}

// ✓ GOOD
for (let i = 0; i < 10; i += 1) {
    const index = i;
    setTimeout(() => {
        console.log(index);
    }, 100);
}
```

**Use rest parameters instead of `arguments`**
```javascript
// ✓ GOOD
function example(...args) {
    return args.length;
}

// ✗ BAD
function example() {
    return arguments.length;
}
```

**No assignment in return statements**
```javascript
// ✓ GOOD
function example(x) {
    const result = x * 2;
    return result;
}

// ✗ BAD
function example(x) {
    return result = x * 2;
}
```

**No `return await` (redundant)**
```javascript
// ✓ GOOD
async function getData() {
    return fetchData();
}

// ✗ BAD
async function getData() {
    return await fetchData();  // Redundant await
}
```

**No early returns after else**
```javascript
// ✓ GOOD
function example(x) {
    if (x > 10) {
        return 'high';
    }
    return 'low';
}

// ✗ BAD
function example(x) {
    if (x > 10) {
        return 'high';
    } else {
        return 'low';  // Unnecessary else
    }
}
```

**No useless returns**
```javascript
// ✓ GOOD
function example() {
    doSomething();
}

// ✗ BAD
function example() {
    doSomething();
    return;  // Useless
}
```

**Consistent returns not required**
```javascript
// ✓ ALLOWED - Different code paths can return or not
function example(x) {
    if (x > 10) {
        return 'high';
    }
    // No return here is OK
}
```

## Conditionals

**Always use curly braces** (even for single-line blocks)
```javascript
// ✓ GOOD
if (condition) {
    doSomething();
}

// ✗ BAD
if (condition) doSomething();

if (condition)
    doSomething();
```

**Brace style: one true brace style**
```javascript
// ✓ GOOD
if (condition) {
    doSomething();
} else {
    doSomethingElse();
}

// ✗ BAD
if (condition)
{
    doSomething();
}
else
{
    doSomethingElse();
}
```

**No lonely if in else**
```javascript
// ✓ GOOD
if (condition1) {
    doSomething();
} else if (condition2) {
    doSomethingElse();
}

// ✗ BAD
if (condition1) {
    doSomething();
} else {
    if (condition2) {
        doSomethingElse();
    }
}
```

**Use strict equality** (`===` and `!==`)
```javascript
// ✓ GOOD
if (x === 10) {
    doSomething();
}
if (y !== null) {
    doSomethingElse();
}

// ✗ BAD
if (x == 10) {  // Use ===
    doSomething();
}
if (y != null) {  // Use !==
    doSomethingElse();
}
```

**No nested ternary operators**
```javascript
// ✓ GOOD
const result = condition ? 'yes' : 'no';

// ✗ BAD
const result = condition1 ? 'yes' : condition2 ? 'maybe' : 'no';
```

## Switch Statements

**Default case must be last**
```javascript
// ✓ GOOD
switch (value) {
    case 1:
        doSomething();
        break;
    case 2:
        doSomethingElse();
        break;
    default:
        doDefault();
}

// ✗ BAD
switch (value) {
    default:
        doDefault();
        break;  // Default should be last
    case 1:
        doSomething();
        break;
}
```

## Loops

**Guard for-in loops**
```javascript
// ✓ GOOD
for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
        doSomething(obj[key]);
    }
}

// ✗ BAD
for (const key in obj) {
    doSomething(obj[key]);  // Should guard
}
```

**No unmodified loop conditions**
```javascript
// ✗ BAD
let i = 0;
while (i < 10) {
    doSomething();  // i never changes!
}

// ✓ GOOD
let i = 0;
while (i < 10) {
    doSomething();
    i += 1;
}
```

**No unreachable loops** (loops that always exit on first iteration)
```javascript
// ✗ BAD
while (condition) {
    doSomething();
    break;  // Always breaks
}
```

**Avoid `++` and `--` operators**
```javascript
// ✓ GOOD
i += 1;
i -= 1;

// ✗ BAD
i++;
i--;
```

## Object Literals

**Use object shorthand**
```javascript
// ✓ GOOD
const name = 'John';
const age = 30;
const person = { name, age };
const methods = {
    getName() {
        return this.name;
    },
};

// ✗ BAD
const person = { name: name, age: age };
const methods = {
    getName: function () {
        return this.name;
    },
};
```

**No computed property keys when unnecessary**
```javascript
// ✓ GOOD
const obj = { foo: 'bar' };

// ✗ BAD
const obj = { ['foo']: 'bar' };  // Unnecessary brackets
```

**Quote object properties when needed** (allowed)
```javascript
// ✓ ALLOWED - Quote props for readability even when not required
const obj = {
    'property-name': 'value',
    'normalKey': 'value',  // Allowed
};
```

## Classes

**Constructor names must be capitalized**
```javascript
// ✓ GOOD
class MyClass { }
const instance = new MyClass();

// ✗ BAD
class myClass { }  // Should be capitalized
```

**Always use `new` with constructors**
```javascript
// ✓ GOOD
const date = new Date();

// ✗ BAD
const date = Date();  // Missing new
```

**Group accessor pairs (getters before setters)**
```javascript
// ✓ GOOD
class Example {
    get value() {
        return this._value;
    }

    set value(v) {
        this._value = v;
    }
}

// ✗ BAD
class Example {
    set value(v) {
        this._value = v;
    }

    get value() {  // Getter should come first
        return this._value;
    }
}
```

**No invalid `this` references**
```javascript
// ✗ BAD
function example() {
    console.log(this.value);  // Invalid this context
}

// ✓ GOOD
class Example {
    method() {
        console.log(this.value);  // Valid in class
    }
}
```

## Async/Promises

**No return values in Promise executor**
```javascript
// ✗ BAD
new Promise((resolve) => {
    return resolve(42);  // Don't return
});

// ✓ GOOD
new Promise((resolve) => {
    resolve(42);
});
```

**Prefer Error objects for Promise.reject()**
```javascript
// ✓ GOOD
return Promise.reject(new Error('Something went wrong'));

// ✗ BAD
return Promise.reject('Something went wrong');
```

**`async` functions without `await` are allowed**
```javascript
// ✓ ALLOWED - Sometimes we want to promisify without using await
async function example() {
    return 42;  // Wraps in Promise
}
```

## Comparisons

**No implicit type coercion**
```javascript
// ✓ GOOD
const str = String(value);
const num = Number(value);
const bool = Boolean(value);

// ✗ BAD
const str = '' + value;
const num = +value;
const bool = !!value;
```

**No floating decimals**
```javascript
// ✓ GOOD
const num = 0.5;
const num2 = 1.0;

// ✗ BAD
const num = .5;
const num2 = 1.;
```

**Use radix parameter for parseInt**
```javascript
// ✓ GOOD
const num = parseInt(str, 10);

// ✗ BAD
const num = parseInt(str);
```

## Dangerous Practices

**No extending native prototypes**
```javascript
// ✗ BAD
Array.prototype.myMethod = function () { };

// ✓ GOOD - Use utility functions
function myArrayMethod(arr) { }
```

**No bitwise operators** (warning, not error)
```javascript
// ⚠ WARNING - Usually a typo
if (flag & otherFlag) {  // Did you mean &&?
    doSomething();
}
```

**No `arguments.caller` or `arguments.callee`**
```javascript
// ✗ BAD
function example() {
    return arguments.callee;
}
```

## Code Quality

**No throwing literals**
```javascript
// ✓ GOOD
throw new Error('Something went wrong');

// ✗ BAD
throw 'Something went wrong';
throw { message: 'error' };
```

**No mixed operators without parentheses** (warning)
```javascript
// ⚠ WARNING - Clarify precedence
const result = a + b * c;

// ✓ BETTER
const result = a + (b * c);
```

**Maximum one statement per line**
```javascript
// ✓ GOOD
const x = 10;
const y = 20;

// ✗ BAD
const x = 10; const y = 20;
```

## Naming and Underscores

**Underscores in identifiers are allowed**
```javascript
// ✓ ALLOWED
const _private = 'value';
const __internal = 'value';
this._property = 'value';
```

**Using `undefined` is allowed**
```javascript
// ✓ ALLOWED
if (value === undefined) {
    doSomething();
}
```

## See Also

- `code-documentation` — JSDoc block comments and inline comment guidelines; loads alongside this skill for most coding tasks
- `runtime-assertions` — enforcing invariants and validating inputs in production code using the kixx-assert library
- `error-handling` — error class conventions and patterns for expected vs. unexpected errors
