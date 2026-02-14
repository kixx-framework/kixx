---
name: writing-tests
description: Guidelines, examples, and reference documentation for writing, updating, and fixing tests in this project.
---

## Running Tests
All test modules are located in the `test/` directory.

**Run all tests:**

```bash
node ./run-tests.js
```

**Run a specific directory of tests (read recursively):**

```bash
node ./run-tests.js test/application/
```

Running a directory of tests can be helpful when working on a specific component or capability of the system.

**Run a specific file of tests:**

```bash
node ./run-tests.js test/application/application-context.test.js
```

Running only a single file of tests can help isolate testing a specific module you're working on.

**Run the linter and full test suite:**

```bash
npm test
```

It's good to run the linter and full test suite when your tests are complete to be sure there are no regressions.

## Test File Naming Conventions
There are two rules to follow when creating test files:

1. Test files should be located in the `test/` directory and the nested directory structure should match the directory structure of the `lib/` directory. For example: The tests for `lib/application/paths.js` should be in `test/application/paths.test.js` and the tests for `lib/hyperview/helpers/format-date.js` should be in `test/hyperview/helpers/format-date.test.js`.
2. Test files should end in `test.js`. For example: The tests for `paths.js` becomes `paths.test.js` and the tests for `format-date.js` becomes `format-date.test.js`.

## Testing Dependencies
We use these supporting libraries for automated testing. You can find the documentation for each of them in this document.

