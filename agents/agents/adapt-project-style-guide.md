# Adapt the starter theme and complete style guide

Use the accompanying design brief and assets to establish this project's visual identity, writing conventions, and working design system. Implement the decisions in the theme and revise the complete live style guide so another developer can build consistent pages without this conversation.

This repository contains the Kixx framework in `src/kixx/`, a reference application, and a starter theme for new projects. Treat the theme like a default theme supplied with a publishing platform: the fork owns its appearance. The starter palette, fonts, density, borders, surfaces, and theme toggle are replaceable choices. Preserve the structural and accessibility contracts below.

Your deliverables are repository changes: the implemented theme, a complete project-specific style guide with working specimens, and the completed Web Copy & Typography Brief incorporated into that guide. A mood board, recommendations, or a brief returned only in chat is not completion.

## 1. Establish context and scope

This prompt works as a direct assignment or a sub-agent assignment. When delegated, use the parent's supplied brief, decisions, assets, and file ownership boundaries; send missing decisions and handoff information to the parent. Do not assume access to conversation history that was not supplied. Preserve unrelated edits and coordinate shared-file changes.

Before editing:

1. Read `AGENTS.md` and `README.md`, including planning and verification requirements. Review the working tree and any existing plan or handoff.
2. Read the full `src/docs/frontend-development-guide.md` and every file under `src/pages/admin/style-guide/`, including page data, markup, and page-local CSS. Start with Aesthetic, then foundations, layout, and all components. Discover additional sections in the fork; the inventory below is a minimum.
3. Inspect both stylesheet entrypoints and the owning files in `src/static-assets/stylesheets/lib/`. Read the token and layout contracts, not just their declarations. Inspect the base templates, shared partials, style-guide wrapper/navigation, and relevant behavior in `src/static-assets/javascript/site.js`.
4. Inspect the supplied assets and representative public, admin, and authentication pages. Identify which styles they share and where the current implementation disagrees with its documentation.

Use the brief to establish audience, site purpose, primary visitor actions, desired character, content density, public/admin differences, supported color schemes, and asset/font constraints. Distinguish mandatory requirements from references and suggestions. Ask focused questions before implementation where an unresolved decision materially changes the outcome. Do not re-ask questions already resolved by the user or parent. Make smaller design and editorial choices yourself and record significant assumptions.

Follow the project's planning requirements. If an implementation plan is required or agreed, put it in `agents/plans/` using the prescribed task format and keep its progress current. Resolve the design direction before making broad theme changes; do not invent an extra approval gate when the supplied brief already authorizes the work.

The default scope is the complete style guide, its supporting shared theme, and necessary integration fixes in existing consumers. Implement new public pages, replace the demo home page, or rewrite unrelated production copy only when the accompanying assignment includes that work. The CSS Zen Garden home page is a demo with deliberate structural exceptions; do not copy its selectors, layout, or fluid type as a new-page pattern. Keep framework internals, business rules, persistence, and deployment changes outside this design task unless separately authorized.

## 2. Define the project aesthetic

If the brief does not identify what the product or subject matter is, identify it yourself before designing, and confirm with the user or parent agent.

Write the intended aesthetic on the Aesthetic page before propagating it through the system. Make decisions concrete enough to guide implementation:

- Audience, purpose, primary actions, and the intended reader experience.
- A few defining visual characteristics, with reasons tied to the project's content and identity.
- Palette roles, surface hierarchy, typeface roles, spacing rhythm, density, shape, borders, shadows, imagery, iconography, and interaction treatment.
- How brand expression differs between public marketing/content and the admin tools that must remain efficient to use.
- Supported color schemes and whether they are fixed, system-driven, or user-selectable.
- Asset usage: logo variants and placement, cropping and focal points, image aspect ratios, decorative versus informative imagery, and appropriate backgrounds.
- Voice, tone, point of view, and practical writing examples from the brief below.

Do not substitute generic adjectives for decisions. Explain how a choice appears in the interface and why it fits. Use supplied assets where they serve the design; preserve logo proportions and avoid arbitrary recoloring or distortion. Identify missing assets without pretending placeholders are final. Use only fonts/assets available or authorized for this project; record sources and usage constraints where supplied.

