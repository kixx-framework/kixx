# Kixx Test with Sinon
A very basic and reliable framework for writing unit tests for JavaScript code using `describe()` blocks, `before()` setup blocks, `after()` teardown blocks, and `it()` assertions.

Each discrete piece of functionality should have its own describe block which a short description statement and nested `it()` blocks which assert some behavior or state. A common pattern is to create a describe block for each logical code branch in a method. Optionally, nested before and after blocks can be used to define the setup and teardown of the test(s) in the describe block.

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

## Best Practices when using Kixx Test
- Define your test subject, spies and stubs, and any results or state at the top of your `describe(({ before, after, it }) => {});` block using the JavaScript `let` keyword. Then you can define those block level values from inside your `before(() => {});` block and use them throughout your describe block scope.
- Do not nest describe() blocks. Although possible to do so, nested describe blocks become confusing. Instead create a top level describe block for each discrete piece of functionality even if that means you need to repeat before() and after() blocks.
- Create a discrete describe() block for each logical branch of code in a method.
- When making assertions about errors, use error names and codes instead of using `instance of` to identify a specific type of error.

## Tips
- create a delayPromise() helper
- prefer implementing mocks instead of using stubs

## Use the Sinon framework for spying and stubbing
Standard practice in this project is to use the Sinon mocking framework with the Kixx Test framework for all our testing. In our use cases we use Sinon spy and stub features insetad of mocks and so will refer to them as spies and stubs from here on out.

Here is a basic example of using the Sinon framework with the Kixx Test framework:

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

// The describe block injects the before, after, and it functions into the block scope for you.
describe('MyComponent: some behavior', ({ before, after, it }) => {

    let testSubject;

    // A before() block does not need to be async.
    before(() => {
        testSubject = new MyComponent();
        sinon.spy(testSubject, 'anotherMethod');
        testSubject.doSomethingAsync();
    });

    // An after() block does not need to be async.
    after(() => {
        sinon.restore();
    });

    it('the stub was called', () => {
        assertEqual(1, testSubject.anotherMethod.callCount, 'anotherMethod() was called once');
    });
});
```

### Best practices when using Sinon to spy and stub
- Keep things simple and only use the Sinon spy and stub features.
- Set up Sinon spies and stubs in the before() block so the it() assertions have access to the Sinon spy calls.
- Be sure to call `sinon.restore()` in the after() block to avoid creating race conditions and unexpected state in your tests.

## Sinon Spy API

__Creating a spy as an anonymous function__

When the behavior of the spied-on function is not under test, you can use an anonymous function spy. The spy won’t do anything except record information about its calls. A common use case for this type of spy is testing how a function handles a callback, as in the following simplified example:

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import PubSub from '../../lib/pub-sub.js';

describe('PubSub#publishSync()', ({ it }) => {
    it('should call subscribers on publish', () => {
        const callback = sinon.spy();

        PubSub.subscribe('message', callback);
        PubSub.publishSync('message');

        assertEqual(1, callback.callCount);
    });
});
```

__Wrap a function in a spy.__ You can pass the resulting spy where the original function would otherwise be passed when you need to verify how the function is being used.

```javascript
import { myFunc } from '../lib/another-module.js';
const spy = sinon.spy(myFunc);
```

__Using a spy to wrap an existing method__

The signature `sinon.spy(object, "method")` creates a spy that wraps the existing function `object.method`. The spy will behave exactly like the original method (including when used as a constructor), but you will have access to data about all calls. The following is a slightly contrived example:

```javascript
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import jQuery from '../../vendor/jquery.js';

describe('Wrap existing method', ({ before, after, it }) => {
    // We don't need an async before() block here.
    before(() => {
        sinon.spy(jQuery, 'ajax');
    });

    after(() => {
        sinon.restore();
    });

    it("should inspect jQuery.getJSON's usage of jQuery.ajax", () => {
        const url = 'https://jsonplaceholder.typicode.com/todos/1';
        jQuery.getJSON(url);

        assert(jQuery.ajax.calledOnce);
        assertEqual(url, jQuery.ajax.getCall(0).args[0].url);
        assertEqual('json', jQuery.ajax.getCall(0).args[0].dataType);
    });
});
```

## Sinon Stub API
Test stubs are functions (spies) with pre-programmed behavior.

