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

Mustache Compatibility
----------------------

Kixx targets the core Mustache spec where it fits the project's constraints and
performance goals. The optional Mustache extensions `~lambdas`, `~dynamic-names`, and
`~inheritance` are intentionally unsupported. Use inline and block helpers for template
logic that would otherwise be expressed with lambdas.

One intentional divergence: pure data sections iterate arrays, Maps, Sets, and plain
object values. Core Mustache treats plain object sections as a single pushed context.

See mustache-conformance-report.md for a detailed report.

Architecture
------------

Kixx Templating is a mustache-style templating engine with three public compilation
steps:

1. **Tokenize** (`lib/tokenize.js`) - Splits template source into tokens, handles
   dynamic Mustache delimiters like `{{=<% %>=}}`, and captures standalone whitespace
   metadata.
2. **Build Syntax Tree** (`lib/build-syntax-tree.js`) - Parses tokens into an AST for
   content, comments, interpolations, sections, helpers, partials, delimiter changes,
   and raw output tags.
3. **Create Render Function** (`lib/create-render-function.js`) - Compiles the AST into
   pre-bound render closures. Rendering uses a zero-copy context stack for Mustache
   name resolution instead of copying context objects for nested scopes.

Development
-----------

The package.json defines the following commands:

| Command | Description |
|---------|-------------|
| `npm run benchmark` | Runs the Phase 8 performance benchmark suite and writes `tmp/phase8-benchmark-report.md`. |
| `npm run benchmark:quick` | Runs a shorter smoke-test version of the Phase 8 benchmarks. |
| `npm test` | Runs the full suite: the linter, the unit/snapshot tests, and the Mustache spec compliance gate. |
| `npm run spec` | Runs only the Mustache spec compliance check. It compiles every test from the vendored spec (`test/mustache-spec/`) and compares the results against the checked-in baseline (`test/mustache-spec-baseline.json`). Read-only; exits non-zero if results regress or otherwise drift from the baseline. |
| `npm run spec:report` | Runs the spec check and (re)generates the human-readable conformance report at `tmp/mustache-conformance-report.md`. |
| `npm run spec:update` | Re-runs the spec suite and rewrites the baseline and report. Run this after intentionally changing rendering behavior to lock in the new expected outcomes. |

The Mustache spec suite is a conformance tracker: the baseline records the expected outcome (pass / fail / threw) of every spec test, tagged with the root cause of each failure, so `npm test` stays green while the engine is iteratively brought toward [Mustache spec](https://mustache.github.io/mustache.5.html) compliance.

Copyright and License
---------------------
Copyright: (c) 2023 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
