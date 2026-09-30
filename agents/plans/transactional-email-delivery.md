# Transactional email delivery

Reference: [platform-backend PR #2](https://github.com/Kixx-Development/platform-backend/pull/2).

## Implementation Approach

Add the same first increment as the reference PR: application code can await
`Mailer.send(context, pathname, { to, data })` for one published email bundle.
`Mailer` renders through the existing `HyperviewService.renderEmail()` and passes
the result to a small `EmailSender` port. Cloudflare sends through its
request-scoped `send_email` binding; Node logs the rendered message and returns
a local message ID. The returned ID means the provider accepted the request or
Node logged it; it does not prove delivery to the recipient.

Keep this a reusable capability and one committed example. No application
workflow sends email as part of this plan. Do not add a queue, retries, an
outbox, delivery tracking, webhooks, bulk recipients, attachments, alternate
transports, preview UI, HTTP endpoint, or new dependency. Preserve the current
email content format and rendering behavior, except that a missing bundle
becomes an `AssertionError` (see Task TED-1). Let sender failures propagate;
classify them only when a real workflow needs a recovery policy.

The Node adapter is deliberately a logging adapter in every Node environment.
Cloudflare production sending requires an onboarded sender domain, a verified
sender address, and a `send_email` binding exposed by the deployment CLI. Use a
clearly marked example sender in source config until those deployment values
are known. Verifying or changing the separate deployment CLI, configuring DNS,
and sending a live email are rollout work outside this plan. Do not claim live
delivery has been verified by unit tests.

## Implementation Tasks

### Task TED-1: Render and send one published email on Node and Cloudflare

**Status:** Not started
**Depends on:** None
**Documentation:** `README.md`; `docs/configuration.md` (per-environment
configuration); `src/plugins/README.md` (ports, adapters, plugin lifecycle,
registry composition); `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`;
`src/templates/README.md` (email template escaping);
`src/app/transaction-scripts/README.md` (service calls);
`test/unit-tests/README.md`;
[Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

**Objective**

Application code on either platform can call `Mailer.send()` to render one
named published email with recipient data and await one delivery attempt
through the runtime's sender. One committed example bundle demonstrates the
full path from content storage through rendering to the Node sender.

**Scope**

- In: `renderEmail()` missing-bundle error; the JSDoc-only sender contract;
  stateless `Mailer`; Cloudflare binding adapter; Node logging adapter; plugin
  registry entries; Cloudflare sender configuration; a minimal `/example`
  HTML/text bundle; the two documentation edits below; focused unit tests and an
  integration-style unit test using the developer content store.
- Out: entry point changes when existing plugin maps suffice; application
  transaction scripts, routes, forms, deployment CLI, DNS, live sending, and all
  deferred features in the approach above.

**Design and invariants**

- `HyperviewService.renderEmail()` throws `AssertionError` instead of
  `NotFoundError` when no bundle is published at the pathname. An application
  selects email pathnames in code, so a missing bundle is a deployment error,
  not a missing request resource; a route must not turn it into a 404. Mailer
  is the only caller, so fix it at the source rather than translating in
  Mailer. Update the inline comment, JSDoc `@throws`, and the existing test.
- `Mailer.send(context, pathname, { to, data })` accepts one bare recipient
  string and optional plain-object data. It calls the existing renderer once,
  then the sender once, awaiting the result. No new template loader, cache,
  subject renderer, or provider factory is needed.
- Mailer validation is minimal: assert `to` is a nonempty string, and one
  assertion that the rendered email has a nonempty subject and at least one
  nonempty body. `renderEmail()` already asserts the pathname. Leave address
  validation to the provider. Pass the rendered `html` and `text` through as-is;
  either may be `null`.
- Define only `EmailSender.send(context, { to, subject, html, text })`, where
  `html` and `text` are `string|null`, and `{ messageId }` in the portable
  contract. The configured sender address belongs to the adapter, not the call.
  The sender trusts Mailer's validation. Let render and send errors propagate
  unchanged.
- Cloudflare resolves the binding from the current request's `context.env`,
  following `#getKVStore` in
  `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`: read
  `config.env.SEND_EMAIL.bindingName`, fall back to a `DEFAULT_BINDING_NAME`
  constant, and assert the binding is present. It sends one structured message
  with `SEND_EMAIL.from`, omitting `null` bodies, and returns the binding's
  result. Do not log recipient data or bodies in this adapter.
- Node uses `crypto.randomUUID()`, logs recipient, subject, available bodies,
  and ID through its child logger, and returns `{ messageId }`. It performs no
  delivery and writes no outbox file.
- Register `Mailer` in the general plugin map and one `EmailSender` in each
  platform map. Use the current two-phase plugin lifecycle; do not add service
  lookup during `register()` merely to establish dependencies.
- Put only `SEND_EMAIL.from` in the Cloudflare production environment config;
  the binding name uses the adapter default. Mark the example `from` address as
  a placeholder. Node needs no new email config or secret.
- Add `src/emails/example/email.json`, `body.html`, and `body.txt` using the
  existing bundle schema. Supply a subject and one caller-provided name.
  Escape runtime data in HTML; keep plain text readable. Do not introduce an
  email style system or external assets for this specimen.
- Documentation: `src/app/transaction-scripts/README.md` already shows the
  `Mailer.send` call shape; only correct its example pathname to canonical
  `/password-reset`. Add a short note to `docs/configuration.md` covering
  `SEND_EMAIL.from` and the Cloudflare prerequisites: the `send_email` binding
  and an onboarded, verified sender domain and address.
- Keep all application calls platform-neutral; no Node or Cloudflare imports
  enter `src/app/` or the general `Mailer` service.
- Exercise the committed example through the real developer content store,
  Hyperview, Mailer, and Node sender. Mock the Cloudflare binding separately;
  do not require a server or real account to run tests.

**Expected touch points**

- `src/kixx/hyperview/hyperview-service.js` — missing bundle throws
  `AssertionError`.
- `test/unit-tests/kixx/hyperview/hyperview-service.test.js` — update the
  missing-bundle test.
- `src/kixx/email-sender/email-sender-interface.js` — sender contract.
- `src/plugins/mailer/` — render-and-send orchestration and plugin.
- `src/plugins/cloudflare-email-sender/` — request-scoped binding adapter.
- `src/plugins/node-email-sender/` — logging adapter.
- `src/plugins/general.js`, `src/plugins/node.js`, `src/plugins/cloudflare.js`
  — service registration.
- `src/cloudflare-config.js` — example sender address.
- `src/emails/example/` — committed example bundle.
- `docs/configuration.md` — Cloudflare prerequisites note.
- `src/app/transaction-scripts/README.md` — pathname fix.
- `test/unit-tests/plugins/{mailer,cloudflare-email-sender,node-email-sender}/`
  — focused tests, including `mailer/example-email.test.js` for service
  composition within the unit-test process.

Treat this list as orientation, not permission to ignore other necessary files.
Record actual changes in the handoff notes.

**Acceptance criteria**

- [ ] `renderEmail()` for an unpublished pathname throws `AssertionError`.
- [ ] HTML-only, text-only, and two-body bundles produce the expected sender
  payload and return its message ID.
- [ ] An empty recipient, or rendered content lacking a subject or any body,
  does not call the sender.
- [ ] Render and sender failures propagate unchanged.
- [ ] Cloudflare uses the current request binding (configured name or default)
  and configured sender, omits `null` bodies, and asserts when the binding is
  missing; Node logs one message and generates an ID without delivering or
  writing a file.
- [ ] Normal plugin composition exposes `Mailer` and the runtime's
  `EmailSender`.
- [ ] The committed example renders caller data in subject, HTML, and text and
  reaches the Node log adapter with a returned ID.
- [ ] Cloudflare configuration and documentation identify the binding and
  verified-sender prerequisites; no placeholder is described as production
  ready.
- [ ] No workflow sends automatically, and no third-party dependency is added.
- [ ] Changed-file lint, the full unit suite, and whitespace check pass.

**Validation**

- `node run-linter.js src/kixx/hyperview src/kixx/email-sender src/plugins/mailer src/plugins/cloudflare-email-sender src/plugins/node-email-sender src/plugins/general.js src/plugins/node.js src/plugins/cloudflare.js src/cloudflare-config.js test/unit-tests/kixx/hyperview test/unit-tests/plugins/mailer test/unit-tests/plugins/cloudflare-email-sender test/unit-tests/plugins/node-email-sender` — lint changed JavaScript; include any additional changed JavaScript paths.
- `node run-tests.js` — full unit suite and example integration coverage.
- `git diff --check` — patch whitespace.
- Before a live rollout, verify the deployment CLI can provision the configured
  `send_email` binding and that the sender address belongs to an onboarded,
  verified domain. This is a deployment prerequisite, not a unit-test claim.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: Existing `HyperviewService.renderEmail()` already
  returns subject, HTML, and text from one content snapshot, and has no callers
  outside its tests. The reference PR uses Cloudflare's structured `send()` API
  and a Node logging adapter. The developer content scanner already discovers
  `emails/<name>/email.json` and its named template files. No storage change is
  planned. Production binding support lives in the separate deployment CLI and
  has not been verified here.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None for local implementation; deployment prerequisites remain for
  live Cloudflare delivery.
