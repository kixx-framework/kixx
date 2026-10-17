Admin Nav Collapse
==================

On screens narrower than the admin shell's 52rem breakpoint, the admin sidebar nav (`.admin-nav`) collapses behind a "Menu" toggle button at the top of the nav, so page content starts near the top of the viewport. The nav starts closed on every page load; pressing the button expands the link lists in place, pushing content down. At 52rem and wider nothing changes: the toggle is hidden and the nav is the sticky sidebar it is today. Without JavaScript, the nav renders fully expanded exactly as today and the toggle never appears.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Vertical collapse in place.** The button shows and hides the nav's link lists, pushing content down. No side drawer or overlay. Reason: simplest option for a starter app and fits existing `site.js` conventions.
2. **Starts closed on every page load on small screens; no persisted state** (no `localStorage`). Reason: content-first, less code.
3. **The toggle lives at the top of the nav, inside `lib/templates/partials/admin-nav.html`**, not in the header bar. Reason: keeps header controls uncrowded and keeps the change contained to the nav partial and its CSS.
4. **Accessible disclosure button.** A real `<button type="button">` with `aria-expanded` and `aria-controls`, with focus-visible styling consistent with the existing `.admin-nav__link` focus styles.
5. **Progressive enhancement.** With JavaScript disabled or failed, the nav renders fully expanded exactly as today, and the button does not appear (it is never a dead control) until JavaScript initializes it.
6. **No change at >= 52rem.** Toggle hidden; nav always shown as the sidebar.
7. **Plain text label "Menu".** No icon library.
8. **Accept a brief flash of the expanded nav on slow first loads.** `site.js` is a deferred module at the end of `<body>`, so a narrow screen may paint the expanded nav before it collapses. Do not add an inline script to the nav partial to prevent it. Reason: keeps the whole behavior in `site.js` and the change small.
9. **Out of scope:** side drawer/overlay, animation or transitions, the public-site nav, standalone admin auth pages (they do not use `.admin-layout`), and remembering open/closed state.

### Routine choices made by the planner (from project conventions)

These are not operator decisions; a later agent may revise them with a recorded reason.

- **`aria-expanded` is the single source of truth.** JavaScript only flips the button's `aria-expanded`; CSS hides the link wrapper with an adjacent-sibling selector on `[aria-expanded="false"]`. The accessible state and the visual state cannot drift apart, and no extra state attribute or class is needed.
- **Server markup ships the button `hidden` with `aria-expanded="true"`.** That is accurate before JavaScript runs (the lists are visible), and it means the collapse selector can never match without JavaScript. On init, `site.js` sets `aria-expanded="false"` and removes `hidden`. The `[hidden] { display: none !important; }` rule in `reset.css` guarantees the button stays invisible until then.
- **Names.** Behavior hook `data-js-behavior="admin-nav-toggle"`. New BEM elements `.admin-nav__toggle` (the button) and `.admin-nav__sections` (a `<div>` wrapping every existing title and list), with `id="admin-nav-sections"` as the `aria-controls` target. The partial renders once per page, so the id is unique.
- **The toggle is a nav row, not a `.button`.** It is styled like an `.admin-nav__link` row (same inline padding, transparent 2px left border, same hover and focus-visible treatment) so it reads as part of the nav and its focus styling matches the links. It is not a `.button` component.
- **Breakpoint mechanics.** Keep the file's mobile-first, single-breakpoint style: the collapse rule and toggle styles sit in the nav block's base (narrow) rules, and the wide-screen overrides (`.admin-nav__toggle` hidden, `.admin-nav__sections` shown regardless of `aria-expanded`) go inside the existing nav `@media (min-width: 52rem)` block, using selectors of equal specificity placed later in source. Do not add a second breakpoint value or a `max-width` query.
- **Docs.** `lib/app/presentation/README.md` documents `admin-nav.html` structure (where new section links go), so it gets one or two sentences: links go inside `.admin-nav__sections`, and below 52rem the nav collapses behind the toggle. The nav block header comment in `admin-shell.css` is updated to describe the collapse. No change to `usage-docs/kixx-app/` (no page mentions the admin nav; this is starter-app UI, not public API). No change to the Layout style-guide page (it documents the `.with-sidebar` primitive, not the admin nav). No change to `lib/docs/frontend-development-guide.md`.
- **No unit tests.** There is no browser-JavaScript test harness for `site.js`, and no unit or e2e test asserts admin nav markup (checked `lib/test/`, `test-app/test/`, `devkit/test/conformance/`). Verification is lint, the existing suites, static checks, and a manual browser check.
- **No new ESLint globals.** The behavior needs only `document` and `console`, both already allowlisted in `lib/eslint.config.js`.