Build a coherent system from the brief. A redesign need not retain neutral paper, one accent, small radii, flat surfaces, hover inversion, system fonts, zero tracking, or light/dark switching. Retain a starter choice when it serves this project, and explain that choice. Avoid adding decorative treatments or new token families without a specific use.

Typography carries the personality of the page. You don't need a different typeface for display or headline text and body content: use one family or two, and if two, make them clearly distinct.

Choose your typefaces deliberately, not the default families you would reach for on any other project, and set a clear type scale following the default guidance of The Elements of Typographic Style with intentional weights, widths, and spacing. When type is used as a headline or visual element, use the type treatment itself as an active part of the design, not a neutral delivery vehicle for the content.

Use non-user-triggered motion sparingly and deliberately, only to draw attention. A single orchestrated moment — one page-load sequence or one reveal — lands better than scattered effects; fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated. Motion that answers a person's action (opening, expanding, confirming) is welcome when it shows what changed.

## 3. Preserve the implementation contracts

### Ownership and composition

- Use semantic HTML. Choose heading levels for document structure, buttons for actions, and links for navigation. Keep logical DOM and keyboard order.
- Compose layout primitives → blocks → elements. Use `.flow`, `.cluster`, `.grid-auto`, `.switcher`, `.with-sidebar`, and `.center` before bespoke flex/grid rules.
- Parents own spacing between siblings. Blocks own their contents and internal layout, never their own outside margins. Configure a composed primitive through its custom properties instead of duplicating its spacing or layout rules.
- Preserve BEM ownership. Only a block's owning rules style its elements. A modifier accompanies its base class. A page-local stylesheet may define a local block or variant; it must not reach into shared block elements.
- Never use inline `style` attributes, including for custom properties. Resolve styling through existing classes, the appropriate shared stylesheet, then a `page_stylesheet` include for truly page-specific rules.
- Preserve component → semantic → reference color dependencies. Component rules consume semantic color tokens or component tokens derived from them, never literal colors or raw palette tokens. Palette swatches demonstrate reference values; they do not license bypassing the semantic layer elsewhere.

### Source ownership

| Source | Responsibility |
| --- | --- |
| `src/static-assets/stylesheets/lib/design-tokens.css` | Shared palette, semantic color roles, typography, spacing, measures, and other reusable values |
| `reset.css`, `typography.css` in that directory | Semantic element defaults and reusable type roles |
| `layout.css` | Layout primitives and their tuning contracts |
| `components.css`, `forms.css` | Shared component and control anatomy, variants, states, and component tokens |
| `admin-shell.css` | Admin shell structure and presentation |
| `admin-style-guide.css` | Documentation chrome and specimen presentation |
| `src/pages/admin/style-guide/` | Live guidance, specimens, usage examples, metadata, and local specimen layouts |
| `src/templates/base/`, `src/templates/partials/` | Document shells, shared markup, asset links, and scheme initialization |
| `src/static-assets/javascript/site.js` | Progressive browser behavior |
| `src/public/` | Assets requiring fixed root URLs, such as favicons and manifests |

Revise defaults in their owning files. Do not accumulate end-of-file overrides or introduce a new modifier merely to preserve a default the project no longer uses. Use modifiers for variants that need to coexist. Search consumers before renaming or removing tokens/classes and migrate them together.

The public `stylesheet.css` is the shared foundation. `admin.css` imports it before admin-only styles. Keep import dependency order and keep admin-only chrome out of the public bundle. Public pages use the default base template; they must not inherit the style guide's admin shell just to reuse its components.

Prefer extending existing files over creating many small stylesheets. Follow the frontend guide's CSS formatting and section-comment conventions. Document component purpose, markup contract, modifiers, custom properties, states, and meaningful tradeoffs. Update stale comments, including descriptions of replaced starter choices.

Use `assetUrl` for template-linked entrypoints and root-relative logical URLs for CSS/browser-module imports. Follow the asset guide for fonts and images. Keep assets appropriately sized, preserve aspect ratios, and avoid unnecessary downloads. Define font loading in shared CSS with usable fallbacks and a deliberate loading strategy; load only needed faces and weights. Do not install dependencies unless explicitly requested.

### Typography and schemes