They support the full [Sinon say API](#sinon-say-api) in addition to methods which can be used to alter the stub's behavior.

As spies, stubs can be either anonymous, or wrap existing functions. When wrapping an existing function with a stub, the original function is not called.

### When to use stubs?

Use a stub when you want to:

1. Control a method's behavior from a test to force the code down a specific path. Examples include forcing a method to throw an error in order to test error handling.

2. When you want to prevent a specific method from being called directly (possibly because it triggers undesired behavior, such as a `XMLHttpRequest` or similar).

The following example is yet another test from PubSub which shows how to create an anonymous stub that throws an exception when called.

```javascript
import { describe } from 'kixx-test';
import { assert } from 'kixx-assert';
import sinon from 'sinon';
import PubSub from '../../lib/pub-sub.js';

describe('PubSub#publishSync', ({ before, after, it }) => {
    let spy1;
    let spy2;

    before(async () => {
        const message = 'an example message';
        const stub = sinon.stub().throws();
        spy1 = sinon.spy();
        spy2 = sinon.spy();

        PubSub.subscribe(message, stub);
        PubSub.subscribe(message, spy1);
        PubSub.subscribe(message, spy2);

        try {
            PubSub.publishSync(message, 'some data');
        } finally {
            // PubSubJS reschedules exceptions using setTimeout(fn,0), so just tick the clock to throw!
            await Promise.resolve(null);
        }
    });

    after(() => {
        sinon.restore();
    });

    it('should call all subscribers, even if there are exceptions', () => {
        assert(spy1.called);
        assert(spy2.called);
        assert(stub.calledBefore(spy1));
    });
});
```

Note how the stub also implements the spy interface. The test verifies that all callbacks were called, and also that the exception throwing stub was called before one of the other callbacks.

### Defining stub behavior on consecutive calls
Calling behavior defining methods like `returns` or `throws` multiple times overrides the behavior of the stub.

### Stub API Properties

#### `const stub = sinon.stub();`

Creates an anonymous stub function

#### `const stub = sinon.stub(object, "method");`

Replaces `object.method` with a stub function. An exception is thrown if the property is not already a function.

The original function can be restored by calling `object.method.restore();` (or `stub.restore();`).

#### `stub.withArgs(arg1[, arg2, ...]);`

Stubs the method only for the provided arguments. If the arguments do not match what you've provided in `withArgs()` then the underlying method will be called.

This is useful to be more expressive in your assertions, where you can access the spy with the same call. It is also useful to create a stub that can act differently in response to different arguments.

#### `stub.onCall(n);`

Defines the behavior of the stub on the _nth_ call. Useful for testing sequential interactions.

There are methods `onFirstCall`, `onSecondCall`,`onThirdCall` to make stub definitions read more naturally.

`onCall` can be combined with all of the behavior defining methods in this section.

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

describe('stub', () => {
    it('should behave differently on consecutive calls with certain argument', () => {
        const callback = sinon.stub();

        callback
            .onFirstCall()
            .returns(1)
            .onSecondCall()
            .returns(2);

        callback.returns(0);

        assertEqual(1, callback());
        assertEqual(2, callback());
        assertEqual(0, callback());
    });
});
```

Note how the behavior of the stub falls back to the default behavior once no more calls have been defined.

#### `stub.onFirstCall();`

Alias for `stub.onCall(0);`

#### `stub.onSecondCall();`

Alias for `stub.onCall(1);`

#### `stub.onThirdCall();`

Alias for `stub.onCall(2);`

#### `stub.callsFake(fakeFunction);`

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
        sinon.reset();
    });

    it('should call fake', () => {
        assertEqual('bar', myObj.prop());
    });
});
```

#### `stub.returns(obj);`

Makes the stub return the provided value.

#### `stub.returnsThis();`

Causes the stub to return its `this` value.

Useful for stubbing jQuery-style fluent APIs.

#### `stub.resolves(value);`

Causes the stub to return a Promise which resolves to the provided value.

When constructing the Promise, sinon uses the `Promise.resolve` method. You are
responsible for providing a polyfill in environments which do not provide `Promise`.

#### `stub.throws();`

Causes the stub to throw an exception (`Error`).

#### `stub.throws("name"[, "optional message"]);`

Causes the stub to throw an exception with the `name` property set to the provided string. The message parameter is optional and will set the `message` property of the exception.

#### `stub.throws(obj);`

Causes the stub to throw the provided exception object.

#### `stub.throws(function() { return new Error(); });`

Causes the stub to throw the exception returned by the function.

#### `stub.rejects();`

Causes the stub to return a Promise which rejects with an exception (`Error`).

When constructing the Promise, sinon uses the `Promise.reject` method. You are
responsible for providing a polyfill in environments which do not provide `Promise`.

#### `stub.rejects("TypeError");`

Causes the stub to return a Promise which rejects with an exception of the provided type.

#### `stub.rejects(value);`

## Sinon Say API
Sinon Say objects are objects returned from `sinon.spy()` and `sinon.stub()`. When spying on existing methods with `sinon.spy(object, "method")` and `sinon.stub(object, "method")`, the following properties and methods are also available on `object.method`.

### Sinon Say API Properties

#### `spy.withArgs(arg1[, arg2, ...]);`

Creates a spy that only records [calls](#spy-call-api) when the received arguments match those passed to `withArgs`. This is useful to be more expressive in your assertions, where you can access the spy with the same [call](#spy-call-api).

#### `spy.callCount`

The number of recorded [calls](#spy-call-api).

#### `spy.called`

`true` if the spy was called at least once

#### `spy.notCalled`

`true` if the spy was not called

#### `spy.calledOnce`

`true` if spy was called exactly once

#### `spy.calledTwice`

`true` if the spy was called exactly twice

#### `spy.calledThrice`

`true` if the spy was called exactly thrice

#### `spy.firstCall`

The first [Spy Call API](#spy-call-api) object.

#### `spy.secondCall`

The second [call](#spy-call-api)

#### `spy.thirdCall`

The third [call](#spy-call-api)

#### `spy.lastCall`

The last [call](#spy-call-api)

#### `spy.calledBefore(anotherSpy);`

Returns `true` if the spy was called before `anotherSpy`

#### `spy.calledAfter(anotherSpy);`

Returns `true` if the spy was called after `anotherSpy`

#### `spy.calledImmediatelyBefore(anotherSpy);`

Returns `true` if `spy` was called before `anotherSpy`, and no spy [calls](#spy-call-api)
occurred between `spy` and `anotherSpy`.

#### `spy.calledImmediatelyAfter(anotherSpy);`

Returns `true` if `spy` was called after `anotherSpy`, and no spy [calls](#spy-call-api)
occurred between `anotherSpy` and `spy`.

#### `spy.calledWithNew();`

Returns `true` if spy/stub was called the `new` operator.

Beware that this is inferred based on the value of the `this` object and the spy function's `prototype`, so it may give false positives if you actively return the right kind of object.

#### `spy.threw();`

Returns `true` if spy threw an exception at least once.

#### `spy.threw("TypeError");`

Returns `true` if spy threw an exception of the provided type at least once.

#### `spy.alwaysThrew();`

Returns `true` if spy always threw an exception.

#### `spy.alwaysThrew("TypeError");`

Returns `true` if spy always threw an exception of the provided type.

#### `spy.returned(obj);`

Returns `true` if spy returned the provided value at least once.

Uses deep comparison for objects and arrays. Use `spy.returned(sinon.match.same(obj))` for strict comparison (see [matchers][matchers]).

#### `spy.alwaysReturned(obj);`

Returns `true` if spy always returned the provided value.

## Spy Call API

A spy call is an object representation of an individual call to a _spied_ function, which could be a [spy](#sinon-spy-api) or [stub](#sinon-stub-api).

#### `const spyCall = spy.getCall(n);`

Returns the _nth_ [call](#spy-call-api).

If _n_ is negative, the _nth_ call from the end is returned. For example, `spy.getCall(-1)` returns the last call, and `spy.getCall(-2)` returns the second to last call.

Accessing individual calls helps with more detailed behavior verification when the spy is called more than once.

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import jQuery from '../../vendor/jquery.js';

describe('Return nth call', ({ before, after, it }) => {

    before(() => {
        sinon.spy(jQuery, 'ajax');
    });

    after(() => {
        sinon.restore();
    });

    it("should inspect jQuery.getJSON's usage of jQuery.ajax", () => {
        const url = "https://jsonplaceholder.typicode.com/todos/1";
        jQuery.ajax(url);

        const spyCall = jQuery.ajax.getCall(0);

        assertEqual(url, spyCall.args[0]);
    });
});
```

#### `const spyCalls = spy.getCalls();`

Returns an `Array` of all [calls](#spy-call-api) recorded by the spy.

### `const spyCall = spy.getCall(n)`

Returns the _nth_ [call](#spy-call-api). Accessing individual calls helps with more detailed behavior verification when the spy is called more than once.

```javascript
sinon.spy(jQuery, "ajax");
jQuery.ajax("/stuffs");
const spyCall = jQuery.ajax.getCall(0);

assertEqual("/stuffs", spyCall.args[0]);
```

### `spyCall.calledOn(obj);`

Returns `true` if `obj` was `this` for this call.

### `spyCall.calledWith(arg1, arg2, ...);`

Returns `true` if call received provided arguments (and possibly others).

### `spyCall.calledWithExactly(arg1, arg2, ...);`

Returns `true` if call received provided arguments and no others.

### `spyCall.notCalledWith(arg1, arg2, ...);`

Returns `true` if call did not receive provided arguments.

### `spyCall.returned(value);`

Returns `true` if spied function returned the provided `value` on this call.

### `spyCall.threw();`

Returns `true` if call threw an exception.

### `spyCall.threw("TypeError");`

Returns `true` if call threw exception of provided type.

### `spyCall.threw(obj);`

Returns `true` if call threw provided exception object.

### `spyCall.calledBefore(otherCall)`

Returns `true` if the spy call occurred before another spy call.

### `spyCall.calledAfter(otherCall)`

Returns `true` if the spy call occurred after another spy call.

### `spyCall.calledImmediatelyBefore(otherCall)`

Returns `true` if the spy call occurred before another call, and no calls to any
other spy occurred in-between.

### `spyCall.calledImmediatelyAfter(otherCall)`

Returns `true` if the spy call occurred after another call, and no calls to any
other spy occurred in-between.

### `spyCall.thisValue`

The call's `this` value.

### `spyCall.args`

Array of received arguments.

#### `spyCall.firstArg`

This property is a convenience for the first argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(date, 1, 2);

spy.lastCall.firstArg === date;
// true
```

#### `spyCall.lastArg`

This property is a convenience for the last argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(1, 2, date);

spy.lastCall.lastArg === date;
// true
```

### `spyCall.exception`

Exception thrown, if any.

### `spyCall.returnValue`

Return value.
