# Frontend Development Guide

This guide covers the frontend development conventions for this project: the live style guide, public and admin layout boundaries, source stylesheet organization, class naming, design tokens, the color-scheme contract, CSS formatting, CSS comments, the page-local stylesheet pattern, and browser JavaScript. For template syntax, see `templates/README.md`. For presentation-layer and HTTP middleware and request handlers, see `app/presentation/README.md`.

## Public Pages Are the Default

This web application provides two different entry points for users:

1. The public website - Publicly available on the Web
2. Admin panel - Administrative and content management "backend" behind an authentication and access gate.

The public website is the default presentation surface. Static public pages should use the default base template, `templates/base/default.html`, which links the public stylesheet entrypoint, `/stylesheets/stylesheet.css`, directly. The current homepage is the canonical example of this default path: root page metadata in `pages/page.json`, route-level markup in `pages/page.html`, public page content in `pages/body.html`, and page-local CSS in `pages/page.css`.

Admin pages are an extension of the public foundation, not the baseline every page inherits. Admin panel routes opt into their shell with `HyperviewPageHandler({ baseTemplateId: 'admin.html' })`, while standalone admin authentication routes use `baseTemplateId: 'admin-login.html'`. Those admin base templates load the admin stylesheet entrypoint, `/stylesheets/admin.css`, which layers admin shell and style-guide rules over the shared public foundations.

## Follow the Style Guide

Before writing or reviewing any frontend markup or CSS, check the live style guide. It is the design reference and a set of working examples built from the project's own primitives and components:

- Start with `pages/admin/style-guide/aesthetic/body.html` — the tone and design philosophy behind every other section, and the line it draws between a structural rule you keep and a default you are expected to change.
- Read the source files under `pages/admin/style-guide/` when you need concrete markup examples. The sections are `aesthetic`, `typography`, `colors`, `layout`, `buttons`, `cards`, `callouts`, `forms`, `text-fields`, `multi-line-text-areas`, and `copy-fields`.
- Served at `/admin/style-guide/<section>` behind the admin auth gate.

The shipped style guide is a place-holder for a default Kixx installation. It is expected to be replaced once a site establishes its own aesthetic; the structural rules in this document outlive it.

Treat the style guide as the source of truth for aesthetic decisions: color use, type roles, spacing rhythm, component anatomy, and state treatment. Its shell and navigation examples are admin examples; copy those only for admin pages. Public pages should borrow the shared tokens, typography roles, layout primitives, and reusable components without inheriting admin-panel chrome by default.

## Never Use Inline Styles

Do not use inline `style="..."` attributes in HTML templates. Inline styles bypass the design system, cannot be reused, and scatter presentation decisions across templates instead of keeping them in stylesheets.

When you need styling, resolve it in this order:

1. **Reuse an existing component, utility, or layout primitive.** Most page structure is a composition of the primitives described below.
2. **Extend an existing shared stylesheet.** If nothing fits and the rule is reusable, add a well-named class to the appropriate file in `src/static-assets/stylesheets/lib/`.
3. **Use a page-local `page_stylesheet` include for genuinely localized styles.** When a style truly belongs to one page and is not reusable, supply it through the `page_stylesheet` include instead of an inline `style` attribute. See app/presentation/README.md to learn how to use page includes.

This rule also applies to CSS custom properties. Do not tune a component with an inline `style` attribute. Put the custom-property override in a modifier class, a reusable class, or the page's local stylesheet.

## File Organization

CSS source lives under `src/static-assets/stylesheets/`. There are two stylesheet bundles with a dedicated entrypoint for each one:

- `src/static-assets/stylesheets/admin.css`
- `src/static-assets/stylesheets/stylesheet.css`

```text
src/static-assets/stylesheets/
├── stylesheet.css          # Public bundle: imports the six shared lib files, in order
├── admin.css               # Admin bundle: imports stylesheet.css, then the two admin files
└── lib/
    ├── design-tokens.css   # The three token tiers, color-scheme roles, type scale, spacing
    ├── reset.css           # Low-specificity browser normalization
    ├── typography.css      # Element type roles (h1-h4, code, kbd, blockquote) + .type-* utilities
    ├── layout.css          # Every Layout primitives + .list-unstyled
    ├── components.css      # .site-header, .site-footer, .button, .theme-toggle, .card, .callout
    ├── forms.css           # .field-stack, .field, .copy-field
    ├── admin-shell.css     # Admin-only: .admin-layout, .admin-header, .admin-nav, .admin-main
    └── admin-style-guide.css  # Admin-only: demo and prose chrome for the style-guide pages
```