- [Kixx Test Framework](#kixx-test-framework)
- [Kixx Assertion Library](#kixx-assertion-library)
- [Sinon](#sinon) for mocking

## Getting Started Authoring Tests
Here is a simple example describe test block in `test/application/paths.test.js` for the Paths module in `lib/application/paths.js`:

```javascript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import Paths from '../../lib/application/paths.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_APP_DIR = path.join(THIS_DIR, 'my-projects', 'fake-app');

describe('Application/Paths#constructor with valid input', ({ before, it }) => {
    const paths = new Paths(FAKE_APP_DIR);

    it('should have the correct app_directory', () => {
        assertEqual(paths.app_directory, FAKE_APP_DIR);
    });

    it('should have the correct routes_directory', () => {
        assertEqual(paths.routes_directory, path.join(FAKE_APP_DIR, 'routes'));
    });

    it('should have the correct public_directory', () => {
        assertEqual(paths.public_directory, path.join(FAKE_APP_DIR, 'public'));
    });

    it('should have the correct pages_directory', () => {
        assertEqual(paths.pages_directory, path.join(FAKE_APP_DIR, 'pages'));
    });

    it('should have the correct templates_directory', () => {
        assertEqual(paths.templates_directory, path.join(FAKE_APP_DIR, 'templates'));
    });

    it('should have the correct app_plugin_directory', () => {
        assertEqual(paths.app_plugin_directory, path.join(FAKE_APP_DIR, 'app'));
    });

    it('should have the correct plugins_directory', () => {
        assertEqual(paths.plugins_directory, path.join(FAKE_APP_DIR, 'plugins'));
    });

    it('should have the correct commands_directory', () => {
        assertEqual(paths.commands_directory, path.join(FAKE_APP_DIR, 'commands'));
    });

    it('should have the correct data_directory', () => {
        assertEqual(paths.data_directory, path.join(FAKE_APP_DIR, 'data'));
    });
});
```

This is a more complex example in `test/hyperview/page-store.test.js` with mocks defined by Sinon and a `before()` setup with asynchronous calls for the PageStore module in `lib/hyperview/page-store.js`. See [Making assertions about errors](#making-assertions-about-errors) for examples of testing error conditions.

```javascript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import PageStore from '../../lib/hyperview/page-store.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));


describe('PageStore#doesPageExist() when stats isDirectory is true', ({ before, after, it }) => {
    const directory = THIS_DIR;

    const stats = {
        isDirectory: sinon.stub().returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.stub().resolves(stats),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.doesPageExist('/blog/a-blog-post');
    });

    after(() => {
        // Always restore the sinon state when using stubs or spies on existing methods.
        sinon.restore();
    });

    it('passes the full directory path to getFileStats()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.getFileStats.callCount);
        assertEqual(dirpath, fileSystem.getFileStats.getCall(0).firstArg);
    });

    it('calls isDirectory() on stats', () => {
        assertEqual(1, stats.isDirectory.callCount);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});
```

## Kixx Test Framework
The Kixx Test framework provides a basic and reliable framework for creating unit tests for JavaScript code. Tests are created in Kixx Test using `describe()` blocks, `before()` setup blocks, `after()` teardown blocks, and `it()` test blocks.

### Setting up describe() test blocks
Each discrete piece of functionality should have its own describe block with a short description statement and nested `it()` blocks which assert some behavior or state. A common pattern is to create a describe block for each logical code branch in a method. Optionally, nested before and after blocks can be used to define the setup and teardown of the test(s) in the describe block.

Define your test subject, spies and stubs, and any results or state at the top of your `describe(({ before, after, it }) => {});` block using the JavaScript `let` keyword. Use `let` because these variables are declared in the describe scope but assigned inside `before()`.

Here is a basic example of using the kixx framework:

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

// The describe block injects the before, after, and it functions into the block scope for you.
describe('MyComponent: some behavior', ({ before, after, it }) => {

    let testSubject;
    let result;

    // A before() block can be async if needed.
    before(async () => {
        testSubject = new MyComponent();
        result = await testSubject.doSomethingAsync();
    });

    // An after() block can be async if needed.
    after(async () => {
        // Test to make sure that testSubject got created before calling close() on it.
        if (testSubject) {
            await testSubject.close();
        }
    });

    it('can perform simple assertions', () => {
        assertEqual(42, result, 'doSomethingAsync() result');
    });

    // The it() blocks can be async if needed.
    it('can test async code', async () => {
        const body = await result.body();
        assertEqual('async result', body, 'result.body()');
    });
});
```

#### Do not nest describe(blocks)
Do not nest describe() blocks. Although possible to do so in the Kixx Test framework, nested describe blocks become confusing. Instead create a top level describe block for each discrete piece of functionality even if that means you need to repeat before() and after() blocks for each of them.

#### Create discrete describe() blocks
Create a discrete describe() block for each behavior you intend to test. Be aware that many methods may require several describe() blocks to describe all the functionality they contain. Look for logical branches of code in a method for clues to different behaviors.

Here is an example of creating different describe() blocks based on different logical code branches in a method:

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

function toBinary(value) {
    if (value <= 0) {
        return false;
    }
    if (value >= 1) {
        return true;
    }
}

describe('toBinary(): when value is less than or equal to 0', ({ it }) => {
    it('returns false', () => {
        assertEqual(false, toBinary(0));
        assertEqual(false, toBinary(-1));
        assertEqual(false, toBinary(-99));
    })
});

describe('toBinary(): when value is greater than equal to 1', ({ it }) => {
    it('returns true', () => {
        assertEqual(true, toBinary(1));
        assertEqual(true, toBinary(2));
        assertEqual(true, toBinary(99));
    })
});
```

## Kixx Assertion Library
The "kixx-assert" library is a JavaScript assertion library.

It contains test functions like `isNumberNotNaN()` which return Booleans, and assertion functions like `assertEqual()` which throw an AssertionError if the condition(s) fail.

Assertion functions come in two flavors: single subject checks and control/subject checks. A message string can be passed into either type of assertion as the last argument. Use message strings to provide context when a test failure would otherwise be ambiguous.

A single subject check with a message string:

```javascript
assertNonEmptyString(null, 'This value should be a string');
// Throws an AssertionError("This value should be a string (Expected null to be a non-empty String)")
```

A control/subject check with a message string:
```javascript
assertEqual('foo', 'bar', 'Subject is equal to control');
// Throws an AssertionError("Subject is equal to control (Expected String(bar) to equal (===) String(foo))")
```

Control/subject checks can be curried:
```javascript
const assertFoo = assertEqual('foo');

assertFoo('bar', 'Subject is foo');
// Throws an AssertionError("Subject is foo (Expected String(bar) to equal (===) String(foo))")
```

### No deep equality assertions
The Kixx Assert library does not do deep equality testing or matching. This feature has been left out intentionally to avoid complexity. It is better, and more clearly understood, to compare objects by reference where possible, or by comparing their properties if not.

### assert
Throw an AssertionError if the passed value is not truthy.

```javascript
assert(0) // Throws AssertionError
assert('foo') // Passes
```

### assertFalsy
Throw an AssertionError if the passed value is not falsy.

```javascript
assertFalsy('foo') // Throws AssertionError
assertFalsy(null) // Passes
```

### assertEqual
Throw an AssertionError if the passed values are *not strictly* equal. Dates and NaN are special cases handled separately. Can be curried.

```javascript
assertEqual(1, 2) // Throws AssertionError
assertEqual(1, '1') // Throws AssertionError
assertEqual(1, 1) // passes

// assertEqual() correctly handles NaN comparison (unlike NaN === NaN which is false).
assertEqual(NaN, NaN) // passes

// Compare dates
assertEqual(new Date('1999'), new Date('1999')) // passes

// Curried usage
const assertIs1 = assertEqual(1);
assertIs1(1) // passes
```

Does not do deep equality testing or matching. Compare objects by reference where possible, or by comparing their properties if not.

### assertNotEqual
The inverse of [assertEqual()](#assertequal). Can be curried.

### assertMatches
Matches strings and RegExp, but can match just about anything. Can be curried.

```javascript
assertMatches(matcher, subject);
```

If the matcher is a regular expression then doesMatch() will call RegExp.test(subject) with the subject. If the subject is strictly equal to the matcher then return true. If the subject is a String then check to see if the String contains the matcher with subject.includes(matcher). If the subject is a valid Date then convert it to a string using Date.toISOString() before making the comparison.

```javascript
assertMatches(/^foo/i, 'BAR') // Throws AssertionError
assertMatches(/^foo/i, 'FOOBAR') // passes
assertMatches('oba', 'foobar') // passes
assertMatches('fox', 'The quick brown fox jumped over the...') // passes

// Curried usage
const assertShortDateString = assertMatches(/^[\d]{4}-[\d]{2}-[\d]{2}$/);

assertShortDateString('14 September 2020') // Throws AssertionError
assertShortDateString('2020-09-14') // passes
```

### assertNotMatches
The inverse of [assertMatches()](#assertmatches). Can be curried.

### assertDefined
Will pass for any value which is not `undefined`.

```javascript
assertDefined(undefined) // Throws AssertionError
assertDefined(new Date().foo) // Throws AssertionError
assertDefined(new Map().size) // passes (even though .size is zero)
assertDefined(null) // passes
```

### assertUndefined
Inverse of [assertDefined()](#assertdefined).

```javascript
assertUndefined(null) // Throws AssertionError
assertUndefined(({}).toString) // Throws AssertionError
assertUndefined(undefined) // passes
```

### assertNonEmptyString
Asserts that the value is a string, and that it is *not* an empty string.

```javascript
assertNonEmptyString(1) // throws AssertionError
assertNonEmptyString('') // throws AssertionError
assertNonEmptyString('hello world') // true
```

### assertNumberNotNaN
Assert that the value is a number, and that it is *not* NaN.

```javascript
assertNumberNotNaN('2') // throws AssertionError
assertNumberNotNaN(NaN) // throws AssertionError
assertNumberNotNaN(1) // true
assertNumberNotNaN(0.1) // true
assertNumberNotNaN(BigInt(7)) // true
```

### assertArray
Uses the native Array.isArray().

```javascript
assertArray({}) // Throws AssertionError
assertArray([]) // passes
assertArray([1, 2, 3]) // passes
```

### assertBoolean
Checks the given value to see if it is a boolean (`true` or `false`).

```javascript
assertBoolean(1) // Throws AssertionError
assertBoolean(false) // true
assertBoolean(Boolean(1)) // true
```

### assertFunction
Detects function declaration, function expressions, arrow functions, and async functions.

```javascript
class Foo {
    yell() {
        return 'HELLO WORLD';
    }
}

async function helloWorld() {
    const res = await Promise.resolve('hello world');
    return res;
}

assertFunction(new Foo().yell) // true
assertFunction(helloWorld) // true
assertFunction(() => {}) // true
assertFunction('foo') // Throws AssertionError
```

### assertValidDate
Checks the given value to see if it is a valid Date instance.

```javascript
assertValidDate({}) // Throws AssertionError
assertValidDate(new Date('1999')) // true
assertValidDate(new Date('Invalid')) // Throws AssertionError
```

### assertRegExp
Checks the given value to see if it is a RegExp instance.

```javascript
assertRegExp({}) // throws AssertionError
assertRegExp(/^foo/i) // true
assertRegExp(new RegExp('^foo', 'i')) // true
```

### assertGreaterThan
If the subject is less than or equal to the control the test will fail. Can be curried.

```javascript
const control = new Date();

// This comparison of 1970 to today will throw an AssertionError
assertGreaterThan(control, new Date(0));

// Curried usage
const assertGreaterThan100 = assertGreaterThan(100);
assertGreaterThan100(99); // Will throw an AssertionError
```

### assertLessThan
If the subject is greater than or equal to the control the test will fail. Can be curried.

```javascript
const control = 'A';
assertLessThan(control, 'B'); // Will throw an AssertionError

// Curried usage
const assertBeforeToday = assertLessThan(new Date());
assertBeforeToday(new Date()); // Will throw an AssertionError
```

### curryAssertion2
Creates a function which can create assertion functions that can be curried. This is an internal utility used by the library to create curried assertion functions.

```javascript
import { curryAssertion2 } from 'kixx-assert';

const assertEqual = curryAssertion2('assertEqual', (expected, actual, messagePrefix) => {
    if (actual !== expected) {
        return `${messagePrefix}. Values are not equal.`;
    }
    return null;
});

const assertIsZero = assertEqual(0);
assertIsZero(1, 'What happens when we pass in 1?'); // Throws AssertionError
```

## Sinon
We use a subset of the Sinon library for mocking with spies and stubs.

### When to use a sinon spy or stub
Here are some rules of thumb to help when deciding to use a sinon spy or stub:

**Use a spy** ([Sinon Spy API](#sinon-spy-api)) to create simple functions without defined behavior when you just need to capture call information from the [Spy Call API](#spy-call-api).

```javascript
import { EventEmitter } from 'node:events';
import sinon from 'sinon';

const emitter = new EventEmitter();

// Create a callback function without any defined behavior.
const customCallback = sinon.spy();

emitter.on('customEvent', customCallback);

// Emit an event to the custom callback spy.
emitter.emit('customEvent', { name: 'customEvent' });

// Capture call count from the spy
assertEqual(1, customCallback.callCount);
// Capture arguments from the spy
const event = customCallback.getCall(0).firstArg;
assertEqual('customEvent', event.name);

const mockObject = {
    // Create a method on an object literal without any defined behavior.
    getSomeState: sinon.spy(),
};

mockObject.getSomeState();
mockObject.getSomeState();

// Capture call count from the spy
assertEqual(2, mockObject.getSomeState.callCount);
```

**Use a spy** if you still want the original function or method to be called but need to capture call information.

```javascript
import sinon from 'sinon';

const mockObject = {

    get flag() {
        return Boolean(this.internalFlag);
    },

    set flag(flag) {
        this.internalFlag = flag;
    },

    getSomeState() {
        return this.state;
    },
};

// Spy on an existing method but allow calls to pass through to the original implementation.
sinon.spy(mockObject, 'getSomeState');

mockObject.getSomeState();
mockObject.getSomeState();

// Capture call count from the spy
assertEqual(2, mockObject.getSomeState.callCount);

// Use sinon to spy on getters and setters
const flagGetterSetterSpy = sinon.spy(mockObject, 'flag', ['get','set']);

mockObject.flag = 99;
const flag = mockObject.flag;

// We can get information about the calls to getters and setters.
assertEqual(1, flagGetterSetterSpy.set.callCount);
assertEqual(99, flagGetterSetterSpy.set.getCall(0).firstArg);
assertEqual(1, flagGetterSetterSpy.get.callCount);
```

**Use a stub** ([Sinon Stub API](#sinon-stub-api)) to create a function with pre-programmed behavior, or to prevent the underlying function from being called.

```javascript
import { EventEmitter } from 'node:events';
import sinon from 'sinon';

const emitter = new EventEmitter();

// Create a callback function with defined behavior.
const customCallback = sinon.stub().throws(new Error('Test error'));

emitter.on('customEvent', customCallback);

// Emit an event to the custom callback stub which will throw the defined error.
try {
    emitter.emit('customEvent', { });
} catch (error) {
    assertEqual('Test error', error.message);
}

// Capture call count from the stub
assertEqual(1, customCallback.callCount);

const mockObject = {
    getSomeState() {
        return this.state;
    },
};

// Stub an existing method, preventing it from being called and defining its behavior.
sinon.stub(mockObject, 'getSomeState').returns(99);

const result1 = mockObject.getSomeState();
const result2 = mockObject.getSomeState();

assertEqual(2, mockObject.getSomeState.callCount);
assertEqual(99, result1);
assertEqual(99, result2);

// Always call sinon.restore() after using sinon stubs or spies on existing methods.
sinon.restore();
```

### sinon.restore()
Always call `sinon.restore()` in the `after()` block when using stubs or when using spies on existing methods. This restores original method behavior and prevents test pollution. Standalone spies created with `sinon.spy()` (not wrapping an existing method) don't strictly require restore, but calling it is good practice regardless.

```javascript
describe('Something with stubs', ({ before, after, it }) => {
    before(() => {
        sinon.stub(myObj, 'method').returns(42);
    });

    after(() => {
        sinon.restore();
    });

    it('works', () => {
        assertEqual(42, myObj.method());
    });
});
```

## Sinon Spy API
A test spy is a function that records arguments, return value, the value of this and exception thrown (if any) for all its calls.

Create a simple spy function:
```javascript
const customFunction = sinon.spy();
customFunction();
assertEqual(1, customFunction.callCount);
```

Wrap an existing function:
```javascript
function addOne(n) {
    return n + 1;
}

const customFunction = sinon.spy(addOne);

const result = customFunction(99);

assertEqual(1, customFunction.callCount);
assertEqual(100, result);
```

Wrap an existing method:
```javascript
import fs from 'node:fs';
import sinon from 'sinon';

sinon.spy(fs, 'readFileSync');

const contents = fs.readFileSync('./README.md');

assertEqual(1, fs.readFileSync.callCount);
assertEqual('./README.md', fs.readFileSync.getCall(0).firstArg);
```

Wrap a setter or getter:
```javascript
class Job {
    #milliseconds = 1000;

    set milliseconds(n) {
        this.#milliseconds = n;
    }

    get seconds() {
        return Math.round(this.#milliseconds / 1000);
    }
}

const job = new Job();

const setMillisecondsSpy = sinon.spy(job, 'milliseconds', ['set']);
const getSecondsSpy = sinon.spy(job, 'seconds', ['get']);

job.milliseconds = 2000;
const { seconds } = job;

assertEqual(1, setMillisecondsSpy.callCount);
assertEqual(2000, setMillisecondsSpy.getCall(0).firstArg);
assertEqual(1, getSecondsSpy.callCount);
```

All spy instances support the properties and methods described in the [Spy/Stub Common API](#spystub-common-api).

## Sinon Stub API
Test stubs are functions (spies) with pre-programmed behavior. They support the full [Spy/Stub Common API](#spystub-common-api) in addition to methods which can be used to alter the stub's behavior.

Create a simple stub function:
```javascript
import sinon from 'sinon';

const customFunction = sinon.stub().returns(99);
const result = customFunction();
assertEqual(1, customFunction.callCount);
assertEqual(99, result);

// Always restore the sandbox state after using stubs.
sinon.restore();
```

Stub an existing method:
```javascript
import fsp from 'node:fs/promises';
import sinon from 'sinon';

sinon.stub(fsp, 'readFile').resolves('# Getting Started');

const contents = await fsp.readFile('./README.md');

assertEqual(1, fsp.readFile.callCount);
assertEqual('./README.md', fsp.readFile.getCall(0).firstArg);
assertEqual('# Getting Started', contents);

// Always restore the sandbox state after using stubs.
sinon.restore();
```

### onCall(n)
Defines the behavior of the stub on the _nth_ call. Useful for testing sequential interactions.

There are alias methods `onFirstCall` (`onCall(0)`), `onSecondCall` (`onCall(1)`), and `onThirdCall` (`onCall(2)`) to make stub definitions read more naturally.

`onCall` can be combined with all of the behavior defining methods in this section.

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

describe('stub', ({ it, after }) => {

    after(() => {
        sinon.restore();
    });

    it('should behave differently on consecutive calls', () => {

        const callback = sinon.stub()
            .onCall(0).returns(1)
            .onCall(1).returns(2);

        // Set a default after defining onCall(n)
        callback.returns(0);

        assertEqual(1, callback()); // Return value from onCall(0)
        assertEqual(2, callback()); // Return value from onCall(1)
        assertEqual(0, callback()); // The default return value.
    });

    it('should behave differently on consecutive calls when defined with aliases', () => {

        const callback = sinon.stub()
            .onFirstCall().returns(1)
            .onSecondCall().returns(2);

        // Set a default after defining onCall(n)
        callback.returns(0);

        assertEqual(1, callback()); // Return value from onCall(0)
        assertEqual(2, callback()); // Return value from onCall(1)
        assertEqual(0, callback()); // The default return value.
    });
});
```

### .callsFake(fakeFunction)
Makes the stub call the provided `fakeFunction` when invoked.

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

const myObj = {
    prop() {
        return 'foo';
    }
};

describe('stub', ({ before, after, it }) => {
    before(() => {
        sinon.stub(myObj, 'prop').callsFake(function fakeFn() {
            return 'bar';
        });
    });

    after(() => {
        sinon.restore();
    });

    it('should call fake', () => {
        assertEqual('bar', myObj.prop());
    });
});
```

### .returns()
Makes the stub return the provided value.
```javascript
const component = {
    updateState: sinon.stub()
        .onFirstCall().returns(false)
        .onSecondCall().returns(true),
};

const result1 = component.updateState();
const result2 = component.updateState();

assertEqual(false, result1);
assertEqual(true, result2);

sinon.restore();
```

### .returnsThis()
Causes the stub to return its `this` value. Useful for testing method chaining.
```javascript
class Job {
    start() { }
}

const job = new Job();
sinon.stub(job, 'start').returnsThis();

// The .returnsThis() method will allow object method chaining.
const result = job.start().start();
assertEqual(job, result);

sinon.restore();
```

### .resolves()
Causes the stub to return a Promise which resolves to the provided value.
```javascript
const component = {
    updateState: sinon.stub()
        .onFirstCall().resolves(false)
        .onSecondCall().resolves(true),
};

const result1 = await component.updateState();
const result2 = await component.updateState();

assertEqual(false, result1);
assertEqual(true, result2);

sinon.restore();
```

### .throws()
Causes the stub to throw the provided exception object, or the object returned by the factory function.
```javascript
const func1 = sinon.stub().throws(new Error('first test error'));

const func2 = sinon.stub().throws(() => {
    return new Error('second test error');
})

try {
    func1();
} catch (error) {
    assertEqual('first test error', error.message);
}

try {
    func2();
} catch (error) {
    assertEqual('second test error', error.message);
}

sinon.restore();
```

### .rejects(value)
Causes the stub to return a Promise which rejects with the provided value.
```javascript
const func1 = sinon.stub().rejects(new Error('first test error'));

const func2 = sinon.stub().rejects(() => {
    return new Error('second test error');
})

try {
    await func1();
} catch (error) {
    assertEqual('first test error', error.message);
}

try {
    await func2();
} catch (error) {
    assertEqual('second test error', error.message);
}

sinon.restore();
```

## Spy/Stub Common API
These properties and methods are available on all objects returned from `sinon.spy()` and `sinon.stub()`. When spying on existing methods with `sinon.spy(object, "method")` and `sinon.stub(object, "method")`, they are also available on `object.method`.

### .callCount
The number of recorded calls.

### .getCall(n)
Returns the _nth_ [Spy Call](#spy-call-api) instance.

If _n_ is negative, the _nth_ call from the end is returned. For example, `spy.getCall(-1)` returns the last call, and `spy.getCall(-2)` returns the second to last call.

### .firstCall, .secondCall, .thirdCall, .lastCall
Convenience aliases for `getCall(0)`, `getCall(1)`, `getCall(2)`, and `getCall(-1)` respectively. Each returns a [Spy Call](#spy-call-api) object.

```javascript
import sinon from 'sinon';

const spy = sinon.spy();

spy('first');
spy('second');
spy('third');

assertEqual(3, spy.callCount);
assertEqual('first', spy.getCall(0).firstArg);
assertEqual('first', spy.firstCall.firstArg);
assertEqual('second', spy.secondCall.firstArg);
assertEqual('third', spy.thirdCall.firstArg);
assertEqual('third', spy.lastCall.firstArg);
```

### .calledBefore() and .calledAfter()
Returns `true` if the spy was called before (or after) `anotherSpy`.

### .calledImmediatelyBefore() and .calledImmediatelyAfter()
Returns `true` if `spy` was called before (or after) `anotherSpy`, and no other spy calls occurred between them.

```javascript
const readFile = sinon.stub().resolves('<html></html>');
const validateSource = sinon.spy();
const compileTemplate = sinon.stub().returns(() => {});

async function test() {
    const source = await readFile();
    validateSource(source);
    return compileTemplate(source);
}

await test();

assert(readFile.calledBefore(validateSource));
assert(validateSource.calledAfter(readFile));
assert(validateSource.calledImmediatelyBefore(compileTemplate));
assertFalsy(readFile.calledImmediatelyBefore(compileTemplate));
assert(compileTemplate.calledImmediatelyAfter(validateSource));

sinon.restore();
```

## Spy Call API
A spy call is an object representation of an individual call to a _spied_ function, which could be a [spy](#sinon-spy-api) or [stub](#sinon-stub-api). Access spy calls using `.getCall(n)`, `.firstCall`, `.secondCall`, `.thirdCall`, or `.lastCall`.

### .args
Array of received arguments.

```javascript
const spy = sinon.spy();
spy('a', 'b', 'c');
assertEqual('a', spy.firstCall.args[0]);
assertEqual('b', spy.firstCall.args[1]);
assertEqual('c', spy.firstCall.args[2]);
```

### .firstArg
This property is a convenience for the first argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(date, 1, 2);

assertEqual(date, spy.lastCall.firstArg);
```

### .lastArg
This property is a convenience for the last argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(1, 2, date);

assertEqual(date, spy.lastCall.lastArg);
```

### .thisValue
The call's `this` value.

```javascript
class Job {
    onQueue() { }
}

const job = new Job();

sinon.spy(job, 'onQueue');

job.onQueue();

assertEqual(1, job.onQueue.callCount);
assertEqual(job, job.onQueue.firstCall.thisValue);
```

### .returnValue
The return value from the call.

```javascript
function validateAuthHeader(authHeader) {
    if (!isNonEmptyString(authHeader)) {
        throw new AuthenticationError('Request missing Authorization header');
    }

    return true;
}

describe('validateAuthHeader() with valid header', ({ before, it }) => {
    let testSubject;

    before(() => {
        testSubject = sinon.spy(validateAuthHeader);
    });

    it('returns true', () => {
        testSubject('foobarbaz');
        assertEqual(true, testSubject.firstCall.returnValue);
    });
});
```

### .exception
Exception thrown, if any.

```javascript
function validateAuthHeader(authHeader) {
    if (!isNonEmptyString(authHeader)) {
        throw new AuthenticationError('Request missing Authorization header');
    }

    return true;
}

describe('validateAuthHeader() when authHeader is empty', ({ before, it }) => {
    let testSubject;

    before(() => {
        testSubject = sinon.spy(validateAuthHeader);
    });

    it('throws an AuthenticationError', () => {
        try {
            testSubject(null);
        } catch { }

        const error = testSubject.firstCall.exception;
        assertEqual('AuthenticationError', error.name);
    });
});
```

### Making assertions about errors
There is no specific function in our test framework for testing errors. Test for thrown errors using a try/catch in your `it()` blocks. When making assertions about errors, use error names and codes instead of `instanceof` to identify error types. This avoids unexpected reference mismatches with imported Node.js modules.

```javascript
import { AuthenticationError, BadRequestError, isNonEmptyString } from 'kixx';
import { describe } from 'kixx-test';
import sinon from 'sinon';
import { assert, assertEqual } from 'kixx-assert';

function validateAuthHeader(authHeader) {
    if (!isNonEmptyString(authHeader)) {
        throw new AuthenticationError('Request missing Authorization header');
    }

    if (authHeader.length !== 32) {
        throw new BadRequestError('Invalid Authorization header');
    }

    return authHeader;
}

describe('validateAuthHeader() when authHeader is empty', ({ before, it }) => {
    let testSubject;

    before(() => {
        testSubject = sinon.spy(validateAuthHeader);
    });

    it('throws an AuthenticationError', () => {
        try {
            testSubject(null);
        } catch { }

        assertEqual(1, testSubject.callCount);
        assert(testSubject.firstCall.exception);
        const error = testSubject.firstCall.exception;
        assertEqual('AuthenticationError', error.name);
    });
});

describe('validateAuthHeader() when authHeader invalid', ({ before, it }) => {
    let testSubject;

    before(() => {
        testSubject = sinon.spy(validateAuthHeader);
    });

    it('throws a BadRequestError', () => {
        try {
            testSubject('foobar');
        } catch { }

        assertEqual(1, testSubject.callCount);
        assert(testSubject.firstCall.exception);
        const error = testSubject.firstCall.exception;
        assertEqual('BadRequestError', error.name);
    });
});
```
