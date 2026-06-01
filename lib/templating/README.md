Kixx Templating
===============
A simple and robust text templating system for JavaScript environments.

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

Usage Documentation
-------------------
See the [docs/](./docs) folder for comprehensive docs.

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
