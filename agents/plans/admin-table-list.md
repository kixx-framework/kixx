Admin Table List
================

Add a reusable "table list" component (`.table-list`) and a status badge component (`.status-badge`) to the shared component stylesheet, define the missing `.button--secondary` style, and document all three in the admin style guide. Then convert four admin list pages from stacked cards to scannable tables: `/admin/files`, `/admin/invites`, `/admin/publishing-api-tokens`, and `/admin/admin-data-api-tokens`. The files table gains "Type" and "Uploaded" columns, which requires two new fields on the files listing row. Everything else about these pages (create forms, one-time secret callouts, empty states, pagination, page sizes) stays as it is.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **CSS block plus copyable markup, not a shared template partial.** Every existing admin component is a CSS block whose markup is copied from the style guide, and the template engine has no partial parameters. The component is a new BEM block on a semantic `<table>` in `lib/static-assets/stylesheets/lib/components.css`, with the standard section documentation header.
2. **Narrow screens scroll horizontally inside a wrapper.** No breakpoint and no stacked-row layout. This is the simplest option and matches the project's breakpoint-free intrinsic layout convention. The scroll wrapper must be keyboard-accessible: a focusable region with an accessible name.
3. **A shared status badge component shows row status.** Statuses: `active`, `revoked`, `pending`, `expired`, `consumed` (invites), `published`, `unpublished`. It uses semantic `--color-*` tokens only, and the state must read without color (the text label carries the state).
4. **The files table gains "Uploaded" and "Type" columns.** "Uploaded" renders `originalUploadedAt` with `formatDate ... format="DATETIME_MED"`; "Type" renders `contentType`. This requires extending `decorateFileRow` in `admin-files.js` and its unit test.
5. **Define `.button--secondary`.** It is already used on the files, invites, token, login, and user pages and on pagination, but has no rule. Document it on the existing Buttons style-guide page.
6. **One new style-guide page, "Table Lists", documents both the table list and the status badge.** Path `lib/pages/admin/style-guide/table-lists/`, canonical section order (intro, Anatomy, Variants, Usage, Accessibility, Guidelines; no States, since the component itself is static). Add a nav link, a mention on the style-guide introduction page, and the component list in `lib/docs/frontend-development-guide.md`.
7. **Out of scope:** sorting, filtering, search, shared partials, page-size changes, changes to create forms, one-time secret callouts, empty-state copy, and pagination markup.

### Routine choices made by the planner (from project conventions)

These are not operator decisions; a later agent may revise them with a recorded reason.

- **Class names:** `.table-list` (scroll wrapper block), `.table-list__table`, `.table-list__caption`, `.table-list__actions` (action cell). Secondary muted text in a cell reuses the existing `.type-caption` utility (`lib/static-assets/stylesheets/lib/typography.css`, caption size plus `--color-ink-muted`) on a `<div>`; do not add a `__note` element. `.status-badge` with tone modifiers `--success`, `--info`, `--warning`, `--danger`. Tone names follow the semantic `--color-status-*` tokens and `.button--danger`.
- **Status-to-tone mapping:** `active` and `published` are success; `pending` is info; `expired` is warning; `revoked` is danger; `consumed` and `unpublished` use the neutral default badge.
- **No glyph in the badge.** Callout glyphs (`[x]`, `[i]`, `[!]`) are `aria-hidden` tone reinforcement on a block notice. The badge's visible text label already carries the state without color, and adding a glyph per status would invent a new glyph vocabulary. Tone rides a graphical mark only (border or marker); badge text stays `--color-ink`, matching the callout contrast rule.
- **Badge text is the status value as rendered today.** Invites and tokens render the raw lowercase `status` value (this also keeps the e2e contract that the word `revoked` appears in the data-token page HTML). Files render "Published" / "Unpublished" as today. No CSS `text-transform`.
- **The wrapper is always focusable** (`tabindex="0"`, `role="region"`, `aria-labelledby` the caption). No JavaScript detects overflow; the extra tab stop on a non-overflowing table is the accepted cost of a JS-free, progressive-enhancement page.
- **Every table has a visible `<caption>`** that names the list (it is the region's and table's accessible name). There is no visually-hidden utility in the project, and adding one is not needed for this work.
- **Existing button classes on row actions are kept** (`button button--secondary` for Manage and Revoke, plain `button` for Publish/Unpublish). Changing Revoke to `button--danger` would be a product change and is not requested.

