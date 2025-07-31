Kixx Templating
===============
A simple and robust text template engine for JavaScript environments.

Created by [Kris Walker](https://www.kriswalker.me) 2023 - 2025.

## Principles
- __No dependencies:__ A template engine is a low level primitive component which systems depend on and should NOT complicate matters by having dependencies itself.
- __Minimal:__ The scope of supported capabilities is kept intentionally small.

Environment Support
-------------------

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__ or __Deno >= 1.0.0__. You could use it in a browser, but there are no plans to offer CommonJS or AMD modules. It targets at least [ES2022](https://node.green/#ES2022) and uses the optional chaining operator `?.`.

Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

__Note:__ There is no TypeScript here. It would be waste of time for a library as small as this.

Documentation
-------------
See the [docs/](./docs) folder for comprehensive docs.

Copyright and License
---------------------
Copyright: (c) 2023 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
