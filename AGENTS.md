Read the @README.md for the project overview, including what this project is and why it exists.

## Developer Documentation
Use this documentation index to identify which linked documents are relevant to your task, then read the full text of each linked document — the index entries are summaries only. Keep the available documentation in mind as you work and review relevant documentation as your understanding of the task deepens. Avoid going off task or doing incorrect work because you did not review the relevant documentation.

### Code Style Guide

src/docs/code-style-guide.md

**When to use this document:** Apply this guide whenever you are writing or modifying any server-side JavaScript source file in this project. This includes:

- New functions, classes, modules, inline code comments, or any other JavaScript code you write from scratch.
- Edits to existing source files, including adding, updating, and improving inline code comments.
- Code review: Fix code style violations and update and clarify inline code comments even when not explicitly asked to.
- Deciding whether behavior belongs in a class, module, helper function, or existing object.
- Improving code structure while making a scoped feature or bug fix.
- Reviewing abstractions for responsibility ownership, encapsulation, layering, naming, or accidental complexity.

**What this document provides:** The canonical JavaScript style conventions for this project — maintaining good quality code as you work on a task, how to choose responsible owners for behavior, language standard, formatting rules, linting constraints, inline code comments, and project-specific patterns like destructuring, type detection, and private class members. Following this guide keeps code consistent throughout the codebase.

### Code Documentation Guide

src/docs/code-documentation-guide.md

**When to use this document:** Apply this guide whenever you are writing, reviewing, or improving JSDoc block comments in any JavaScript source file in this project. This includes:

- Adding documentation to new functions, classes, methods, or modules you write.
- Reviewing or updating existing documentation for accuracy and completeness.
- Deciding whether a given symbol *needs* documentation at all.
- Choosing the right JSDoc tags for a given situation.

### Server Error Handling

src/docs/server-error-handling.md

**When to use this document:** Apply this guide whenever you are writing, reviewing, or refactoring server-side JavaScript error handling. This includes throwing application errors, handling errors, validating request input, asserting internal invariants, writing route error handlers, and deciding whether an error should propagate as expected or unexpected.

**What this document provides:** The project error-handling rules for server-side code — expected operational errors vs. unexpected programmer errors, which `src/kixx/errors/` class to throw, when and how to use assertions, how to use `ValidationError`, and how the HTTP router handles and serializes errors.

### Unit Testing Guide

test/unit-tests/README.md

**When to use this document:** Apply this guide whenever you are:

- Creating a new `*.test.js` file under `test/unit-tests/`.
- Adding or modifying test cases, hooks, or assertions in an existing test file.
- Writing mocks with `MockTracker` or testing thrown errors and rejected promises.

**What this document provides:** The complete test API for this project — the `kixx-test` runner, `kixx-assert` assertions, mock helpers, file and naming conventions, hook semantics, timeout configuration, and patterns for error/rejection testing.

### Collections

src/app/collections/README.md

**When to use this document:** Apply this guide whenever you are creating, modifying, or reviewing Collections, Records, document store access, secondary indexes, KV store access, custom storage gateways, or any code that reads from or writes to a persistence layer.

**What this document provides:** The data persistence and gateway API — how to define and register Collections, write methods (`create`, `put`, `update`, `updateWithRetry`) and when to use each, the two delete methods (`delete`, `deleteStrict`) and when to use each, reading with `get`/`scan`/`query`, optimistic concurrency via `version`, Record attribute accessors, how to subclass Collection and Record, secondary index configuration, custom gateway boundaries, and how to author and register custom data access gateways.

### Transaction Scripts

src/app/transaction-scripts/README.md

**When to use this document:** Apply this guide whenever you are writing, modifying, or reviewing Transaction Scripts — the procedures that enforce business rules, read or write data, translate storage errors, and return results to the presentation layer.

**What this document provides:** The Transaction Script pattern used for domain logic — file and naming conventions, function signatures for read and write scripts, how middleware calls Transaction Scripts, how Forms feed write workflows, data access via Collections, calling external services through registered gateways, domain error rules, storage-error translation with `cause`, and complete annotated examples.

### Presentation Layer Guide

src/app/presentation/README.md

**When to use this document:** Apply this guide whenever you are adding, modifying, or reviewing application web presentation behavior. This includes:

- Adding or changing static Hyperview pages, dynamic routes, request handlers, middleware, forms, or HTML error handlers.
- Deciding where presentation-layer changes belong in `pages/`, `templates/`, `virtual-hosts.js`, or `app/`.
- Handling route parameters, request payloads, redirects, response props, or form-backed HTML workflows.
- Understanding how root, ancestor, leaf, include, and runtime response props are merged into the template context.

