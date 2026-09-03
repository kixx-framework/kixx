# Blank-Canvas Default Theme

## Implementation Approach

Kixx is a starter framework. Developers clone it and build their own site on top, so the default frontend must be a blank canvas: minimal, accessible, easy to override, and free of a signature aesthetic. The current default is "Hypertext Minimalism" — system monospace everywhere, bracketed `[ save ]` buttons, uppercase tracked labels, square corners, ASCII ornament, and a `//kixx` wordmark. That identity is replaced with neutral defaults.

Decisions already made with the project owner (do not re-litigate):

- **Fonts:** no downloaded fonts (already true). Switch from the system monospace stack to a generic system sans-serif stack. Monospace remains only for `code`, `pre`, `kbd`, and the copy-field value.
- **Corner radius:** a small radius (`0.25rem`) on buttons, fields, cards, and callouts. Tokens stay overridable.
- **Form controls:** style text-like inputs (`text`, `email`, `password`, `url`, `search`, `number`, `tel`, `date`-family) and `textarea`. Leave `select`, checkboxes, radios, and file inputs native, with only `font: inherit` and `accent-color`.
- **Field labels:** normal case, body size, medium/semibold weight. Drop uppercase and tracking.
- **`.type-label` utility:** removed. Its uses are replaced case by case (see Task 4).
- **Buttons:** drop the `[ ]` pseudo-element brackets, uppercase, and tracking. Keep the hover inversion pattern (outline ↔ filled), the primary filled variant, the danger variant, and transitions on border and background.
- **Cards:** keep the accent-left-rule modifiers (`--accent-primary`, `--accent-secondary`), `--flush`, and `--sunken`.
- **Callouts:** keep the four tones. The icon slot becomes optional.
- **Transitions:** keep them on border-color and background-color only.
- **Type scale:** retune for sans-serif. Monospace runs wide, so the current heading steps are deliberately low; sans-serif gets a slightly larger scale and tighter leading.
- **Wordmark:** removed entirely (component, tokens, and both header partials). Replaced with a plain text link.
- **Theme toggle:** kept, restyled to match the neutral button treatment.
- **Aesthetic page:** kept, rewritten to describe the blank-canvas intent rather than a manifesto.
- **Flow primitive:** switch from the flex-column `gap` implementation to the margin-based "lobotomized owl" (`.flow > * + *`), so per-child `--flow-space` exceptions work the way Andy Bell's flow method intends.
- **Documentation posture:** the frontend guide and style guide pages become *prescriptive* about BEM ownership, flow-based spacing, and composition, and become *permissive* about aesthetic choices (radius, shadow, color) that were previously forbidden. Rules about structure are law; rules about looks are defaults.

Cross-cutting concerns:

- **Ordering.** The guide (Task 1) is the spec every later task checks against. Tokens and reset (Task 2) must land before any component task. Style guide pages (Task 9) are last because they demonstrate the finished components.
- **Token contract stays intact.** The three-tier `--palette-* -> --color-* -> component` system and the palette values themselves do not change. Only typography, radius, and a few component tokens change.
- **Every `.flow` container gets audited** when the primitive changes (Task 3). There are ~20 template and page files using `.flow`. Children that relied on flex-column stretching or on `gap` behaviour need checking.
- **No inline styles**, ever. This rule is unchanged.
- **Validation.** There is no JavaScript change in most tasks, so linting is limited to any `.js` files touched. Visual verification is a manual check against the style guide pages via `node tools/devserver.js --port 2026`. Record what was checked in each task's handoff notes.
- **Known documentation bug to fix in Task 1:** `src/docs/frontend-development-guide.md` references `templates/partials/common-site-styles.html`, which does not exist. The public stylesheet is linked directly from `templates/base/default.html`.

File map (all paths relative to `src/`):

```text
static-assets/stylesheets/
├── stylesheet.css          public entrypoint (imports lib/ in order)
├── admin.css               admin entrypoint (imports stylesheet.css + admin libs)
└── lib/
    ├── design-tokens.css   Task 2
    ├── reset.css           Task 2
    ├── typography.css      Task 4
    ├── layout.css          Task 3
    ├── components.css      Tasks 5, 7, 8
    ├── forms.css           Task 6
    ├── admin-shell.css     Tasks 4, 8
    └── admin-style-guide.css   Task 9
templates/partials/default-site-header.html   Task 8
templates/partials/admin-site-header.html     Task 8
pages/admin/style-guide/**                    Tasks 4, 9
docs/frontend-development-guide.md            Task 1
```

---

### Task 1: Rewrite the frontend development guide as the prescriptive spec

**Status:** Not started
**Depends on:** None
**Documentation:** `src/docs/frontend-development-guide.md` (the document being rewritten)

**Objective**

