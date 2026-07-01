# Copy-to-Clipboard Field Component

## Implementation Approach

Add a reusable admin "copy field" component — a labeled read-only value with a copy button and status feedback — as a general-purpose primitive in the shared frontend component layer, not something scoped to secrets. The one-time admin secrets (invite links, Publishing API tokens) are the first two consumers, but the component itself must not encode "secret" or "one-time" semantics: it is just a copyable value display, equally suited to a webhook URL, a public share link, or an ID field added later. The one-time-reveal framing (warning text, "shown once") stays in the callout markup that wraps the component, not in the component itself. The delegated browser script is behavior-only and keys off `data-js-behavior="copy-field"` plus a `data-copy-target` selector, matching the existing `data-js-behavior="theme-toggle"` convention in `src/templates/base/admin.html`, so it works for any current or future field without modification. The enhancement is progressive: without JavaScript, the value remains visible and selectable in a plain read-only input; with JavaScript, clicking the value selects it and clicking the copy icon writes it to the clipboard with clear success/failure feedback. Server-side behavior is unchanged — invite links and Publishing API tokens are still produced by the existing POST handlers and rendered only on the immediate create response.

- [ ] **Add the shared `.copy-field` component styles**
  - **Story**: Copy-to-clipboard field component
  - **What**: Add a reusable `.copy-field` component with BEM element classes for label, control row, read-only value field, copy button, icon, and status text (e.g. `.copy-field__label`, `.copy-field__row`, `.copy-field__value`, `.copy-field__button`, `.copy-field__icon`, `.copy-field__status`). Name the component and its classes generically — a copyable value display, not a secret or token display — so it reads correctly whether used for a one-time secret, a URL, or any other value someone might want to copy. The component should handle long URLs/tokens without layout overflow, use existing design tokens and Material Symbols, provide focus-visible states, keep the button at a stable icon-button size, and include a reusable visually-hidden utility only if the chosen markup needs hidden accessible text.
  - **Where**: `src/stylesheets/lib/standard-include.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`; `src/stylesheets/lib/standard-include.css`; `src/stylesheets/lib/admin-components.css:259` for the existing `.code-block` usage to avoid reusing style-guide-only demo CSS for product UI
  - **Acceptance criteria**: The component fits inside the existing `callout__body` on desktop and mobile when used inside a one-time-reveal callout, and also renders sensibly outside a callout (e.g. as a standalone labeled field) for future non-secret uses; long values scroll or truncate within the field instead of stretching their container; button and input focus outlines are visible; no inline styles or raw palette tokens are introduced; no class name or comment refers to "secret" or "token".
  - **Depends on**: none

- [ ] **Add delegated copy behavior to the admin base template**
  - **What**: Add a small delegated browser script, following the existing `data-js-behavior="theme-toggle"` pattern in `src/templates/base/admin.html`, that listens for clicks on `[data-js-behavior="copy-field"]` buttons and their associated value fields. Clicking a value field selects its full contents; clicking a copy button reads the target field value via `data-copy-target` (an id reference, matching how the field and button are linked), attempts `navigator.clipboard.writeText(value)`, updates an `aria-live` status element to "Copied" on success, swaps the icon to `check` temporarily, and falls back to selecting the field with a "Press Ctrl+C or Cmd+C" style status when clipboard write is unavailable or rejected. The script must stay generic — no reference to invites, tokens, or any specific field — so any page that renders a `.copy-field` gets working behavior for free.
  - **Where**: `src/templates/base/admin.html`
  - **Documentation**: `src/app/presentation/README.md`; `src/templates/README.md`; existing theme-toggle script in `src/templates/base/admin.html:52-88` for local script style and `data-js-behavior` conventions
  - **Acceptance criteria**: Copy behavior works for any `[data-js-behavior="copy-field"]` control in the admin shell, regardless of what kind of value it holds; selecting a value works even if clipboard APIs fail; each control updates only its own status/icon; the script does not throw when no copy controls exist on a page.
  - **Depends on**: Add the shared `.copy-field` component styles

