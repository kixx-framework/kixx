Paths are relative to `lib/`.

### Configuration

../usage-docs/kixx-app/configuration.md

Where a runtime value belongs: per-environment values in `node-config.jsonc`/`cloudflare-config.jsonc` versus per-deploy environment variables (dotenv files or Cloudflare bindings) split by secrecy. Covers environment selection, merging dotenv files, the server port, the `example.env.secrets` manifest, `DATA_DIRECTORY` and store paths, `JOB_QUEUE` settings, and Cloudflare bindings, secrets, resources, and packaging.

### Configuration Internals

docs/configuration-internals.md

`parseJsonc`, `readConfig`, `resolveFilepath`, and environment merging; the `*.jsonc.template` config templates, their `json` helper, and the Node.js and Cloudflare rendering contexts; and the checklist for adding a new setting.

### Code Style Guide

docs/code-style-guide.md

Server-side JavaScript conventions: naming, formatting, argument objects, unused variables, private class members, async code, type detection, and inline comments. Does not apply to `kixx/vendor/`, `kixx/assertions/`, or `kixx/errors/`.

### Code Documentation Guide

docs/code-documentation-guide.md

JSDoc conventions for server-side JavaScript: supported tags, documenting the public contract, no JSDoc on module-private functions, and documenting events and classes.

### Server Error Handling

docs/server-error-handling.md

Expected operational errors versus programmer bugs and how each entry point applies the rule, turning assumptions into `assert*` checks, and wrapping and rethrowing with `cause`.

### Collections

app/collections/README.md

The data source layer: backing stores, defining Collections and custom helpers, document store writes, reads, deletes, IDs and sort keys, secondary indexes, Records, key/value store Collections, and custom gateways.

### Transaction Scripts

app/transaction-scripts/README.md

Domain logic as one async function per user action: when not to write one, files and signatures, return values, calling Collections and external services, and error handling.

### Background Jobs

app/jobs/README.md

The durable job queue (port contract in `kixx/jobs/job-queue-interface.js`): registering jobs, handlers, enqueueing now, later, or on a UTC cron schedule, errors and retries, operating the queue, and testing.

### Data Migrations

app/migrations/README.md

Statically registered migrations an operator runs in batches through the Admin API: registration, the module contract, expand/contract deployment ordering, and an authoring checklist. Endpoints are documented outside `lib/` in `../usage-docs/kixx-app/admin-api.md`.

### Presentation Layer Guide

app/presentation/README.md

HTTP and Hyperview integration: route patterns, handler and middleware execution order, response cache policy, reverse routing and target names, request handlers and error handling, `HyperviewPageHandler`, and the `RequestContext`, `ServerRequest`, and `ServerResponse` APIs. Covers HTML and API-only Forms, normalization helpers, CSRF helpers, recipes (page, form workflow, JSON:API endpoint, static assets), page context, emails, and the `/admin` sidebar.

### Cross-Site Request Forgery Protection

docs/cross-site-request-forgery.md

The CSRF threat model and the protection for browser HTML forms that sign in or mutate admin state: form rendering and submission, per-handler enforcement (every new mutating HTML route must adopt it), token lifecycle, and tradeoffs.

### Administrative Data API

../usage-docs/kixx-app/admin-data-api.md

Version-checked JSON:API access to registered Collections at `/admin-data-api/v1/`, bypassing application workflows but not Record validation. Covers the exposure model, token grants, media types, discovery, resource documents and versions, writes, pagination, errors, audit logging, and the `File` resource and its limits.

### Administrative Data API Resources

app/admin-data-api/README.md

Registering a Collection as an Administrative Data API resource: the registration shape, rules the registry enforces, and where the contract is tested.

### Plugins and Cross-Platform Architecture

plugins/README.md

Ports-and-adapters architecture: the three plugin roles, adapters that skip the registry, general plugins, the two-phase plugin module contract, where Node.js and Cloudflare differences live, how contracts are written, checklists for adding ports or platforms, and rules for application code.

### Templating Guide

templates/README.md

Kixx Mustache-style templates as rendered by Hyperview: the Hyperview context, expressions and name resolution, sections, falsiness, delimiters, whitespace, built-in helpers, Hyperview helpers (`assetUrl`, `formatDate`, `markup`, `truncate`), HTML escaping, partials, custom helpers, and errors.

### Frontend Development Guide

docs/frontend-development-guide.md

HTML, CSS, and browser JavaScript conventions: where frontend source lives (`pages/`, `templates/`, `static-assets/`, `public/`) and how `page.json` directives treat files, public pages as the default with `admin.css` layered on `stylesheet.css`, no inline styles, stylesheet organization and formatting, BEM, design tokens, the `light-dark()` scheme and theme toggle, typography, layout primitives, composition, page-local CSS, `data-js-behavior` hooks in `site.js`, and verifying frontend work.

### Style Guide (Live Design System)

pages/admin/style-guide/

The live design system, served at `/admin/style-guide` (admin sign-in required); each subdirectory is one page whose content is in `body.html`. Start with `aesthetic/`. Foundation pages (`typography/`, `colors/`, `layout/`) and component pages (`buttons/`, `callouts/`, `cards/`, `forms/`, `text-fields/`, `multi-line-text-areas/`, `copy-fields/`, `table-lists/`) document markup, variants, and usage rules. Read the relevant pages before writing or reviewing markup or CSS, and add a page (plus a link in `templates/partials/admin-nav.html`) when creating a shared component.

### Static Assets

kixx/static-assets/README.md

`StaticAssetRequestHandler` fingerprinted versus pathname modes and their caching headers, development asset scanning and root-relative imports, and how CSS and JavaScript are published for production.

### Unit Testing Guide

test/README.md

Testing with `kixx-test` and `kixx-assert`: file conventions, imports, structure, setup patterns, shared conformance suites, hook semantics, timeouts, skipping, assertions, `MockTracker`, error and rejection tests, and writing good tests.

### Kixx Library References

kixx/assertions/README.md, kixx/errors/README.md, kixx/vendor/templating/docs/README.md

API references for framework code under `kixx/`: the `is*` tests and `assert*` helpers with `AssertionError`; the standard HTTP error classes and the operational-versus-unexpected distinction; and the generic template engine and its API (`tokenize`, `buildSyntaxTree`, `createRenderFunction`). Prefer the Templating Guide for project template work.
