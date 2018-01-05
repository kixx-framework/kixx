Kixx
====
The best ECMAScript application development framework ever.

Kixx is a loosely coupled set of tools and libraries used to make designing and building complex Node.js applications better. Although not strictly a functional library, it attempts to sprinkle in good functional programming paradigms where appropriate.

## Library
Import the library like this:

```js
const lib = require('kixx/library');

// Or, using destructuring:
const {curry} = require('kixx/library');

lib.curry === curry; // true
```

### Rambda Library
The Kixx Library is extended with the Ramda functional library. All functions available in Ramda are available as part of `require('kixx/library')`. For example, [Ramda compose()](http://ramdajs.com/docs/#compose) is available like this:

```js
const {compose} = require('kixx/library');
```

For a complete list of Ramda functions, see the [Ramda documentation](http://ramdajs.com/docs/).

### Kixx Assert Library
The Kixx Library is also extended with [Kixx Assert](https://github.com/kixxauth/kixx-assert). The assertion namespace is hooked onto the Kixx Library like this:

```js
const {assert} = require('kixx/library');
assert.isNonEmptyString('foo'); // Passes.
```

The Kixx Assert helpers simply extend the root Kixx Library namespace like this:

```js
const {isFunction} = require('kixx/library');
isFunction({}); // false
```

For a complete list of Kixx Assert assertions and helpers, see the
[Kixx Assert README](https://github.com/kixxauth/kixx-assert).

### Other Library Gems

Copyright and License
---------------------
Copyright: (c) 2017 - 2018 by Kris Walker (www.kixx.name)

Unless otherwise indicated, all source code is licensed under the MIT license. See MIT-LICENSE for details.