`admin.css` does not replace the public bundle, it extends it: its first import is `/stylesheets/stylesheet.css`, and the two admin files layer on top. A rule that belongs on both surfaces goes in `lib/`; only shell chrome and style-guide demo chrome go in the two `admin-*` files.

Templates link to public logical URLs such as `/stylesheets/stylesheet.css` through the `assetUrl` helper, which fingerprints the entrypoint. Source `@import` statements use root-relative logical URLs such as `/stylesheets/lib/layout.css`; those revalidate independently, so never write a relative or fingerprinted path inside a stylesheet. Keep each bundle ordered from low-level foundations to higher-level components.

Before adding a new file to `lib/`, prefer extending one of the existing files. The project favors a handful of well-documented stylesheets over many small files, so related rules stay close to the examples and comments that explain them.

## CSS Formatting

Use the formatting already present in `src/static-assets/stylesheets/`:

- Four spaces for indentation.
- One selector per line when a selector list has multiple selectors.
- One declaration per line.
- A blank line between adjacent rules.
- Opening braces on the selector line.
- Expanded rule blocks, even for one-declaration modifiers.
- No padded inline comments after declarations; put explanatory comments above the declaration or rule they describe.

Example:

```css
.callout--warning {
    --callout-accent: var(--color-status-warning);
}

.callout--error {
    --callout-accent: var(--color-status-danger);
}
```

Keep selectors readable and low-surprise. Prefer classes over complex structural selectors unless the structure is part of the component contract. Structural selectors are acceptable for primitives like `.with-sidebar > :first-child` because the child relationship is the primitive's API.

## CSS Comments

The source stylesheets are also developer documentation. Verbose comments are acceptable because comments are stripped from production build output.

Use a section block for every major file section or public component:

```css
/* -----------------------------------------------------------------------------
    Section title

    Explain what this section owns, when to use it, and any constraints or
    custom properties authors need to understand.
----------------------------------------------------------------------------- */
```

Use short local comments for non-obvious implementation details, browser quirks, accessibility decisions, or intentional tradeoffs. A useful comment explains why the rule exists, what contract it protects, or what would break if it changed. Avoid comments that only restate the declaration.

For component and primitive sections, document the public contract:

- What the class is for.
- When to use it.
- Expected markup structure when relevant.
- Modifier classes.
- Exposed custom properties.
- Important state or accessibility behavior.

## Naming Convention: BEM

Component classes follow Block-Element-Modifier (BEM):

```css
.callout {
    /* block */
}

.callout__body {
    /* element: __ separates block from a part of it */
}

.callout--warning {
    /* modifier: -- separates block from a variant of it */
}
```

BEM in this project is an ownership rule, not just a naming convention:

- **A block owns its internal layout and its elements.** A block never sets its own outside margin — that space belongs to whatever sibling relationship the block sits in (see Flow, below).
- **An element is only ever styled from within its own block's rules.** `.callout__body` is styled in the `.callout` section of `components.css`. No other block's rules may reach into `.callout__body`.
- **A modifier always accompanies its base class in markup** (`class="callout callout--warning"`), never alone. The base class carries the shared rules; the modifier only overrides what varies.
- **Page-local stylesheets may add a new block, a new modifier of an existing block, or a page-scoped rule.** They may not restyle a shared block's elements — that is the shared block's owner reaching an inconsistent hand back into a stylesheet it does not control.
- **Utilities and layout primitives are flat, single-purpose classes**: `.flow`, `.cluster`, `.center`, `.list-unstyled`, `.type-caption`. They are not blocks — they own no elements — they are reusable declaration blocks applied directly to whatever markup needs them. A primitive may carry a `--` modifier that only presets one of its custom properties (`.center--form` sets `--center-max`), but it never gains parts.

### Tuning Instances with Custom Properties

Prefer a scoped CSS custom property over a new modifier class when only a value changes, not the structure. Components commonly expose their own component token, resolved from a semantic token, so a modifier can change one value without repeating the whole rule:

```css
.callout {
    --callout-accent: var(--color-ink);
    border-left: 3px solid var(--callout-accent);
}

.callout--warning {
    --callout-accent: var(--color-status-warning);
}
```

The same pattern is used by layout primitives. For example, `.grid-auto` exposes `--grid-min` and `--grid-space`, `.cluster` exposes `--cluster-space`, and `.center` exposes `--center-max`.

## Design Tokens

`design-tokens.css` defines a three-tier custom-property system. References flow one direction only:

```text
component token  ->  semantic token  ->  reference palette token
```