`docs/frontend-development-guide.md` becomes the single prescriptive reference for how frontend CSS and markup are structured in this project: BEM with explicit ownership rules, Andy Bell's flow method for spacing, a composition rule for how layout primitives, blocks, and elements nest, and a "when to add what" decision table. Aesthetic rules that previously read as prohibitions (no radius, no shadows, no color hierarchy) are rewritten as overridable defaults. Doing this first gives every later task a spec to check against.

**Scope**

- In: the full text of `docs/frontend-development-guide.md`.
- Out: any CSS or template change (Tasks 2–9). The style guide HTML pages (Task 9).

**Design and invariants**

- Keep the existing section structure where it still applies: public pages are the default, follow the style guide, never use inline styles, file organization, CSS formatting, CSS comments, design tokens, typography, layout primitives, components and forms, page-local styles.
- Fix the broken reference: the public stylesheet is linked from `templates/base/default.html`, not from a `common-site-styles.html` partial.
- **BEM section must prescribe ownership, not just naming:**
  - A block owns its internal layout and its elements. A block never sets its own outside margin.
  - An element (`.block__element`) is only ever styled from within its own block's rules. No block reaches into another block's elements.
  - A modifier (`.block--modifier`) always accompanies its base class in markup and only overrides what varies.
  - Page-local stylesheets may add a new block, a new modifier of an existing block, or a page-scoped rule. They may not restyle a shared block's elements.
  - Utilities (`.flow`, `.cluster`, `.center`, `.type-*`) are flat single-purpose classes. They are not blocks and have no elements.
- **Flow section must describe the owl implementation and its contract:**
  - `.flow > * + *` sets `margin-block-start: var(--flow-space, <default>)`.
  - Spacing is a relationship between siblings and is owned by the parent `.flow`. Components never set their own vertical margins.
  - The exception path: set `--flow-space` on an individual child to change the space *above that child only*. Set it on the container to change the rhythm of every child.
  - Nesting is safe because a nested `.flow` only applies margins to its own children.
  - `gap`-based primitives (`.cluster`, `.grid-auto`, `.switcher`, `.with-sidebar`) are for two-dimensional or inline arrangement; `.flow` is for vertical document rhythm. Do not use `.flow` to build a flex column.
- **Composition rule (new section):** page structure is layout primitives → blocks → elements. A layout class and a block class may coexist on one element (`<div class="card flow">`), but a layout class never carries block styling and a block never lays out its siblings. A block's *internal* layout may use primitives on its child elements.
- **"When to add what" table (new section):** rows for "a value changes on one instance" (scoped custom property), "a variant of an existing block" (modifier), "a reusable declaration block with no parts" (utility), "a new reusable component with parts" (block in `lib/`), "styling that belongs to one page" (`page_stylesheet`), "a new color or size" (token, only after checking existing tokens). Each row names the file it goes in.
- **Aesthetic defaults section:** replace "Do not add shadows, decorative gradients, rounded card treatments…" with a statement that the shipped defaults are neutral (small radius, hairline borders, no shadows, single link accent) and that a downstream site is expected to change them through tokens first, modifiers second.
- Typography section: remove the monospace framing. Keep the fixed `rem` scale rule, the WCAG 1.4.4 fluid-type guidance for public marketing display type, and the heading-level-then-`.type-*` rule.
- Fonts: state that the default is a generic system sans-serif stack with no downloaded font files, and that monospace is reserved for `code`, `pre`, `kbd`, and copy-field values. A site that wants a web font adds it in its own base template and overrides `--font-body` / `--font-display`.
- Remove any mention of `.type-label`, the wordmark, character-unit measures as an aesthetic, and "spec-sheet" controls.
- Keep the document under roughly 300 lines. It is a reference, not an essay.

**Expected touch points**

- `docs/frontend-development-guide.md` — full rewrite.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The guide contains a BEM section with the five ownership rules above.
- [ ] The guide contains a flow section describing the owl selector, parent ownership, the per-child `--flow-space` exception, and nesting.
- [ ] The guide contains the composition rule and the "when to add what" table.
- [ ] Aesthetic prohibitions are rewritten as defaults with an override path.
- [ ] No reference to `common-site-styles.html`, monospace-first, `.type-label`, or the wordmark remains.
- [ ] Every file path named in the guide exists (verify with `ls`).

**Validation**

- `grep -n "common-site-styles\|type-label\|wordmark\|monospace-first\|Hypertext Minimalism" src/docs/frontend-development-guide.md` — must return nothing.
- Read-through against this task's invariants list.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 2: Neutral design tokens and reset

**Status:** Not started
**Depends on:** Task 1
**Documentation:** `docs/frontend-development-guide.md` (Design Tokens, Typography); `static-assets/stylesheets/lib/design-tokens.css` comments

