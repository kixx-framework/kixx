Paths are relative to `devkit/`.

### Devkit Architecture

docs/architecture.md

How `kixx.js`, `commands/`, and `lib/` divide the work; a map of the `lib/` subsystems (admin, publishing, bundler, cloudflare, devserver); the settings inputs; the check-before-write rule for remote pipelines; and modules ported from the Kixx Library, with the conformance tests that keep them in sync.

### Commands

commands/README.md

How the CLI finds and runs commands: the `commands/` layout, command index modules, sub-command classes and their static `description`, `options`, `requiredConfig`, and `requiredSecrets`, constructor arguments, `run()` return codes, output and `UsageError`, and the checklist for adding a command.

### Code Style Guide

docs/code-style-guide.md

JavaScript conventions: owners of responsibility, naming, formatting, imports (`node:` built-ins, vendored code, nothing outside `devkit/`), argument objects, unused variables, private class members, async code, type detection with the vendored `kixx-assert`, and inline comments. Does not apply to `lib/vendor/` or `test/fixtures/`.

### Code Documentation Guide

docs/code-documentation-guide.md

JSDoc conventions: supported tags, documenting the public contract, no JSDoc on module-private functions, and documenting events and classes.

### Error Handling

docs/error-handling.md

Operator errors (`UsageError`, printed without a stack) versus defects (printed in full); assertions and turning them into config errors at the boundary; the Admin, Publishing, Cloudflare, and bundle error classes and their typed subclasses; Cloudflare auth guidance; retry rules for reads and writes; reporting partial success; and wrapping with `cause`.

### Packaging and Runtimes

docs/packaging-and-runtimes.md

Publishing to npm and JSR from one tree: the stand-alone and no-dependency rules, vendored code, keeping `package.json` and `deno.json` in sync, Node.js and Deno differences, Deno install permissions, and the injectable test seams (`output`, `fileSystem`, `fetch`, `now`).

### Unit Testing Guide

test/README.md

Running the suite on Node.js and Deno, file conventions, `kixx-test` and `kixx-assert` imports and structure, setup patterns, conformance tests against repo `lib/`, hook semantics, timeouts, skipping, assertions, `MockTracker`, the `test/helpers/` stand-ins and fixtures, error and rejection tests, and writing good tests.

### Devkit Usage Docs

../usage-docs/kixx-devkit/

Public docs for `kixx` users: `configuration.md` (`.kixx` settings, `cloudflare-config.jsonc`, `.env.<env>`, `example.env.secrets`), `admin.md`, `app.md`, `cloudflare.md`, and `dev.md`. Update the matching page when a command's behavior or options change.