**What this document provides:** The main presentation-layer guide for this Hypermedia Driven Application — where presentation files live, common recipes for static pages, dynamic pages, forms, and progressive enhancement, route matching behavior, middleware and request handler responsibilities, `HyperviewDynamicPageHandler` options, form conventions, request and response object APIs, and HTML error handler guidance.

### Templating Guide

src/templates/README.md

**When to use this document:** Apply this guide whenever you are writing, reviewing, or debugging frontend templates. This includes:

- Editing any templates in `templates/` including page templates, base templates, partials, or templated include files.
- Choosing interpolation, raw output, nested property access, bracket notation, sections, loops, conditionals, helpers, or partials in templates.
- Understanding HTML escaping, Markdown rendering, whitespace behavior, name resolution, delimiter changes, custom helpers, or template errors.

**What this document provides:** The Kixx template syntax and behavior reference used by Hyperview — compilation stages, supported Mustache-style features, expression resolution, section semantics, built-in helpers, Hyperview helpers, escaping rules, partial usage, helper authoring, public APIs, and error behavior.

### Frontend Development Guide

src/docs/frontend-development-guide.md

**When to use this document:** Apply this guide whenever you are writing or reviewing any HTML template markup or CSS in this project. This includes:

- Styling new or existing pages, components, or layout structure.
- Deciding where a new CSS rule belongs — an existing primitive, a new shared utility, or a page-local stylesheet.
- Naming classes, adding design tokens, or tuning a component's custom properties.

**What this document provides:** The frontend conventions for this project — how to use the live style guide as the design reference, the no-inline-styles resolution order, how `src/stylesheets/` is organized into shared vs. admin-only files, BEM class naming, the three-tier design token system, the Every Layout–style layout primitives, and the page-local `page_stylesheet` include pattern.

### Plugins and Cross-Platform Architecture

src/plugins/README.md

**When to use this document:** Apply this guide whenever you are working on the ports-and-adapters layer that lets one application run across deploy targets (Node.js, Cloudflare Workers, and future Deno/AWS Lambda). This includes:

- Writing or modifying a platform adapter under `plugins/`, or its `plugin.js` lifecycle module.
- Adding, changing, or reviewing an interface contract (`kixx/**/*-interface.js`).
- Registering a service through a plugin, or wiring dependencies between services.
- Editing an entry point (`node-server.js`, `cloudflare-server.js`) or a source config module.
- Adding support for a new deploy target, or deciding whether a new capability needs a port at all.

**What this document provides:** The cross-platform design reference — the three roles (ports, adapters, and entry-points), the plugin module contract and its two-phase `register()`/`initialize()` lifecycle, plugin-registry merge semantics, where platform differences live, the rules interface contracts are written by, and checklists for adding a new port or a new platform.

## Development Server

Run the development server with:

```bash
node tools/devserver.js --port 2026
```

Use this wrapper for normal development instead of running `src/node-server.js` directly. It keeps `--port` as the public browser-facing port, starts the app server child on a temporary internal port, and forwards `--environment` and `--dotenv` to the child process.

Change the --port option to avoid port conflicts if needed.

The wrapper restarts the child app server after the site has been idle for a few seconds, so JavaScript source changes are picked up on the next request without manually restarting the command. Server restarts are not needed for changes to `templates/`, `pages/` data, or source stylesheets under `src/stylesheets/`.

The dev server also serves CSS and JavaScript directly from `src/stylesheets/` and `src/javascript/`, allowing you to skip an asset build process. It recognizes `/assets/<build-id>/stylesheets/**` and `/assets/<build-id>/javascript/**` as source-file URLs in development, ignores the Build ID segment, and sends `Cache-Control: no-cache` so edits appear on reload. The bare `/stylesheets/**` and `/javascript/**` source-file URLs remain available too.

Add `.json` to the end of any URL to get the template context object as JSON (ecluding includes content):

`http://localhost:2026/index.json` -> context object for `http://localhost:2026/`
`http://localhost:2026/users/admin/new.json` -> context object for `http://localhost:2026/users/admin/new`

## Dependencies

This project uses vendored dependencies. They live in the `src/kixx/vendor/` tree and are imported using relative paths directly in project files — not as package names. Do not use `npm install` or bare package name imports for vendored deps.

NEVER install dependencies without explicitly being asked to install them by the user.

If you think you need a dependency that is not already vendored, stop working on that task and ask the user to install it.

## Planning Work

When the user makes a request for a new feature or significant refactoring:

Do NOT begin writing code or making changes.