**Objective**

`design-tokens.css` and `reset.css` express the blank-canvas defaults: a system sans-serif font stack, a type scale and leading retuned for sans-serif, a small radius, and native-control affordances. The palette and the three-tier color contract are untouched. After this task the site renders in sans-serif with small rounded corners, but components still carry their old ornament until Tasks 4–7.

**Scope**

- In: `lib/design-tokens.css`, `lib/reset.css`.
- Out: any component, form, or layout rule. The `.type-*` utilities (Task 4).

**Design and invariants**

- **Palette (`--palette-*`) and semantic color (`--color-*`) tokens do not change.** This is an explicit decision.
- Font tokens:
  - `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;`
  - `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;` (trimmed; keep it for code only)
  - `--font-body: var(--font-sans);` `--font-display: var(--font-sans);`
  - Remove `--font-wordmark`.
- Type scale for sans-serif (fixed `rem`, WCAG 1.4.4). Proposed values, adjust only if the style guide typography page looks wrong:
  - h1 `2rem`, h2 `1.5rem`, h3 `1.25rem`, h4 `1.125rem`, body-lg `1.125rem`, body `1rem`, body-sm `0.875rem`, caption `0.8125rem`.
  - Remove `--text-label`.
- Leading: tight `1.15`, snug `1.25`, normal `1.4`, body `1.5`, relaxed `1.65`.
- Tracking: remove `--tracking-label`. Keep `--tracking-tight: 0` only if something still reads it; otherwise remove.
- Weights: `--weight-regular: 400`, `--weight-medium: 500`, `--weight-semibold: 600`, `--weight-bold: 700`. Sans-serif system faces support these.
- Radius: `--radius-sm: 0.25rem`, `--radius-md: 0.25rem`. Remove `--radius-pill` unless something uses it (grep first).
- Measures: keep `--measure-prose` and `--measure-form` but express them in `rem` or keep `ch` — either is fine; the *comment* must stop calling them "the aesthetic's grid material". Recommend `--measure-prose: 65ch` (a normal reading measure for sans-serif) and `--measure-form: 40ch`.
- Component tokens: keep the field and button border tokens. Add `--control-radius: var(--radius-sm)` so buttons and fields share one radius knob.
- Rewrite the file header comment. It currently opens with "Hypertext Minimalism". Replace with a two-sentence statement: neutral defaults for a starter site; change the palette and type tokens first when adopting a house style.
- Reset:
  - Remove the "one monospace family" comments.
  - Add `accent-color: var(--color-ink-link);` on `:root` or `body` so native checkboxes, radios, range, and progress pick up the link accent. This is the *only* styling native selection controls receive.
  - Keep `font: inherit` on `input, button, textarea, select`.
  - Keep `hr`, link, `::selection`, media, and heading resets. Headings lose the "no balance/tracking tricks" comment; keep `text-wrap: balance` off (do not add it — it is a stylistic choice for the downstream site).
  - The reset zeroes block margins on `p`, headings, lists, `pre`. This is required for the owl flow in Task 3 to be the only source of vertical space. Keep it and say so in the comment.

**Expected touch points**

- `static-assets/stylesheets/lib/design-tokens.css` — font, type scale, leading, tracking, weight, radius, measure tokens and header comment.
- `static-assets/stylesheets/lib/reset.css` — comments, `accent-color`.

**Acceptance criteria**

- [ ] No `--palette-*` or `--color-*` value changed (diff the file and confirm).
- [ ] `--font-body` resolves to a sans-serif stack; `--font-wordmark`, `--text-label`, `--tracking-label` are gone.
- [ ] `--radius-sm` and `--radius-md` are `0.25rem`; `--control-radius` exists.
- [ ] `accent-color` is set on the document.
- [ ] `grep -rn "font-wordmark\|text-label\|tracking-label\|radius-pill" src/static-assets src/pages src/templates` lists only files owned by later tasks (record them in handoff so Tasks 4–8 know what to clean up).

**Validation**

- `grep -n "palette-\|color-" src/static-assets/stylesheets/lib/design-tokens.css | diff - <(git show HEAD:src/static-assets/stylesheets/lib/design-tokens.css | grep -n "palette-\|color-")` — palette and semantic tokens unchanged (line numbers may shift; compare content).
- Manual: load `/admin/style-guide/typography` in the devserver. Text is sans-serif; nothing has a downloaded font in the network panel.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 3: Margin-based flow primitive and flow-container audit

**Status:** Not started
**Depends on:** Task 2
**Documentation:** `docs/frontend-development-guide.md` (Layout Primitives, flow section from Task 1)

**Objective**

`.flow` is implemented as the lobotomized owl so that spacing is owned by the parent and any child can opt into an exception via `--flow-space`. Every existing `.flow` container still renders correctly after the change.

