Kixx Templating
===============
A simple and robust markup and text templating system for JavaScript environments.

Created by [Kris Walker](https://www.kriswalker.me) 2023 - 2026.

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

Usage Documentation
-------------------
See the [docs/](./docs) folder for comprehensive docs.

Build & Test Commands
---------------------

```bash
# Run linting and all tests
npm test

# Run linting only
npm run lint

# Run tests only (without linting)
node ./test/run-tests.js
```

There is no build step - this is a pure ES module library.

Architecture
------------

Kixx Templating is a mustache-style templating engine with a three-phase compilation pipeline:

1. **Tokenize** (`lib/tokenize.js`) - Splits template source into tokens based on `{{` `}}` delimiters and `{{!-- --}}` comments
2. **Build Syntax Tree** (`lib/build-syntax-tree.js`) - Parses tokens into an AST with node types: `CONTENT`, `COMMENT`, `PATH_EXPRESSION`, `HELPER_EXPRESSION`, `BLOCK_OPEN`, `BLOCK_CLOSE`, `PARTIAL`, `ELSE`
3. **Create Render Function** (`lib/create-render-function.js`) - Transforms AST into an executable render function that accepts a context object

Copyright and License
---------------------
Copyright: (c) 2023 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
