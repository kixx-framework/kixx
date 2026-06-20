Documentation
=============

Use this documentation index to find relevant documentation for the task you are working on. This includes reference documentation and project guides, as well as common workflows.

Project Guides
--------------

### Code Quality Guide

@docs/code-quality.md

**When to use this document:** Apply this guide whenever you are writing,
reviewing, or refactoring code in this project. This includes:

- Deciding whether behavior belongs in a class, module, helper function, or
  existing object.
- Improving code structure while making a scoped feature or bug fix.
- Reviewing abstractions for responsibility ownership, encapsulation, layering,
  naming, or accidental complexity.

**What this document provides:** General maintainability guidance for agents
working in this codebase — how to choose responsible owners for behavior, when
to use object-oriented design, when not to add a class, how to keep abstractions
inside the existing architecture, and how to avoid refactors that add complexity
or drift outside the current task.

### Code Style Guide

@docs/code-style-guide.md

**When to use this document:** Apply this guide whenever you are writing or modifying any JavaScript source file in this project. This includes:

- New functions, classes, modules, or any other JavaScript code you write from scratch.
- Edits to existing source files — match the style of the surrounding code, and correct any violations you introduce.
- Code review: flag style violations even when not explicitly asked to.

**What this document provides:** The canonical JavaScript style conventions for this project — language standard, runtime boundaries, formatting rules, linting constraints, and project-specific patterns like destructuring, type detection, and private class members. Following this guide keeps code consistent with the linter and with the rest of the codebase.

### Code Documentation Guide

@docs/code-documentation-guide.md

**When to use this document:** Apply this guide whenever you are writing, reviewing, or improving JSDoc block comments or inline comments in any JavaScript source file in this project. This includes:

- Adding documentation to new functions, classes, methods, or modules you write.
- Reviewing or updating existing documentation for accuracy and completeness.
- Deciding whether a given symbol *needs* documentation at all.
- Choosing the right JSDoc tags for a given situation.
- Writing inline comments that explain non-obvious decisions.

### Unit Testing Guide

@docs/unit-testing-guide.md

**When to use this document:** Apply this guide only when you have been explicitly asked to write new tests or update existing tests. Consult it whenever you are:

- Creating a new `*.test.js` file under `test/`.
- Adding or modifying test cases, hooks, or assertions in an existing test file.
- Writing mocks with `MockTracker` or testing thrown errors and rejected promises.

**What this document provides:** The complete test API for this project — the `kixx-test` runner, `kixx-assert` assertions, mock helpers, file and naming conventions, hook semantics, timeout configuration, and patterns for error/rejection testing.