Keep shared and admin type roles on fixed `rem` steps. Body copy, navigation, controls, and ordinary headings use those roles. Reserve fluid sizing for bounded, page-local public display text, with `rem` bounds and a `rem` term in the preferred value. Verify enlargement in the browser; the presence of `clamp()` bounds is not proof of accessibility.

Define fonts, scale, weights, line heights, measures, and justified tracking roles together. Check explicit `letter-spacing: 0` in `reset.css` when introducing tracking. Tokens alone do not change consuming rules. Test real fonts, fallbacks, long labels, and wrapping. Do not introduce fonts merely to fill out the editorial brief; type changes must follow the design direction.

If retaining light/dark switching, resolve color pairs at the semantic tier with the current scheme model. Do not scatter color-scheme queries through components. Non-color scheme rules must account for both system preference and explicit user choice.

If changing the scheme model, update all related machinery together: `design-tokens.css`, scheme-dependent `reset.css` rules, the pre-paint script in `src/templates/partials/common-site-meta.html`, toggle markup, `site.js` behavior, storage-key wiring, attribute selectors, and specimens. Remove obsolete pieces. A fixed scheme must set the matching native `color-scheme` and ignore stale stored choices. Update the frontend guide's scheme documentation as well as the Colors page.

Browser behavior uses `data-js-behavior`, separate from styling classes, and the project's existing self-contained behavior blocks. Keep core content and form workflows usable without JavaScript. Clipboard or storage failures must degrade gracefully. Preserve template escaping, form names/actions, validation bindings, and route behavior while restyling.

## 4. Incorporate the Web Copy & Typography Brief

Consider written content carefully. Often a design brief may not contain real content, and it's up to you to come up with copy and placeholder content. Copy can make a design feel as templated as the design itself. See the below section on writing for more guidance.

Complete all five sections below with project-specific decisions before applying copy throughout the assigned surfaces. Use concrete examples from the actual domain. A genuinely irrelevant item may be marked “Not applicable” with a reason. Record unresolved factual questions separately; do not leave bracketed placeholders in finished copy.

Preserve supplied meaning, factual claims, intentional terminology, and information hierarchy. Do not invent features, testimonials, statistics, guarantees, pricing, privacy promises, or other claims. Label illustrative specimen data as examples and never use real credentials. Flag facts requiring input.

Write specific, useful language for the audience. Prefer concrete benefits and actions over praise. Remove filler, repetition, clichés, and unnecessary jargon. Keep a consistent voice while adapting tone to context. Preserve necessary detail when length targets conflict with clarity.

### 1. Brand persona and voice — Aesthetic page

- Three defining voice adjectives, a concrete “We are” description, and “We are not” traits or writing habits.
- Tone goals and website-specific examples for marketing/hero sections, product/UI flows, and errors/system states.
- Preferred point of view: `you/your`, `we/us`, or a defined combination; when each applies; preferred and discouraged examples.
- Intended reader experience, practical writing do/don't examples, and the relationship between the voice and visual direction.

### 2. Structural and layout constraints — Typography page

- Casing for page titles/H1s, H2–H4 subheadings, buttons, and navigation.
- Hero-subhead character and desktop-line targets; feature-card title word targets; card-body character targets; paragraph sentence/word and typical visual-line targets.
- Whether character counts include spaces, which limits are firm versus editorial targets, and exceptions for clarity or necessary detail.
- Actual body, display, UI, and code font choices; classes/roles for titles, headings, introductions, body copy, helper text, and captions.
- Implemented line heights, reading measures, and responsive/wrapping guidance for narrow screens and zoom.

Line counts are layout targets: fonts, content, and viewport width change wrapping. Never force them through clipping, unreadably small type, or unnecessary manual line breaks.

### 3. Microcopy standards — Typography page

- Primary and secondary CTA patterns with project-specific examples. Buttons describe explicit actions; avoid vague “Submit” or “Click here.” Links name their destination or purpose; qualify generic “Learn more” labels.
- Concise visible field labels, consistent placement, and placeholders used only for formatting examples.
- Helper-text placement and word targets, with room for necessary instructions.
- Validation/error patterns that explain the problem and available correction without blame.
- Success messages that confirm the actual outcome and empty states that explain available next steps.