### Cross-cutting constraints

- **Contracts that must not break** (asserted by unit tests and the test-app e2e suite):
  - Handler prop names stay `files`, `invites`, `tokens`, `csrf` (files), and `form.csrf` (other pages). Do not rename or reshape existing row fields.
  - Files listing: exactly one `<form>` per row whose `action` matches `/admin/files/<uuid>/(publish|unpublish)` (`test-app/test/100-admin-files/helpers.js` `getListingRows`). No other form on the page may use those actions.
  - Pagination anchors keep the exact text "Next page" / "Previous page", and the `{{#if showPagination}}` block stays outside the list conditional, unchanged.
  - Invites and token pages: one hidden `invite_id` / `token_id` input per revocable row only (pending invites, active tokens), and none elsewhere.
  - Data-token page: the substring `files: list, get` must appear contiguously in the HTML, so `{{ grant.type }}: {{ grant.actions }}` stays on one line with no markup or whitespace change between the parts. The word `revoked` must appear for a revoked token.
  - `#new-token`, `#new-invite-url`, and the form-expired callout text are untouched.
- **Frontend rules** (`lib/docs/frontend-development-guide.md`): no inline `style` attributes; component rules read semantic `--color-*` tokens only (never `--palette-*` or literals); BEM, one block per section with the standard documentation header; CSS formatting rules (four-space indent, one declaration per line, expanded blocks); components never set their own outer margin (parents space them with `.flow`); prefer existing tokens (`--space-*`, `--text-body-sm` for dense cells, `--text-caption`, `--color-rule`, `--color-rule-strong`, `--color-surface-sunken`, `--color-ink-muted`, `--color-status-*`, `--color-focus-outline`, `--hairline-width`, `--radius-*`).
- **Style-guide `body.html` files are included verbatim** — `{{ }}` is not processed. Use HTML entities, and put copyable markup in `<pre class="code-block"><code>` with escaped `&lt;` / `&gt;`.
- **No browser JavaScript** is needed or added.
- **No CSS or HTML linter exists.** CSS and templates are verified by the static checks in each task and by review. Run the JavaScript linter only on changed JavaScript.
- **Commands run from the repo root** (`/Users/kris/Documents/kixx`): `node lib/run-tests.js <path>` and `node lib/run-linter.js <path>`. Do not run the test-app e2e suite as agent validation; it is in the operator runbook.
- **Admin pages require an admin session.** Visual checks of the four list pages and the style guide are operator runbook items unless the implementing agent already has a local dev admin session. Do not create accounts or enter credentials to get one.
- Related plan: `agents/plans/remove-admin-publishing-pages.md` (complete) removed `/admin/publishing*` and left `/admin/publishing-api-tokens` intact. No conflict.

---

### Task T1: Define and document `.button--secondary`

**Status:** Complete
**Depends on:** None
**Documentation:** `lib/docs/frontend-development-guide.md` (Components and Forms; CSS Formatting; color rules); Buttons section header in `components.css`

**Objective**

`.button--secondary`, already used across admin, login, and user pages, gets a real rule: a lower-emphasis variant of `.button`. It is documented on the Buttons style-guide page. This is a self-contained styling fix with its own documentation, independent of the table work.

**Scope**

- In: the `.button--secondary` rule(s) in the Buttons section of `components.css`, the section header's modifier list, and the Buttons style-guide page (Variants tile, States demo, Usage snippet, Guidelines).
- Out: changing which buttons use the modifier on any page (no markup changes outside the style guide); table and badge components (T2).

**Design and invariants**