**Scope**

- In: the `.flow` rule in `lib/layout.css`; every template and page that uses `.flow` (audit and fix); `admin-shell.css` where it sets `--flow-space` on `.admin-content-section`.
- Out: other layout primitives (unchanged); component visual changes (Tasks 5–7).

**Design and invariants**

- New implementation:

  ```css
  .flow > * + * {
      margin-block-start: var(--flow-space, var(--space-sm));
  }
  ```

  Do not set `display: flex` on `.flow`. Do not set `--flow-space` on `.flow` itself, or a child's own `--flow-space` would be overridden by inheritance rules in the wrong direction. The container default comes from the `var()` fallback; a container tunes it by declaring `--flow-space` on itself (which children inherit), and a child overrides for itself alone.
- `.field-stack` in `forms.css` currently sets `--flow-space: var(--form-field-gap)` on the container. That keeps working with the owl. Leave it.
- `.admin-content-section` sets `--flow-space: var(--space-lg)`. Keeps working. Leave it.
- Audit every file returned by `grep -rln 'flow' src/pages src/templates` (roughly 20). For each `.flow` container check:
  - Did any child rely on `align-items: stretch` from the flex column (e.g. a button or input stretching full width)? If so, give that child `width: 100%` or `display: block` in its own block rules.
  - Did any child rely on the container being a flex formatting context (e.g. margin collapsing being suppressed, or an inline child being blockified)? Fix in the child's block.
  - Does any child have its own top margin that now double-stacks? The reset zeroes most; check `hr`, `blockquote`, `.admin-nav__list + .admin-nav__title`.
- `.admin-content-section + .admin-content-section` uses `margin-top` for section gaps. That is a sibling relationship owned by the shell, not a flow child, so it may stay. Note it in the layout.css comment as the one shell-owned exception.
- Update the `.flow` section comment in `layout.css` to match the guide: parent ownership, per-child exception, nesting, and "not a flex column".

**Expected touch points**

- `static-assets/stylesheets/lib/layout.css` — `.flow` rule and comment.
- `static-assets/stylesheets/lib/admin-shell.css` — verify `--flow-space` usage; possibly no change.
- `pages/**/*.html`, `templates/**/*.html` — only where the audit finds a child that needs adjusting. Prefer fixing in CSS block rules over adding markup.

**Acceptance criteria**

- [ ] `.flow` is the owl selector; no `display: flex` on `.flow`.
- [ ] Every `.flow` usage listed in the audit is recorded in handoff with "no change" or the fix applied.
- [ ] `/admin/style-guide/layout` flow demo renders with the same visual rhythm as before.
- [ ] A per-child `--flow-space` override demonstrably works (add one to the layout style guide demo in Task 9, or verify ad hoc in devtools now).

**Validation**

- Manual: walk `/admin/style-guide/*`, `/admin`, `/admin/publishing`, `/admin/invites`, `/admin/publishing-api-tokens`, `/login/admin/new`, `/users/admin/new`, and `/` in the devserver at narrow and wide widths. Compare against `git stash` of the pre-change state if unsure.
- No JavaScript changed; no lint or unit test run needed unless a `.js` file was touched.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 4: Retune typography roles and remove `.type-label`

**Status:** Not started
**Depends on:** Task 2
**Documentation:** `docs/frontend-development-guide.md` (Typography)

**Objective**

`typography.css` expresses sans-serif type roles with no uppercase/tracked "label" convention. The `.type-label` utility is deleted and each of its 22 usages is replaced with the semantically right alternative.

**Scope**

- In: `lib/typography.css`; every file that uses `.type-label` (list below); `.admin-nav__title` in `admin-shell.css`, which duplicates the label treatment.
- Out: field labels (Task 6), button labels (Task 5), callout title styling (Task 7).

**Design and invariants**

- Heading roles use `--weight-semibold` (600) for h1–h3 and `--weight-semibold` or `--weight-medium` for h4. Bold-700 everywhere is a monospace workaround that is no longer needed.
- `.type-caption` stays: small, muted, normal case.
- New: `.type-overline` is **not** added. If a later page needs a small uppercase heading, that is a downstream aesthetic choice.
- `code`, `kbd`: keep `font-family: var(--font-mono)`; `font-size: 0.9em` is now meaningful because body is no longer mono. Keep the sunken background and the small radius.
- `blockquote`: keep the left rule; use `--color-rule-strong` rather than the link accent (color as decoration is what we are removing).
- Replacement rules for `.type-label` usages (decide per instance, record in handoff):
  - A label that titles a callout body → drop the class; make it a `<strong>` or a `.callout__title` element (Task 7 defines `.callout__title`; coordinate: this task may add the class name and Task 7 styles it).
  - A "Do / Avoid" guideline label in the style guide (`.guideline__label`) → keep `.guideline__label`, style it in `admin-style-guide.css` as `.type-caption`-like bold text without uppercase. That is style-guide-only CSS and is allowed to be opinionated.
  - Specimen/meta labels in style guide pages → `.type-caption`.
  - Anything in a real admin page (`pages/admin/publishing/**`, `invites`, `publishing-api-tokens`, `errors`, `users/admin/new`, `login/admin/**`, `pages/body.html`) → `.type-caption` or a plain `<strong>`, whichever reads correctly.