- **Tier 1 · Reference palette** (`--palette-*`) — raw, theme-agnostic values. This is the only place literal colors such as `hsl()` belong.
- **Tier 2 · Semantic** (`--color-*`) — role- and theme-aware tokens resolved from the palette, often with `light-dark()`. Component rules should read from this tier.
- **Tier 3 · Component** (`--field-border-width`, `--color-field-border`, `--button-border-width`, component-scoped tokens like `--callout-accent`) — resolved component values that keep component declarations declarative.

A component rule must not name a raw `--palette-*` token or a literal color. Use semantic tokens for foregrounds, backgrounds, rules, status marks, focus outlines, and selection colors.

The same tiered thinking applies to spacing (`--space-*`, plus the standalone `--space-page-gutter` and `--space-section-gap`), measures (`--measure-prose`, `--measure-form`), the type scale (`--text-*`, `--leading-*`, `--weight-*`), radii (`--radius-sm`, `--radius-md`, `--control-radius`), and border widths (`--rule-width`, `--hairline-width`, `--button-border-width`, `--accent-border-width`). There is no letter-spacing token: tracking is not a hierarchy tool here. Read the comments in `design-tokens.css` and the relevant style-guide pages before adding a new token.

## Color Scheme and Theming

The site supports light and dark without duplicated stylesheets. Three pieces make that work, and a component rule should not have to touch any of them:

1. `design-tokens.css` sets `color-scheme: light dark` on `:root` and resolves every themed semantic token with `light-dark(<light value>, <dark value>)`.
2. `common-site-meta.html` runs a small inline script before first paint that reads the saved preference from `localStorage` and stamps `data-color-scheme="light"` or `"dark"` on `<html>`. `design-tokens.css` maps that attribute back onto `color-scheme`, so an explicit choice overrides the OS. This script is the one deliberate exception to keeping behavior out of templates: it must run before paint or the page flashes the wrong theme.
3. `site.js` wires the `.theme-toggle` control, writes the choice to `localStorage`, and follows the OS preference while no explicit choice is stored.

Consequences when you write CSS:

- **Never write a `prefers-color-scheme` media query in a component rule.** Put both values in a `light-dark()` semantic token in `design-tokens.css` and read the token.
- **Never write a literal color or a `--palette-*` reference in a component rule** — it will be correct in exactly one scheme.
- **Never assume a theme.** Anything shipped must be legible on both grounds; check both before calling a change done.

## Typography

Choose heading levels for document structure first. If the semantic level is correct but the visual size is wrong, apply the matching `.type-*` utility rather than changing the heading level.

The default font stack is a generic system sans-serif (`--font-body`, `--font-display`), with no downloaded font files. Monospace (`--font-mono`) is reserved for `code`, `pre`, `kbd`, and copy-field values — it is not the project's default voice. A downstream site that wants a web font adds it in its own base template and overrides `--font-body` / `--font-display`; it does not edit the shared token file.

There are two generalized categories of typography used in this project:

1. The public website - usually for marketing purposes
2. The admin panel - purely utility

### Typography for the Admin Panel

Do not use color, italics, negative tracking, or decoration to create hierarchy. Hierarchy comes from size, weight, spacing, and structure. Type sizes are fixed `rem` steps from the `--text-*` scale so browser zoom stays predictable (WCAG 1.4.4 Resize Text). This is the default for all app, admin, and reading text — reach for it unless you are building a marketing page.

### Typography for Public Marketing Pages

Public marketing pages (the home page and its kin) may, and are encouraged to, use fluid `clamp()` sizing for the large *display* type that carries the page — a hero title, an oversized background motif, a lede — where the size should track the viewport instead of jumping at a breakpoint. Keep it to that expressive display type: body copy, reading text, and anything in app or admin UI stays on the fixed `--text-*` scale. Put the fluid rules in the page's own `page_stylesheet`, never in the shared token or stylesheet files.

When you do reach for fluid type, keep it zoom-safe so it does not regress WCAG 1.4.4: give `clamp()` a `rem` minimum and a `rem` maximum, and make the preferred (middle) value include a `rem` term — e.g. `clamp(2.75rem, calc(2.125rem + 1.8vw), 3.75rem)`. The `rem` base means browser zoom still scales the text; the `vw` term only adds viewport responsiveness on top. Never use a bare `vw` preferred value: it ignores zoom.

## Layout Primitives

`layout.css` defines a small family of composable, single-purpose layout primitives in the Every Layout tradition. Each is one class tuned by scoped custom properties. Compose these before writing a new `display: flex` or `display: grid` rule. Most page structure should be a nesting of these primitives.