- Lower visual emphasis than the default `.button`, achieved through the border color: `--color-ink-muted` border with `--color-ink` text on `--color-bg`. Keep the size, radius, and border width of `.button`.
- Keep the shared hover inversion from `.button:not(:disabled):hover` (do not override it) and the shared focus ring.
- It must remain distinguishable from `.button:disabled`, which uses a muted border and muted text. Secondary keeps ink text. Confirm that `.button:disabled` still wins over the secondary rule for a disabled secondary button (source order or specificity).
- Semantic tokens only. The border must clear 3:1 non-text contrast against `--color-bg` in both themes; `--color-ink-muted` is already used as text, so it does.
- Use the existing CSS formatting and comment style; add the modifier to the Buttons header list ("`.button--secondary` muted outline — a lower-emphasis action such as a row action or pagination").

**Expected touch points**

- `lib/static-assets/stylesheets/lib/components.css` — the rule and header comment.
- `lib/pages/admin/style-guide/buttons/body.html` — a Variants tile, a secondary button in the States demo, a Usage line, and a Guidelines bullet (for example: use it for repeated per-row actions and pagination; keep one primary action per view).

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `.button--secondary` is defined in the Buttons section and listed in its header comment.
- [x] Hover inverts to the ink fill like every button; focus-visible shows the shared ring; disabled secondary buttons render as disabled.
- [x] The Buttons style-guide page shows the variant in Variants, States, Usage, and Guidelines, with escaped markup in the code block.
- [x] No `--palette-*` reference or color literal in the new rule.

**Validation**

- `grep -n "button--secondary" lib/static-assets/stylesheets/lib/components.css lib/pages/admin/style-guide/buttons/body.html` — the rule, header entry, and documentation exist.
- `grep -n "palette\|#[0-9a-fA-F]\{3,6\}\b\|rgb(\|hsl(" lib/static-assets/stylesheets/lib/components.css` — prints nothing (no raw colors in component rules).
- `grep -rn 'style="' lib/pages lib/templates` — prints nothing.
- Manual (operator runbook if no session): `/admin/style-guide/buttons` in light and dark themes; tab to a secondary button for the focus ring; hover for inversion.

**Progress and handoff**

- Completed: `.button--secondary` rule and header entry; Buttons style-guide Variants tile, States demo and state text, Usage snippet, Do/Don't bullets.
- Current state: Complete.
- Remaining: Manual light/dark, focus, and hover check on `/admin/style-guide/buttons` (Operator Runbook; no admin session available to the agent).
- Decisions and discoveries: The rule sets only `border-color: var(--color-ink-muted)`; ink text and `--color-bg` come from `.button`. It sits after the danger rule and before `.button:disabled`, so disabled (equal specificity, later) wins; the shared hover (`.button:not(:disabled):hover`, higher specificity) still inverts. Variants lede now says "Four shipped variants."
- Actual files changed: `lib/static-assets/stylesheets/lib/components.css`, `lib/pages/admin/style-guide/buttons/body.html`.
- Validation run: `grep -n "button--secondary" ...` shows rule (components.css:126), header (:61), and six style-guide lines; palette/literal-color grep prints nothing; `style="` grep prints nothing.
- Blockers: None.

---

### Task T2: Add the table list and status badge components with their style-guide page

**Status:** Complete
**Depends on:** None
**Documentation:** `lib/docs/frontend-development-guide.md` (Follow the Style Guide; When to Add What; Composition; BEM; CSS Comments); per-component documentation template comment in `lib/static-assets/stylesheets/lib/admin-style-guide.css` (~lines 210-220)

**Objective**

`components.css` gains two documented blocks: `.table-list`, a dense, hairline-ruled data table inside a horizontally scrolling, keyboard-focusable wrapper; and `.status-badge`, a compact inline status label with tone modifiers. A new "Table Lists" style-guide page documents both with live examples and copyable markup, and the nav, style-guide introduction, and frontend guide point to it. After this task the pages in T3 and T4 have a complete, documented pattern to copy.

**Scope**