- [ ] **Update the admin invite reveal-once callout**
  - **Story**: Copy newly created admin invite links
  - **What**: Replace the current `.code-block` display for `newInviteUrl` (`src/templates/pages/admin/invites/page.html:19`) with the shared `.copy-field` markup, keeping the existing `.callout.callout--info` wrapper and one-time warning text unchanged around it. Render a labeled read-only input whose `value` is `{{ newInviteUrl }}`, a copy icon button with an accessible label such as "Copy invite link", and an `aria-live` status element for feedback. Do not change the request handler or invite data contract.
  - **Where**: `src/templates/pages/admin/invites/page.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; `src/app/presentation/request-handlers/admin-invites.js`
  - **Acceptance criteria**: After creating an invite, the page still shows the exact `newInviteUrl` once, inside the existing one-time warning callout; clicking the field selects the entire link; clicking the copy icon copies the link when browser permissions allow it and otherwise leaves the selected field ready for manual copy; existing create, list, revoke, and pagination markup remains behaviorally unchanged.
  - **Depends on**: Add delegated copy behavior to the admin base template

- [ ] **Update the Publishing API token reveal-once callout**
  - **Story**: Copy newly created Publishing API tokens
  - **What**: Replace the current `.code-block` display for `newToken` (`src/templates/pages/admin/publishing-api-tokens/page.html:18`) with the same shared `.copy-field` markup used by admin invites, keeping the existing `.callout.callout--info` wrapper and one-time warning text unchanged around it. Render a labeled read-only input whose `value` is `{{ newToken }}`, a copy icon button with an accessible label such as "Copy token", and an `aria-live` status element for feedback. Do not change the request handler or token data contract.
  - **Where**: `src/templates/pages/admin/publishing-api-tokens/page.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; `src/app/presentation/request-handlers/admin-publishing-api-tokens.js`
  - **Acceptance criteria**: After creating a Publishing API token, the page still shows the exact `newToken` once, inside the existing one-time warning callout; clicking the field selects the entire token; clicking the copy icon copies the token when browser permissions allow it and otherwise leaves the selected field ready for manual copy; existing create, list, revoke, and pagination markup remains behaviorally unchanged.
  - **Depends on**: Add delegated copy behavior to the admin base template

- [ ] **Verify copy controls in the browser**
  - **Story**: Copy-to-clipboard field component
  - **What**: Start the dev server, create an invite and a Publishing API token through the admin UI, and confirm both one-time callouts render correctly across desktop and narrow mobile widths using the new `.copy-field` component. Inspect the controls manually or with browser automation to confirm field selection, copy-button feedback, no layout overflow, no JavaScript errors, and no regressions to create/revoke/list workflows.
  - **Where**: `/admin/invites`; `/admin/publishing-api-tokens`; `node tools/devserver.js --config src/node-config.json --port 2026`
  - **Documentation**: `src/docs/frontend-development-guide.md`; Development Server instructions in `AGENTS.md`
  - **Acceptance criteria**: Both pages allow copying from the button and selecting from the field; the control remains usable without layout overlap on mobile and desktop; the browser console is clean for this behavior; no tests are run unless explicitly requested.
  - **Depends on**: Update the admin invite reveal-once callout; Update the Publishing API token reveal-once callout

- [ ] **Run linting for changed source files**
  - **Story**: Copy-to-clipboard field component
  - **What**: Run the project linter against changed JavaScript-bearing source files after implementation, especially `src/templates/base/admin.html` if template scripts are linted by the workflow, or otherwise run `node run-linter.js` on applicable JavaScript sources changed during the implementation. Do not run unit tests unless explicitly asked.
  - **Where**: `node run-linter.js [pathname ...]`
  - **Documentation**: `AGENTS.md` linting instructions; `src/docs/code-style-guide.md` if any JavaScript source file is changed instead of only template-embedded script
  - **Acceptance criteria**: Linting exits 0 for applicable changed source code; any skipped test run is noted to the user with a reminder that tests can be written or run on request.
  - **Depends on**: Verify copy controls in the browser
