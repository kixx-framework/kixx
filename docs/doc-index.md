Paths are relative to the repository root.

### Code Style Guide

docs/code-style-guide.md

Server-side JavaScript conventions: naming, formatting, argument objects, unused variables, private class members, async code, type detection, and inline comments. Does not apply to `kixx/vendor/`, `kixx/assertions/`, or `kixx/errors/`.

### Code Documentation Guide

docs/code-documentation-guide.md

JSDoc conventions for server-side JavaScript: supported tags, documenting the public contract, no JSDoc on module-private functions, and documenting events and classes.

### Plugin Guide

plugins/README.md

What a plugin is and how it is wired in: the `plugin.json` manifest reference (also the schema of core's `kixx/plugin.json` and the app's `app/app.json`), lifecycle modules and their order (`register`, `initialize`, `start`, `stop`), the five generated files and how to regenerate them, routes and mounts, config defaults per target, declared secrets and the boot check, plugin content and its collisions with project content, declared template helpers, the deploy key check for operations endpoints, Cloudflare resources and Durable Object classes, contributing only when another plugin is installed, and thin entry points. Also the ports-and-adapters rules: the three roles, where Node.js and Cloudflare differences live, writing a contract, and checklists for adding a port or a platform.

### Server Error Handling

docs/server-error-handling.md

Expected operational errors versus programmer bugs and how each platform's server module applies the rule, turning assumptions into `assert*` checks, and wrapping and rethrowing with `cause`.

### Vendored Code

docs/vendored-code.md

The rules for code copied into `kixx/errors/`, `kixx/assertions/`, `kixx/vendor/` (acorn, marked, path-to-regexp, templating), and `devkit/lib/vendor/` (acorn, kixx-assert): unmodified releases only, the file set for Kixx and third-party libraries, changing Kixx libraries upstream first, adding, upgrading, and removing, and the `vendored-code.json` record and its digest.

### Kixx Library References

kixx/assertions/README.md, kixx/errors/README.md, kixx/errors/docs/README.md, kixx/vendor/templating/docs/README.md

API references for framework code under `kixx/`: the `is*` tests and `assert*` helpers with `AssertionError`; the operational-versus-unexpected error distinction, with a per-class reference for every error class (name, code, HTTP status, options) in `kixx/errors/docs/`; and the generic template engine and its API (`tokenize`, `buildSyntaxTree`, `createRenderFunction`). Prefer the Templating Guide for project template work.

### Testing Guide

test/README.md

The unit suite and the integration suite, and which one a test belongs in. Dependency injection of platform services, thin Durable Object shells, the shared fakes in `test/fakes/` and how to write one, the fixture project in `test/fixtures/`, shared conformance and golden suites and the rules for running one on a real platform, and the import hygiene rules, including the one that keeps the content compiler and the tooling entry platform-neutral. Also testing with `kixx-test` and `kixx-assert`: file conventions, imports, structure, setup patterns, hook semantics, timeouts, skipping, assertions, `MockTracker`, error and rejection tests, and writing good tests.

### Integration Suite

test-app/README.md

Running the integration suite against a real target: the runner's target options, its environment variables and the deploy key, timeouts and path selection, and who runs it. Covers the probe, which runs shared conformance suites inside a running server: its protocol, mounting it, and using `createProbeClient` and `describeProbeSuite` in an integration test.

### Cross-Site Request Forgery Protection

docs/cross-site-request-forgery.md

The CSRF threat model and the protection for browser HTML forms that sign in or mutate admin state: form rendering and submission, per-handler enforcement (every new mutating HTML route must adopt it), token lifecycle, and tradeoffs.

### Configuration Internals

docs/configuration-internals.md

`parseJsonc`, `readConfig` and the config defaults it lays under a project's config, `resolveFilepath`, environment merging, and the boot check of declared secrets; the `*.jsonc.template` config templates, their `json` helper, and the Node.js and Cloudflare rendering contexts; and the checklist for adding a new setting.

### Content Compiler

kixx/content-compiler/README.md

The one compiler that turns a project's content into content objects and a Release manifest: the entry point a tool loads (`kixx/tooling/mod.js` and the two Node.js adapters), `compileProjectContent()` and `compileContent()`, the content source port and how to write a source, what is compiled and each object type, the result (`objects`, `release`, `report`, `graph`), stylesheet bundling and JavaScript comment stripping, plugin content and collisions, the template checks and what they can't see, the dependency graph, the limits, and every problem code.

### Code Fingerprint

kixx/code-fingerprint/README.md

Which project paths are content, agent files, tests, docs, or code (D40), with the classification table and its precedence; `classifyPath()` and `createPathClassifier()`; `computeCodeFingerprint()` and the format 1 serialization byte for byte, with a worked example; feeding it from `git ls-tree -r -z` (`parseGitLsTree()`) or Studio's workspace; the golden vectors; and the version rule.