- In: both CSS blocks; `lib/pages/admin/style-guide/table-lists/` (page.html, page.json, body.html, and page.css only if page-local demo tuning is needed); the Components nav link; the introduction page mention; the frontend guide's component list.
- Out: `.button--secondary` (T1); converting any admin list page (T3, T4).

**Design and invariants**

- **Markup contract** (document it in the section header and the Usage snippet):

  ```html
  <div class="table-list" role="region" tabindex="0" aria-labelledby="files-caption">
      <table class="table-list__table">
          <caption id="files-caption" class="table-list__caption">Files</caption>
          <thead>
              <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  ...
                  <th scope="col">Actions</th>
              </tr>
          </thead>
          <tbody>
              <tr>
                  <th scope="row"><a href="...">Quarterly report</a><div class="type-caption">report.pdf</div></th>
                  <td><span class="status-badge status-badge--success">Published</span></td>
                  ...
                  <td class="table-list__actions"><div class="cluster">...buttons/forms...</div></td>
              </tr>
          </tbody>
      </table>
  </div>
  ```

  The caption `id` must be unique per page. The row header (`th scope="row"`) is the cell that best identifies the row.
- **Wrapper (`.table-list`):** `overflow-x: auto`; a visible `:focus-visible` outline using `--color-focus-outline`, matching `.button:focus-visible` (2px, offset 2px); no outer margin. Whether the wrapper draws a hairline border and radius like a card is a design choice; if it does, it uses `--hairline-width`, `--color-rule`, and `--radius-md`.
- **Table:** `width: 100%`; `border-collapse: collapse`; cell text `--text-body-sm`; cell padding from `--space-*`; `text-align: start`; `vertical-align: top` (or baseline) so multi-line cells align. Header row: `--text-caption`, semibold, `--color-ink-muted` text, bottom rule `--color-rule-strong`. Body rows: hairline bottom rule `--color-rule`. Row headers in the body use body weight or a modest semibold, not caption styling. No zebra striping, no row hover (the block is static; interactive states belong to the buttons and links inside it).
- **Width behavior:** the badge and actions cell do not wrap (`white-space: nowrap` in `.status-badge` and `.table-list__actions`; add no other cell classes); dates and sizes may wrap like any cell; free-text cells (title, description, type, user id) may wrap but keep a sensible minimum width so the table scrolls instead of crushing text. Long unbroken tokens (UUIDs, MIME types) must not force the page itself to scroll horizontally; only the wrapper scrolls.
- **`.table-list__caption`:** left-aligned (`caption-side: top`, `text-align: start`), caption type role, with spacing below it. It names the list and is the region's accessible name.
- **`.table-list__actions`:** a cell holding a `.cluster` of buttons and inline forms; no wrapping, so actions stay on one line.
- **`.status-badge`:** an inline-block label with compact padding, `--text-caption`, medium or semibold weight, `--color-ink` text, a hairline box in `--color-rule`, `white-space: nowrap`, and a tone marker (a heavier left border, as on callouts) in `--status-badge-accent`. Copy the `.callout` accent pattern in `components.css` (`--callout-accent` default plus one-line tone modifiers) rather than inventing a new one. Default accent is `--color-ink-muted` (neutral). Modifiers set only the accent: `--success` (`--color-status-success`), `--info` (`--color-ink-link`), `--warning` (`--color-status-warning`), `--danger` (`--color-status-danger`). Tone never lands on the text. It is usable outside tables.
- Both blocks get the standard section header: purpose, when to use, markup structure, elements, modifiers, exposed custom properties, and accessibility notes (region, tabindex, caption, scope, color-independent status).
- **Style-guide page:** model on `lib/pages/admin/style-guide/cards/` and `callouts/`. `page.json` uses `"template": "page.html"`, `subpage.title` "Table Lists", and `includes.body` (plus `includes.page_stylesheet` only if `page.css` exists). `page.html` is `{{>admin/style-guide-wrapper.html}}`. Sections in order:
  - Intro prose: what it is, when to use it (a list of records with several comparable fields and per-row actions), and when not to (a few items with free-form content are better as cards).
  - Anatomy: a live demo table with a numbered parts list (wrapper, caption, header row, row header, cells, `.type-caption` secondary line, badge, actions cell).
  - Variants: the five badge tones with the status words each maps to (see Routine choices), as live examples. The table itself has no modifiers, so it has no table variants.
  - Usage: escaped copyable markup for a table and for a badge.
  - Accessibility: region plus tabindex plus caption for the scroll wrapper; `scope` on headers; status read from text, not color; repeated action labels ("Manage", "Revoke") get their row context from the row header, so keep labels short and the row header meaningful.
  - Guidelines: Do / Don't cards.

  Live demo data must be static HTML with realistic sample values (no template syntax).
