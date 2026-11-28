Paths are relative to `devkit/`.

### Devkit Architecture

docs/architecture.md

How `kixx-dev.js`, the runner (`lib/run-cli.js`) and its modules, `commands/`, and `lib/` divide the work; how framework logic is loaded from the project's own `kixx/` (discovery, the version gate, the tooling loader); a map of the `lib/` subsystems (admin, publishing, bundler, cloudflare, devserver, project); the settings inputs; the check-before-write rule for remote pipelines; and modules ported from the Kixx Library, with the conformance tests that keep them in sync.

### Commands

commands/README.md

The command contract: one-word and two-word names, the flat registry and `groups`, how a command line is read, finding the project (`kixx/plugin.json`, the version gate, settings, and the project's tooling), the static `description`, `options`, `positionals`, `requiredConfig`, `requiredSecrets`, `requiresProject`, `requiresTooling`, and `available`, constructor arguments, what `run()` returns, the `--json` envelope schema, help as data, the exit-code table and error mapping, placeholders, and the checklist for adding a command.

### Code Style Guide

docs/code-style-guide.md

JavaScript conventions: owners of responsibility, naming, formatting, imports (`node:` built-ins, vendored code, nothing outside `devkit/`), argument objects, unused variables, private class members, async code, type detection with the vendored `kixx-assert`, and inline comments. Does not apply to `lib/vendor/` or `test/fixtures/`.

### Code Documentation Guide

docs/code-documentation-guide.md

JSDoc conventions: supported tags, documenting the public contract, no JSDoc on module-private functions, and documenting events and classes.

### Error Handling

docs/error-handling.md

Operator errors (`UsageError`, printed without a stack, exit 2) versus defects (printed in full, exit 1); subclasses with their own exit code (`ProjectNotFoundError`, `UnsupportedProjectVersionError`, `CommandNotAvailableError`); errors from the project's own Kixx code; assertions and turning them into config errors at the boundary; the Admin, Publishing, Cloudflare, and bundle error classes and their typed subclasses; Cloudflare auth guidance; retry rules for reads and writes; reporting partial success; and wrapping with `cause`.

### Packaging and Runtimes

docs/packaging-and-runtimes.md

Publishing to npm and JSR from one tree: the stand-alone and no-dependency rules, loading framework logic from the project at run time, what project code the CLI runs, vendored code, keeping `package.json` and `deno.json` in sync, Node.js and Deno differences, Deno install permissions, and the injectable test seams (`output`, `fileSystem`, `fetch`, `now`).

### Unit Testing Guide

test/README.md

Running the suite on Node.js and Deno, file conventions, `kixx-test` and `kixx-assert` imports and structure, setup patterns, conformance tests (mostly parked in `test-v6/devkit/conformance/` and not run, R16), hook semantics, timeouts, skipping, assertions, `MockTracker`, the `test/helpers/` stand-ins and fixtures, error and rejection tests, and writing good tests.

### Devkit Usage Docs

../usage-docs/kixx-devkit/

Public docs for `kixx` users: `configuration.md` (`.kixx` settings, `cloudflare-config.jsonc`, `.env.<env>`, `example.env.secrets`), `admin.md`, `app.md`, `cloudflare.md`, `dev.md`, and `local.md`. Update the matching page when a command's behavior or options change.