- `.admin-nav__title` in `admin-shell.css`: drop uppercase and `letter-spacing`; use `--text-caption`, `--weight-semibold`, muted color.
- Files currently using `.type-label` (from grep at plan time):
  `pages/body.html`, `pages/admin/publishing/releases/page.html`, `pages/admin/publishing/page.html`, `pages/admin/publishing/builds/page.html`, `pages/admin/errors/page.html`, `pages/admin/publishing-api-tokens/page.html`, `pages/admin/invites/page.html`, `pages/users/admin/new/page.html`, `pages/login/admin/new/page.html`, `pages/login/admin/errors/page.html`, and the style guide pages: `style-guide/body.html`, `aesthetic`, `buttons`, `callouts`, `cards`, `colors`, `copy-fields`, `forms`, `layout`, `multi-line-text-areas`, `text-fields`, `typography`.

**Expected touch points**

- `static-assets/stylesheets/lib/typography.css` — roles, removal of `.type-label`.
- `static-assets/stylesheets/lib/admin-shell.css` — `.admin-nav__title`.
- `static-assets/stylesheets/lib/admin-style-guide.css` — `.guideline__label`.
- The 22 HTML files listed above.

**Acceptance criteria**

- [ ] `grep -rn "type-label" src/` returns nothing.
- [ ] `grep -rn "text-transform: uppercase" src/static-assets/stylesheets` returns nothing (buttons and fields are cleaned in Tasks 5–6; if this task runs first, record the remaining hits in handoff).
- [ ] Headings render at the new weights and sizes on `/admin/style-guide/typography`.
- [ ] Every replaced label still reads as a label in context (manual check of each admin page).

**Validation**

- `grep -rn "type-label" src/` — empty.
- Manual: `/admin/style-guide/typography`, `/admin`, each admin page listed above.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 5: Neutral buttons and theme toggle

**Status:** Not started
**Depends on:** Task 2
**Documentation:** `docs/frontend-development-guide.md` (Components and Forms); Buttons section comment in `components.css`

**Objective**

`.button` is a plain, accessible control: normal-case label, one border, small radius, comfortable padding, a visible focus ring, and three variants (default outline, primary filled, danger). Hover inverts fill and text. `.theme-toggle` uses the same treatment.

**Scope**

- In: Buttons and Theme toggle sections of `lib/components.css`.
- Out: `.copy-field__button` (Task 6, but it should match this treatment); style guide buttons page (Task 9).

**Design and invariants**

- Remove `.button::before` and `.button::after` bracket content.
- Remove `text-transform`, `letter-spacing`, and `font-family: var(--font-mono)` from `.button` and `.theme-toggle`.
- `.button`: `display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2xs); min-height: 2.5rem; padding-inline: var(--space-sm); border: var(--button-border-width) solid var(--color-ink); border-radius: var(--control-radius); font-size: var(--text-body); font-weight: var(--weight-medium); line-height: 1; color: var(--color-ink); background: var(--color-bg); text-decoration: none; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;`
- Minimum target size: `min-height: 2.5rem` and `min-width: 2.5rem` (WCAG 2.5.8 target size, 24px minimum; 40px is comfortable).
- Hover on non-disabled: invert (`background: var(--color-ink); color: var(--color-ink-on-accent)`). Primary resting is inverted, hover flips back. Danger resting is red outline, hover is red fill. These are unchanged in behaviour; only the label treatment and radius change.
- `:focus-visible`: `outline: 2px solid var(--color-focus-outline); outline-offset: 2px;` — keep.
- `:disabled`: muted border and text, `cursor: not-allowed`, no hover inversion — keep.
- `.theme-toggle`: same box model as `.button` at a smaller `min-height: 2.25rem`. Consider making the markup `class="button theme-toggle"` and having `.theme-toggle` only adjust size. Decide and record. (Recommendation: do it — one less component to document.)
- Rewrite both section comments. No "terminal / spec-sheet" language.

**Expected touch points**

- `static-assets/stylesheets/lib/components.css` — Buttons and Theme toggle sections.
- `templates/partials/default-site-header.html`, `templates/partials/admin-site-header.html` — only if the theme toggle markup changes to `button theme-toggle`.

**Acceptance criteria**