Apply these conventions to live component examples and any production copy included in the assignment, including accessible names and script-generated messages. Keep example instructions consistent with actual workflow behavior.

### 4. Technical and editorial conventions — Typography page

- End punctuation for headlines, subheads, buttons, and card descriptions.
- List capitalization and punctuation; dash usage and spacing; Oxford comma; quotation marks and apostrophes.
- Digits versus words and exceptions; percentages; audience-appropriate dates, times, time zones, currency, and units where relevant.
- A preferred terminology table with preferred term, term to avoid, and context/reason. Do not collapse different domain concepts into one term for superficial consistency.

### 5. Accessibility and inclusivity — Typography page

- Descriptive-link examples that make sense out of context.
- Alt-text rules: describe relevant meaning or function; use empty alt text for decorative images. Aim for concise descriptions, usually under 125 characters, without omitting necessary meaning.
- Audience-appropriate readability target, explanations of necessary specialist terms, and guidance on respectful language, assumptions, and idioms.
- Semantic heading order, readable type, and usable content at narrow widths and increased zoom.

Every field in this completed brief must have a clear home in the live guide. Cross-link Aesthetic and Typography instead of maintaining duplicate rules. Distinguish public marketing guidance from admin UI conventions where needed. Preserve useful technical explanations and specimens, replacing anything that contradicts the final decisions. If implementation changes a decision, update the brief and affected examples together.

## 5. Revise every style-guide section

Review every section for the new identity, factual accuracy, live styling, and editorial consistency. A section need not acquire a different component API to count as reviewed. Retain useful anatomy and accessibility guidance; replace stale values and starter-specific prescriptions. Do not reduce the guide to attractive swatches with no implementation guidance.

| Section under `src/pages/admin/style-guide/` | Required coverage |
| --- | --- |
| Root introduction | Project identity, how to use the guide, design-system boundaries, and accurate navigation/cross-links |
| `aesthetic/` | Visual direction, rationale, assets/imagery, public/admin distinctions, and completed voice decisions |
| `typography/` | Actual fonts, roles, scale, weight, leading, tracking, reading measures, responsive behavior, copy conventions, and live specimens with accurate values |
| `colors/` | Reference and semantic swatches, component-token relationships, supported schemes, permitted foreground/background pairings, brand/status distinctions, and contrast guidance |
| `layout/` | All six primitives, spacing rhythm, measures, thresholds, parent-owned flow, nested composition, and responsive examples |
| `buttons/` | Action/link semantics, hierarchy, supported variants, labels, targets, default/hover/active/focus/disabled states, and toggle specimens only if supported |
| `cards/` | Surface hierarchy, padding, borders/radii/shadows, supported modifiers, semantic content, and valid interactive-card patterns without nested controls |
| `forms/` | `.flow.field-stack`, form measure, action clusters, persistent hints versus errors, native controls, and complete form composition |
| `text-fields/` | Label/control/message anatomy, field types, default/hover/focus/error/read-only/disabled states, targets, and accessible associations |
| `copy-fields/` | Labeled read-only value, unique target wiring, named copy button, success feedback, clipboard-failure/manual-copy fallback, and no-JavaScript usability |
| `multi-line-text-areas/` | Shared field anatomy/states, suitable `rows`, vertical resizing, reading width, and understandable length constraints where used |
| `callouts/` | Neutral/info/warning/error/success roles, readable messages, non-color meaning, optional decorative icons, and appropriate alert/status announcements |

For each reusable component, provide its purpose, when to use it, anatomy, supported variants and states, copyable valid markup, token/custom-property hooks, accessibility behavior, and practical do/don't guidance. Use real shared classes in specimens; do not simulate the finished component with documentation-only styling. Show realistic short and long content.

Update `body.html`, `page.json`, `page.html`, and `page.css` as needed. Keep include bindings, titles, heading outlines, and the style-guide wrapper/navigation accurate. Add discoverable guide coverage for new reusable components. Remove obsolete specimens only after replacing their guidance or confirming the feature was removed; do not discard controls still used in the admin app because they do not appear on the public home page.

Audit shared comments and frontend documentation for assumptions invalidated by the redesign. Once the project aesthetic is established, follow `AGENTS.md` instructions for retiring temporary starter guidance, preserving applicable architecture/documentation links and project rules.