The family, all defined in `layout.css`:

| Class | Use for | Custom properties |
| --- | --- | --- |
| `.flow` | Vertical document rhythm between siblings | `--flow-space` |
| `.cluster` | Wrapping horizontal groups: toolbars, button rows, chips | `--cluster-space`, `--cluster-align`, `--cluster-justify` |
| `.grid-auto` | Auto-fit responsive tracks: galleries, swatches, card rows | `--grid-min`, `--grid-space` |
| `.switcher` | Row that flips to one-per-row below a threshold, no media query | `--switcher-threshold`, `--switcher-space` |
| `.with-sidebar` | Fixed-ish rail beside fluid content; wraps when tight | `--sidebar-width`, `--sidebar-content-min`, `--sidebar-space` |
| `.center` | Measure-capped, horizontally centered column | `--center-max` |

`.center` ships two preset modifiers: `.center--form` (`--measure-form`) for standalone form pages and `.center--site` (68rem) for the default public shell. `layout.css` also holds `.list-unstyled`, a plain utility for lists whose semantics matter but whose markers do not.

`.cluster`, `.grid-auto`, `.switcher`, and `.with-sidebar` are `gap`-based and exist for two-dimensional or inline arrangement. `.flow` is different on purpose: it owns vertical document rhythm, not a flex column, and is implemented as the "lobotomized owl":

```css
.flow > * + * {
    margin-block-start: var(--flow-space, var(--space-sm));
}
```

- **Spacing is a relationship between siblings, and the parent `.flow` owns it.** Components never set their own vertical margins — that would fight the flow container for the same space.
- **The container tunes the default rhythm** by declaring `--flow-space` on itself; every child inherits it. Do not set `--flow-space` on the `.flow` rule in shared CSS — the default lives in the `var()` fallback so that a child's own value always wins over an inherited one.
- **A child overrides for itself alone** by declaring `--flow-space` on that one child — this changes the space *above that child only*, not the rhythm of its siblings.
- **Nesting is safe** because a nested `.flow` only applies margins to its own direct children; it never reaches into a descendant's descendants.

Do not use `.flow` to build a flex column, and do not set `display: flex` on `.flow`.

When a primitive needs shell-specific defaults, scope those defaults to the shell class. For example, `.admin-layout` in `admin-shell.css` sets `--sidebar-content-min` (100%, dropping to 60% past its one `52rem` breakpoint) for the admin shell built on `.with-sidebar`; the primitive itself stays breakpoint-free and generally reusable.

## Composition

Page structure is layout primitives → blocks → elements, in that order of responsibility:

- A layout primitive (`.flow`, `.cluster`, `.with-sidebar`, …) and a block class (`.card`, `.callout`, …) may coexist on the same element — `<div class="card flow">` is the normal, expected composition.
- A layout class never carries block styling, and a block never lays out its siblings — that is the layout primitive's job.
- A block's *internal* layout may use primitives on its own child elements (for example `<div class="callout__body flow">`), but the block itself does not reimplement `gap` or margin spacing that a primitive already provides.

## When to Add What

| Situation | Where it goes |
| --- | --- |
| A value changes on one instance, structure stays the same | A scoped CSS custom property override, set on that instance |
| A variant of an existing block | A modifier class (`.block--modifier`) in the block's file |
| A reusable declaration block with no parts | A utility class in `layout.css` or `typography.css` |
| A new reusable component with parts | A new block in `components.css` or `forms.css` |
| Styling that belongs to exactly one page | The page's `page_stylesheet` include |
| A new color or size is needed | Check existing tokens first (`design-tokens.css`); add a token only if nothing fits |
| A color must differ between light and dark | A `light-dark()` semantic token in `design-tokens.css`, never a media query in the component |
| Interactive behavior on a component | A `data-js-behavior` hook plus an IIFE in `static-assets/javascript/site.js` |
| Chrome that only the admin shell needs | `admin-shell.css`, never the shared `lib/` files |

## Components and Forms

Reusable components live in `components.css` and `forms.css`. Copy their documented anatomy instead of inventing parallel markup — every one of them declares its expected structure, modifiers, and exposed tokens in the section comment above it.

| Block | File | Modifiers |
| --- | --- | --- |
| `.site-header` / `.site-footer` | `components.css` | — |
| `.button` | `components.css` | `--primary`, `--danger` |
| `.theme-toggle` | `components.css` | Composed as `class="button theme-toggle"` |
| `.card` | `components.css` | `--flush`, `--sunken`, `--accent-primary`, `--accent-secondary` |
| `.callout` | `components.css` | `--info`, `--success`, `--warning`, `--error` |
| `.field-stack` / `.field` | `forms.css` | `.field--choice`, `.field--error` |
| `.copy-field` | `forms.css` | — |