- Nav: add `<li>` for `/admin/style-guide/table-lists` labelled "Table Lists" at the end of the Components list in `admin-nav.html`, using the same `ifEqual pathname` `aria-current` pattern.
- Introduction page: add a "Table Lists" link to the "3. Copy the pattern" card list in `lib/pages/admin/style-guide/body.html`.
- Frontend guide: add `table-lists/` to the "Components:" list (~line 74).

**Expected touch points**

- `lib/static-assets/stylesheets/lib/components.css` — the `.table-list` and `.status-badge` sections, appended after Callouts.
- `lib/pages/admin/style-guide/table-lists/page.html`, `page.json`, `body.html` (new), and `page.css` (optional).
- `lib/templates/partials/admin-nav.html` — Components nav link.
- `lib/pages/admin/style-guide/body.html` — introduction mention.
- `lib/docs/frontend-development-guide.md` — component list.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `.table-list` (with its elements) and `.status-badge` (with four tone modifiers) are defined in `components.css` with standard documentation headers, semantic tokens only, and no outer margins.
- [x] A table wider than its container scrolls inside the wrapper; the page itself never scrolls horizontally; the wrapper is reachable by Tab and shows a focus ring.
- [x] `/admin/style-guide/table-lists` renders with the canonical section order and shows live examples of the table and every badge tone.
- [x] The nav link shows `aria-current="page"` on that page; the introduction page and frontend guide mention the component.
- [x] Usage markup in `body.html` is escaped and contains no template syntax.

**Validation**

- `grep -n "Table list\|Status badge\|\.table-list\|\.status-badge" lib/static-assets/stylesheets/lib/components.css` — both blocks and their headers exist.
- `grep -n "palette\|#[0-9a-fA-F]\{3,6\}\b\|rgb(\|hsl(" lib/static-assets/stylesheets/lib/components.css` — prints nothing.
- `grep -rn 'style="' lib/pages lib/templates` — prints nothing.
- `grep -n "{{" lib/pages/admin/style-guide/table-lists/body.html` — prints nothing.
- `grep -n "table-lists" lib/templates/partials/admin-nav.html lib/pages/admin/style-guide/body.html lib/docs/frontend-development-guide.md` — all three references exist.
- `node -e "JSON.parse(require('fs').readFileSync('lib/pages/admin/style-guide/table-lists/page.json','utf8'))"` — page.json is valid JSON.
- Manual (operator runbook if no session): with `node node-server.js` running from `lib/` (port 2026), open `http://localhost:2026/admin/style-guide/table-lists` in light and dark themes; narrow the viewport to about 360px and confirm the demo table scrolls within its wrapper; Tab to the wrapper and confirm the focus ring; `http://localhost:2026/admin/style-guide/table-lists.json` shows the included body.

**Progress and handoff**