- [ ] No `::before`/`::after` content on `.button`.
- [ ] No `text-transform` or `letter-spacing` in the Buttons or Theme toggle sections.
- [ ] Default, primary, danger, disabled, hover, and focus states render as described on `/admin/style-guide/buttons` (page copy updated in Task 9; the demos still exercise the states now).
- [ ] Keyboard focus ring visible in both color schemes.

**Validation**

- Manual: `/admin/style-guide/buttons`, tab through the controls, toggle theme with the header button in both light and dark.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 6: Accessible, simplified form controls

**Status:** Not started
**Depends on:** Task 2, Task 5
**Documentation:** `docs/frontend-development-guide.md` (Components and Forms); Forms sections in `forms.css`

**Objective**

Text-like inputs and textareas are styled with a plain border, small radius, comfortable padding, clear hover/focus/error/disabled/readonly states, and normal-case labels. Selects, checkboxes, radios, and file inputs are left native. The copy field matches.

**Scope**

- In: all of `lib/forms.css`; a new short "Native controls" section documenting what is intentionally unstyled.
- Out: the style guide forms pages (Task 9); any form template markup (should not need to change; if a label class changes, record it).

**Design and invariants**

- `.field__label`: `font-size: var(--text-body); font-weight: var(--weight-medium); color: var(--color-ink);`. Remove mono, uppercase, tracking, muted color. A label is primary text — muted labels fail contrast for people who need them most.
- `.field__input`: keep the existing box (`min-height: 2.75rem`, padding, border tokens, `font: inherit`, `background: var(--color-field-bg)`). Change `border-radius: var(--control-radius)`. Keep `appearance: none` **only** for text-like inputs; do not apply `.field__input` to `<select>`, checkbox, radio, or file (document this in the section comment).
- Do **not** hide number spinners. Remove the `::-webkit-inner-spin-button` and `-moz-appearance: textfield` rules. Hiding the spinner removes an affordance; it was an aesthetic choice.
- Focus: keep `outline: 2px solid var(--color-focus-outline); outline-offset: 2px;` plus the strong border. Hover: strong border. Error: red border, and `.field__error` text stays. Disabled: keep. Readonly: keep dashed border or switch to the sunken background — pick one, record it. (Recommendation: sunken background, solid border; dashed borders are ornament.)
- Add a `Native controls` section: `select`, `input[type="checkbox"]`, `input[type="radio"]`, `input[type="file"]`, `input[type="range"]` receive `font: inherit` (already in reset) and `accent-color` (Task 2). Provide a `.field--inline` or `.field--choice` modifier for a checkbox/radio row (label beside control, `align-items: center`, `gap: var(--space-2xs)`) so there is a documented way to lay those out without styling the control itself. Provide `.field__select` only if a `select` needs `width: 100%` and the field border to align with text inputs; if added, it must not use `appearance: none`.
- `.copy-field__label` mirrors `.field__label`. `.copy-field__button` mirrors `.button` box model (radius, transition, hover inversion). `.copy-field__value` keeps `font-family: var(--font-mono)` because copied values are usually code-like; this is the one place mono appears in a control.
- `--form-field-gap` stays as the `.field-stack` rhythm; `2.5rem` may drop to `--space-md` (`1.5rem`) now that labels are normal case. Decide by looking at `/admin/style-guide/forms`.

**Expected touch points**

- `static-assets/stylesheets/lib/forms.css` — every section.
- `templates/**`, `pages/**` — only if a checkbox/radio row needs the new modifier; the two files with `<select>` (`pages/admin/publishing-api-tokens/page.html`, `pages/admin/invites/page.html`) should be checked for how the select is currently classed.

**Acceptance criteria**

- [ ] Labels are normal case, body size, primary ink color.
- [ ] Number inputs show native spinners.
- [ ] `<select>` elements in the two admin pages render natively (no `appearance: none`) and sit correctly beside text fields.
- [ ] Focus, hover, error, disabled, and readonly states are distinguishable on `/admin/style-guide/text-fields` and `/admin/style-guide/multi-line-text-areas`.
- [ ] Copy field row edges align with the text field height.

**Validation**

- Manual: `/admin/style-guide/text-fields`, `/admin/style-guide/multi-line-text-areas`, `/admin/style-guide/forms`, `/admin/style-guide/copy-fields`, `/admin/invites`, `/admin/publishing-api-tokens`, `/login/admin/new`, `/users/admin/new`. Keyboard through each form.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 7: Standard card and callout components

**Status:** Not started
**Depends on:** Task 2, Task 4
**Documentation:** `docs/frontend-development-guide.md` (Components and Forms, BEM); Cards and Callouts section comments in `components.css`

**Objective**

