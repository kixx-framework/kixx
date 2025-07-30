# Kixx Test with Sinon
The Kixx Test frameowrk with Sinon for mocking provides a basic and reliable framework for creating unit tests for JavaScript code. Tests are created in Kixx Test using `describe()` blocks, `before()` setup blocks, `after()` teardown blocks, and `it()` assertions.

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
We've found that it is easier to reason about the tests we create when we adhere to these best practices.

### Do not nest describe(blocks)
Do not nest describe() blocks. Although possible to do so in the Kixx Test frameworks, nested describe blocks become confusing. Instead create a top level describe block for each discrete piece of functionality even if that means you need to repeat before() and after() blocks for each of them.

### Create discrete describe() blocks
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

### No deep equality assertions
Remember that the Kixx Assert library does not do deep equality testing or matching. This feature has been left out intentionally to avoid complexity. It is better, and more clearly understood, to compare objects by reference where possible, or by comparing their properties if not.

### Making assertions about errors
While there is no specific function in our test framework for testing errors, you can test for thrown errors using a simple try ... catch sequence it() blocks like in this example: 

```javascript
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

function authenticationMiddleware(context, request, response) {
    const userCollection = context.getService('UserCollection');

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
        throw new AuthenticationError('Request missing Authorization header');
    }

    request.user = await userCollection.getUserByToken(authHeader);
    if (!request.user.entitledForPathname(request.url.pathname)) {
        throw new AuthorizationError('User is not entitled for this pathname');
    }

    return response;
}

describe('authenticationMiddleware(): with missing Authorization header', ({ before, it }) => {
    let context;
    let request;
    let response;

    before(() => {
        const user = {
            entitledForPathname() {
                return true;
            },
        };
        const userCollection = {
            getUserByToken() {
                return Promise.resolve(user);
            },
        };

        // We do not define an Authorization header in the Header map.
        const headers = new Headers();

        context = {
            getService(serviceName) {
                if (serviceName !== 'UserCollection') {
                    // Throw an error for any other services except for the exact
                    // service we are mocking here.
                    throw new Error(`Service ${ serviceName } is not implemented for this test`);
                }
                return userCollection;
            },
        };

        request = {
            headers,
            pathname: '/admin',
        };

        response = {};
    });

    it('throws an AuthenticationError', () => {
        let error;
        try {
            authenticationMiddleware(context, request, response);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AuthenticationError', error.name);
        assertEqual('AUTHENTICATION_ERROR', error.code);
        assertEqual(401, error.httpStatus);
    })
});

describe('authenticationMiddleware(): when user is not entitled', ({ it }) => {
    let context;
    let request;
    let response;

    before(() => {
        const user = {
            entitledForPathname() {
                return false;
            },
        };
        const userCollection = {
            getUserByToken() {
                return Promise.resolve(user);
            },
        };

        const headers = new Headers({
            authorization: 'Bearer 23492309weflijw3r098wefj',
        });

        context = {
            getService(serviceName) {
                if (serviceName !== 'UserCollection') {
                    // Throw an error for any other services except for the exact
                    // service we are mocking here.
                    throw new Error(`Service ${ serviceName } is not implemented for this test`);
                }
                return userCollection;
            },
        };

        request = {
            headers,
            pathname: '/admin',
        };

        response = {};
    });

    it('throws an AuthorizationError', () => {
        let error;
        try {
            authenticationMiddleware(context, request, response);
        } catch (e) {
            error = e;
        }
        assert(error);
        assertEqual('AuthorizationError', error.name);
        assertEqual('AUTHORIZATION_ERROR', error.code);
        assertEqual(403, error.httpStatus);
    })
});
```

When making assertions about errors, use error names and codes instead of using `instance of` to identify a specific type of error like in the example above. This avoids unexpected reference mismatches with imported Node.js modules.

Also notice how we broke out the discrete behaviors of the `authenticationMiddleware()` into separate describe blocks for clarity. This is considered best practice.

## Use the Sinon framework for spying and stubbing
Standard practice in this project is to use the Sinon mocking framework with the Kixx Test framework for all our tests which require stubbing or spying on functions or methods. In our use cases we use Sinon spy and stub features (instead of Sinon mocks) and so will refer to them as spies and stubs in this document.

Also, remember there is no need to stub or spy every function or method. It is only necessary to:

- Use a spy ([Sinon Spy API](#sinon-spy-api)) if you still want the original function or method to be called but need to get information about the call from the [Sinon Say API](#sinon-say-api).
- Use a stub ([Sinon Stub API](#sinon-stub-api)) if you need to prevent the underlying function or method from being called and intend on modifying its behavior.

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

## Sinon Spy API

### Creating a spy as an anonymous function
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

### Wrap a function in a spy.
You can pass the resulting spy where the original function would otherwise be passed when you need to verify how the function is being used.

```javascript
import { myFunc } from '../lib/another-module.js';
const spy = sinon.spy(myFunc);
```

### Use a spy to wrap an existing method
The signature `sinon.spy(object, "method")` creates a spy that wraps the existing function `object.method`. The spy will behave exactly like the original method (including when used as a constructor), but you will have access to data about all calls from the [Sinon Say API](#sinon-say-api). The following is a slightly contrived example:

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

### sinon.stub()
Creates an anonymous stub function

### sinon.stub(object, "method")
Replaces `object.method` with a stub function. An exception is thrown if the property is not already a function.

The original function can be restored by calling `object.method.restore();` (or `stub.restore();`).

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

TODO: Where should we put this section? And, it needs more details and examples if we keep it.

### Stub Methods

#### .withArgs(arg1[, arg2, ...])
Stubs the method only for the provided arguments. If the arguments do not match what you've provided in `withArgs()` then the underlying method will be called.

This is useful to be more expressive in your assertions, where you can access the spy with the same call. It is also useful to create a stub that can act differently in response to different arguments.

#### onCall(n)
Defines the behavior of the stub on the _nth_ call. Useful for testing sequential interactions.

There are methods `onFirstCall`, `onSecondCall`,`onThirdCall` to make stub definitions read more naturally.

`onCall` can be combined with all of the behavior defining methods in this section.

```javascript
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

describe('stub', () => {
    it('should behave differently on consecutive calls with certain argument', () => {

        const callback = sinon
            .stub()
            .onCall(0)
            .returns(1)
            .onCall(1)
            .returns(2);

        callback.returns(0);

        assertEqual(1, callback());
        assertEqual(2, callback());
        assertEqual(0, callback());
    });
});
```

Note how the behavior of the stub falls back to the default behavior once no more calls have been defined.

#### .onFirstCall()
Alias for `stub.onCall(0);`

#### .onSecondCall()
Alias for `stub.onCall(1);`

#### .onThirdCall()
Alias for `stub.onCall(2);`

#### .callsFake(fakeFunction)
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

#### .returns(obj)
Makes the stub return the provided value.

#### .returnsThis()
Causes the stub to return its `this` value.

Useful for stubbing jQuery-style fluent APIs.

#### .resolves(value)
Causes the stub to return a Promise which resolves to the provided value.

When constructing the Promise, sinon uses the `Promise.resolve` method. You are
responsible for providing a polyfill in environments which do not provide `Promise`.

#### .throws()
Causes the stub to throw an exception (`Error`).

#### .throws("name"[, "optional message"])
Causes the stub to throw an exception with the `name` property set to the provided string. The message parameter is optional and will set the `message` property of the exception.

#### .throws(obj)
Causes the stub to throw the provided exception object.

#### .throws(function() { return new Error(); })
Causes the stub to throw the exception returned by the function.

#### .rejects()
Causes the stub to return a Promise which rejects with an exception (`Error`).

When constructing the Promise, sinon uses the `Promise.reject` method. You are
responsible for providing a polyfill in environments which do not provide `Promise`.

#### .rejects("TypeError")
Causes the stub to return a Promise which rejects with an exception of the provided type.

#### .rejects(value)

## Sinon Say API
Sinon Say objects are objects returned from `sinon.spy()` and `sinon.stub()`. When spying on existing methods with `sinon.spy(object, "method")` and `sinon.stub(object, "method")`, the following properties and methods are also available on `object.method`.

### .getCall(n)
Returns the _nth_ [call](#spy-call-api) instance.

If _n_ is negative, the _nth_ call from the end is returned. For example, `spy.getCall(-1)` returns the last call, and `spy.getCall(-2)` returns the second to last call.

```javascript
// Get a Spy Call API from a spy
const spyCall = spy.getCall(2);
// Get a Spy Call API from a stub
const stubCall = stub.getCall(2);
```

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

### .getCalls()
Returns an `Array` of all [calls](#spy-call-api) recorded by the spy.

```javascript
// Get a Spy Call API from a spy
const spyCalls = spy.getCalls();
// Get a Spy Call API from a stub
const stubCalls = stub.getCalls();
```

### .callCount
The number of recorded [calls](#spy-call-api).

### .called
`true` if the spy was called at least once

### .notCalled
`true` if the spy was not called

### .calledOnce
`true` if spy was called exactly once

### .calledTwice
`true` if the spy was called exactly twice

### .calledThrice
`true` if the spy was called exactly thrice

### .firstCall
The first [Spy Call API](#spy-call-api) object.

### .secondCall
The second [Spy Call API](#spy-call-api)

### .thirdCall
The third [Spy Call API](#spy-call-api)

### .lastCall
The last [Spy Call API](#spy-call-api)

### .calledBefore(anotherSpy)
Returns `true` if the spy was called before `anotherSpy`

### .calledAfter(anotherSpy)
Returns `true` if the spy was called after `anotherSpy`

### .calledImmediatelyBefore(anotherSpy)

Returns `true` if `spy` was called before `anotherSpy`, and no spy [calls](#spy-call-api)
occurred between `spy` and `anotherSpy`.

### .calledImmediatelyAfter(anotherSpy)
Returns `true` if `spy` was called after `anotherSpy`, and no spy [calls](#spy-call-api)
occurred between `anotherSpy` and `spy`.

### .calledWithNew()
Returns `true` if spy/stub was called the `new` operator.

Beware that this is inferred based on the value of the `this` object and the spy function's `prototype`, so it may give false positives if you actively return the right kind of object.

### .threw()
Returns `true` if spy threw an exception at least once.

### .threw("TypeError")
Returns `true` if spy threw an exception of the provided type at least once.

### .alwaysThrew()
Returns `true` if spy always threw an exception.

### .alwaysThrew("TypeError")
Returns `true` if spy always threw an exception of the provided type.

### .returned(obj)
Returns `true` if spy returned the provided value at least once.

Uses deep comparison for objects and arrays. Use `spy.returned(sinon.match.same(obj))` for strict comparison (see [matchers][matchers]).

### .alwaysReturned(obj)
Returns `true` if spy always returned the provided value.

## Spy Call API

A spy call is an object representation of an individual call to a _spied_ function, which could be a [spy](#sinon-spy-api) or [stub](#sinon-stub-api).

### .returned(value)
Returns `true` if spied function returned the provided `value` on this call.

```javascript
// Get a Spy Call API from a stub
const stubCall = stub.getCall(1);
stubCall.returned(true);
```

### .threw()
Returns `true` if call threw an exception.

```javascript
// Get a Spy Call API from a spy
const spyCall = spy.getCall(3);
spyCall.threw();
```

### .threw("TypeError")
Returns `true` if call threw exception of provided type.

### .threw(obj)
Returns `true` if call threw provided exception object.

### .calledBefore(otherCall)
Returns `true` if the spy call occurred before another spy call.

### .calledAfter(otherCall)
Returns `true` if the spy call occurred after another spy call.

### .calledImmediatelyBefore(otherCall)
Returns `true` if the spy call occurred before another call, and no calls to any
other spy occurred in-between.

### .calledImmediatelyAfter(otherCall)
Returns `true` if the spy call occurred after another call, and no calls to any
other spy occurred in-between.

### .thisValue
The call's `this` value.

### .args
Array of received arguments.

### .firstArg
This property is a convenience for the first argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(date, 1, 2);

spy.lastCall.firstArg === date;
// true
```

### .lastArg
This property is a convenience for the last argument of the call.

```javascript
const spy = sinon.spy();
const date = new Date();

spy(1, 2, date);

spy.lastCall.lastArg === date;
// true
```

### .exception
Exception thrown, if any.

### .returnValue
Return value.

---

## Best Practices when using Kixx Test
- Define your test subject, spies and stubs, and any results or state at the top of your `describe(({ before, after, it }) => {});` block using the JavaScript `let` keyword. Then you can define those block level values from inside your `before(() => {});` block and use them throughout your describe block scope.
- Do not nest describe() blocks. Although possible to do so, nested describe blocks become confusing. Instead create a top level describe block for each discrete piece of functionality even if that means you need to repeat before() and after() blocks.
- Create a discrete describe() block for each logical branch of code in a method.
- When making assertions about errors, use error names and codes instead of using `instance of` to identify a specific type of error.

## Tips
- create a delayPromise() helper
- prefer implementing mocks instead of using stubs

### Best practices when using Sinon to spy and stub
- Keep things simple and only use the Sinon spy and stub features.
- Set up Sinon spies and stubs in the before() block so the it() assertions have access to the Sinon spy calls.
- Be sure to call `sinon.restore()` in the after() block to avoid creating race conditions and unexpected state in your tests.

---