- Completed: `.table-list` (wrapper, `__table`, `__caption`, `__actions`) and `.status-badge` (neutral plus `--success`, `--info`, `--warning`, `--danger`) appended after Callouts in `components.css`, each with a standard header; "Table Lists" style-guide page (intro, Anatomy, Variants, Usage, Accessibility, Guidelines); nav link; introduction mention; frontend guide and doc index lists.
- Current state: Complete. Rendered-page checks behind admin sign-in (nav `aria-current`, `.json` include, dark theme, keyboard focus ring) are left to the Operator Runbook; no admin session was available.
- Remaining: Nothing for T2. T3 and T4 can copy the Usage markup on the page.
- Decisions and discoveries:
  - Wrapper draws a card-like box: hairline `--color-rule` border, `--radius-md`, `--color-bg` fill (so it lifts off the sunken demo stage). Last body row drops its bottom rule since the wrapper draws the edge.
  - Caption uses the caption size, semibold, in `--color-ink` (not muted) so it reads as the list's name above the muted column headers.
  - Cells: `--space-2xs` block / `--space-xs` inline padding, `vertical-align: top`, `min-inline-size: 6rem`; body row headers `min-inline-size: 12rem` and medium weight. Header cells are `nowrap`. Long unbroken tokens widen the table and the wrapper scrolls.
  - `.table-list__actions > .cluster` sets `flex-wrap: nowrap` in addition to `white-space: nowrap` on the cell, since `.cluster` wraps by default.
  - Badge: `--color-surface-sunken` fill, `--radius-sm`, 3px left marker in `--status-badge-accent`, `0.125rem` block padding (no smaller space token exists).
  - Added `page.css` to stretch the live table to the full `.demo-stage` width (the stage is a centered flex row).
  - Also updated `lib/docs/doc-index.md`, which lists style-guide component pages.
  - Scratch render check (`tmp/table-list-check.html`, real stylesheets inlined, no admin shell): at 360px the document `scrollWidth` equals the viewport (360) while the wrapper scrolls (client 276, scroll 869). The admin shell's content track sets an explicit `min-inline-size`, so table width cannot widen it.
- Actual files changed: `lib/static-assets/stylesheets/lib/components.css`; `lib/pages/admin/style-guide/table-lists/page.json`, `page.html`, `page.css`, `body.html` (new); `lib/templates/partials/admin-nav.html`; `lib/pages/admin/style-guide/body.html`; `lib/docs/frontend-development-guide.md`; `lib/docs/doc-index.md`.
- Validation run: block/header grep finds both sections (components.css:278, :398) and all elements and modifiers; palette/literal-color grep, `style="` grep, and `{{` grep on body.html print nothing; `table-lists` found in nav, intro, and frontend guide; page.json parses; `node lib/run-tests.js` passes 1833 tests.
- Blockers: None.

---

### Task T3: Convert the files listing to a table list with Type and Uploaded columns

**Status:** Not started
**Depends on:** T2
**Documentation:** Table Lists style-guide page and `components.css` headers from T2

**Objective**

`/admin/files` renders its rows as a `.table-list` table with title, status badge, type, size, upload date, and row actions, instead of a grid of cards. The listing handler exposes `contentType` and `originalUploadedAt` on each row so the template can render the new columns. Handler and template change together because the template depends on the new fields.

**Scope**

- In: `decorateFileRow` and its comment; the listing unit test; the list markup in `lib/pages/admin/files/page.html` between `{{#if files}}` and `{{else}}`.
- Out: the upload button, empty state, pagination block, file detail page, and any other handler.

**Design and invariants**

- `decorateFileRow` adds `contentType: file.content.contentType` and `originalUploadedAt: file.originalUploadedAt`. Existing fields keep their names and values. `decorateFileDetail` is unchanged.
- Columns, in order: **Title** (`th scope="row"`: link `file.links.detail` with `file.displayTitle`, plus `<div class="type-caption">` with `file.filename`), **Status** (badge: `status-badge status-badge--success` "Published" when `file.isPublished`, else neutral `status-badge` "Unpublished"), **Type** (`file.contentType`), **Size** (`file.sizeLabel`), **Uploaded** (`{{ formatDate file.originalUploadedAt format="DATETIME_MED" }}`), **Actions** (`table-list__actions` cell with a `.cluster` holding the existing "Manage" link and the existing publish or unpublish form, unchanged).
- Caption "Uploaded files" or "Files" (unique `id`, for example `files-caption`), with the wrapper's `aria-labelledby` pointing at it.
- Exactly one publish or unpublish `<form>` per row, with the same `action` values and the same top-level `csrf` hidden input. The row `<h2>` goes away (the row header replaces it); this is acceptable because no test reads it.
- Keep the pagination block and its explanatory comment byte-for-byte outside the list conditional.