`.card` and `.callout` have a documented, stable anatomy: a bordered padded box with a small radius, optional accent-left rule, optional sunken surface; a callout is a card-like notice with a tone accent, an optional icon slot, and an optional title element.

**Scope**

- In: Cards and Callouts sections of `lib/components.css`.
- Out: style guide pages (Task 9); `.guideline` cards in `admin-style-guide.css` (Task 9 keeps them working).

**Design and invariants**

- `.card`: `padding: var(--card-padding, var(--space-md)); border: var(--hairline-width) solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-bg); overflow: hidden;`. Note the border drops from `--color-rule-strong` to `--color-rule` (hairline grey). The strong full-ink border was part of the spec-sheet look. Record this as a decision.
- Keep modifiers: `.card--flush`, `.card--accent-primary`, `.card--accent-secondary`, `.card--sunken`. Accent modifiers keep the 3px left rule via `--card-accent`.
- Card does not define elements. Content inside a card is laid out with `.flow` or other primitives. Say this in the comment: `<div class="card flow">` is the canonical composition.
- `.callout`: same box as card plus `border-left: 3px solid var(--callout-accent)` and the sunken background. Radius `--radius-md`. Tones unchanged: default ink, `--info` link blue, `--warning` amber, `--error` red. Add `--success` green using `--color-status-success` (the token already exists and has no consumer).
- Elements: `.callout__icon` (optional, `flex: none`, tone-colored, `aria-hidden` in markup), `.callout__body` (required, a column), `.callout__title` (new, optional: `font-weight: var(--weight-semibold)`; replaces the `.type-label` usage removed in Task 4). Do not force an icon glyph; the markup chooses one or omits the element.
- `.callout__body` should compose with `.flow` rather than defining its own `gap` column. Change it to `min-width: 0` only and document `class="callout__body flow"`. This keeps the block from owning sibling spacing, per the guide.
- Remove all "ASCII icon" language from comments.

**Expected touch points**

- `static-assets/stylesheets/lib/components.css` — Cards and Callouts sections.
- `pages/**`, `templates/**` — every `.callout__body` gets `flow` added if it has more than one child (14 files use callouts; list in handoff).

**Acceptance criteria**

- [ ] Card and callout share radius and border tokens.
- [ ] `.callout--success` exists.
- [ ] `.callout__title` exists and is used where a callout previously used `.type-label`.
- [ ] `.callout__body` no longer sets `display: flex`/`gap`; callouts with multiple body children use `callout__body flow` and render with correct spacing.
- [ ] `/admin/style-guide/cards` and `/admin/style-guide/callouts` render all modifiers.

**Validation**

- `grep -rn "callout__body" src/pages src/templates` — every multi-child body carries `flow`.
- Manual: `/admin/style-guide/cards`, `/admin/style-guide/callouts`, `/admin/style-guide` (index uses a warning callout), `/admin/errors`.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 8: Remove the wordmark; plain-text site headers

**Status:** Not started
**Depends on:** Task 2, Task 5
**Documentation:** None

**Objective**

The `//kixx` wordmark component is gone. Both site headers show a plain text link (site name) at the leading edge and the theme toggle at the trailing edge.

**Scope**

- In: Wordmark section of `components.css`; `.site-header__wordmark` in `components.css`; `.admin-header__wordmark` in `admin-shell.css`; `templates/partials/default-site-header.html`; `templates/partials/admin-site-header.html`.
- Out: any other header behaviour.

**Design and invariants**

- Delete `.kixx-wordmark`, `.kixx-wordmark__slash-1`, `.kixx-wordmark__slash-2`, `.kixx-wordmark__kixx`, and `a.kixx-wordmark`.
- Replace `.site-header__wordmark` / `.admin-header__wordmark` with `.site-header__title` / `.admin-header__title`: `font-size: var(--text-h3); font-weight: var(--weight-semibold); color: var(--color-ink); text-decoration: none;` and an underline on hover/focus so it is still recognizable as a link.
- Public header text: the site name. Check whether a site name is available in the template context (`grep -rn "siteName\|site_name\|name" src/templates/base/default.html src/pages/page.json`); if it is, interpolate it; if not, use the literal "Kixx" and note in handoff that a downstream site edits the partial.
- Admin header text: "Site Admin" (or the site name followed by "Admin"). Keep `href="/"` on the public header. Admin header link should go to `/admin`.
- Keep `aria-label` only if the visible text is not already descriptive; with visible text, drop it.
- Update the Site header and Admin header section comments (they mention the wordmark).

**Expected touch points**

- `static-assets/stylesheets/lib/components.css` — remove Wordmark section, rename header title element.
- `static-assets/stylesheets/lib/admin-shell.css` — rename header title element, comment.
- `templates/partials/default-site-header.html`, `templates/partials/admin-site-header.html`.

**Acceptance criteria**