## 6. Preserve accessibility and working behavior

- Keep visible, unobscured keyboard focus on all interactive controls, including against changed surfaces. Do not communicate state only through hover or color.
- Preserve the project's target floors: buttons/copy controls at least `2.5rem` in each target dimension and text fields at least `2.75rem` high; larger targets may suit the brief. These are project design constraints, not a claim that those exact sizes are a universal standard.
- Verify contrast on actual backgrounds in every supported scheme: ordinary text at least 4.5:1, large text and meaningful non-text control/status indicators at least 3:1. Check muted copy, placeholders, links, focus indicators, filled buttons, selection, and error messages. Status colors adequate for graphical marks may fail for body text; keep messages in readable ink or provide a verified semantic text role.
- Keep native select, checkbox, radio, file, and range affordances. Do not replace their internals to match a visual reference.
- Keep visible labels and unique `for`/`id` pairs. Associate every rendered hint/error through `aria-describedby`; mark invalid controls. Separate standing guidance from validation feedback.
- Use `readonly` for selectable, uneditable values and `disabled` for unavailable controls. If using `aria-disabled`, implement the disabled behavior as well as its appearance; the attribute alone does not prevent activation.
- Keep text areas vertically resizable. Preserve copy-field manual selection and polite feedback. Use urgent announcements for actionable errors and non-urgent status announcements appropriately; static specimens should not generate needless alerts.
- Maintain heading hierarchy, landmarks, meaningful accessible names, and non-color status cues. Keep decorative icons out of accessible names. Do not add invalid markup merely to make a whole card clickable.
- Keep essential content usable with scripts unavailable, font loads failing, long strings, and enlarged text. Respect reduced-motion preferences when adding transitions or animation.

## 7. Validate and finish

Check the implementation and the documentation against each other, not just against the brief. A token rename, new font, or changed surface can affect every section and both public/admin bundles.

Use a disposable Local Target Instance when starting a server, as required by `AGENTS.md`; follow `README.md` for create/seed/serve. Keep its credentials out of committed files, screenshots, and reports. Seed a fresh disposable instance when needed to validate later working-tree changes; do not mistake a previously published snapshot for the current source.

Complete and record these checks:

- Visit every style-guide route. Confirm templates/includes render, navigation works, assets/fonts load, and live examples match their stated classes, values, states, and code samples.
- Check representative public pages, admin screens, and admin authentication forms. Confirm shared changes have not leaked admin chrome into public pages or broken controls.
- Inspect desktop and narrow mobile layouts, including a 320 CSS-pixel-wide viewport where practical, long copy/URLs, and 200% text enlargement. Check reflow at high browser zoom, clipping, overflow, reading order, and wrapped actions.
- Exercise keyboard navigation and actual control states: focus, hover/active, disabled, read-only, errors, copy success/failure, text-area resizing, and native controls. Keep style-guide demo submits inert and clearly identified; exercise real workflows only in the disposable instance.
- Check all supported schemes, system preference and explicit selection when applicable, reload behavior, and stale stored preferences after a scheme-model change. Check reduced motion and JavaScript-disabled fallbacks where applicable.
- Measure the relevant contrast pairs; do not infer accessibility from token names or previous starter claims.
- Review HTML/CSS ownership and formatting manually; the JavaScript linter does not check them. Search for inline styles, stale starter prescriptions, obsolete tokens/classes, unresolved placeholders, unsupported claims, and broken cross-links.
- Run `git diff --check`. Lint every changed JavaScript file with `node run-linter.js [pathname ...]`; use `node run-linter.js src/static-assets/javascript` for browser behavior changes. If Node.js or Cloudflare JavaScript changes, read the relevant code/testing guides and run the required full suite with `node run-tests.js`.

Fix discovered regressions within scope. Do not claim browser, contrast, or accessibility checks that were not performed. If tooling or a missing decision blocks verification, identify the affected routes/states and the exact remaining check.

Finish with a concise handoff: design and copy decisions, actual files changed, sections reviewed, validation performed/results, and remaining assumptions or blockers. Link the live-guide source locations and any durable plan/brief. The guide must describe the implemented project, with enough examples and rationale for the next agent to extend it consistently.