**Expected touch points**

- `lib/app/presentation/request-handlers/admin-panel/admin-files.js` — `decorateFileRow` (~lines 262-271).
- `lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-files.test.js` — assert `row.contentType === 'application/pdf'` and `row.originalUploadedAt === '2024-01-01T00:00:00.000Z'` (the fixture defaults) in the "Admin file listing" test.
- `lib/pages/admin/files/page.html` — the table markup.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] Listing rows include `contentType` and `originalUploadedAt`; the unit test asserts both.
- [ ] `/admin/files` renders a `.table-list` table with the six columns above, a captioned focusable region, and status badges.
- [ ] Exactly one publish or unpublish form per row with unchanged actions and CSRF input; pagination markup and placement are unchanged; the empty state is unchanged.

**Validation**

- `node lib/run-tests.js lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-files.test.js` — handler row shape, including the new fields.
- `node lib/run-tests.js` — full unit suite passes.
- `node lib/run-linter.js lib/app/presentation/request-handlers/admin-panel/admin-files.js lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-files.test.js` — no lint errors.
- `grep -c 'method="POST"' lib/pages/admin/files/page.html` — prints 2 (the publish and unpublish branches; one renders per row).
- `grep -n "Next page\|Previous page\|showPagination" lib/pages/admin/files/page.html` — pagination still present after the list's `{{/if}}`.
- Manual (operator runbook if no session): `http://localhost:2026/admin/files` with a few files, light and dark, at about 360px width; publish and unpublish one row.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: Convert the invites and both API token listings to table lists

**Status:** Not started
**Depends on:** T2
**Documentation:** Table Lists style-guide page and `components.css` headers from T2

**Objective**

`/admin/invites`, `/admin/publishing-api-tokens`, and `/admin/admin-data-api-tokens` render their rows as `.table-list` tables with status badges. The three pages share the same row shape (status, a describing field, created date and creator, expiry, and a conditional revoke form), so converting them together keeps their markup parallel. The data-token page adds a grants column and carries extra e2e text contracts (below). Template-only; no handler changes. This task absorbs the former T5.

**Scope**

- In: the list markup between `{{#if invites}}` / `{{#if tokens}}` and `{{else}}` in the three page templates.
- Out: create forms, `#new-invite-url` and `#new-token` callouts, form-expired callouts, empty states, pagination, and handlers.

**Design and invariants**

- **Invites columns:** **Created** (`th scope="row"`, `formatDate invite.createdAt format="DATETIME_MED"`), **Status** (badge), **Grants** (`{{ invite.roles }}`, rendered only `{{#if invite.roles}}`; otherwise an empty cell), **Created by** (`invite.createdBy`), **Expires** (`formatDate invite.expiresAt format="DATETIME_MED"`), **Actions** (the existing revoke form only `{{#ifEqual invite.status "pending"}}`; otherwise an empty cell). Caption "Invites".
- **Publishing token columns:** **Description** (`th scope="row"`; `token.description` or "No description provided." as today), **Status** (badge), **Created** (date), **Created by** (`token.createdBy`), **Expires** (date), **Actions** (the existing revoke form only `{{#ifEqual token.status "active"}}`). Caption "Tokens".
- **Badge tone** is chosen in the `class` attribute with `ifEqual`, for example `class="status-badge{{#ifEqual invite.status "pending"}} status-badge--info{{/ifEqual}}{{#ifEqual invite.status "expired"}} status-badge--warning{{/ifEqual}}{{#ifEqual invite.status "revoked"}} status-badge--danger{{/ifEqual}}"`, with `consumed` as neutral. Tokens: `active` success, `expired` warning, `revoked` danger. The badge text is `{{ invite.status }}` / `{{ token.status }}`.
- Revoke forms keep their `action`, `form.csrf` hidden input, hidden `invite_id` / `token_id` input, and button classes. The form's own `cluster` class may move to an action-cell wrapper, as in T2's markup. Exactly one hidden id input per revocable row, and none elsewhere.
- Keep each page's pagination block and its comment unchanged and outside the list conditional. Keep the template comments that explain the revoke form and bootstrap invites without roles, moved next to the markup they describe.
- Each page has one table; caption `id`s are unique on the page.
- **Data token columns:** the publishing token columns plus **Grants** after Status, and **Expiry** in place of Expires. Grants is a `<ul class="flow list-unstyled">` in the cell, one `<li>` per grant, preserving today's two branches exactly: `{{ grant.collection }} (no longer exposed): {{ grant.actions }}` when `grant.isRetired`, else `{{ grant.type }}: {{ grant.actions }}`. Expiry cell text is `Revoked {date}` when `token.revokedAt`, else `Expires {date}`, as today. Caption "Tokens".
- Each grant expression stays on a single line with nothing between `{{ grant.type }}`, `: `, and `{{ grant.actions }}`, so `files: list, get` appears contiguously. The badge text `{{ token.status }}` keeps the word `revoked` in the HTML for revoked tokens.