### Static Assets

kixx/static-assets/README.md

`StaticAssetRequestHandler` fingerprinted versus pathname modes and their caching headers, development asset scanning and root-relative imports, and how the content compiler publishes CSS and JavaScript for production.

### Content

usage-docs/kixx-app/content.md

For app developers: where content lives, what the pre-publish checks catch and don't, reading a failed check, declaring a template helper in `app/app.json` and the boot warning, collisions with plugin content, and unmatched files.

### Configuration

usage-docs/kixx-app/configuration.md

Where a runtime value belongs: per-environment values in `node-config.jsonc`/`cloudflare-config.jsonc` versus per-deploy environment variables (dotenv files or Cloudflare bindings) split by secrecy. Covers environment selection, config defaults, merging dotenv files, the server port, the generated `example.env.secrets` manifest, `DATA_DIRECTORY` and store paths, `JOB_QUEUE` settings, and Cloudflare bindings, secrets, resources, and packaging.

### Administrative Data API

usage-docs/kixx-app/admin-data-api.md

Version-checked JSON:API access to registered Collections at `/admin-data-api/v1/`, bypassing application workflows but not Record validation. Covers the exposure model, token grants, media types, discovery, resource documents and versions, writes, pagination, errors, audit logging, and the `File` resource and its limits.

### Frontend Development Guide

docs/frontend-development-guide.md

HTML, CSS, and browser JavaScript conventions: where frontend source lives (`pages/`, `templates/`, `static-assets/`, `public/`) and how `page.json` directives treat files, public pages as the default with `admin.css` layered on `stylesheet.css`, no inline styles, stylesheet organization and formatting, BEM, design tokens, the `light-dark()` scheme and theme toggle, typography, layout primitives, composition, page-local CSS, `data-js-behavior` hooks in `site.js`, and verifying frontend work.

## v6 Reference App

Guides for code that is still in `reference-app/`: v6 starter-app material, not maintained or runnable. Read them when extracting that code.

### Collections

reference-app/app/collections/README.md

The data source layer: backing stores, defining Collections and custom helpers, document store writes, reads, deletes, IDs and sort keys, secondary indexes, Records, key/value store Collections, and custom gateways.

### Transaction Scripts

reference-app/app/transaction-scripts/README.md

Domain logic as one async function per user action: when not to write one, files and signatures, return values, calling Collections and external services, and error handling.

### Presentation Layer Guide

reference-app/app/presentation/README.md

HTTP and Hyperview integration: route patterns, handler and middleware execution order, response cache policy, reverse routing and target names, request handlers and error handling, `HyperviewPageHandler`, and the `RequestContext`, `ServerRequest`, and `ServerResponse` APIs. Covers HTML and API-only Forms, normalization helpers, CSRF helpers, recipes (page, form workflow, JSON:API endpoint, static assets), page context, and the `/admin` sidebar.

### Background Jobs

reference-app/app/jobs/README.md

The durable job queue (port contract in `kixx/jobs/job-queue-interface.js`): registering jobs, handlers, enqueueing now, later, or on a UTC cron schedule, errors and retries, operating the queue (including the admin panel at `/admin/jobs`: inspect, retry, and Run now), and testing.

### Data Migrations

reference-app/app/migrations/README.md

Statically registered migrations an operator runs in batches from the admin panel (`/admin/migrations`) or through the Admin API: registration, the module contract, expand/contract deployment ordering, and an authoring checklist. Endpoints are documented in `usage-docs/kixx-app/admin-api.md`.

### Administrative Data API Resources

reference-app/app/admin-data-api/README.md

Registering a Collection as an Administrative Data API resource: the registration shape, rules the registry enforces, and where the contract is tested.

### Templating Guide

reference-app/templates/README.md

Kixx Mustache-style templates as rendered by Hyperview: the Hyperview context, expressions and name resolution, sections, falsiness, delimiters, whitespace, built-in helpers, Hyperview helpers (`assetUrl`, `formatDate`, `markup`, `truncate`), HTML escaping, partials, custom helpers, and errors.

### Style Guide (Live Design System)

reference-app/pages/admin/style-guide/

The live design system, served at `/admin/style-guide` (admin sign-in required); each subdirectory is one page whose content is in `body.html`. Start with `aesthetic/`. Foundation pages (`typography/`, `colors/`, `layout/`) and component pages (`buttons/`, `callouts/`, `cards/`, `forms/`, `text-fields/`, `multi-line-text-areas/`, `copy-fields/`, `table-lists/`) document markup, variants, and usage rules. Read the relevant pages before writing or reviewing markup or CSS, and add a page (plus a link in `reference-app/templates/partials/admin-nav.html`) when creating a shared component.