### Cross-cutting constraints

- **`.with-sidebar` child contract.** `lib/templates/base/admin.html` requires exactly two children of `.admin-layout.with-sidebar`: the nav partial and one element after it. The toggle and the wrapper go *inside* `<nav class="admin-nav">` (inside `.admin-nav__inner`). Do not change `admin.html` or `lib/static-assets/stylesheets/lib/layout.css` (the primitive stays breakpoint-free).
- **Link markup is unchanged.** Every existing `.admin-nav__title`, `.admin-nav__list`, `.admin-nav__link`, `href`, `aria-current` conditional, and the `{{#ifEqual subpage.section "style-guide"}}...{{else}}...{{/ifEqual}}` branch stay byte-for-byte the same; they only move one level deeper into the wrapper (re-indent only).
- **Browser JS conventions** (`lib/docs/frontend-development-guide.md`, "Browser JavaScript"): a new self-contained IIFE in `lib/static-assets/javascript/site.js`, selected by `data-js-behavior`, never by a styling class. If the `aria-controls` target is missing, `console.warn` and skip that control (leave it `hidden`) instead of throwing. `ecmaVersion: 2017`.
- **CSS conventions** (same guide, "CSS Formatting" and "CSS Comments"): four-space indent, one declaration per line, expanded blocks, comments above rules (no trailing inline comments), semantic `--color-*` tokens only (no `--palette-*` or literal colors), existing `--space-*` tokens for any new spacing. Match the block-header comment style already in `admin-shell.css`.
- **No platform code.** This is static assets and a template only; it works the same on Node.js and Cloudflare. Nothing under `kixx/`, `plugins/`, or `kixx/vendor/` changes.
- **No devkit ports affected.** None of the ported `lib/` modules change.
- **Commands run from the repo root** (`/Users/kris/Projects/kixx/kixx`). Do not run the test-app e2e suite as agent validation; it is in the Operator Runbook.
- **Admin pages require an admin session.** Browser checks are Operator Runbook items unless the implementing agent already has a local dev admin session. Do not create accounts or enter credentials to get one.
- Related plans: none overlap. `agents/plans/admin-table-list.md` (admin UI) was used for conventions only.

---

### Task T1: Collapse the admin nav behind a Menu toggle on narrow screens

**Status:** Complete
**Depends on:** None
**Documentation:** `lib/docs/frontend-development-guide.md` (Browser JavaScript; CSS Formatting; CSS Comments; Verifying Frontend Work); `lib/app/presentation/README.md` (admin layout section, around the `admin-nav.html` paragraphs); header comments in `lib/static-assets/stylesheets/lib/admin-shell.css`

**Objective**

Below 52rem, every page using the admin shell shows a "Menu" button at the top of the nav, with the link lists hidden until the button is pressed; pressing it again hides them. At 52rem and wider, and whenever JavaScript has not run, the nav looks and behaves exactly as it does today. Markup, CSS, JavaScript, and the two doc touch-ups are one task because none of them is meaningful or verifiable alone.

**Scope**