FIRST: Ensure you have a conversation to elicit information from the user so that you have a complete understanding of the work to be done, tradeoffs made, etc. Pose as many questions as you need to fill in the gaps and avoid confusion.

You and the user may mutually decide that the work can be done without an implementation plan. However, if you do decide to create an Implementation plan, or the user requests one, then follow this guide:

An implementation plan is durable project state, not a disposable checklist or a copy of one agent's intended call sequence. Write it so an agent with no conversation history can understand the intended outcome, verify the completed work, and continue from the exact point where another agent stopped.

Each task must be a logical, reviewable partition of the implementation. It should produce one coherent outcome, have explicit boundaries, and be independently verifiable where practical. Prefer tasks aligned with behavior or an owned invariant over arbitrary file-by-file tasks. If a task cannot reasonably fit in one agent's context window, split it before implementation.

Use stable task IDs and record dependencies by ID.

Use this template for every implementation task:

```markdown
### Task <ID>: <outcome-oriented title>

**Status:** Not started
**Depends on:** <task IDs, or "None">
**Documentation:** <specification or document sections, or "None">

**Objective**

<Describe the observable outcome and why this task is a coherent partition of the plan. This should remain true even if the implementation details change.>

**Scope**

- In: <behavior, packages, interfaces, migrations, or documentation owned by this task>
- Out: <nearby work intentionally deferred to other task IDs>

**Design and invariants**

- <Constraints the implementation must preserve.>
- <Important API, ownership, concurrency, security, or error-handling choices.>
- <Known decisions that a later agent should not have to rediscover.>

**Expected touch points**

- `<anticipated file or package>` — <purpose of the change>

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] <Specific, observable behavior or artifact.>
- [ ] <Required success and failure behavior.>
- [ ] <Tests and documentation required for this task.>

**Validation**

- `<exact command>` — <what it proves>
- <Unit test coverage.>
- <Manual or integration check that cannot be expressed as a command, if any.>

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
```

An Implementation Plan should begin with an Implementation Approach section summarizing the overall strategy and any cross-cutting concerns across the tasks.

Write implementation plans into the agents/plans/ directory.

## Work Verification

DO:

- Always run the linter when you change JavaScript files for the Node.js or Cloudflare runtimes. See [Linting](#linting) below.
- Always run the unit tests when you change JavaScript source files for the Node.js or Cloudflare runtimes. See [Testing](#testing) below.

DO NOT:

- Do not run the dev server, call remote servers, or write specialized code for the purpose of work verification or smoke testing.
- Do not run or write end-to-end tests unless explicitly asked to do so.

### Linting

Run the linter according to the instructions in the `README.md` for every JavaScript source file you changed during your task. Fix any linting errors you find for the code you have written during your task before you are done.

### Testing

Follow the unit testing guide at test/unit/README.md and follow the instructions in `README.md` for running unit tests. When you discover broken unit tests; think carefully about the correctness if the implementation. If the unit tests need to be updated to match the intended behavior of the implementation then update the unit tests. Otherwise fix the implementation to address the issue that broken tests have highlighted.

## Helpful Tips
When writing something intended for human consumption, (comment, commit message, reply to prompt) use as few words as possible. Be down to the point. Less is more.

Avoid superlatives and praise. Stop telling me I am absolutely right. Give me the cold hard truth.

Let the reader of the code breathe. Add empty lines between logical blocks of code.

### Commit Messages
When you write a commit message, follow these rules:

- Separate the subject line from the body with a single blank line.
- Limit the subject line to 50 characters (72 is the absolute hard limit).
- Capitalize the first letter of the subject line.
- Do not end the subject line with a period.
- Use the imperative mood in the subject line (e.g., "Fix bug," "Add feature," not "Fixed" or "Adds"). Test formula: It must complete the sentence: "If applied, this commit will [your subject line here]".
- Wrap the body text manually at 72 characters to prevent Git formatting issues.
- Use the body to explain what and why vs. how. Assume the code explains the how; the message must explain the context and reasoning.
- Never attribute authorship of a commit to yourself. Use the current git user instead with `git config user.name` and `git config user.email`.

### Explanatory Output

You should provide insightful explanations about how you are approaching a task and the tradeoffs you are making while remaining focused on the task. For non-trivial code changes, before and after writing code, provide brief insightful explanations about your implementation choices and your thinking supporting those choices using:

"★ Insight ─────────────────────────────────────
[2-3 key insightful points]
─────────────────────────────────────────────────"

These insights should be included in the conversation, not in the codebase. Focus on interesting insights that are specific to the codebase or the code you are writing, rather than general programming concepts. Do not wait until the end to provide insights. Provide them as you think about changes and write code.
