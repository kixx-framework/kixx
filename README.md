Kixx
====
The best ECMAScript application development framework ever.

Kixx is a loosely coupled set of tools and libraries used to make designing and building complex Node.js applications better. Although not strictly a functional library, it attempts to sprinkle in good functional programming paradigms where appropriate.

Installation
------------
Kixx requires 2 peer depenendencies which also must be installed:
[Bluebird](http://bluebirdjs.com/docs/getting-started.html) and [Ramda](http://ramdajs.com/). The full command line NPM installation is:

```
$ npm install --save kixx
$ npm install --save bluebird
$ npm install --save ramda
```

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
Kixx has it's own library functions which are not availble in the other libraries. They are on the root level of the library namespace with the Ramda functions and can be imported like this:

```js
const {compact} = require(`kixx/library`);
```

#### compact()
__`compact(list)`__

parameter | type | description
--------- | ---- | -----------
list | Array | A list to filter

Returns a new list with all the falsy values filtered out.

#### deepFreeze()
__`deepFreeze(object)`__

parameter | type | description
--------- | ---- | -----------
object | Object | An Object to deeply freeze.

Returns the passed Object after recursively calling Object.freeze() deeply throughout.

#### random()
__`random(min, max)`__

parameter | type | description
--------- | ---- | -----------
min | Number | The *inclusive* minimum.
max | Number | The *exclusive* maximum.

Returns a random Integer from min (inclusive) to max (exclusive). Is automatically curried.

#### sampleOne()
__`sampleOne(list)`__

parameter | type | description
--------- | ---- | -----------
list | Array | An Array.

Returns a single random element from the given Array.

#### clamp()
__`clamp(min, max, n)`__

parameter | type | description
--------- | ---- | -----------
min | Number | The *inclusive* minimum.
max | Number | The *exclusive* maximum.
n   | Number | The Number to clamp.

Returns Number n only if it is greater then or equal to the minimum and less than the maximum. Otherwise, return the min or max as appropriate.

Copyright and License
---------------------
Copyright: (c) 2017 - 2018 by Kris Walker (www.kixx.name)

Unless otherwise indicated, all source code is licensed under the MIT license. See MIT-LICENSE for details.