- In: the toggle button and `.admin-nav__sections` wrapper in `admin-nav.html`; toggle, collapse, and wide-screen override rules plus the updated nav block header comment in `admin-shell.css`; a new `admin-nav-toggle` IIFE in `site.js`; a short note in `lib/app/presentation/README.md`.
- Out: header bar, public-site nav, standalone auth pages, `admin.html`, `layout.css`, animation, persisted state, `usage-docs/`, style-guide pages.

**Design and invariants**

- Markup, inside `.admin-nav__inner`, in this order:
  - `<button class="admin-nav__toggle" type="button" data-js-behavior="admin-nav-toggle" aria-controls="admin-nav-sections" aria-expanded="true" hidden>Menu</button>`
  - `<div class="admin-nav__sections" id="admin-nav-sections">` wrapping all existing titles and lists, including both branches of the `subpage.section` conditional.
  - The button must be the immediately preceding sibling of the wrapper (the CSS uses `+`).
- CSS, narrow (base) rules in the "Admin sidebar navigation" block:
  - `.admin-nav__toggle`: full-width block row, `text-align: start`, no background, no border except a transparent 2px left border, the same `padding-block`, `padding-inline`, `line-height`, and `color` as `.admin-nav__link`, `cursor: pointer`, and `--weight-semibold` (or the title's weight) so it reads as a control. Font is inherited via `reset.css`.
  - `.admin-nav__toggle:hover` and `:focus-visible` mirror the link rules (accent left border, `--color-surface-sunken` background, `--color-ink-link` text); `:focus-visible` adds the same `outline: 2px solid var(--color-focus-outline); outline-offset: -2px;`. Prefer adding the toggle selectors to the existing link selector lists over duplicating declarations.
  - `.admin-nav__toggle[aria-expanded="false"] + .admin-nav__sections { display: none; }`.
  - When open, give the first list a little separation from the toggle with an existing `--space-*` token if it looks cramped; keep it small.
- CSS, inside the existing nav `@media (min-width: 52rem)` block: `.admin-nav__toggle { display: none; }` and `.admin-nav__toggle[aria-expanded="false"] + .admin-nav__sections { display: block; }` (equal specificity, later in source than the base rules). Do not change the existing sticky inner, borders, or padding.
- Update the nav block's header comment to say that below the breakpoint the lists collapse behind the Menu toggle, that `aria-expanded` drives visibility, that the toggle ships `hidden` until `site.js` enables it (so no-JS pages stay fully expanded), and that the wide layout ignores the toggle state.
- JavaScript, a new IIFE appended to `site.js` with a one-line `// Set up ...` comment matching the others:
  - For each `[data-js-behavior="admin-nav-toggle"]`: look up `document.getElementById(toggle.getAttribute('aria-controls'))`. If missing, `console.warn` and skip that toggle (it stays `hidden`).
  - Otherwise set `aria-expanded="false"`, remove `hidden`, and on `click` flip `aria-expanded` between `"true"` and `"false"`.
  - No `localStorage`, no resize or `matchMedia` handling (the wide layout ignores the state and the toggle is `display: none` there), no focus moves, no Escape handling (this is a disclosure, not a modal).
- Docs: in `lib/app/presentation/README.md`, next to the existing `admin-nav.html` paragraphs, state that section links go inside `.admin-nav__sections` and that below 52rem the nav collapses behind the Menu toggle (`admin-nav-toggle` behavior in `site.js`).

**Expected touch points**

- `lib/templates/partials/admin-nav.html` — toggle button and wrapper.
- `lib/static-assets/stylesheets/lib/admin-shell.css` — toggle, collapse, wide override, header comment.
- `lib/static-assets/javascript/site.js` — `admin-nav-toggle` IIFE.
- `lib/app/presentation/README.md` — short note on wrapper and collapse.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Rendered admin pages contain exactly one `data-js-behavior="admin-nav-toggle"` button, with `type="button"`, `aria-controls="admin-nav-sections"`, `aria-expanded="true"`, and `hidden` in the server HTML, immediately followed by `<div class="admin-nav__sections" id="admin-nav-sections">`.
- [x] All existing nav titles, lists, links, and conditionals are inside the wrapper and otherwise unchanged (`git diff` of the partial shows only the added lines and re-indentation).
- [x] `.admin-layout.with-sidebar` still has exactly two children; `admin.html` and `layout.css` are unchanged.
- [x] Below 52rem with JavaScript: on load the button is visible, `aria-expanded="false"`, lists hidden; clicking or pressing Enter/Space toggles the lists and `aria-expanded`. (verified by code review; operator confirmed in a browser 2026-10-17)
- [x] At 52rem and wider with JavaScript: the button is not displayed and the lists are shown regardless of `aria-expanded`; sidebar layout, sticky inner, and borders look as before. (verified by code review; operator confirmed in a browser 2026-10-17)
- [x] With JavaScript disabled at any width: no button is visible and the nav is fully expanded, as today. (verified by code review; operator confirmed in a browser 2026-10-17)
- [x] The toggle's hover and keyboard focus-visible styles match `.admin-nav__link` (accent left border, sunken background, focus outline). (verified by code review; operator confirmed in a browser 2026-10-17)
- [x] A missing `aria-controls` target logs a warning and leaves that toggle hidden without throwing.
- [x] CSS uses semantic tokens only, follows the formatting rules, and adds no new breakpoint value.
- [x] `lib/app/presentation/README.md` and the `admin-shell.css` nav header comment describe the new structure.

**Validation**

- `node lib/run-linter.js lib/static-assets/javascript` — browser JavaScript passes lint (no new globals).
- `node lib/run-linter.js lib` — whole library still lints.
- `node lib/run-tests.js` — full unit suite still passes (includes the content-store scanner tests that read `static-assets/`).
- `node devkit/run-tests.js devkit/test/conformance` — bundling and scanning of `lib/` still pass with the changed static assets.
- `grep -n 'admin-nav-toggle\|admin-nav-sections' lib/templates/partials/admin-nav.html lib/static-assets/javascript/site.js lib/static-assets/stylesheets/lib/admin-shell.css` — hook and id appear in partial and JS; class rules appear in CSS.
- `grep -nE 'palette-|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' lib/static-assets/stylesheets/lib/admin-shell.css` — prints nothing (no palette tokens or literal colors).
- `git diff --stat lib/templates/base/admin.html lib/static-assets/stylesheets/lib/layout.css` — prints nothing.
- Unit test coverage: none added (no browser-JS harness; see routine choices).
- Manual: if the agent has a local admin session, perform the Operator Runbook browser checks; otherwise leave them to the operator and say so in the handoff.

**Progress and handoff**

- Completed: T1 implemented. Toggle and `.admin-nav__sections` wrapper in the partial; toggle, collapse, and wide-override CSS plus updated nav header comment; `admin-nav-toggle` IIFE at the end of `site.js`; one-paragraph note in the presentation README.
- Current state: Complete. Operator ran the Operator Runbook browser checks on 2026-10-17; all passed.
- Remaining: Only the pre-release test-app e2e run in the Operator Runbook.
- Decisions and discoveries:
  - The base `.admin-nav__toggle` rule and the collapse rule sit between `.admin-nav__inner` and the nav `@media` block, so the wide overrides inside the media block come later in source. The toggle is not added to the `.admin-nav__link` base selector list, because that rule follows the media block and its `display: block` would beat the wide `display: none`. Hover, focus-visible, and outline rules are shared via the existing link selector lists.
  - No open-state spacing between the toggle and the first list: a rule keyed on `aria-expanded="true"` would also match the hidden server markup and change the no-JS layout. The toggle's own padding separates them.
  - Review found an empty band (~300px) under the collapsed nav below 52rem. `.admin-layout` is `flex-wrap: wrap` and fills the viewport (`body:has(> .admin-layout)` flex column plus `flex: 1 1 auto`), so its two wrapped flex lines shared the leftover height (`align-content: normal` acts as stretch). The expanded nav had always hidden this. Fix in `admin-shell.css`: `align-content: flex-start` on base `.admin-layout`, `align-content: stretch` in its 52rem rule (keeps the full-height divider), plus a note in the "Admin layout" header comment. `layout.css` unchanged.
  - `reset.css` sets `button { font: inherit; }`; the toggle's own `font-weight` overrides it.
  - The plan's grep for `admin-nav-toggle\|admin-nav-sections` matches only the partial and `site.js`; the CSS uses the BEM classes `.admin-nav__toggle` / `.admin-nav__sections`, as designed. `site.js` reads the target id from `aria-controls` rather than hard-coding it.
- Actual files changed: `lib/templates/partials/admin-nav.html`, `lib/static-assets/stylesheets/lib/admin-shell.css`, `lib/static-assets/javascript/site.js`, `lib/app/presentation/README.md`.
- Validation run:
  - `node lib/run-linter.js lib/static-assets/javascript` and `node lib/run-linter.js lib`: pass.
  - `node lib/run-tests.js`: 1978 tests, pass.
  - `node devkit/run-tests.js devkit/test/conformance`: 25 tests, pass.
  - Hook/id grep: partial lines 3-4, `site.js` line 941. Palette/literal-color grep: no output. `git diff --stat` of `admin.html` and `layout.css`: no output.
  - `git diff -w` of the partial: only the button, wrapper open, and wrapper close lines added.
  - Rendered the partial with the vendored template engine (scratch script `tmp/render-admin-nav.mjs`) for `/admin` and `/admin/style-guide`: one toggle, `hidden` with `aria-expanded="true"`, immediately followed by the wrapper; balanced divs; `aria-current` intact.
  - Layout fix: `node lib/run-linter.js lib` passes; `node lib/run-tests.js` 1978 tests pass. Static preview (`tmp/nav-preview/`, partial plus real stylesheets and `site.js`, no admin session): at 375x812 with JS, `.admin-nav` 71px (was 368), main starts at 124px, toggle collapsed and visible, opens to 841px on click; at 1200x812, toggle `display: none`, sections shown, nav and main both 812px tall (`align-content: stretch`); no-JS at 375, toggle not displayed and nav fully expanded.
  - Browser checks with a real admin session: run by the operator on 2026-10-17; passed.
- Blockers: None.

---

Operator Runbook
----------------

Run after T1 is complete. Requires a local admin session. Browser checks completed by the operator on 2026-10-17.

- [x] From `lib/`, run `node node-server.js` (port 2026) and sign in as an admin.
- [x] Narrow viewport (about 360px, and just under 52rem, about 830px at default font size), open `http://localhost:2026/admin`: the nav shows only "Menu"; content starts near the top. Click Menu: lists appear and push content down; click again: they hide. Reload: closed again.
- [x] Keyboard at narrow width: Tab reaches Menu with the same focus outline and accent as nav links; Enter and Space toggle; Tab continues into the links when open. A screen reader (VoiceOver) announces "Menu, collapsed/expanded, button".
- [x] Wide viewport (>= 52rem): no Menu button; sidebar, right rule, and sticky nav look exactly as before. Resize from narrow (closed) to wide: lists are visible; resize back: closed state resumes.
- [x] Repeat the narrow check on `/admin/style-guide` (style-guide branch of the nav) and on one section page (e.g. `/admin/files`) to confirm `aria-current` highlighting is intact when opened.
- [x] Disable JavaScript in the browser and reload at narrow and wide widths: no Menu button; nav fully expanded as before.
- [x] Check light and dark themes.
- [ ] Before a release: `node tools/build-test-app.js`, then run the test-app e2e suite per `test-app/README.md`.