Admin shell blocks (`.admin-layout`, `.admin-header`, `.admin-nav`, `.admin-main`, `.admin-content-section`) live in `admin-shell.css` and are for admin pages only. The `.doc-*`, `.specimen*`, `.demo-*`, and `.guideline*` blocks in `admin-style-guide.css` are chrome for the style-guide pages themselves — do not reuse them in application markup.

Component state should be visible, semantic, and restrained. Buttons invert or shift border color; destructive actions use the danger signal; focus uses `--color-focus-outline`.

The shipped defaults are neutral on purpose: a small border radius, hairline borders, no shadows, a single link accent color. These are defaults, not rules — a downstream site is expected to change them. Change them through tokens first (`--radius-sm`, `--radius-md`, `--control-radius`, the `--color-*` tier), and through a new modifier class second, before reaching for a one-off override.

## Browser JavaScript

Browser JavaScript lives in `src/static-assets/javascript/` and is deliberately small:

```text
src/static-assets/javascript/
└── site.js            # The single entrypoint, loaded by every base template
```

All three base templates end `<body>` with the same tag:

```html
<script type="module" src="{{ assetUrl assets "/javascript/site.js" }}"></script>
```

Conventions:

- **Behavior is attached by a `data-js-behavior` attribute, never by a style class.** `site.js` finds its work with `document.querySelectorAll('[data-js-behavior="theme-toggle"]')` and `document.querySelectorAll('[data-js-behavior="copy-field"]')`. A class is for styling; an attribute hook is for behavior, so restyling a component cannot break its script and vice versa.
- **Progressive enhancement is the contract.** Every component must be usable with JavaScript disabled or failed. `.copy-field` is the reference case: without the script the value is still a selectable read-only input; the script adds click-to-select and a clipboard write, and falls back to a "press Cmd+C" status message when the Clipboard API is missing or denied.
- **Missing markup is a warning, not a throw.** A behavior whose required attributes or target elements are absent logs to the console and skips that one element, so one broken control cannot disable every other control on the page.
- **Vanilla DOM APIs only. No dependencies, no DOM wrapper, no build step, no bundler, no npm package for the browser.** Use `querySelector`/`querySelectorAll`, `addEventListener`, `dataset`, `classList`, and `textContent` directly. A jQuery-shaped wrapper (`kquery.js`) was removed: it added a layer to learn, and because a wrapper instance is always truthy it silently swallowed missing-element bugs that plain nodes surface immediately.
- **Guard for absent nodes explicitly.** `querySelector` returns `null` and `getElementById` returns `null`; check before use, and skip that one element rather than throwing.
- **ES modules, root-relative imports.** If `site.js` ever grows a second module, import it by a root-relative logical URL such as `'/javascript/lib/thing.js'`, never a relative path — a relative import would inherit the entrypoint's fingerprint hash, and hash-addressed reads would return the entrypoint blob for the dependency request. Only the template-linked entrypoint goes through `assetUrl`.
- **Browser sources are linted at `ecmaVersion: 2017`** (see the browser block in `eslint.config.js`), so `async`/`await` is available but optional chaining and `??` are not.

New behavior belongs in `site.js` as another self-contained IIFE keyed off its own `data-js-behavior` value. Reach for a page-local script only when the behavior is genuinely specific to one page.

## Page-Local Styles via `page_stylesheet`

All three base templates (`default.html`, `admin.html`, `admin-login.html`) conditionally render a `page_stylesheet` include into a `<style>` element in the document `<head>`:

```html
{{#if includes.page_stylesheet }}
<style>{{{ includes.page_stylesheet }}}</style>
{{/if}}
```

To supply page-local CSS, add a `page_stylesheet` entry to the page's `includes` in its `page.json`, pointing at a CSS file in the same page directory:

```json
{
    "includes": {
        "page_stylesheet": { "filename": "page.css" }
    }
}
```

`pages/admin/style-guide/colors/` is a working example of this pattern: `colors/page.json` includes both `body.html` and `page.css`, keeping one-page layout rules out of the shared stylesheets. The public homepage at `pages/` uses the same pattern. Most of the style-guide subdirectories carry a `page.css` — read one before writing your own.

This is the supported pattern for localized styles. Reach for `page_stylesheet` only when the styling is specific to one page and is not worth generalizing into `src/static-assets/stylesheets/lib/`.