**Expected touch points**

- `lib/pages/admin/invites/page.html` — table markup (~lines 84-118).
- `lib/pages/admin/publishing-api-tokens/page.html` — table markup (~lines 91-123).
- `lib/pages/admin/admin-data-api-tokens/page.html` — table markup (~lines 125-174).

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] All three pages render `.table-list` tables with the columns above, captioned focusable regions, and tone-mapped status badges whose text is the raw status.
- [ ] Revoke forms render only for pending invites and active tokens, with unchanged action, CSRF, and hidden id fields.
- [ ] Data-token grant lines render exactly as before, including the retired-collection branch; `Revoked`/`Expires` logic is unchanged.
- [ ] Create forms, secret callouts, empty states, and pagination are unchanged.

**Validation**

- `node lib/run-tests.js lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-invites.test.js lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-publishing-api-tokens.test.js lib/test/unit-tests/app/presentation/request-handlers/admin-panel/admin-data-api-tokens.test.js` — handler props unchanged.
- `grep -c 'name="invite_id"' lib/pages/admin/invites/page.html`, `grep -c 'name="token_id"' lib/pages/admin/publishing-api-tokens/page.html`, and `grep -c 'name="token_id"' lib/pages/admin/admin-data-api-tokens/page.html` — each prints 1, inside the pending or active `ifEqual`.
- `grep -n "{{ grant.type }}: {{ grant.actions }}" lib/pages/admin/admin-data-api-tokens/page.html` — prints one line.
- `git diff --stat -- lib/pages/admin/invites/page.html lib/pages/admin/publishing-api-tokens/page.html lib/pages/admin/admin-data-api-tokens/page.html` and review the diff — only the list section changed.
- `grep -rn 'style="' lib/pages lib/templates` — prints nothing.
- Manual (operator runbook if no session): all three pages with rows in several statuses (the data-token page with one retired grant if available), light and dark, at about 360px width; revoke one pending invite and one active token.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

Operator Runbook
----------------

Run after all tasks are complete.

- [ ] Start `node node-server.js` from `lib/`, sign in as an admin, and review `/admin/style-guide/buttons`, `/admin/style-guide/table-lists`, `/admin/files`, `/admin/invites`, `/admin/publishing-api-tokens`, and `/admin/admin-data-api-tokens` in light and dark themes, at desktop width and at about 360px (tables scroll inside their wrapper; the page does not scroll sideways; Tab reaches each table region with a visible focus ring).
- [ ] Spot-check pages that already used `.button--secondary` and now pick up its style: `/admin/files/<id>`, the admin login and user signup pages.
- [ ] Build and run the e2e suite per `test-app/README.md`: `node tools/build-test-app.js` from the repo root, then from `test-app/` run `node run-tests.js --nodejs` and `node run-tests.js --cloudflare` (or `node run-tests.js --development` against a local server). The suites under `100-admin-files`, `010-csrf`, and `300-admin-data-api` exercise the markup contracts listed above.
