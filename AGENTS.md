Read the @README.md for the project overview, including what this project is and why it exists.

Before starting any task, including planning, ALWAYS review the documentation index at @docs/index.md

Use the @docs/index.md to identify which linked documents are relevant to your task, then read the full text of each relevant document — the index entries are summaries only. Keep the available documentation in mind as you work, so you can review additional documents that become relevant as your understanding of the task deepens. Avoid going off task or doing incorrect work because you did not review the relevant documentation.

### Linting

Linting is configured in `./eslint.config.js`.

You should always run the linter on changed source code files after making changes.

Run linting with:

```bash
# Run the linter on all JavaScript files in the current working directory which are not ignored in eslint.config.js
node run-linter.js

# Run the linter on specified files or directories.
node run-linter.js [pathname ...]
```
Pathname arguments are optional. If omitted, the CLI uses the current working directory.

The eslint.config.js file is always loaded from the current working directory.

When a target pathname is a directory, linting walks it recursively and only lints .js files. Other file extensions are ignored during directory traversal. Multiple targets are linted in argument order, and files selected through overlapping targets are linted only once.

The `files` and `ignores` matching in eslint.config.js is literal path-segment matching (no glob support).

Diagnostic output is written to stderr, grouped by file.

Exit behavior:

- Exits 1 when any lint error is present (or when CLI/config loading fails).
- Exits 0 when results are warnings-only or fully clean.

### Unit Testing

Run tests with:

```bash
# Run all non-integration test files (*.test.js) in the ./test/ directory
node run-tests.js

# Run all test files (*.test.js) in the files and directories passed into run-tests.js
node run-tests.js [pathname ...]

# Include tests from ./test/integration/
node run-tests.js --integration
```
Pathname arguments are optional. If omitted, the CLI uses `./test/`.

When a target pathname is a directory, the test script walks it recursively and only runs `*.test.js` files. Other file extensions are ignored during directory traversal.

Diagnostic output is written to stderr, grouped by file.

Exit behavior:

- Exits 1 when any test error is present (or when CLI/config loading fails).
- Exits 0 when results are warnings-only or fully clean.

DO NOT write new tests OR update existing tests without being explicitly asked to by the user.

DO NOT run tests without being explicitly asked by the user.

Remind the user that you can write or run tests after making source code changes.

## Planning

When the user makes a request for a new feature or significant refactoring:

You WILL NOT immediately begin writing code or making changes.

FIRST: Have a conversation with the user so you both have a shared understanding of the work to be done.

**Make sure you are clear on these points:**

1. **User Story** - What user or system behavior is changing? Define the observable behavior: URL, request/response shape, UI state, generated HTML, deployment effect, command behavior, or data mutation.
2. **Acceptance Criteria** - How will we know when we have successfully made the changes described here?
3. **What** - What are the runtime constraints? For Worker code, consider Cloudflare Workers limitations: no Node filesystem, no native Node modules, request-scoped execution, bindings, caches, KV/R2/D1 behavior, and fetch semantics.
4. **Where** - Where does the feature belong? Decide whether it is Worker application code in src/, developer tooling in commands/ or tools/, or test/runtime harness code. This decision is also a runtime decision: src/ runs in the Cloudflare Workers runtime and must never use native Node.js modules or filesystem access. commands/, tools/, and test/ run in Node.js and have no such restriction.
5. **Dependencies** - What dependency stories will we need to implement first in order to achieve the subsequent user stories in the most maintainable way?
6. **Read the Documentation** - Which existing docs apply? Review @docs/index.md to find applicable documentation.

Ask the user if you should create an implementation plan or continue discussing the feature.

NEXT: When the user prompts you to create an implementation plan:

Considering the conversation with the user, create an implementation plan document.

Think hard to imagine all the user stories which would encapsulate the discussion.

Review all user stories you can think of and then plan to implement them cohesively for your implementation plan document.

The plan should begin with a brief Implementation Approach section (3–5 sentences) summarizing the overall strategy and any cross-cutting concerns across the stories.

The rest of the document is a TODO list. Break each user story into discrete technical tasks — one task per file change, component, route, or logical unit of work. Each TODO item must follow this exact format:

```
- [ ] **<Short title>**
  - **Story**: <User story ID or title>
  - **What**: <What to build or change, in concrete terms>
  - **Where**: <File path(s) or module(s) to create or modify>
  - **Documentation**: <File path(s) to relevant documentation or source modules for reference>
  - **Acceptance criteria**: <Which AC items this task satisfies>
  - **Depends on**: <Item titles this must come after, or "none">
```

Order items so that dependencies come first. Do not group items by story — sequence them by the order they should be implemented.

When completed, put the plan document in the prompts/plans/ directory.

## Dependencies

This project uses vendored dependencies. They live in the `lib/vendor/` and are imported using relative paths directly in project files — not as package names. Do not use `npm install` or bare package name imports for vendored deps.

NEVER install dependencies without explicitly being asked to install them by the user.

If you think you need a dependency that is not already vendored, stop working on that task and ask the user to install it.

## Explanatory Output

You should provide insightful explanations about how you are approaching a task and the tradeoffs you are making while remaining focused on the task. Balance insightful content with task completion. When providing insights, you may exceed typical length constraints, but remain focused and relevant.

For non-trivial code changes, before and after writing code, provide brief insightful explanations about your implementation choices and your thinking supporting those choices using:

"★ Insight ─────────────────────────────────────
[2-3 key insightful points]
─────────────────────────────────────────────────"

These insights should be included in the conversation, not in the codebase. Focus on interesting insights that are specific to the codebase or the code you are writing, rather than general programming concepts. Do not wait until the end to provide insights. Provide them as you write code.
