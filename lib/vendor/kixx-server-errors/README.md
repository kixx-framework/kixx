Kixx Server Errors
==================
A collection of standardized error classes for HTTP application servers built with JavaScript (Node.js, Deno, etc). This library provides a set of error classes that extend the native `Error` class, with additional properties and standardized behavior for HTTP error responses.

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2025.

Inspired by [node-verror](https://github.com/TritonDataCenter/node-verror) and the corresponding [blog post](https://www.tritondatacenter.com/node-js/production/design/errors).

Environment Support
-------------------

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__ or __Deno >= 1.0.0__. You could use it in a browser, but there are no plans to offer CommonJS or AMD modules. It targets at least [ES2022](https://node.green/#ES2022) and uses the optional chaining operator `?.`.

If you're curious: Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

__Note:__ There is no TypeScript here. It would be waste of time for a library as small as this.

Installation
------------
```bash
npm install kixx-server-errors
```

Reference Documentation
-----------------------
Check out the `docs/` folder for complete documentation.

Ethos
-----
Kixx Server Errors exists to meet 3 goals for better error handling in server-side JavaScript:

1. Make it easy to differentiate between unexpected errors and expected operational errors.
2. Provide a mechanism to augment error information as it is caught and rethrown with the added context from each layer.
3. Throw errors with specific HTTP application constructs which can help formulate an appropriate HTTP response to clients.

### Expected operational errors vs. unexpected errors
It’s helpful to divide all errors into two broad categories:

#### Expected Operational Errors
Expected errors epresent run-time problems experienced by correctly-written programs. These are not bugs in the program. In fact, these are usually problems with something else: the system itself (e.g., out of memory or too many open files), the system’s configuration (e.g., no route to a remote host), the network (e.g., socket hang-up), or a remote service (e.g., a 500 error, failure to connect, or the like):

- failed to connect to server
- failed to resolve hostname
- invalid user input
- request timeout
- server returned a 500 response
- socket hang-up
- system is out of memory

For expected operational errors we want to handle them at several levels of the stack. This happens when lower levels can’t do anything useful except propagate the error to their caller, which propagates the error to its caller, and so on. Often, only the top-level caller has the context to know what to do next. But that means we need to pass up the error context through the layers. In kixx-server-errors we do this by wrapping errors and including the thrown error as a `cause` option. See the [MDN docs on `Error:cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) for more information.

#### Unexpected Errors
Unexpected errors are bugs in the program. These are things that can always be avoided by changing the code. They can never be handled properly (since by definition the code in question is broken).

- tried to read property of “undefined”
- called an asynchronous function without a callback
- passed a “string” where an object was expected
- passed an object where an IP address string was expected

*__The best way to recover from unexpected errors is to crash immediately.__* You should run your programs using a restarter that will automatically restart in the event of a crash. With a restarter in place, crashing is the fastest way to restore reliable service in the face of a transient programmer error.

Some people advocate attempting to recover from unexpected errors — that is, allow the current operation to fail, but keep handling requests. This is not recommended. Consider unexpected errors as cases that you didn’t think about when you wrote the original code. How can you be sure that the problem won’t affect other requests? If other requests share any common state (a server, a socket, a pool of database connections, etc.), it’s very possible that the other requests will do the wrong thing.


Copyright and License
---------------------
Copyright: (c) 2018 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