- [ ] `grep -rn "wordmark" src/` returns nothing.
- [ ] Both headers render a text link and the theme toggle, aligned as before, at narrow and wide widths.

**Validation**

- `grep -rn "wordmark" src/` — empty.
- Manual: `/`, `/admin`, `/login/admin/new` in both color schemes.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task 9: Rewrite the style guide pages for the blank-canvas system

**Status:** Not started
**Depends on:** Tasks 1–8
**Documentation:** `docs/frontend-development-guide.md` (all sections); `src/app/presentation/README.md` (page includes and `page_stylesheet`)

**Objective**

Every page under `pages/admin/style-guide/` documents the finished neutral system with prescriptive, consistent language: the aesthetic page states the blank-canvas intent and the structural rules (BEM ownership, flow, composition); each component page shows the current anatomy, modifiers, states, and the exact markup to copy. `admin-style-guide.css` is trimmed to what the pages still use.

**Scope**

- In: all files under `pages/admin/style-guide/`; `lib/admin-style-guide.css`.
- Out: shared component CSS (done in earlier tasks). If a page reveals a component bug, fix it in the owning task's file and record it under that task's handoff too.

**Design and invariants**

- **Aesthetic page** (`aesthetic/body.html`): rewrite from scratch. Sections:
  1. *Intent* — Kixx ships a blank canvas: neutral, accessible, override-first. What ships is a default, not a brand.
  2. *What is fixed* — structure rules: semantic HTML first, BEM ownership, flow spacing, composition (primitives → blocks → elements), tokens before literals, no inline styles. These are the rules a downstream site keeps.
  3. *What is a default* — sans-serif system font, palette, small radius, hairline borders, hover inversion, single link accent. How to change each: which token or modifier.
  4. *Accessibility floor* — focus rings, target sizes, contrast, native controls left native, zoom-safe type. These are not optional.
  5. *Do / Avoid* guideline cards, rewritten to match the above.
- **Index page** (`style-guide/body.html`): remove "Hypertext Minimalism" paragraph; keep the placeholder warning callout (using `.callout__title`); update the workflow cards and decision rules to reference the guide's "when to add what" table.
- **Typography page**: new scale values, weights, no label role; show `code`/`kbd`/`blockquote`.
- **Colors page**: unchanged tokens; update any copy referencing mono or spec-sheet.
- **Layout page**: document the owl flow with a demo showing a per-child `--flow-space` override; the other primitives are unchanged.
- **Buttons page**: default, primary, danger, disabled, as link (`<a class="button">`), and the theme toggle if it now composes `.button`.
- **Cards page**: anatomy (`card flow`), four modifiers.
- **Callouts page**: five tones, optional icon, optional title, `callout__body flow`.
- **Text fields, Multi-line text areas, Forms, Copy fields pages**: new label treatment, states, native controls section with a `select`, checkbox row, radio row, and file input demo. Make clear these are unstyled on purpose.
- Every component page must have, in this order: heading and lede, *Anatomy* (markup to copy in a `.code-block`), *Modifiers*, *States*, *Usage rules* (prescriptive do/don't). Keep the existing `.specimen`, `.example`, `.state-list`, `.code-block`, `.demo-*` helpers from `admin-style-guide.css` where useful; delete helpers no page uses after the rewrite.
- `admin-style-guide.css` is admin-only and may be opinionated, but must follow the guide's BEM and flow rules. `.guideline > * + *` and `.parts-list li + li` style hand-rolled owls should switch to `.flow` in markup.
- Page-local `page.css` files: keep only rules that are genuinely local. Remove any that duplicate a shared primitive.

**Expected touch points**

- `pages/admin/style-guide/**/*.html`, `**/*.css`, `**/*.json` — all pages.
- `static-assets/stylesheets/lib/admin-style-guide.css`.

**Acceptance criteria**

- [ ] `grep -rn "Hypertext Minimalism\|monospace-first\|spec-sheet\|type-label\|wordmark\|ASCII" src/pages/admin/style-guide` returns nothing (a mention of monospace for `code` is fine).
- [ ] Every component page has Anatomy, Modifiers, States, and Usage rules sections.
- [ ] The layout page demonstrates a per-child `--flow-space` override.
- [ ] The forms pages show native `select`, checkbox, radio, and file controls.
- [ ] Every helper class in `admin-style-guide.css` is used by at least one page (`grep` each).
- [ ] Every `*.json` include still resolves (load each page in the devserver; no template error).

**Validation**

- `grep -rn "Hypertext Minimalism\|spec-sheet\|type-label\|wordmark" src/pages/admin/style-guide` — empty.
- Manual: load every `/admin/style-guide/*` page, light and dark, narrow and wide. Append `.json` to each URL once to confirm includes resolve.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.
